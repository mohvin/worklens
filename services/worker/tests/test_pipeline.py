"""Offline tests: sampling and boundary detection on the synthetic recording.

No model calls. Regenerate the recording with `python samples/make_synthetic.py`.
"""
from __future__ import annotations

import shutil
from pathlib import Path

import pytest

from worklens_worker.detect import cut_steps, detect
from worklens_worker.sample import kept_frames, sample
from worklens_worker.store import RunStore

REPO = Path(__file__).resolve().parents[3]
VIDEO = REPO / "samples" / "synthetic-invoice.mp4"

pytestmark = pytest.mark.skipif(
    not VIDEO.exists() or shutil.which("ffmpeg") is None, reason="needs ffmpeg and the sample video"
)


@pytest.fixture(scope="module")
def run_and_dir(tmp_path_factory):
    store = RunStore(tmp_path_factory.mktemp("runs"))
    run, run_dir = store.new_run(VIDEO)
    run = sample(run, run_dir, VIDEO)
    run = detect(run, run_dir)
    return run, run_dir


def test_sampler_dedupes_most_frames(run_and_dir):
    run, _ = run_and_dir
    assert 90 <= len(run.frames) <= 100
    assert len(kept_frames(run)) < len(run.frames) * 0.3


def test_detector_finds_the_scripted_screens(run_and_dir):
    run, _ = run_and_dir
    # The script has 12 screen states: inbox, selected, open mail, pdf, ERP load,
    # form, sheet, form, inbox, open mail, reply, inbox.
    assert 11 <= len(run.boundaries) <= 13
    assert len(run.steps) == len(run.boundaries) + 1


def test_steps_cover_the_recording(run_and_dir):
    run, _ = run_and_dir
    steps = cut_steps(run)
    assert steps[0].t_start == 0.0
    assert abs(steps[-1].t_end - run.duration) < 1.5
    for a, b in zip(steps, steps[1:]):
        assert a.t_end == b.t_start
        assert a.frame_end + 1 == b.frame_start


def test_long_wait_is_the_longest_step(run_and_dir):
    run, _ = run_and_dir
    longest = max(run.steps, key=lambda s: s.duration)
    assert 19 <= longest.duration <= 23  # the 21 s ERP page load
