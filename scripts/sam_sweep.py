"""Find which noun-phrase prompts make SAM 3.1 see UI regions on screen frames.

    python scripts/sam_sweep.py                 # sample frames + any images in runs/meta-check/in/
    python scripts/sam_sweep.py --prompts "button,text box,table"

Prints a prompt x frame table of box counts, writes overlay images with the
boxes drawn to runs/meta-check/overlays/, and caches every call under
runs/meta-check/cache (re-runs are free). Check the Meta Billing page before
and after to learn the per-image price.
"""
from __future__ import annotations

import argparse
import os
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from dotenv import load_dotenv
from PIL import Image, ImageDraw

REPO = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO / "services" / "worker"))
load_dotenv(REPO / ".env")
from worklens_worker.sam import SamClient  # noqa: E402

OUT = REPO / "runs" / "meta-check"
DEFAULT_PROMPTS = [
    "button", "text box", "input field", "form", "table", "table row", "dialog box", "menu",
    "toolbar", "icon", "sidebar", "panel", "window", "document", "list item", "progress bar",
    "text", "email message", "spreadsheet cell", "link",
]
SAMPLE_FRAMES = ["f00001.jpg", "f00013.jpg", "f00022.jpg", "f00042.jpg", "f00059.jpg"]  # inbox, pdf, erp loading, erp form, sheet


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompts", default=",".join(DEFAULT_PROMPTS))
    ap.add_argument("--workers", type=int, default=4)
    a = ap.parse_args()
    key = os.environ.get("MODEL_API_KEY") or sys.exit("MODEL_API_KEY not set in .env")
    prompts = [p.strip() for p in a.prompts.split(",") if p.strip()]
    images = [REPO / "samples" / "runs" / "synthetic-invoice" / "frames" / f for f in SAMPLE_FRAMES]
    extra = sorted((OUT / "in").glob("*")) if (OUT / "in").exists() else []
    images += [p for p in extra if p.suffix.lower() in (".png", ".jpg", ".jpeg")]
    print(f"{len(prompts)} prompts x {len(images)} images = {len(prompts) * len(images)} calls")

    client = SamClient(key, OUT / "cache")
    jobs = [(img, p) for img in images for p in prompts]
    with ThreadPoolExecutor(max_workers=a.workers) as pool:
        results = list(pool.map(lambda j: (j, client.segment(*j)), jobs))

    table: dict[str, dict[str, str]] = {}
    overlays = OUT / "overlays"
    overlays.mkdir(parents=True, exist_ok=True)
    for (img, prompt), (boxes, call) in results:
        cell = f"{len(boxes)}" + (f"@{max(b.confidence for b in boxes):.2f}" if boxes else "") if call.ok else "ERR"
        table.setdefault(prompt, {})[img.name] = cell
        if boxes:
            im = Image.open(img).convert("RGB")
            d = ImageDraw.Draw(im)
            for b in boxes:
                d.rectangle([b.x1, b.y1, b.x2, b.y2], outline=(255, 40, 40), width=3)
                d.text((b.x1 + 4, max(0, b.y1 - 14)), f"{b.confidence:.2f}", fill=(255, 40, 40))
            im.save(overlays / f"{img.stem}__{prompt.replace(' ', '_')}.jpg", quality=80)

    names = [i.name for i in images]
    print("\n" + "prompt".ljust(18) + "".join(n[:14].ljust(16) for n in names))
    for p in prompts:
        print(p.ljust(18) + "".join(table[p].get(n, "-").ljust(16) for n in names))
    fresh = [c for c in client.calls if not c.cached]
    errs = [c for c in client.calls if not c.ok]
    lat = sum(c.latency_s for c in fresh) / len(fresh) if fresh else 0
    print(f"\n{len(fresh)} API calls ({len(client.calls) - len(fresh)} cached), {len(errs)} errors, mean latency {lat:.1f}s")
    print(f"overlays in {overlays}")


if __name__ == "__main__":
    main()
