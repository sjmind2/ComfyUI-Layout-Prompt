# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

ComfyUI custom node `LayoutPromptBuilder` ("Layout Prompt Builder", category `model/conditioning/moss_image`). It turns a summary, an aspect-ratio/megapixel choice, and an editable set of 0-1000 boxes into the MOSS-Image layout prompt plus the output width and height. `layout_core.py` is standard-library-only; `nodes.py` uses ComfyUI's V3 `comfy_api.latest` API; the editor is vanilla ES modules served from `web/` via `WEB_DIRECTORY = "./web"`.

## Commands

Run from the repository root (this checkout is also the installed custom node):

```bash
# Python core (system Python 3.12 with pytest): 19 tests
python -m pytest tests/ -v

# Pure frontend modules (Node 22 node:test): 22 tests
npm test

# Equivalent direct invocation (same 22 tests)
node --test "tests/js/*.test.js"

# Node schema and execute behavior (ComfyUI venv, no pytest): 4 tests
PYTHONPATH="C:/Users/sjmin/ComfyUI-Installs/ComfyUI/ComfyUI" E:/ComfyUI2/.venv/Scripts/python.exe -m unittest tests.node_schema_check -v

# Real MOSS parity (ComfyUI venv): 5 tests
# CreateBoundingBoxes -> MOSSImageLayoutPrompt at 1024x1024 and 1360x768,
# plus ResolutionSelector size parity for all eight ratios at four megapixel values.
PYTHONPATH="C:/Users/sjmin/ComfyUI-Installs/ComfyUI/ComfyUI" E:/ComfyUI2/.venv/Scripts/python.exe -m unittest tests.parity_moss_check -v
```

After changing Python or frontend files, restart the ComfyUI server and hard-refresh the browser (`Ctrl+F5`). The instance runs from the `E:/ComfyUI2` base, loads custom nodes from `E:/ComfyUI2/custom_nodes`, and keeps its Python code checkout at `C:/Users/sjmin/ComfyUI-Installs/ComfyUI/ComfyUI`. No launch script for this instance is in the repository.

## Architecture

- `layout_core.py` - stdlib-only core. `ASPECT_RATIOS` (eight MOSS display names), `compute_size()` (aspect ratio + megapixels, multiple fixed at 16), `parse_boxes()` (defensive parse of the hidden JSON into normalized 0-1000 boxes), `convert_bbox()` (copied from `MOSSImageLayoutPrompt.execute`), and `build_layout_prompt()` (exact compact MOSS JSON). Must stay importable without ComfyUI.
- `nodes.py` - V3 `io.ComfyNode`. Schema inputs `summary`, `aspect_ratio`, `megapixels`, `boxes_json` (socketless); outputs `width` INT, `height` INT, `prompt` STRING, in that order. `execute()` warns when non-empty `boxes_json` yields no usable boxes and still emits the summary.
- `__init__.py` - `NODE_CLASS_MAPPINGS`, `NODE_DISPLAY_NAME_MAPPINGS`, `WEB_DIRECTORY = "./web"`.
- `web/layout_prompt.js` - extension shell. Registers `Moss.LayoutPromptBuilder`, hides the `boxes_json` widget, adds the DOM widget `layout_editor` (type `LayoutEditor`), chains `onNodeCreated` / `onConfigure` / `onResize` / `onRemoved`, and owns the global `executed` listener plus the `liveEditors` registry.
- `web/editor.js` - `LayoutEditor`: owns layout state, history, selection, toolbar, pointer/keyboard editing, file upload, `Last`, background persistence, and node-height management.
- `web/canvas.js` - `CanvasView`: device-pixel-ratio backing store, paint order (selected last), box/hover/selection drawing, and the clipped, dimmed reference layer.
- `web/background.js` - `Background`: mode, source, file/last descriptors, Fill/Fit, zoom, pan, pan clamping, image loading via `api.apiURL("/view?...")`, and the `toJSON()` / `loadStored()` snapshot used for persistence and undo.
- `web/geometry.js` - DOM-free `normalizeBbox`, `bboxToRect`, `rectToBbox`, and `hitTest` (8 handles, topmost box wins).
- `web/state.js` - DOM-free immutable layout state, serialization (`{version, boxes}` only, no `selectedId`), and the 50-entry undo/redo history.
- `web/size.js` - zero-dependency mirror of `compute_size`, including Python's round-half-to-even behavior (`pythonRound`), used by the editor for canvas sizing and the live size hint.
- `web/list.js` - single-column box list renderer, label list/colors, selection helpers, and row-local key handling.
- `web/styles.js` - `injectStyles()`, scoped under `.layout-prompt-editor`.
- Tests: `tests/test_layout_core.py` (pytest, 19); `tests/js/*.test.js` (node:test, 22); `tests/node_schema_check.py` (unittest, 4, ComfyUI venv); `tests/parity_moss_check.py` (unittest, 5, real ComfyUI chain).

## Invariants

- **Coordinates:** every stored bbox is an integer 0-1000 `[y0, x0, y1, x1]`. y is first and maps to height; x maps to width. Normalize each axis independently (sort), clamp to 0-1000, and drop zero-area boxes. Unknown labels become `object` in the Python parser.
- **Sizes:** `total_pixels = megapixels * 1024 * 1024`; `scale = sqrt(total_pixels / (w_ratio * h_ratio))`; width/height are `round(value / 16) * 16`. The multiple is fixed at 16. Python uses banker's rounding; `web/size.js` must keep the same behavior and ratio table.
- **Prompt JSON:** with boxes, exactly `{"summary":{"caption":<stripped summary>},"items":[...],"bbox_coord_space":"abs_centralized","bbox_format":"yxyx"}`, using compact separators, `ensure_ascii=False`, and the key order shown. Items are `label` + `caption` + (`text` only for `text` labels) + `bbox`. The output bbox uses `floor(round(value * dimension / 1000, 9)) - dimension // 2` for y0/x0 and `ceil(...) - dimension // 2` for y1/x1. With no boxes, return the summary unchanged (not stripped); empty summary + no boxes returns `""`.
- **Labels:** exactly `character`, `object`, `text`. Label colors are `character #4a9eff`, `object #f0a030`, `text #c77dff`.
- **Selection visuals:** the selected box is painted last with a 30% label-color fill, a 2.5 px solid outline, and 8 handles. Unselected boxes use a 1.5 px outline; hover uses a 12% tint plus a dashed outline.
- **Reference transform:** Fill is the default; zoom is 0.5-8.0 (50%-800%), where 100% is the current Fill/Fit base scale. The reference is dimmed with 45% black (about 55% brightness), and pan is clamped so a large image covers the canvas and a small image stays fully inside. Boxes never move when the reference or the canvas size changes.
- **History:** entries are `{layout, background}` composites, limit 50. Only committed edits push entries (pointer-up gestures, field commits, add/delete/duplicate/reorder, coalesced nudges, Fit/Fill/zoom/pan, and reference-source changes). Selection changes and `White`/`Reference` mode toggles do not.
- **R12:** `Pick file` and `Last` are source-changing background edits, so they are undoable. A failed upload or failed `Last` load pushes nothing and keeps the previous reference.
- **R14:** undo/redo preserve the current `White`/`Reference` mode (view-only) while restoring the snapshot's file/last/source/fit/zoom/pan.
- **Defaults:** default node width 560 px, minimum 440 px; new box `[400,400,600,600]` with label `character`; duplicate offset 30 units; list shows about five rows before scrolling.

## Gotchas

- **Hidden `boxes_json` widget.** The schema still declares it, and the extension only sets `widget.hidden = true`; do not remove it or its value stops serializing with the workflow. The DOM widget uses `serialize: false` and the editor writes `serializeState(state)` into `boxes_json` on every mutation. If the widget is missing, the extension warns and editor state will not persist.
- **Global `executed` listener + `liveEditors`.** `web/layout_prompt.js` registers the listener once and keeps live editors in a `Set`. Each executed event calls `editor.setLastOutput(ref)` with the last entry of `detail.output.images`; it never switches the displayed reference. Editors unregister on `destroy()` / `onRemoved`, so removed nodes are ignored.
- **Upload and view URLs.** Picking a file posts `FormData` (`image` with a unique `layout_ref_<node>_<timestamp>_<random>.<ext>` name, `type=input`, `overwrite=true`) to `api.fetchApi("/upload/image")`; images load through `api.apiURL("/view?filename=...&type=...&subfolder=...&t=...")` with a cache-busting `t`. Only `{filename, type, subfolder}` descriptors are persisted, never image data.
- **Wheel consumption.** The canvas wheel listener is `passive: false` and always calls `preventDefault()` + `stopPropagation()`, so the graph never zooms. The notch is ignored during an active box/pan drag, and a wheel burst shares one undo entry (500 ms window).
- **Pointer mapping.** Convert client coordinates with `canvas.getBoundingClientRect()` and the display-size/rect-size scale (`canvasScale()`), never raw client pixels; this keeps boxes under the cursor at any graph zoom. Pointer move/up/cancel for drags are registered on `window` so gestures survive leaving the canvas.
- **Background persistence.** `node.properties.layoutPromptBg` holds `{mode, source, file, last, fit, zoom, panX, panY}` and is written on committed changes (debounced for pointer-driven updates). `onConfigure` restores widget values and properties before the handler runs; `syncFromWidget()` re-reads both. It refreshes the canvas size before `background.loadStored()` because `setViewport` clamps pan against the current viewport and would otherwise zero the saved pan. Restoration is a load, not an edit: it must never push history. A missing file keeps its descriptor and falls back to a white canvas.
- **Parity check path shadowing.** This repo ships `nodes.py`, and `comfy_extras/nodes_bounding_boxes.py` does `import nodes`; running `python -m unittest` from the project root puts that root first on `sys.path`. `tests/parity_moss_check.py` temporarily removes the project root before importing ComfyUI modules and restores it afterward. Do not remove that guard.
- **Two interpreters.** The ComfyUI venv has no pytest, and system Python has no `comfy_api`/`comfy_extras`. Keep `tests/test_layout_core.py` free of ComfyUI imports, and run `node_schema_check.py` / `parity_moss_check.py` with the venv via `unittest`. Neither venv-only check is named `test_*.py`, so system pytest does not collect them.
- **Keyboard scope.** Editing keys only fire when the canvas or a box row has focus (`ownsKeyboardFocus()`); text/select inputs keep native editing and native undo. The window `keydown` handler runs in the capture phase and consumes handled keys so Delete, arrows, and Ctrl+Z do not reach the graph. The row renderer also stops its local keys from bubbling.
- **DOM widget height.** `addDOMWidget` uses `editor.computeHeight()` for getHeight/getMinHeight/getMaxHeight; the editor grows/shrinks the node around the panel, and the extension's chained `onResize` enforces the 440 px minimum width. Do not hardcode panel heights in the extension.
- **Pure modules.** `layout_core.py`, `web/size.js`, `web/geometry.js`, and `web/state.js` must stay DOM-free and ComfyUI-free; they are the automated-test surface.
- **Malformed `boxes_json`.** `parse_boxes()` returns `[]` for invalid/wrong-version input, and `nodes.py` logs a warning only when the string was non-empty. The Python fallback is the plain summary; the frontend always writes valid JSON.
