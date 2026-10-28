"""Integration parity check against ComfyUI's built-in MOSS layout chain.

Deliberately not named ``test_*.py`` so system pytest does not collect it:
this module imports the installed ComfyUI ``comfy_extras`` nodes and must be
run explicitly with the ComfyUI checkout on ``PYTHONPATH``::

    PYTHONPATH="C:/Users/sjmin/ComfyUI-Installs/ComfyUI/ComfyUI" \
        E:/ComfyUI2/.venv/Scripts/python.exe -m unittest tests.parity_moss_check -v
"""

import json
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from layout_core import ASPECT_RATIOS, build_layout_prompt, compute_size, parse_boxes

from comfy_extras.nodes_moss_image import MOSSImageLayoutPrompt
from comfy_extras.nodes_resolution import ResolutionSelector

MEGAPIXELS = (0.1, 1.0, 1.5, 2.0)


def _builtin_layout_prompt(summary, elements, character_boxes="", width=1024, height=1024):
    return MOSSImageLayoutPrompt.execute(
        summary, elements, width, height, character_boxes
    ).args[0]


def _our_layout_prompt(summary, boxes, width=1024, height=1024):
    boxes_json = json.dumps({"version": 1, "boxes": boxes})
    return build_layout_prompt(summary, parse_boxes(boxes_json), width, height)


class ResolutionParityTest(unittest.TestCase):
    def test_compute_size_matches_resolution_selector(self):
        self.assertEqual(len(ASPECT_RATIOS), 8)
        for ratio in ASPECT_RATIOS:
            for megapixels in MEGAPIXELS:
                with self.subTest(ratio=ratio, megapixels=megapixels):
                    builtin = ResolutionSelector.execute(ratio, megapixels, 16).args
                    self.assertEqual(compute_size(ratio, megapixels), builtin)


class LayoutPromptParityTest(unittest.TestCase):
    def test_character_and_text_items_match_builtin(self):
        summary = "1girl, long hair, standing in a street"
        builtin_elements = [
            {
                "type": "obj",
                "desc": "hatsune miku",
                "text": "",
                "bbox": [100, 200, 400, 600],
            },
            {
                "type": "text",
                "desc": "shop sign",
                "text": "こんにちは",
                "bbox": [500, 100, 900, 800],
            },
        ]
        our_boxes = [
            {
                "label": "character",
                "caption": "hatsune miku",
                "text": "",
                "bbox": [100, 200, 400, 600],
            },
            {
                "label": "text",
                "caption": "shop sign",
                "text": "こんにちは",
                "bbox": [500, 100, 900, 800],
            },
        ]

        builtin = _builtin_layout_prompt(summary, builtin_elements, "1")
        ours = _our_layout_prompt(summary, our_boxes)

        self.assertEqual(ours, builtin)
        self.assertIn('"label":"character"', ours)
        self.assertIn('"label":"text"', ours)
        self.assertIn('"text":"こんにちは"', ours)

    def test_no_boxes_returns_summary_unchanged(self):
        summary = "  a quiet street  "
        self.assertEqual(_builtin_layout_prompt(summary, []), summary)
        self.assertEqual(_our_layout_prompt(summary, []), summary)

        self.assertEqual(_builtin_layout_prompt("", []), "")
        self.assertEqual(_our_layout_prompt("", []), "")


if __name__ == "__main__":
    unittest.main()
