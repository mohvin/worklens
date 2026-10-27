"""Stage 2: find step boundaries, the moments the screen state changes.

Two detectors share one interface:

* PixelDiffDetector (default, no model): a boundary fires when more than
  `threshold` of thumbnail pixels change between consecutive frames and the
  new state holds for at least `settle` frames. Runs over ALL sampled frames
  (cheap), so a dropped near-duplicate can still be the "before" frame.
* SamDetector (Meta SAM 3.1): segments each kept frame into UI regions and
  fires when the set of regions changes. Wired in once Meta Model API access
  is confirmed; until then it raises NotImplementedError.

Steps are then cut between boundaries.
"""
from __future__ import annotations

from pathlib import Path
from typing import Protocol

from .imageops import changed_fraction
from .models import Boundary, Run, Step

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


class SamDetector:
    """Meta SAM 3.1 region-change detector. Adapter stub until API access is live."""

    def __init__(self, client):  # noqa: ANN001 - client type lands with the adapter
        self.client = client

    def boundaries(self, run: Run, run_dir: Path) -> list[Boundary]:
        raise NotImplementedError("SAM 3.1 adapter: pending Meta Model API access")


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


def detect(run: Run, run_dir: Path, detector: Detector | None = None) -> Run:
    detector = detector or PixelDiffDetector()
    run.boundaries = detector.boundaries(run, run_dir)
    run.steps = cut_steps(run)
    run.status = "detected"
    return run
