"""The whole pipeline in one call, with a progress callback.

Used by the CLI (prints each stage) and by the Modal worker (writes each stage
to the run record so the web page can show progress).
"""
from __future__ import annotations

import os
import shutil
from collections.abc import Callable
from pathlib import Path

from .detect import SamChangeSegmenter, detect
from .export import to_bpmn
from .graph import build
from .label import label
from .llm import LLMClient, LLMConfig
from .models import Run
from .rules import run_rules
from .sam import SamClient
from .sample import kept_frames, sample
from .store import RunStore

Progress = Callable[[str, Run, str], None]  # (stage, run, human-readable line)


def _noop(stage: str, run: Run, line: str) -> None:
    pass


def seed_cache(run_dir: Path, cache: Path) -> int:
    n = 0
    for f in cache.glob("*.json"):
        shutil.copy(f, run_dir / "cache" / f.name)
        n += 1
    return n


def run_pipeline(
    run: Run,
    run_dir: Path,
    video: Path,
    store: RunStore,
    *,
    fps: float = 1.0,
    do_label: bool = True,
    workers: int = 4,
    segment: str = "auto",
    progress: Progress = _noop,
) -> Run:
    r = sample(run, run_dir, video, fps=fps)
    store.save(r)
    progress("sampling", r, f"sampled {len(r.frames)} frames, kept {len(kept_frames(r))} after de-dupe ({r.duration:.0f}s)")

    use_sam = segment == "sam" or (segment == "auto" and bool(os.environ.get("MODEL_API_KEY")))
    if use_sam:
        sam = SamClient(os.environ["MODEL_API_KEY"], run_dir / "cache")
        r = detect(r, run_dir, segmenter=SamChangeSegmenter(sam, workers=workers))
        seg = [c for c in r.model_calls if c.stage == "segment"]
        fresh = [c for c in seg if not c.cached]
        elements = sum(1 for x in r.regions if x.kind == "changed element")
        line = (
            f"detected {len(r.boundaries)} boundaries -> {len(r.steps)} steps; sam-3.1 segmented the changed element at "
            f"{elements} of them ({len(r.regions) - elements} full-screen switches): {len(fresh)} API calls, {len(seg) - len(fresh)} cached"
        )
    else:
        r = detect(r, run_dir)
        line = f"detected {len(r.boundaries)} boundaries -> {len(r.steps)} steps (pixel-diff only)"
    store.save(r)
    progress("detecting", r, line)

    if do_label:
        client = LLMClient(LLMConfig.from_env(), run_dir / "cache")
        r = label(r, run_dir, client, workers=workers)
        store.save(r)
        ok = sum(1 for s in r.steps if s.label)
        lab = [c for c in r.model_calls if c.stage == "label"]
        fresh = [c for c in lab if not c.cached]
        progress(
            "labelling", r,
            f"labelled {ok}/{len(r.steps)} steps with {client.cfg.model}: "
            f"{len(fresh)} API calls, {len(lab) - len(fresh)} cached, ${r.total_cost_usd:.4f}",
        )

    r = run_rules(build(r))
    store.save(r)
    (run_dir / "run.bpmn").write_text(to_bpmn(r))
    progress(
        "building", r,
        f"built graph: {len(r.graph.nodes)} nodes, {len(r.graph.edges)} edges, "
        f"{r.summary.app_switches} app switches, {r.summary.loops} loops; {len(r.findings)} findings",
    )
    return r


def frames_to_publish(run: Run) -> list[int]:
    """Frame indexes the findings view needs: kept, evidence, and every boundary's before/after."""
    need = {f.index for f in run.frames if f.kept}
    need |= {i for f in run.findings for i in f.evidence_frames}
    need |= {b.frame_before for b in run.boundaries} | {b.frame_after for b in run.boundaries}
    for s in run.steps:
        need |= {s.frame_start, s.frame_end}
    return sorted(i for i in need if 0 <= i < len(run.frames))
