"""Stage 2: find step boundaries and what changed at each one.

* PixelDiffDetector: a boundary fires when more than `threshold` of thumbnail
  pixels change between consecutive frames and the new state holds for at
  least `settle` frames. Runs over ALL sampled frames (cheap).
* SamChangeSegmenter (Meta SAM 3.1): for every boundary, pixel-diff locates
  the changed area of the new frame; SAM is prompted with that box and returns
  the exact UI element that changed (the dialog, the form, the opened email).
  A change covering most of the screen is a screen switch and needs no call.
  The element's box goes on the boundary (the labeller crops it for Muse
  Spark) and on run.regions (the UI draws it over the frame).

Steps are then cut between boundaries.
"""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Protocol

from .imageops import changed_fraction, changed_regions
from .models import Boundary, Region, Run, Step
from .sam import SamClient

BOUNDARY_CHANGE = 0.02  # fraction of thumbnail pixels; tuned on samples/synthetic-invoice.mp4
SETTLE_FRAMES = 1       # new state must persist this many frames to count


class Detector(Protocol):
    def boundaries(self, run: Run, run_dir: Path) -> list[Boundary]: ...


class PixelDiffDetector:
    def __init__(self, threshold: float = BOUNDARY_CHANGE, settle: int = SETTLE_FRAMES):
        self.threshold = threshold
        self.settle = settle

    def boundaries(self, run: Run, run_dir: Path) -> list[Boundary]:
        frames = run.frames
        out: list[Boundary] = []
        i = 1
        while i < len(frames):
            score = changed_fraction(run_dir / frames[i - 1].path, run_dir / frames[i].path)
            if score > self.threshold:
                # settle: the next `settle` frames must stay close to frame i
                stable = all(
                    changed_fraction(run_dir / frames[i].path, run_dir / frames[j].path) <= self.threshold
                    for j in range(i + 1, min(i + 1 + self.settle, len(frames)))
                )
                if stable or i + 1 >= len(frames):
                    out.append(
                        Boundary(
                            index=len(out),
                            t=frames[i].t,
                            frame_before=frames[i - 1].index,
                            frame_after=frames[i].index,
                            score=round(score, 4),
                            method="pixel-diff",
                        )
                    )
            i += 1
        return out


FULL_SCREEN = 0.5  # the screen switched when this much of it changed, or the changed area spans this much of it


class SamChangeSegmenter:
    """Attach the SAM-segmented changed element to every boundary."""

    def __init__(self, client: SamClient, workers: int = 4, full_screen: float = FULL_SCREEN):
        self.client = client
        self.workers = workers
        self.full_screen = full_screen

    def _one(self, run: Run, run_dir: Path, b: Boundary) -> tuple[Boundary, Region | None]:
        before = run_dir / run.frames[b.frame_before].path
        after = run_dir / run.frames[b.frame_after].path
        boxes, fraction = changed_regions(before, after)
        b.changed_fraction = round(fraction, 4)
        if not boxes:
            return b, None
        w, h = run.frame_width, run.frame_height
        x1, y1, x2, y2 = boxes[0]
        coverage = (x2 - x1) * (y2 - y1) / (w * h) if w and h else 0.0
        if fraction >= self.full_screen or coverage >= self.full_screen:
            return b, Region(frame=b.frame_after, kind="screen change", x1=0, y1=0, x2=w, y2=h, confidence=1.0)
        found, _ = self.client.segment_box(after, boxes[0])
        best = max(found, key=lambda x: x.confidence, default=None)
        if best is None or best.area == 0:
            x1, y1, x2, y2 = boxes[0]  # SAM found nothing: keep the raw diff box
            region = Region(frame=b.frame_after, kind="changed element", x1=x1, y1=y1, x2=x2, y2=y2, confidence=0.0)
        else:
            region = Region(frame=b.frame_after, kind="changed element", x1=best.x1, y1=best.y1, x2=best.x2, y2=best.y2, confidence=round(best.confidence, 4))
        b.change_box = [region.x1, region.y1, region.x2, region.y2]
        return b, region

    def apply(self, run: Run, run_dir: Path) -> Run:
        with ThreadPoolExecutor(max_workers=self.workers) as pool:
            results = list(pool.map(lambda b: self._one(run, run_dir, b), run.boundaries))
        run.boundaries = [b for b, _ in results]
        run.regions = [r for _, r in results if r is not None]
        run.model_calls.extend(self.client.calls)
        self.client.calls.clear()
        return run


def cut_steps(run: Run) -> list[Step]:
    """One step per span between boundaries, covering the whole recording."""
    if not run.frames:
        return []
    last = run.frames[-1]
    end_t = max(run.duration, last.t + 1 / run.fps_sampled)
    starts = [(0.0, 0)] + [(b.t, b.frame_after) for b in run.boundaries]
    steps: list[Step] = []
    for k, (t0, f0) in enumerate(starts):
        if k + 1 < len(starts):
            t1, f1 = starts[k + 1][0], starts[k + 1][1] - 1
        else:
            t1, f1 = end_t, last.index
        steps.append(
            Step(index=k, t_start=t0, t_end=t1, duration=round(t1 - t0, 3), frame_start=f0, frame_end=f1)
        )
    return steps


def detect(run: Run, run_dir: Path, detector: Detector | None = None, segmenter: SamChangeSegmenter | None = None) -> Run:
    detector = detector or PixelDiffDetector()
    run.boundaries = detector.boundaries(run, run_dir)
    if segmenter is not None:
        run = segmenter.apply(run, run_dir)
    run.steps = cut_steps(run)
    run.status = "detected"
    return run
