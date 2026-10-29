"""Smoke-test the Meta Model API with the WorkLens key: models, Muse Spark, SAM 3.1.

    python scripts/check_meta_api.py            # reads MODEL_API_KEY from .env
    python scripts/check_meta_api.py --sam-only

Prints what works, latency and token counts, and saves the raw SAM output to
runs/meta-check/ so the adapter can be written against real data. Costs a few
cents at most.
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import re
import sys
import time
from pathlib import Path

import httpx
from dotenv import load_dotenv

REPO = Path(__file__).resolve().parents[1]
load_dotenv(REPO / ".env")
BASE = "https://api.meta.ai/v1"  # always the Meta Model API; this is a Meta check
KEY = os.environ.get("MODEL_API_KEY") or os.environ.get("WORKLENS_LLM_API_KEY") or ""
FRAMES = REPO / "samples" / "runs" / "synthetic-invoice" / "frames"
OUT = REPO / "runs" / "meta-check"


def data_url(p: Path) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(p.read_bytes()).decode()


def check_models(c: httpx.Client) -> None:
    r = c.get("/models")
    print(f"GET /models -> {r.status_code}")
    if r.status_code != 200:
        print(r.text[:500])
        return
    ids = [m.get("id") for m in r.json().get("data", [])]
    print("  models:", ", ".join(ids) if ids else "(empty list: this host or region may be restricted)")


def check_muse(c: httpx.Client, effort: str) -> None:
    sys.path.insert(0, str(REPO / "services" / "worker"))
    from worklens_worker.label import SCHEMA, SYSTEM  # noqa: E402

    body = {
        "model": "muse-spark-1.3",
        "temperature": 0,
        "max_completion_tokens": 1500,
        "reasoning_effort": effort,
        "messages": [
            {"role": "system", "content": SYSTEM},
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": "Image 1: the screen when this step began (12s). Image 2: the same screen when the step ended (20s), 8 seconds later. Image 3: the screen that appeared right after. What did the user do on this screen?"},
                    {"type": "image_url", "image_url": {"url": data_url(FRAMES / "f00013.jpg")}},
                    {"type": "image_url", "image_url": {"url": data_url(FRAMES / "f00020.jpg")}},
                    {"type": "image_url", "image_url": {"url": data_url(FRAMES / "f00021.jpg")}},
                ],
            },
        ],
        "response_format": {"type": "json_schema", "json_schema": {"name": "step_label", "strict": True, "schema": SCHEMA}},
    }
    t0 = time.time()
    r = c.post("/chat/completions", json=body)
    dt = time.time() - t0
    print(f"POST /chat/completions (reasoning_effort={effort}) -> {r.status_code} in {dt:.1f}s")
    if r.status_code != 200:
        print("  ", r.text[:600])
        return
    j = r.json()
    msg = j["choices"][0]["message"]
    usage = j.get("usage", {})
    print("  usage:", json.dumps(usage))
    content = msg.get("content") or ""
    try:
        print("  label:", json.dumps(json.loads(content)))
    except json.JSONDecodeError:
        print("  content (not JSON):", content[:300])


BOX_RE = re.compile(r"<\|box;([^|]*)\|>")


def check_sam(c: httpx.Client, prompt: str, frame: str) -> None:
    body = {
        "model": "sam-3.1",
        "input": [
            {
                "type": "message",
                "role": "user",
                "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": data_url(FRAMES / frame)},
                ],
            }
        ],
        "stream": False,
        "metadata": {"include_confidence": "true", "mask_encoding": "one_bit"},
    }
    t0 = time.time()
    r = c.post("/responses", json=body)
    dt = time.time() - t0
    print(f"POST /responses sam-3.1 prompt={prompt!r} frame={frame} -> {r.status_code} in {dt:.1f}s")
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / f"sam_{prompt.replace(' ', '_')}_{frame}.json").write_text(r.text)
    if r.status_code != 200:
        print("  ", r.text[:600])
        return
    j = r.json()
    text = ""
    for item in j.get("output", []):
        for part in item.get("content", []) if isinstance(item, dict) else []:
            if part.get("type") in ("output_text", "text"):
                text += part.get("text", "")
    if not text and "output_text" in j:
        text = j["output_text"]
    boxes = BOX_RE.findall(text)
    print(f"  {len(boxes)} boxes; usage={json.dumps(j.get('usage', {}))}")
    for b in boxes[:8]:
        print("   ", b)
    if not boxes:
        print("  raw keys:", list(j.keys()), "| text head:", text[:200])


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sam-only", action="store_true")
    ap.add_argument("--muse-only", action="store_true")
    a = ap.parse_args()
    if not KEY:
        sys.exit("MODEL_API_KEY is not set in .env")
    print(f"base {BASE}, key ...{KEY[-4:]}")
    with httpx.Client(base_url=BASE, headers={"Authorization": f"Bearer {KEY}"}, timeout=180) as c:
        check_models(c)
        if not a.sam_only:
            check_muse(c, "low")
            check_muse(c, "none")
        if not a.muse_only:
            # f00042 = ERP form; f00013 = PDF viewer. Prompts are noun phrases: one concept per call.
            for prompt in ("text input field", "button", "window"):
                check_sam(c, prompt, "f00042.jpg")
            check_sam(c, "text input field", "f00013.jpg")
    print(f"\nraw SAM responses saved under {OUT}")


if __name__ == "__main__":
    main()
