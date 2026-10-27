"""Stage 3: label each step with Muse Spark.

For every step the model sees two frames, the first and the last of the
step, and returns what the user did between them as strict JSON:
application, action, object, data fields touched, confidence.
Steps run in a small thread pool; results are cached so re-runs are free.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from .llm import LLMClient
from .models import Run, Step, StepLabel

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


def label_step(client: LLMClient, run: Run, run_dir: Path, step: Step) -> Step:
    images = [_frame_path(run, run_dir, step.frame_start), _frame_path(run, run_dir, step.frame_end)]
    next_hint = ""
    if step.index + 1 < len(run.steps):
        images.append(_frame_path(run, run_dir, run.steps[step.index + 1].frame_start))
        next_hint = NEXT_HINT
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
    with ThreadPoolExecutor(max_workers=workers) as pool:
        run.steps = list(pool.map(lambda s: label_step(client, run, run_dir, s), run.steps))
    run.model_calls.extend(client.calls)
    client.calls.clear()
    run.status = "labelled"
    return run
