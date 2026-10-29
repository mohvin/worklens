"""Stage 3: label each step with Muse Spark.

For every step the model sees the first and the last frame of the step, the
first frame of the next step (the result of the action), and, when SAM 3.1
isolated the UI element that changed as this step began, a crop of that
element. It returns what the user did as strict JSON: application, action,
object, data fields touched, confidence.
Steps run in a small thread pool; results are cached so re-runs are free.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

from .llm import LLMClient
from .models import Run, Step, StepLabel

CROP_PAD = 12  # pixels of context around the changed element
MIN_CROP = 48  # elements smaller than this are not worth a crop

SYSTEM = (
    "You are WorkLens, a process-mining assistant. You look at screen recordings of "
    "office work and name what the user did in one step. A step is the time spent on one "
    "screen state; the user's action on that screen is what moved them to the next screen. "
    "Be concrete and short: application is the product name on screen (e.g. 'Mail', "
    "'ERP - Accounts Payable', 'Sheets'); action is a verb phrase describing what the user "
    "did on this screen (e.g. 'select invoice email', 'open attachment', 'read invoice PDF', "
    "'fill invoice form', 'check PO in register', 'submit invoice', 'send approval reply'); "
    "object is the business thing acted on (an invoice number, a PO, a file name); "
    "data_fields lists field names or values visibly entered or read. Use 'wait for ...' "
    "ONLY when a loading indicator or progress bar is visible. Never invent values not "
    "visible. Return only JSON matching the schema."
)

USER_TEXT = (
    "Image 1: the screen when this step began ({t0:.0f}s). "
    "Image 2: the same screen when the step ended ({t1:.0f}s), {dur:.0f} seconds later. "
    "{next_hint}"
    "What did the user do on this screen?"
)
NEXT_HINT = "Image 3: the screen that appeared right after, the result of the user's action. "
CHANGE_HINT = "Image {n}: a close-up of the part of the screen that changed when this step began (segmented by SAM 3.1). "

SCHEMA = {
    "type": "object",
    "properties": {
        "application": {"type": "string"},
        "action": {"type": "string"},
        "object": {"type": "string"},
        "data_fields": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number"},
    },
    "required": ["application", "action", "object", "data_fields", "confidence"],
    "additionalProperties": False,
}


def _frame_path(run: Run, run_dir: Path, index: int) -> Path:
    return run_dir / run.frames[index].path


def change_crop(run: Run, run_dir: Path, step: Step, out_dir: Path) -> Path | None:
    """Crop of the SAM-segmented element that changed at the start of this step."""
    b = next((b for b in run.boundaries if b.frame_after == step.frame_start), None)
    if b is None or not b.change_box:
        return None
    x1, y1, x2, y2 = b.change_box
    if x2 - x1 < MIN_CROP or y2 - y1 < MIN_CROP:
        return None
    src = _frame_path(run, run_dir, step.frame_start)
    with Image.open(src) as im:
        w, h = im.size
        if (x2 - x1) * (y2 - y1) > 0.6 * w * h:
            return None  # nearly the whole screen: the full frame already shows it
        box = (max(0, x1 - CROP_PAD), max(0, y1 - CROP_PAD), min(w, x2 + CROP_PAD), min(h, y2 + CROP_PAD))
        out = out_dir / f"change_{step.index}.jpg"
        im.crop(box).save(out, "JPEG", quality=90)
    return out


def label_step(client: LLMClient, run: Run, run_dir: Path, step: Step, crop_dir: Path) -> Step:
    images = [_frame_path(run, run_dir, step.frame_start), _frame_path(run, run_dir, step.frame_end)]
    next_hint = ""
    if step.index + 1 < len(run.steps):
        images.append(_frame_path(run, run_dir, run.steps[step.index + 1].frame_start))
        next_hint = NEXT_HINT
    crop = change_crop(run, run_dir, step, crop_dir)
    if crop is not None:
        images.append(crop)
        next_hint += CHANGE_HINT.format(n=len(images))
    text = USER_TEXT.format(t0=step.t_start, t1=step.t_end, dur=step.duration, next_hint=next_hint)
    data, call = client.structured(SYSTEM, text, images, SCHEMA, "step_label")
    step.label, step.label_error = None, None
    if data is None:
        step.label_error = call.error
        return step
    try:
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0))))
        step.label = StepLabel.model_validate(data)
    except Exception as e:  # noqa: BLE001 - schema drift is a label error, not a crash
        step.label_error = f"invalid label: {e}"[:300]
    return step


def label(run: Run, run_dir: Path, client: LLMClient, workers: int = 4) -> Run:
    crop_dir = run_dir / "crops"
    crop_dir.mkdir(exist_ok=True)
    with ThreadPoolExecutor(max_workers=workers) as pool:
        run.steps = list(pool.map(lambda s: label_step(client, run, run_dir, s, crop_dir), run.steps))
    run.model_calls.extend(client.calls)
    client.calls.clear()
    run.status = "labelled"
    return run
