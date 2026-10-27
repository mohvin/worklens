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
