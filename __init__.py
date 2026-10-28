"""ComfyUI Layout Prompt Builder custom node."""

from .nodes import LayoutPromptBuilder

NODE_CLASS_MAPPINGS = {"LayoutPromptBuilder": LayoutPromptBuilder}
NODE_DISPLAY_NAME_MAPPINGS = {"LayoutPromptBuilder": "Layout Prompt Builder"}
WEB_DIRECTORY = "./web"

__all__ = [
    "NODE_CLASS_MAPPINGS",
    "NODE_DISPLAY_NAME_MAPPINGS",
    "WEB_DIRECTORY",
    "LayoutPromptBuilder",
]
