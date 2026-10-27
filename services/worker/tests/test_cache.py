"""The model cache must survive re-extracting frames with a different JPEG encoder."""
from __future__ import annotations

import io
from pathlib import Path

from PIL import Image

from worklens_worker.imageops import fingerprint
from worklens_worker.llm import LLMClient, LLMConfig, cache_key, fingerprints_match, prompt_key

SAMPLE = Path(__file__).resolve().parents[3] / "samples" / "runs" / "synthetic-invoice" / "frames"


def test_fingerprint_ignores_jpeg_encoding(tmp_path):
    src = sorted(SAMPLE.glob("*.jpg"))[:5]
    for p in src:
        with Image.open(p) as im:
            buf = io.BytesIO()
            im.save(buf, "JPEG", quality=70, subsampling=2)  # a noticeably different encode
            other = tmp_path / p.name
            other.write_bytes(buf.getvalue())
        assert other.read_bytes() != p.read_bytes()
        assert fingerprints_match(fingerprint(other), fingerprint(p))


def test_fingerprint_separates_different_screens():
    fps = {fingerprint(p) for p in SAMPLE.glob("*.jpg")}
    assert len(fps) >= 15  # 28 shipped frames, many are the same screen before/after a boundary


def test_cache_key_depends_on_prompt_and_frames():
    a, b = SAMPLE / "f00001.jpg", SAMPLE / "f00013.jpg"  # inbox vs PDF viewer
    k1 = cache_key("m", "sys", "text", [a], "s")
    assert k1 == cache_key("m", "sys", "text", [a], "s")
    assert k1 != cache_key("m", "sys", "text", [b], "s")
    assert k1 != cache_key("m", "sys", "other text", [a], "s")


def test_near_hit_serves_a_re_encoded_frame(tmp_path):
    """A response cached for one encode of a frame is found for another encode of it."""
    client = LLMClient(LLMConfig(base_url="http://127.0.0.1:9", model="m", api_key="x", timeout_s=2), tmp_path / "cache")
    orig = SAMPLE / "f00013.jpg"
    key = cache_key("m", "sys", "text", [orig], "s")
    (tmp_path / "cache" / f"{key}.json").write_text('{"application": "PDF Viewer"}')
    (tmp_path / "cache" / f"{key}.fp.json").write_text(
        '{"prompt": "%s", "fps": ["%s"]}' % (prompt_key("m", "sys", "text", "s"), fingerprint(orig))
    )
    with Image.open(orig) as im:
        im.save(tmp_path / "again.jpg", "JPEG", quality=70, subsampling=2)
    data, call = client.structured("sys", "text", [tmp_path / "again.jpg"], {}, "s")
    assert call.cached and data == {"application": "PDF Viewer"}
    # a different screen with the same prompt is not a hit (the endpoint is unreachable, so it fails fast)
    data, call = client.structured("sys", "text", [SAMPLE / "f00001.jpg"], {}, "s", retries=0)
    assert not call.cached and data is None
