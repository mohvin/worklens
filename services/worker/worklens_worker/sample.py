"""Stage 1: sample frames from the recording and drop near-duplicates.

ffmpeg extracts one frame per second as JPEG. A perceptual hash (pHash) is
computed for each; a frame whose hash is within `dup_threshold` bits of the
last kept frame is marked kept=False. On a typical screen recording this
removes 60-80% of frames before any model is called.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path

import imagehash
from PIL import Image

from .imageops import changed_fraction
from .models import Frame, Run

JPEG_QUALITY = 4  # ffmpeg -q:v scale, 2 best .. 31 worst
MAX_WIDTH = 1280  # downscale wide recordings; models do not need 4K
KEEP_CHANGE = 0.02  # fraction of thumbnail pixels changed since the last kept frame


def probe_duration(video: Path) -> float:
    """Container duration; falls back to decoding the stream when the container has none
    (WebM written by a browser's MediaRecorder carries no duration header)."""
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration:stream=duration", "-of", "json", str(video)],
        check=True, capture_output=True, text=True,
    ).stdout
    info = json.loads(out)
    for d in [info.get("format", {}).get("duration")] + [st.get("duration") for st in info.get("streams", [])]:
        try:
            if d is not None and float(d) > 0:
                return float(d)
        except (TypeError, ValueError):
            pass
    # decode without output; ffmpeg reports the last timestamp on stderr ("time=00:01:21.40")
    err = subprocess.run(
        ["ffmpeg", "-v", "info", "-nostats", "-i", str(video), "-f", "null", "-"],
        capture_output=True, text=True,
    ).stderr
    m = re.findall(r"time=(\d+):(\d+):(\d+(?:\.\d+)?)", err)
    if m:
        h, mi, se = m[-1]
        return int(h) * 3600 + int(mi) * 60 + float(se)
    raise ValueError(f"could not determine the duration of {video.name}")


def extract_frames(video: Path, out_dir: Path, fps: float = 1.0) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    pattern = out_dir / "f%05d.jpg"
    subprocess.run(
        [
            "ffmpeg", "-v", "error", "-y", "-i", str(video),
            "-vf", f"fps={fps},scale='min({MAX_WIDTH},iw)':-2",
            "-q:v", str(JPEG_QUALITY), str(pattern),
        ],
        check=True,
    )
    return sorted(out_dir.glob("f*.jpg"))


def sample(run: Run, run_dir: Path, video: Path, fps: float = 1.0, dup_threshold: int = 4) -> Run:
    run.duration = probe_duration(video)
    run.fps_sampled = fps
    paths = extract_frames(video, run_dir / "frames", fps)
    if paths:
        with Image.open(paths[0]) as im:
            run.frame_width, run.frame_height = im.size

    frames: list[Frame] = []
    last_kept: imagehash.ImageHash | None = None
    last_kept_path: Path | None = None
    for i, p in enumerate(paths):
        with Image.open(p) as im:
            h = imagehash.phash(im)
        # pHash alone misses small text changes on screens, so a frame is also
        # kept when enough thumbnail pixels moved since the last kept frame.
        kept = (
            last_kept is None
            or (h - last_kept) > dup_threshold
            or changed_fraction(last_kept_path, p) > KEEP_CHANGE
        )
        if kept:
            last_kept, last_kept_path = h, p
        frames.append(
            Frame(index=i, t=i / fps, path=str(p.relative_to(run_dir)), phash=str(h), kept=kept)
        )
    run.frames = frames
    run.status = "sampled"
    return run


def kept_frames(run: Run) -> list[Frame]:
    return [f for f in run.frames if f.kept]
