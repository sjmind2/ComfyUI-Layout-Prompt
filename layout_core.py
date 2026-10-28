"""Resolution math for the MOSS layout prompt node.

Stdlib-only: this module must stay importable without ComfyUI.
"""

import json
import math

ASPECT_RATIOS: dict[str, tuple[int, int]] = {
    "1:1 (Square)": (1, 1),
    "2:3 (Portrait Photo)": (2, 3),
    "3:2 (Photo)": (3, 2),
    "3:4 (Portrait Standard)": (3, 4),
    "4:3 (Standard)": (4, 3),
    "9:16 (Portrait Widescreen)": (9, 16),
    "16:9 (Widescreen)": (16, 9),
    "21:9 (Ultrawide)": (21, 9),
}


def compute_size(
    aspect_ratio: str, megapixels: float, multiple: int = 16
) -> tuple[int, int]:
    """Calculate width and height from aspect ratio and megapixel target."""
    w_ratio, h_ratio = ASPECT_RATIOS[aspect_ratio]
    total_pixels = megapixels * 1024 * 1024
    scale = math.sqrt(total_pixels / (w_ratio * h_ratio))
    width = round(w_ratio * scale / multiple) * multiple
    height = round(h_ratio * scale / multiple) * multiple
    return width, height


LABELS = ("character", "object", "text")

_BBOX_MAX = 1000


def _clamp_bbox_value(value) -> int:
    """Round one bbox coordinate to an integer inside 0-1000."""
    return max(0, min(_BBOX_MAX, int(round(float(value)))))


def parse_boxes(boxes_json: str) -> list[dict]:
    """Parse the hidden ``boxes_json`` widget into layout boxes.

    Accepts ``{"version": 1, "boxes": [...]}``. Each bbox is normalized,
    sorted and clamped to 0-1000 ``yxyx`` integers; zero-size boxes are
    dropped and unknown labels become ``object``. Invalid input yields ``[]``.
    """
    try:
        data = json.loads(boxes_json)
    except (TypeError, ValueError):
        return []
    if not isinstance(data, dict) or data.get("version") != 1:
        return []
    raw_boxes = data.get("boxes")
    if not isinstance(raw_boxes, list):
        return []

    boxes: list[dict] = []
    for raw in raw_boxes:
        if not isinstance(raw, dict):
            continue
        bbox = raw.get("bbox")
        if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
            continue
        try:
            y0, x0, y1, x1 = (_clamp_bbox_value(value) for value in bbox)
        except (TypeError, ValueError, OverflowError):
            continue
        y0, y1 = sorted((y0, y1))
        x0, x1 = sorted((x0, x1))
        if y0 == y1 or x0 == x1:
            continue
        label = raw.get("label")
        if label not in LABELS:
            label = "object"
        caption = raw.get("caption")
        text = raw.get("text")
        boxes.append({
            "label": label,
            "caption": caption if isinstance(caption, str) else "",
            "text": text if isinstance(text, str) else "",
            "bbox": [y0, x0, y1, x1],
        })
    return boxes


def convert_bbox(
    y0: int, x0: int, y1: int, x1: int, width: int, height: int
) -> list[int]:
    """Convert a 0-1000 ``yxyx`` box to centered pixel edges.

    Copied from ``MOSSImageLayoutPrompt.execute`` for byte-for-byte parity.
    """
    return [
        math.floor(round(y0 * height / 1000, 9)) - height // 2,
        math.floor(round(x0 * width / 1000, 9)) - width // 2,
        math.ceil(round(y1 * height / 1000, 9)) - height // 2,
        math.ceil(round(x1 * width / 1000, 9)) - width // 2,
    ]


def build_layout_prompt(
    summary: str, boxes: list[dict], width: int, height: int
) -> str:
    """Build the MOSS-Image layout prompt string from parsed boxes."""
    if not boxes:
        return summary
    items = []
    for box in boxes:
        label = box["label"]
        item = {"label": label, "caption": box.get("caption", "")}
        if label == "text":
            item["text"] = box.get("text", "")
        y0, x0, y1, x1 = box["bbox"]
        item["bbox"] = convert_bbox(y0, x0, y1, x1, width, height)
        items.append(item)
    layout = {
        "summary": {"caption": summary.strip()},
        "items": items,
        "bbox_coord_space": "abs_centralized",
        "bbox_format": "yxyx",
    }
    return json.dumps(layout, ensure_ascii=False, separators=(",", ":"))
