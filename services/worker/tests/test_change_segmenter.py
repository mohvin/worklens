"""SAM change segmentation with a fake client, on the real sample frames (no API)."""
from __future__ import annotations

from pathlib import Path

from worklens_worker.detect import SamChangeSegmenter, cut_steps
from worklens_worker.imageops import changed_regions
from worklens_worker.label import change_crop
from worklens_worker.models import Boundary, Frame, ModelCall, Run
from worklens_worker.sam import Box, box_prompt

FRAMES = Path(__file__).resolve().parents[3] / "samples" / "runs" / "synthetic-invoice" / "frames"


class FakeSam:
    """Returns the prompted box shrunk by 2px, like SAM tightening a diff box."""

    def __init__(self):
        self.calls = []
        self.prompts = []

    def segment_box(self, image, box, retries=1):
        self.prompts.append((image.name, box))
        x1, y1, x2, y2 = box
        self.calls.append(ModelCall(stage="segment", model="sam-3.1", cache_key="k", cached=False, latency_s=0.1))
        return [Box(x1 + 2, y1 + 2, x2 - 2, y2 - 2, 0.91)], self.calls[-1]


def make_run() -> tuple[Run, Path]:
    names = ["f00001.jpg", "f00005.jpg", "f00007.jpg", "f00013.jpg"]  # inbox, selected, open mail, pdf
    run = Run(id="t", source="t.mp4", duration=4.0, frame_width=1280, frame_height=720)
    run.frames = [Frame(index=i, t=float(i), path=f"frames/{n}", phash="0") for i, n in enumerate(names)]
    run.boundaries = [
        Boundary(index=0, t=1.0, frame_before=0, frame_after=1, score=0.05),
        Boundary(index=1, t=2.0, frame_before=1, frame_after=2, score=0.09),
        Boundary(index=2, t=3.0, frame_before=2, frame_after=3, score=0.4),
    ]
    return run, FRAMES.parent


def test_changed_regions_find_the_selected_row():
    boxes, frac = changed_regions(FRAMES / "f00001.jpg", FRAMES / "f00005.jpg")
    assert 0.03 < frac < 0.08
    x1, y1, x2, y2 = boxes[0]
    assert 290 < x1 < 330 and 60 < y1 < 80 and x2 > 1200 and 120 < y2 < 150  # the highlighted inbox row


def test_segmenter_attaches_elements_and_skips_full_screen(tmp_path):
    run, run_dir = make_run()
    sam = FakeSam()
    run = SamChangeSegmenter(sam, workers=1, full_screen=0.3).apply(run, run_dir)
    assert len(sam.prompts) == 2  # the third boundary (mail -> pdf) is above the full-screen threshold
    assert run.boundaries[0].change_box is not None and run.boundaries[0].changed_fraction > 0
    assert run.boundaries[2].change_box is None
    kinds = [r.kind for r in run.regions]
    assert kinds == ["changed element", "changed element", "screen change"]
    assert run.regions[0].confidence == 0.91
    assert len(run.model_calls) == 2 and all(c.stage == "segment" for c in run.model_calls)
    # the labeller crops the element for the step that begins at that boundary
    run.steps = cut_steps(run)
    crop = change_crop(run, run_dir, run.steps[1], tmp_path)
    assert crop is not None and crop.exists()
    assert change_crop(run, run_dir, run.steps[3], tmp_path) is None  # full-screen change: no crop


def test_box_prompt_grammar():
    assert box_prompt((10, 20, 110, 60), 1280, 720) == "<0f>1<|box;x1=10;y1=20;x2=109;y2=59;w=1280;h=720|>"
