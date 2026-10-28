"""ComfyUI V3 node for building MOSS-Image layout prompts."""

import logging

from comfy_api.latest import io

from .layout_core import ASPECT_RATIOS, build_layout_prompt, compute_size, parse_boxes


class LayoutPromptBuilder(io.ComfyNode):
    @classmethod
    def define_schema(cls):
        return io.Schema(
            node_id="LayoutPromptBuilder",
            display_name="Layout Prompt Builder",
            category="model/conditioning/moss_image",
            inputs=[
                io.String.Input(
                    "summary", multiline=True, dynamic_prompts=True, default=""
                ),
                io.Combo.Input(
                    "aspect_ratio",
                    options=list(ASPECT_RATIOS),
                    default="1:1 (Square)",
                ),
                io.Float.Input(
                    "megapixels", default=1.0, min=0.1, max=16.0, step=0.1
                ),
                io.String.Input(
                    "boxes_json", multiline=False, default="", socketless=True
                ),
            ],
            outputs=[
                io.Int.Output("width"),
                io.Int.Output("height"),
                io.String.Output("prompt"),
            ],
        )

    @classmethod
    def execute(cls, summary, aspect_ratio, megapixels, boxes_json="") -> io.NodeOutput:
        width, height = compute_size(aspect_ratio, megapixels)
        boxes = parse_boxes(boxes_json)
        if boxes_json.strip() and not boxes:
            logging.getLogger(__name__).warning(
                "boxes_json was provided but contained no usable boxes; "
                "falling back to the plain summary prompt."
            )
        prompt = build_layout_prompt(summary, boxes, width, height)
        return io.NodeOutput(width, height, prompt)
