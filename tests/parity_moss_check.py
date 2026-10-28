"""Integration parity check against ComfyUI's built-in MOSS layout chain.

Deliberately not named ``test_*.py`` so system pytest does not collect it:
this module imports the installed ComfyUI ``comfy_extras`` nodes and must be
run explicitly with the ComfyUI checkout on ``PYTHONPATH``::

    PYTHONPATH="C:/Users/sjmin/ComfyUI-Installs/ComfyUI/ComfyUI" \
        E:/ComfyUI2/.venv/Scripts/python.exe -m unittest tests.parity_moss_check -v
"""

import json
import os
import sys
import unittest
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT))

from layout_core import ASPECT_RATIOS, build_layout_prompt, compute_size, parse_boxes


def _import_comfy_builtins():
    """Import the installed ComfyUI nodes this check compares against.

    ``comfy_extras.nodes_bounding_boxes`` does ``import nodes``; this project
    also ships a ``nodes.py``, and the project root is on ``sys.path`` because
    ``python -m unittest`` runs from here. The project root is therefore
    dropped temporarily so ``nodes`` resolves to ComfyUI's module, then
    restored for the rest of the checks.
    """
    removed = []
    for entry in list(sys.path):
        try:
            resolved = Path(entry or os.getcwd()).resolve()
        except OSError:
            continue
        if resolved == PROJECT_ROOT:
            sys.path.remove(entry)
            removed.append(entry)
    try:
        from comfy_extras.nodes_bounding_boxes import CreateBoundingBoxes
        from comfy_extras.nodes_moss_image import MOSSImageLayoutPrompt
        from comfy_extras.nodes_resolution import ResolutionSelector
    finally:
        sys.path[:0] = removed
    return CreateBoundingBoxes, MOSSImageLayoutPrompt, ResolutionSelector


CreateBoundingBoxes, MOSSImageLayoutPrompt, ResolutionSelector = _import_comfy_builtins()

MEGAPIXELS = (0.1, 1.0, 1.5, 2.0, 16.0)

SUMMARY = "1girl, long hair, standing in a street"

# Built-in elements as Create Bounding Boxes emits them: 0-1000 yxyx boxes.
# These boxes survive CreateBoundingBoxes' 0-1000 -> pixel -> 0-1000
# re-quantization unchanged at both 1024x1024 and 1360x768 (asserted below).
ELEMENTS = [
    {
        "type": "obj",
        "desc": "hatsune miku",
        "text": "",
        "bbox": [128, 256, 512, 768],
    },
    {
        "type": "text",
        "desc": "shop sign",
        "text": "こんにちは",
        "bbox": [500, 100, 900, 800],
    },
]

# The same elements expressed as the hidden boxes_json our node consumes.
OUR_BOXES = [
    {
        "label": "character",
        "caption": "hatsune miku",
        "text": "",
        "bbox": [128, 256, 512, 768],
    },
    {
        "label": "text",
        "caption": "shop sign",
        "text": "こんにちは",
        "bbox": [500, 100, 900, 800],
    },
]


def _builtin_layout_prompt(summary, elements, character_boxes="", width=1024, height=1024):
    return MOSSImageLayoutPrompt.execute(
        summary, elements, width, height, character_boxes
    ).args[0]


def _chained_elements(elements, width, height):
    """Run elements through CreateBoundingBoxes and return its elements output."""
    return CreateBoundingBoxes.execute(width, height, bboxes=elements).args[2]


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
        builtin = _builtin_layout_prompt(SUMMARY, ELEMENTS, "1")
        ours = _our_layout_prompt(SUMMARY, OUR_BOXES)

        self.assertEqual(ours, builtin)
        self.assertIn('"label":"character"', ours)
        self.assertIn('"label":"text"', ours)
        self.assertIn('"text":"こんにちは"', ours)

    def _assert_chain_parity(self, width, height):
        chained = _chained_elements(ELEMENTS, width, height)
        # CreateBoundingBoxes re-quantizes through its pixel canvas; the
        # fixtures must survive that round-trip for an exact comparison.
        self.assertEqual(
            [
                (el.get("type"), el["bbox"], el.get("desc", ""), el.get("text", ""))
                for el in chained
            ],
            [
                (el.get("type"), el["bbox"], el.get("desc", ""), el.get("text", ""))
                for el in ELEMENTS
            ],
        )

        builtin = _builtin_layout_prompt(SUMMARY, chained, "1", width, height)
        ours = _our_layout_prompt(SUMMARY, OUR_BOXES, width, height)

        self.assertEqual(ours, builtin)
        self.assertIn('"label":"character"', ours)
        self.assertIn('"label":"text"', ours)
        self.assertIn('"text":"こんにちは"', ours)

    def test_create_bounding_boxes_chain_matches_at_1024(self):
        self._assert_chain_parity(1024, 1024)

    def test_create_bounding_boxes_chain_matches_at_widescreen(self):
        width, height = compute_size("16:9 (Widescreen)", 1.0)
        self.assertEqual((width, height), (1360, 768))
        self._assert_chain_parity(width, height)

    def test_no_boxes_returns_summary_unchanged(self):
        summary = "  a quiet street  "
        self.assertEqual(_builtin_layout_prompt(summary, []), summary)
        self.assertEqual(_our_layout_prompt(summary, []), summary)

        self.assertEqual(_builtin_layout_prompt("", []), "")
        self.assertEqual(_our_layout_prompt("", []), "")


if __name__ == "__main__":
    unittest.main()
