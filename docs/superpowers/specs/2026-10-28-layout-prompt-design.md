# Layout Prompt Builder — design

Date: 2026-10-28
Status: Approved 2026-10-28
Project: `E:\ComfyUI2\custom_nodes\ComfyUI-Layout-Prompt`

## Intent

MOSS-Image layout prompts are a structural control surface. Moving a box, changing a label, adding or removing a box, or editing the summary changes anatomy, props, and subject count, so the JSON is adjusted many times before an image is acceptable. The current loop is heavy:

1. prepare a dummy image and a plain-text summary caption;
2. switch to the Qt layout tagger at `O:\loratool\anima_lora-origin`;
3. draw boxes, write a prompt per box;
4. export the layout JSON;
5. copy it into ComfyUI and queue;
6. if a draft is acceptable, save it and swap the dummy image file to use it as the next reference.

This node collapses the loop into one ComfyUI node: choose the output shape, draw and edit boxes over a white canvas or a reference image, edit the summary and per-box prompts, and output width, height, and the layout prompt string. It replaces `ResolutionSelector`, `CreateBoundingBoxes`, and `MOSSImageLayoutPrompt` for this workflow.

The three adjustment strategies seen in practice, which define the hot path:

1. body over-stretched → move/resize a box;
2. part wrong, merged, or missing → edit that box's prompt and resize it;
3. wrong subject count or mixed-up features → edit the summary and add/remove/duplicate boxes.

## The MOSS-Image layout format

Confirmed against the official MOSS-Image docs and the local tagger (`O:/loratool/anima_lora-origin/gui/layout/workspace.py`). The layout object is serialized as an ordinary prompt string:

```json
{
  "summary": {
    "meta": ["poster"],
    "canvas": "single",
    "caption": "A minimalist travel poster with a cream background, a blue mountain illustration, and the title EXPLORE at the top."
  },
  "items": [
    {
      "label": "text",
      "caption": "Large dark-blue uppercase title centered at the top.",
      "text": "EXPLORE",
      "bbox": [-416, -384, -288, 384]
    },
    {
      "label": "object",
      "caption": "A flat blue mountain illustration in the lower center.",
      "bbox": [-192, -288, 384, 288]
    }
  ],
  "bbox_coord_space": "abs_centralized",
  "bbox_format": "yxyx"
}
```

Rules we must match:

- `summary.caption` is the global scene/style description.
- `items[].label` is one of `text`, `character`, `object`.
- `items[].caption` is the localized description; for `text`, `text` is the literal characters and `caption` describes typography, color, and placement.
- `bbox` is absolute pixels with the canvas center as origin, ordered `[y_min, x_min, y_max, x_max]`; subtract `height/2` from y values and `width/2` from x values.
- `bbox_coord_space` is `"abs_centralized"`, `bbox_format` is `"yxyx"`.
- Recommended output sizes are 1 MP, 1.5 MP, or 2 MP; any ratio; both sides must be positive multiples of 16. The usable range is 0.25 MP (512×512) to 4 MP (2K).
- Serialize with `json.dumps(layout, ensure_ascii=False, separators=(",", ":"))`.

The built-in `MOSSImageLayoutPrompt` in `C:/Users/sjmin/ComfyUI-Installs/ComfyUI/ComfyUI/comfy_extras/nodes_moss_image.py` is the parity reference. Its conversion from 0–1000 normalized `yxyx` to centered pixels is copied exactly (see “Exact conversion”).

## Goals

- One node provides the output size, the bbox canvas, the per-box editing, and the layout prompt string.
- The canvas is usable before any queue: white or a reference image, drawn and edited directly.
- The edit loop is fast: select, nudge, resize, edit a caption, duplicate, delete, add, undo.
- Selection is obvious in a dense canvas and is shared with the box list.
- The generated prompt is byte-for-byte compatible with `MOSSImageLayoutPrompt` for the same boxes and size.
- Boxes, labels, captions, text, ordering, background choice, and background transform survive workflow save/reload.
- Reference handling covers the three real cases: fresh white canvas, an external reference image, and the last acceptable generation.
- The reference can be fitted, filled, zoomed into a region, and panned; the boxes stay in output coordinates.

## Non-goals (v1)

- Generating images or calling the model.
- Automatic captioning or bbox detection.
- Multi-panel / collage (`summary.canvas`), `summary.meta`, per-item palette, tags.
- Batch layouts across multiple images.
- A graph `IMAGE` input for the reference. The canvas must work before execution; file upload and “use last output” cover the two reference cases. A connected-image source can be added later.
- Modal dialogs for the hot path; everything stays in the node.
- Mobile/touch support.

## Anti-goals

- A node so wide or tall it is painful to place in a graph.
- Requiring a queue just to see the reference or start drawing.
- Diverging from the official JSON format or the built-in conversion.
- Losing edits on reload, or bloating the workflow with base64 image data.
- A selected box that disappears under overlaps or is hard to spot among many boxes.
- Deleting boxes or moving the reference because a keyboard or wheel event leaked to the graph.

## Node anatomy

- Display name: **Layout Prompt Builder**
- Node id: `LayoutPromptBuilder`
- Category: `model/conditioning/moss_image`
- Shape: single-column node, default width 560 px, minimum 440 px; canvas above a single-column box list (layout B).
- Inputs (ordinary widgets):
  - `summary` — multiline string, dynamic prompts enabled, default empty. Maps to `summary.caption`.
  - `aspect_ratio` — combo with the same eight values and display names as `ResolutionSelector`.
  - `megapixels` — float, 0.1–16.0, step 0.1, default 1.0.
  - `boxes_json` — hidden string widget carrying the serialized editor state to Python. Default empty.
- Outputs:
  - `width` — INT.
  - `height` — INT.
  - `prompt` — STRING.
- Ports render in the standard ComfyUI way: outputs at the top-right, above the widgets. There is no graph image input in v1.
- The canvas + toolbar + list is one `addDOMWidget` panel placed below the ordinary widgets. The summary, aspect ratio, and megapixels are standard widgets above it.
- The node is resizable; the canvas re-fits and the box list keeps its scroll position.

## Resolution selector

Copy `ResolutionSelector` exactly (`comfy_extras/nodes_resolution.py`):

```
w_ratio, h_ratio = ratios[aspect_ratio]
total_pixels = megapixels * 1024 * 1024
scale = sqrt(total_pixels / (w_ratio * h_ratio))
width = round(w_ratio * scale / 16) * 16
height = round(h_ratio * scale / 16) * 16
```

- Multiple is fixed at **16**: MOSS requires sides to be multiples of 16. The built-in selector defaults to 8 but the official templates set 16.
- Ratios and display names, copied exactly: `1:1 (Square)`, `2:3 (Portrait Photo)`, `3:2 (Photo)`, `3:4 (Portrait Standard)`, `4:3 (Standard)`, `9:16 (Portrait Widescreen)`, `16:9 (Widescreen)`, `21:9 (Ultrawide)`.
- The computed `width × height` is shown under the widgets. The frontend replicates the formula for the live hint; Python is authoritative. The JS preview must implement Python's round-half-to-even; if it ever differs, show the backend value after execution.
- A 1:1, 1.0 MP output is exactly 1024×1024.

## Canvas

Display:

- The canvas represents the exact output rectangle: the selected aspect ratio and size, scaled down to fit the node.
- Default display: fit the ratio into a box of max width `node width − 28` (10 px DOM-widget margin on each side plus 4 px panel padding on each side) and max height 340 px. A square is about 340×340; 16:9 is about 532×299; 9:16 about 191×340. Crisp at devicePixelRatio.
- The reference is dimmed to about 55% brightness so boxes read clearly. There is no dim toggle in v1.
- The reference is guidance only. It is never part of the layout JSON, the node output, or the graph.

Boxes:

- Coordinates are stored as integers in **0–1000 normalized `[y0, x0, y1, x1]`**, matching the built-in CreateBoundingBoxes tolerance for 0.001 precision.
- Draw: left-drag on empty canvas. A drag shorter than 3 display px is ignored. New boxes are clamped to the canvas.
- Move: left-drag inside a box.
- Resize: 8 handles (corners and edge midpoints), 6 display px hit radius. Minimum size 3 display px; clamped to the canvas.
- Delete: Delete/Backspace while the panel has keyboard focus, or the row's ✕.
- Duplicate: Ctrl+D, or a duplicate control in the row. Translate the copy by 3% of the canvas (30 units) per axis while preserving its size: forward when it fits, backward near the right/bottom edge, and unchanged for a full-frame box. Select the copy.
- Nudge: arrow keys move the selected box 1 unit; Shift+arrow 10 units.
- Hit-test topmost (last in list order) first. The selected box is painted last, so overlapping boxes never hide it.
- Pointer coordinates are computed from `getBoundingClientRect()`, not client pixels, so graph zoom does not skew them.

Selection:

- Single selection, shared by canvas and list.
- Click a box → its row scrolls into view and highlights.
- Click a row → the box gets the selected treatment.
- A new box is selected automatically.
- Esc or a click on empty canvas clears selection.
- Selected: semi-transparent label-color fill at about 30%, solid 2.5 px outline, 8 white handles, drawn last.
- Hover: about 12% tint and a dashed outline, deliberately weaker than selection.
- Unselected: outline only, in the label color. Colors: character `#4a9eff`, object `#f0a030`, text `#c77dff`.
- The selected row is the editor for label, prompt/caption, and `text`.

Keyboard and pointer:

| Action | Input |
|---|---|
| Draw box | left-drag on empty canvas |
| Move box | left-drag inside box |
| Resize box | drag any of 8 handles |
| Select | click box or row |
| Deselect | Esc / click empty canvas |
| Delete | Delete / Backspace (panel focus) or row ✕ |
| Duplicate | Ctrl+D |
| Nudge | arrows; Shift+arrows = 10 units |
| Pan reference | Move bg mode drag, Space+drag, or middle-drag |
| Zoom reference | wheel over canvas at cursor; −/+ buttons |
| Undo / redo | Ctrl+Z / Ctrl+Shift+Z (outside text fields) |

- Wheel over the canvas is consumed by the editor (preventDefault + stopPropagation) so the graph does not zoom.
- Keys are intercepted when any non-editable element inside the editor panel has focus (canvas, row, row control, toolbar, `+ add`, or panel background); typing in a caption must not delete a box.
- Ctrl+Z inside a caption/text input is left to the browser's field undo.

## Box list

- Single column, below the toolbar; about five rows visible before the list scrolls.
- Each row:
  - index chip (`01`, `02`, …) in the label color;
  - label dropdown: `character`, `object`, `text`;
  - prompt/caption text input (maps to `caption` in JSON);
  - a `text` input, shown only when the label is `text` (the literal characters);
  - duplicate, move up, move down, delete controls.
- New boxes default to label `character`, empty caption, empty text; the caption input is focused after creation.
- Switching a box away from `text` hides its `text` value but retains it in state; switching back restores it. The JSON only includes `text` for `text` items.
- List order is JSON item order and draw order. New boxes append at the end (front-most). Up/down controls change the order. The built-in guidance is background element first, foreground last; the list exposes that ordering.
- The `+ add` control creates a 20% × 20% box at the canvas center, clamped, selected, with an empty caption.
- The list header shows the count. Deleting the last box is allowed; the node then outputs the plain summary.

## Reference background

Modes:

- **White** (default): an empty white canvas.
- **Reference**: draws the selected source under the boxes.

Sources (frontend-only):

- **Pick file**: hidden `<input type="file" accept="image/*">` → `POST /upload/image` with `type=input`, `overwrite=true`, and a unique name such as `layout_ref_<nodeid>_<timestamp>.<ext>`. Store `{filename, type: "input"}`. Render via `/view?...`. The input folder is used so the reference survives a ComfyUI restart; on another machine the file may be missing and the node falls back to white.
- **Use last generated image** (`Use last`): listen to ComfyUI's global `executed` event (`api.addEventListener("executed", ({detail}) => ...)`); `detail.output.images` carries `{filename, type, subfolder}` for SaveImage/PreviewImage. Store the newest image reference and render it via `/view?...`. If several images are emitted, the newest event wins; the last image in that event is used. This pattern is already used by ComfyUI-Custom-Scripts' image feed (`web/js/imageFeed.js:536`) and Impact Pack (`js/impact-pack.js:267`). On editor creation, also recover the newest generated image from `GET /history?max_items=20` (entries are in completion order; walk backward to the newest image-bearing entry) so the button works after a reload or for images produced before the node existed. A live executed image wins; the history result only seeds an empty button and never switches the displayed reference.
- If a stored reference file is missing on load, show an unobtrusive “reference unavailable” hint and fall back to the white canvas; do not clear the stored reference automatically.
- Picking a file or using the last output sets the source and switches to Reference. The White/Reference toggle does not forget the stored source.

Transform:

- `Fill`: cover the canvas, crop overflow. This is the default for a reference composition.
- `Fit`: contain the whole image, letterboxed on a neutral background.
- `zoom`: multiplier over the current Fill/Fit base scale, range 50%–800%; 100% = the preset scale. Wheel-at-cursor, −/+ buttons. The percentage is shown.
- `pan`: drag the reference under the boxes in Move bg mode; Space+drag or middle-drag works in any mode. Pan is clamped so the image cannot be lost.
- Zooming and panning affect the reference layer only. Boxes are in output space and never move.
- The reference state (`mode`, `source`, file/last-output ref, `fit`, `zoom`, pan) persists in `node.properties` with the workflow.
- Changing aspect ratio or megapixels re-fits the canvas. The zoom and the source point at the canvas center are preserved; the visible crop changes with the rectangle. Fit/Fill recenters.
- Pan/zoom snapshots are added to undo on pointer-up, not every pointer move.

## Persistence

- Editor state goes into the hidden `boxes_json` widget:

```json
{
  "version": 1,
  "boxes": [
    {
      "id": "b1",
      "label": "character",
      "caption": "left arm raised",
      "text": "",
      "bbox": [120, 250, 480, 360]
    }
  ]
}
```

- `bbox` is 0–1000 `yxyx`. `id` is stable across reordering.
- Background state goes into `node.properties.layoutPromptBg` (mode, source, file/last-output reference, fit, zoom, pan). ComfyUI serializes node properties with the workflow.
- Selection id may be stored in properties; it is UI-only and optional.
- On `onConfigure`, parse `boxes_json`, rebuild the canvas/list, and restore the background. On any edit, update the hidden widget immediately so a queue always sees the current state.
- The backend parses defensively: wrong version, malformed JSON, non-numeric or out-of-range boxes → treat as no boxes, log a warning, and still output the summary. The frontend always writes valid JSON.

## Exact conversion

Python core, copied from `MOSSImageLayoutPrompt.execute`:

```python
def convert_bbox(y0, x0, y1, x1, width, height):
    return [
        math.floor(round(y0 * height / 1000, 9)) - height // 2,
        math.floor(round(x0 * width / 1000, 9)) - width // 2,
        math.ceil(round(y1 * height / 1000, 9)) - height // 2,
        math.ceil(round(x1 * width / 1000, 9)) - width // 2,
    ]
```

Build items as:

```python
item = {"label": label, "caption": caption}
if label == "text":
    item["text"] = text
item["bbox"] = convert_bbox(...)
```

Then:

```python
layout = {
    "summary": {"caption": summary.strip()},
    "items": items,
    "bbox_coord_space": "abs_centralized",
    "bbox_format": "yxyx",
}
return json.dumps(layout, ensure_ascii=False, separators=(",", ":"))
```

- Labels are exactly `text`, `character`, `object`.
- If there are no items, return the summary string unchanged (matching `MOSSImageLayoutPrompt`). Empty summary + no boxes → empty string.
- If there are items and the summary is empty, still emit the layout with `"caption": ""`.
- No `palette`, `tags`, `meta`, or `canvas` keys in v1.
- Normalize incoming boxes: clamp to 0–1000, order the coordinates, drop non-numeric or zero-size boxes after conversion. The frontend already prevents these; the backend is the last line of defense.

## Architecture

### Python

- `layout_core.py` — stdlib only (no ComfyUI imports):
  - `ASPECT_RATIOS` / display names;
  - `compute_size(aspect_ratio, megapixels, multiple=16)`;
  - `parse_boxes(boxes_json)`;
  - `build_layout_prompt(summary, boxes, width, height)`;
  - `convert_bbox(...)`.
- `nodes.py` — the `io.ComfyNode` class (`LayoutPromptBuilder`), schema, `execute`, the hidden `boxes_json` input, and output tuple. Imports `layout_core`.
- `__init__.py` — `NODE_CLASS_MAPPINGS`, `WEB_DIRECTORY = "./web"`.
- No third-party dependencies.

### Frontend

- `web/layout_prompt.js` — `app.registerExtension`, `beforeRegisterNodeDef`, chain `onNodeCreated`, `onConfigure`, `onResize`, `onRemoved`.
- On creation:
  - find the `boxes_json` widget and hide it (`widget.hidden = true`), keeping it serialized;
  - hide/disable nothing else; the summary/ratio/MP widgets stay standard;
  - create the DOM widget with `addDOMWidget("layout_canvas", "LayoutCanvas", element, {serialize:false, hideOnZoom:false, ...})`;
  - set the default node size (560 px wide) and let the widget's `computeSize`/height callbacks drive the height.
- The DOM widget contains:
  - an HTML5 `<canvas>` for the reference and boxes, sized by devicePixelRatio;
  - the white/reference toggle, Pick file, Use last output, Fill/Fit, zoom controls, Move bg;
  - the single-column box list;
  - a hidden file input.
- State lives in one editor object on the node: boxes, selected id, background, undo stack. Every mutation updates the hidden widget and schedules a canvas redraw with `requestAnimationFrame`.
- Global `executed` listener registered in the extension; it updates the “last output” reference in the current node(s) when an image output arrives.
- Reference image loading uses `api.apiURL("/view?" + new URLSearchParams(...))` (the local pattern in `ComfyUI-Impact-Pack/js/impact-image-util.js` and VHS).
- Upload uses `api.fetchApi("/upload/image", {method:"POST", body: formData})` (KJNodes `editor_base.js:309`, Custom-Scripts `workflows.js:248`).
- Drag/selection/rendering patterns can follow:
  - `E:/ComfyUI2/custom_nodes/ComfyUI-KJNodes/web/js/editors/editor_base.js` — DOM widget height (550 px), properties persistence, upload, `onConfigure`, background restore;
  - `E:/ComfyUI2/custom_nodes/ComfyUI-SAM3/web/sam3_bbox_widget.js` — canvas widget, `getBoundingClientRect()` mouse mapping, `onExecuted` background image;
  - `E:/ComfyUI2/custom_nodes/ComfyUI-Impact-Pack/js/mask-rect-area.js` — custom widget drawn over the node and node resizing.
- Keep the canvas widget under the standard widgets; do not attempt to overlay the output slots.

### File layout

```
ComfyUI-Layout-Prompt/
  __init__.py
  layout_core.py
  nodes.py
  web/
    layout_prompt.js
    layout_prompt.css          (optional; inline styles are fine)
  tests/
    test_layout_core.py
  README.md
  docs/superpowers/specs/2026-10-28-layout-prompt-design.md
```

## Behavior edge cases

- **No boxes**: output the summary string exactly as entered (not stripped), matching `MOSSImageLayoutPrompt`.
- **Empty summary, boxes present**: emit JSON with `summary.caption: ""`.
- **Empty summary, no boxes**: output `""`.
- **Text box with empty `text`**: include `"text": ""`; do not drop it.
- **Missing reference file**: white canvas plus a hint; Reference button re-shows the hint.
- **Upload failure**: keep the previous reference and show an inline error.
- **Ratio/megapixel change**: width/height preview and canvas update immediately; boxes are unchanged (stored 0–1000); reference keeps center and zoom.
- **Many boxes**: 50 boxes on a 340 px canvas should stay interactive; selected fill must remain legible.
- **Graph zoom**: pointer mapping uses the element's bounding rect, so boxes land under the cursor.
- **Node removal**: remove per-node listeners; the global `executed` handler ignores removed nodes.
- **Workflow reload**: hidden widget and properties restore the exact canvas; a missing reference falls back gracefully.
- **Wrong/old `boxes_json`**: backend ignores it and outputs the summary; frontend shows an empty editor.

## Testing and verification

Automated (`python -m pytest tests/`):

- `compute_size`:
  - `1:1 (Square)`, 1.0 → 1024, 1024;
  - every ratio at 1.0, 1.5, 2.0, 0.1, 16.0 against the formula;
  - multiples of 16 for all results;
  - parity with the copied `ResolutionSelector` formula.
- `convert_bbox` / `build_layout_prompt`:
  - one character box with known coordinates → exact centered `yxyx`;
  - a text item includes `text`, `caption`, and `bbox`;
  - labels are exactly `character` / `object` / `text`;
  - compact separators and non-ASCII preserved;
  - no items → summary unchanged;
  - empty summary + items → `caption: ""`;
  - malformed/out-of-range input → no boxes, no crash.
- A parity fixture: the same normalized boxes and size run through a copy of `MOSSImageLayoutPrompt`'s conversion should produce the identical JSON string.

Manual in ComfyUI:

1. Node appears under `model/conditioning/moss_image`; layout is B (canvas above one-column list).
2. Width/height match `ResolutionSelector` for each ratio at 1.0 and 1.5 MP.
3. Draw/move/resize/delete/duplicate/undo; selection sync; dense-canvas legibility; wheel does not zoom the graph.
4. Summary + boxes → queue; the prompt output matches the built-in `CreateBoundingBoxes` + `MOSSImageLayoutPrompt` chain for the same boxes.
5. Pick a reference; Fill/Fit/zoom/pan; boxes stay put; save, reload, reference restores.
6. Generate an image; “Use last output” shows it; a deleted/missing file falls back to white.
7. Save/reload with boxes, labels, text, order, and background; everything restores.
8. Remove the node; no console errors, listeners cleaned up.
9. Text label shows the literal field; switching labels retains/hides it correctly.
10. 30–50 boxes remain responsive.

## Risks

- **Frontend API drift**: DOM widgets, `executed`, and upload endpoints are proven in the installed custom nodes, but they are not a stable public API. Pin to the installed ComfyUI version and retest after upgrades.
- **Rounding parity**: Python uses banker's rounding; the JS size hint must match or be treated as a hint only.
- **File lifetime**: “last output” temp files can be cleaned; picked files live in the input folder but are not portable across machines.
- **DOM widget sizing**: the node height must grow with the canvas and list without clipping at different graph zooms; test.
- **Wheel/keyboard leakage**: must consume events only when appropriate.
- **Undo complexity**: snapshots should be coarse (pointer-up, commit) to avoid huge stacks; text fields keep native undo.
- **Workflow size**: never store the reference image as base64 in the workflow.
- **Experimental upstream format**: MOSS layout prompting is labeled experimental; parity tests against the installed `MOSSImageLayoutPrompt` catch drift.

## Builder calls (user can veto)

- Name `Layout Prompt Builder`, id `LayoutPromptBuilder`, category `model/conditioning/moss_image`.
- No graph `IMAGE` input in v1; sources are picked file and last output.
- New boxes default to `character`; empty caption; centered 20% box from `+ add`.
- Box list has explicit up/down reorder; list order = JSON order.
- Undo/redo: 50 snapshots for box and background edits; native undo inside text inputs.
- Reference default: Fill, dimmed ~55%; zoom 50–800% with 100% = preset.
- Picked files stored in the input folder; last output stores its `{filename, type, subfolder}`; missing files fall back to white.
- Ratio/MP changes preserve the reference’s centered source point and zoom.
- The list shows about five rows before scrolling; default node width 560 px, min 440 px.
- No `palette`, `meta`, `canvas`, or `tags` fields; no multi-panel.
- Automated tests cover the stdlib core only; the editor is verified manually.

## Left to the builder

- Exact DOM/CSS styling and color contrast within the node.
- Event-handler organization and module split inside `web/layout_prompt.js`.
- Precise canvas sizing math and DPR handling.
- Snapshot granularity for undo (which mutations push history).
- Reference clamping and zoom-at-cursor math.
- Accessible focus order and tooltips.
- Test fixture values (derive expected outputs from the copied formula).
- `README.md` usage text and a CLAUDE.md once the code exists.
