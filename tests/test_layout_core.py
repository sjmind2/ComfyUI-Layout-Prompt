import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from layout_core import (
    ASPECT_RATIOS,
    build_layout_prompt,
    compute_size,
    convert_bbox,
    parse_boxes,
)


def test_square_1mp():
    assert compute_size("1:1 (Square)", 1.0) == (1024, 1024)

def test_portrait_photo_1mp():
    assert compute_size("2:3 (Portrait Photo)", 1.0) == (832, 1248)

def test_widescreen_1mp():
    assert compute_size("16:9 (Widescreen)", 1.0) == (1360, 768)

def test_ultrawide_1mp():
    assert compute_size("21:9 (Ultrawide)", 1.0) == (1568, 672)

def test_square_1_5mp():
    assert compute_size("1:1 (Square)", 1.5) == (1248, 1248)

def test_all_results_are_multiples_of_16():
    for ratio in ASPECT_RATIOS:
        for mp in (0.1, 0.5, 1.0, 1.5, 2.0, 4.0):
            w, h = compute_size(ratio, mp)
            assert w % 16 == 0 and h % 16 == 0

def test_unknown_ratio_raises():
    with pytest.raises(KeyError):
        compute_size("5:4", 1.0)


def test_convert_bbox_center():
    assert convert_bbox(0, 0, 500, 500, 1024, 1024) == [-512, -512, 0, 0]

def test_convert_bbox_offgrid():
    assert convert_bbox(100, 200, 400, 600, 1024, 1024) == [-410, -308, -102, 103]

def test_convert_bbox_large_canvas():
    assert convert_bbox(100, 200, 400, 600, 1360, 768) == [-308, -408, -76, 136]

def test_character_layout_exact():
    boxes = [{"label": "character", "caption": "hatsune miku",
              "text": "", "bbox": [100, 200, 400, 600]}]
    assert build_layout_prompt("1girl, long hair", boxes, 1024, 1024) == (
        '{"summary":{"caption":"1girl, long hair"},'
        '"items":[{"label":"character","caption":"hatsune miku",'
        '"bbox":[-410,-308,-102,103]}],'
        '"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}'
    )

def test_text_item_includes_text_and_unicode():
    boxes = [{"label": "text", "caption": "Japanese text",
              "text": "こんにちは", "bbox": [0, 0, 500, 500]}]
    out = build_layout_prompt("poster", boxes, 1024, 1024)
    assert '"label":"text"' in out
    assert '"text":"こんにちは"' in out
    assert '"caption":"Japanese text"' in out

def test_no_boxes_returns_summary_unchanged():
    assert build_layout_prompt("  hello  ", [], 1024, 1024) == "  hello  "

def test_empty_summary_with_boxes():
    boxes = [{"label": "object", "caption": "rail",
              "text": "", "bbox": [0, 0, 500, 500]}]
    assert '"caption":""' in build_layout_prompt("", boxes, 1024, 1024)

def test_invalid_json_returns_empty():
    assert parse_boxes("not json") == []

def test_clamps_and_sorts_boxes():
    out = parse_boxes('{"version":1,"boxes":[{"label":"character",'
                      '"caption":"a","text":"","bbox":[400,600,100,200]}]}')
    assert out[0]["bbox"] == [100, 200, 400, 600]

def test_out_of_range_clamped():
    out = parse_boxes('{"version":1,"boxes":[{"label":"object",'
                      '"caption":"a","text":"","bbox":[-10,0,500,1200]}]}')
    assert out[0]["bbox"] == [0, 0, 500, 1000]

def test_unknown_label_becomes_object():
    out = parse_boxes('{"version":1,"boxes":[{"label":"panel",'
                      '"caption":"a","text":"","bbox":[0,0,10,10]}]}')
    assert out[0]["label"] == "object"

def test_zero_size_box_dropped():
    out = parse_boxes('{"version":1,"boxes":[{"label":"object",'
                      '"caption":"a","text":"","bbox":[100,100,100,200]}]}')
    assert out == []
