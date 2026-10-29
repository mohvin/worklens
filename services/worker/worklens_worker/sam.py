"""Meta SAM 3.1 client: segment one image by a noun-phrase or a box prompt.

POST /v1/responses with model "sam-3.1". The result is a line of text per
frame: `<0f>` then comma-separated records, each `<id><|box;...|><|mask;...|>`.
Boxes are in source pixels; `w`/`h` are the image size. We keep the boxes and
the confidence and ignore the mask payload (base85, box-sized raster).

WorkLens uses the box prompt: pixel-diff says roughly where the screen changed,
SAM returns the exact UI element there (a dialog, a form, an opened email).
Noun-phrase prompts (`segment`) are kept for experiments (scripts/sam_sweep.py).

Every call is cached on disk by prompt + frame fingerprint, like the Muse
Spark client, so a run can be replayed without API calls.
"""
from __future__ import annotations

import base64
import hashlib
import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from .imageops import fingerprint
from .models import ModelCall

SAM_MODEL = "sam-3.1"
SAM_VERSION = "v1"
BOX_RE = re.compile(r"<\|box;([^|]*)\|>")


@dataclass(frozen=True)
class Box:
    x1: int
    y1: int
    x2: int
    y2: int
    confidence: float = 1.0

    @property
    def area(self) -> int:
        return max(0, self.x2 - self.x1) * max(0, self.y2 - self.y1)

    def iou(self, other: "Box") -> float:
        ix1, iy1 = max(self.x1, other.x1), max(self.y1, other.y1)
        ix2, iy2 = min(self.x2, other.x2), min(self.y2, other.y2)
        inter = max(0, ix2 - ix1) * max(0, iy2 - iy1)
        union = self.area + other.area - inter
        return inter / union if union else 0.0


def parse_boxes(text: str) -> list[Box]:
    out: list[Box] = []
    for raw in BOX_RE.findall(text):
        kv = dict(p.split("=", 1) for p in raw.split(";") if "=" in p)
        try:
            out.append(Box(int(kv["x1"]), int(kv["y1"]), int(kv["x2"]), int(kv["y2"]), float(kv.get("c", 1.0))))
        except (KeyError, ValueError):
            continue
    return out


def output_text(response: dict[str, Any]) -> str:
    text = ""
    for item in response.get("output", []):
        for part in item.get("content", []) or []:
            if part.get("type") == "output_text":
                text += part.get("text", "")
    return text


def sam_cache_key(prompt: str, image: Path) -> str:
    return hashlib.sha256(f"{SAM_VERSION}|{SAM_MODEL}|{prompt}|{fingerprint(image)}".encode()).hexdigest()[:24]


def box_prompt(box: tuple[int, int, int, int], w: int, h: int) -> str:
    """Visual prompt token: one object, one box, in the image's pixel space (x2/y2 inclusive)."""
    x1, y1, x2, y2 = box
    return f"<0f>1<|box;x1={x1};y1={y1};x2={max(x1, x2 - 1)};y2={max(y1, y2 - 1)};w={w};h={h}|>"


class SamClient:
    def __init__(self, api_key: str, cache_dir: Path, base_url: str = "https://api.meta.ai/v1", timeout_s: float = 120.0):
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.calls: list[ModelCall] = []
        self._http = httpx.Client(base_url=base_url, headers={"Authorization": f"Bearer {api_key}"}, timeout=timeout_s)

    def segment_box(self, image: Path, box: tuple[int, int, int, int], retries: int = 1) -> tuple[list[Box], ModelCall]:
        """The object inside `box` (pixel coords of `image`), refined by SAM."""
        from PIL import Image

        with Image.open(image) as im:
            w, h = im.size
        return self.segment(image, box_prompt(box, w, h), retries=retries)

    def segment(self, image: Path, prompt: str, retries: int = 1) -> tuple[list[Box], ModelCall]:
        key = sam_cache_key(prompt, image)
        cached = self.cache_dir / f"{key}.json"
        if cached.exists():
            boxes = [Box(**b) for b in json.loads(cached.read_text())]
            call = ModelCall(stage="segment", model=SAM_MODEL, cache_key=key, cached=True, latency_s=0.0)
            self.calls.append(call)
            return boxes, call

        b64 = base64.b64encode(image.read_bytes()).decode()
        body = {
            "model": SAM_MODEL,
            "input": [{"type": "message", "role": "user", "content": [
                {"type": "input_text", "text": prompt},
                {"type": "input_image", "image_url": f"data:image/jpeg;base64,{b64}"},
            ]}],
            "stream": False,
            "metadata": {"include_confidence": "true", "mask_encoding": "one_bit"},
        }
        last_err = "no attempt"
        for _ in range(retries + 1):
            t0 = time.time()
            try:
                r = self._http.post("/responses", json=body)
                latency = time.time() - t0
                if r.status_code != 200:
                    last_err = f"http {r.status_code}: {r.text[:300]}"
                    continue
                boxes = parse_boxes(output_text(r.json()))
                cached.write_text(json.dumps([b.__dict__ for b in boxes]))
                call = ModelCall(stage="segment", model=SAM_MODEL, cache_key=key, cached=False, latency_s=round(latency, 3))
                self.calls.append(call)
                return boxes, call
            except httpx.HTTPError as e:
                last_err = f"{type(e).__name__}: {e}"[:300]
        call = ModelCall(stage="segment", model=SAM_MODEL, cache_key=key, cached=False, latency_s=0.0, ok=False, error=last_err)
        self.calls.append(call)
        return [], call
