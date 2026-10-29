"""Cheap image comparisons used by sampling and boundary detection."""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path

import numpy as np
from PIL import Image

THUMB = (160, 90)  # 16:9 thumbnail; enough to see a screen change, cheap to diff
PIXEL_DELTA = 16   # grey-level change that counts as "this pixel changed"; 16 catches light UI text, 32 misses it


@lru_cache(maxsize=4096)
def thumb(path: str) -> np.ndarray:
    with Image.open(path) as im:
        return np.asarray(im.convert("L").resize(THUMB, Image.BILINEAR), dtype=np.int16)


def changed_fraction(a: Path | str, b: Path | str) -> float:
    """Fraction of thumbnail pixels that changed by more than PIXEL_DELTA, 0..1."""
    da = np.abs(thumb(str(a)) - thumb(str(b)))
    return float((da > PIXEL_DELTA).mean())


def fingerprint(path: Path | str) -> str:
    """Encoder-independent identity of a frame, for the model cache key.

    Perceptual + difference hash of the image, so the same frame extracted by a
    different ffmpeg build (different JPEG bytes) still hits the cache, while
    any visible change on screen misses it.
    """
    import imagehash

    with Image.open(path) as im:
        g = im.convert("L")
        return f"{im.size[0]}x{im.size[1]}:{imagehash.phash(g, hash_size=8)}:{imagehash.dhash(g, hash_size=8)}"


DIFF_THUMB = (320, 180)  # finer grid than THUMB, to locate what changed


def changed_regions(a: Path | str, b: Path | str, min_area: float = 0.001) -> tuple[list[tuple[int, int, int, int]], float]:
    """Where frame b differs from frame a.

    Returns ([(x1, y1, x2, y2), ...] in b's pixel space, largest first) and the
    fraction of the screen that changed. Regions are connected components of
    changed pixels on a 320x180 grid, grown by one cell so broken edges join.
    """
    with Image.open(a) as ia, Image.open(b) as ib:
        w, h = ib.size
        ga = np.asarray(ia.convert("L").resize(DIFF_THUMB, Image.BILINEAR), dtype=np.int16)
        gb = np.asarray(ib.convert("L").resize(DIFF_THUMB, Image.BILINEAR), dtype=np.int16)
    changed = np.abs(ga - gb) > PIXEL_DELTA
    fraction = float(changed.mean())
    if not changed.any():
        return [], 0.0
    # dilate by one cell
    grown = changed.copy()
    grown[1:, :] |= changed[:-1, :]
    grown[:-1, :] |= changed[1:, :]
    grown[:, 1:] |= changed[:, :-1]
    grown[:, :-1] |= changed[:, 1:]
    rows, cols = grown.shape
    seen = np.zeros_like(grown, dtype=bool)
    boxes: list[tuple[int, int, int, int, int]] = []
    for r0 in range(rows):
        for c0 in range(cols):
            if not grown[r0, c0] or seen[r0, c0]:
                continue
            stack = [(r0, c0)]
            seen[r0, c0] = True
            rmin = rmax = r0
            cmin = cmax = c0
            n = 0
            while stack:
                r, c = stack.pop()
                n += 1
                rmin, rmax, cmin, cmax = min(rmin, r), max(rmax, r), min(cmin, c), max(cmax, c)
                for dr, dc in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                    rr, cc = r + dr, c + dc
                    if 0 <= rr < rows and 0 <= cc < cols and grown[rr, cc] and not seen[rr, cc]:
                        seen[rr, cc] = True
                        stack.append((rr, cc))
            if n / (rows * cols) >= min_area:
                boxes.append((n, cmin, rmin, cmax + 1, rmax + 1))
    boxes.sort(reverse=True)
    sx, sy = w / cols, h / rows
    out = [(int(x1 * sx), int(y1 * sy), min(w, int(x2 * sx)), min(h, int(y2 * sy))) for _, x1, y1, x2, y2 in boxes]
    return out, fraction
