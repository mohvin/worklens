"""SAM 3.1 output parsing, from a real response captured on 2026-10-28."""
from __future__ import annotations

from worklens_worker.sam import Box, output_text, parse_boxes

RAW = {
    "output": [{"type": "message", "role": "assistant", "content": [{"type": "output_text", "text":
        "<0f>0<|box;x1=460;y1=580;x2=600;y2=622;w=1280;h=720;c=0.6521739363670349|>"
        "<|mask;x=0;y=0;c=0.6521739363670349;data=43,141,!!!!!/NbMsUUUny1(5e&1|>,"
        "1<|box;x1=10;y1=20;x2=110;y2=60;w=1280;h=720;c=0.9|><|mask;x=0;y=0;c=0.9;data=40,100,!abc,def|>\n"}]}],
}


def test_parse_real_response():
    boxes = parse_boxes(output_text(RAW))
    assert boxes == [Box(460, 580, 600, 622, 0.6521739363670349), Box(10, 20, 110, 60, 0.9)]


def test_empty_response_means_no_match():
    assert parse_boxes(output_text({"output": [{"type": "message", "content": [{"type": "output_text", "text": ""}]}]})) == []


def test_iou():
    a, b = Box(0, 0, 100, 100), Box(50, 0, 150, 100)
    assert abs(a.iou(b) - 1 / 3) < 1e-9
    assert a.iou(Box(200, 200, 300, 300)) == 0.0
