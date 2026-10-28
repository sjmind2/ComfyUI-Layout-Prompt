import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from layout_core import ASPECT_RATIOS, compute_size


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
