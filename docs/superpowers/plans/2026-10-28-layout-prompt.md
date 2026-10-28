# Layout Prompt Builder Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a ComfyUI custom node that turns a summary, aspect ratio + megapixels, and an editable bbox canvas into the MOSS-Image layout prompt plus output width and height.

**Architecture:** A stdlib-only Python core computes sizes and serializes the layout JSON; a V3 `io.ComfyNode` wraps it; a vanilla ES-module frontend adds a DOM-widget canvas editor with a single-column box list, persisting through a hidden string widget and node properties.

**Tech Stack:** Python 3.12 stdlib, ComfyUI 0.42 V3 node API (`comfy_api.latest`), vanilla ES modules, HTML5 canvas, pytest, Node 22 `node:test`.

**Spec:** `docs/superpowers/specs/2026-10-28-layout-prompt-design.md` — executors read both the spec and this plan.

## Global Constraints

- Node id `LayoutPromptBuilder`; display `Layout Prompt Builder`; category `model/conditioning/moss_image`.
- Outputs, in order: `width` INT, `height` INT, `prompt` STRING.
- Aspect ratio values, verbatim: `1:1 (Square)`, `2:3 (Portrait Photo)`, `3:2 (Photo)`, `3:4 (Portrait Standard)`, `4:3 (Standard)`, `9:16 (Portrait Widescreen)`, `16:9 (Widescreen)`, `21:9 (Ultrawide)`.
- `megapixels` 0.1–16.0 step 0.1 default 1.0; multiple fixed at **16**; formula from the spec's "Resolution selector".
- Boxes stored 0–1000 integer `[y0,x0,y1,x1]`; JSON conversion copied from `MOSSImageLayoutPrompt` (floor of y0/x0, ceil of y1/x1, minus `height//2` / `width//2`).
- JSON exactly: `summary.caption` (stripped), `items[]` with `label`/`caption`/`text` (text only)/`bbox`, `bbox_coord_space: "abs_centralized"`, `bbox_format: "yxyx"`; compact separators, `ensure_ascii=False`; no items → summary unchanged.
- Labels exactly `character`, `object`, `text`; unknown labels become `object`.
- No graph `IMAGE` input. Reference sources are a picked file and "Use last output".
- Selection: ~30% label-color fill, 2.5 px outline, 8 handles, painted last; hover ~12% tint + dashed outline. Label colors: character `#4a9eff`, object `#f0a030`, text `#c77dff`.
- Single-column box list; default node width 560 px, minimum 440 px.
- No base64 reference data in the workflow; store `{filename, type, subfolder}` references only.
- No `palette`, `meta`, `canvas`, or `tags` fields.
- `layout_core.py`, `web/size.js`, `web/geometry.js`, `web/state.js` must not import ComfyUI.
- Test commands: `python -m pytest tests/ -v` (system Python 3.12, pytest 7.4.3) and `node --test "tests/js/*.test.js"` (Node 22). Node schema test uses the ComfyUI venv, see Task 5.
- **Version control:** this folder is not a git repository. Do not initialize git or run commit steps unless the user explicitly authorizes it; the commit steps are checkpoints for when git is enabled.

## Review Focus

1. **Dense/overlapping canvases (50+ boxes):** topmost box wins hit-testing; the selected box is painted last with its 30% fill and never disappears under overlaps. Tests: Task 4 hit-test topmost; Task 12 50-box manual.
2. **Extreme sizes and ratios (0.1/16 MP, 21:9/9:16):** size math matches `ResolutionSelector`; canvas reflows; boxes do not move. Tests: Tasks 1 and 3 exact values; Task 8 manual reflow.
3. **Save/reload and reference loss:** boxes, text, order, background, and transform restore; a missing reference file falls back to white without a crash. Tests: Task 11 and Task 12 manual.
4. **Text labels, empty and non-ASCII text:** the literal survives exactly and only text items carry `text`. Tests: Task 2 non-ASCII exact JSON; Task 7 conditional field; Task 12 parity.
5. **Graph zoom, wheel, and keyboard leakage:** boxes land under the cursor at any graph zoom; the wheel does not zoom the graph; Delete does not fire while typing. Tests: Task 9 graph-zoom manual; Task 10 focus manual.

---

### Task 1: Python core — resolution math

**Files:**
- Create: `layout_core.py`
- Create: `tests/__init__.py` (empty)
- Test: `tests/test_layout_core.py`

**Interfaces:**
- Produces: `ASPECT_RATIOS: dict[str, tuple[int, int]]` keyed by the eight display strings above; `compute_size(aspect_ratio: str, megapixels: float, multiple: int = 16) -> tuple[int, int]`.

- [ ] **Step 1: Write the failing tests**

In `tests/test_layout_core.py`, prepend the project root to `sys.path`, then write exactly these tests (plus `import pytest`):

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_layout_core.py -v`
Expected: collection error / `ModuleNotFoundError: No module named 'layout_core'`.

- [ ] **Step 3: Implement `layout_core.py`**

Add `ASPECT_RATIOS` with the eight keys in spec order, and `compute_size` using the spec's formula verbatim (`total_pixels = megapixels * 1024 * 1024`, `scale = sqrt(total_pixels / (w_ratio * h_ratio))`, `round(... / multiple) * multiple`). Keep the file stdlib-only.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/test_layout_core.py -v`
Expected: 7 passed.

- [ ] **Step 5: Commit (only if the user authorized git)**

```bash
git add layout_core.py tests/__init__.py tests/test_layout_core.py
git commit -m "feat: add MOSS resolution math"
```

---

### Task 2: Python core — boxes and layout JSON

**Files:**
- Modify: `layout_core.py`
- Modify: `tests/test_layout_core.py`

**Interfaces:**
- Produces:
  - `LABELS = ("character", "object", "text")`
  - `parse_boxes(boxes_json: str) -> list[dict]` — returns boxes `{label, caption, text, bbox}`; invalid input returns `[]`.
  - `convert_bbox(y0: int, x0: int, y1: int, x1: int, width: int, height: int) -> list[int]`
  - `build_layout_prompt(summary: str, boxes: list[dict], width: int, height: int) -> str`
- `parse_boxes` accepts `{"version":1,"boxes":[...]}`; each bbox is normalized/sorted/clamped to 0–1000 integers; missing `id` is ignored; zero-size boxes after clamping are dropped; unknown labels become `object`.

- [ ] **Step 1: Write the failing tests**

Add these tests with exact expected values:

```python
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `python -m pytest tests/test_layout_core.py -v`
Expected: import errors for `convert_bbox`, `build_layout_prompt`, `parse_boxes`.

- [ ] **Step 3: Implement the three functions in `layout_core.py`**

Follow the spec's "Exact conversion" section. `convert_bbox` uses `math.floor(round(v * dim / 1000, 9))` for y0/x0 and `math.ceil(round(v * dim / 1000, 9))` for y1/x1, then subtracts `dim // 2`. `build_layout_prompt` returns the summary unchanged when `boxes` is empty; otherwise emits the compact JSON with the exact key order shown in the test.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `python -m pytest tests/ -v`
Expected: all tests pass (19 total).

- [ ] **Step 5: Commit (only if the user authorized git)**

```bash
git add layout_core.py tests/test_layout_core.py
git commit -m "feat: build MOSS layout prompt from boxes"
```

---

### Task 3: JS pure — size preview

**Files:**
- Create: `package.json`
- Create: `web/size.js`
- Test: `tests/js/size.test.js`

**Interfaces:**
- Produces: `ASPECT_RATIOS` (same eight keys/tuples), `pythonRound(value: number) -> number`, `computeSize(aspectRatio: string, megapixels: number, multiple = 16) -> [number, number]`.
- `pythonRound` implements round-half-to-even; unknown ratio throws `Error`.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "comfyui-layout-prompt",
  "private": true,
  "type": "module",
  "scripts": { "test": "node --test \"tests/js/*.test.js\"" }
}
```

- [ ] **Step 2: Write the failing tests**

`tests/js/size.test.js`:

```js
import test from "node:test";
import assert from "node:assert/strict";
import { computeSize, pythonRound, ASPECT_RATIOS } from "../../web/size.js";

test("square 1 MP", () => assert.deepEqual(computeSize("1:1 (Square)", 1.0), [1024, 1024]));
test("portrait photo 1 MP", () => assert.deepEqual(computeSize("2:3 (Portrait Photo)", 1.0), [832, 1248]));
test("widescreen 1 MP", () => assert.deepEqual(computeSize("16:9 (Widescreen)", 1.0), [1360, 768]));
test("ultrawide 1 MP", () => assert.deepEqual(computeSize("21:9 (Ultrawide)", 1.0), [1568, 672]));
test("square 1.5 MP", () => assert.deepEqual(computeSize("1:1 (Square)", 1.5), [1248, 1248]));
test("all results are multiples of 16", () => {
  for (const ratio of Object.keys(ASPECT_RATIOS)) {
    for (const mp of [0.1, 0.5, 1.0, 1.5, 2.0, 4.0]) {
      const [w, h] = computeSize(ratio, mp);
      assert.equal(w % 16, 0);
      assert.equal(h % 16, 0);
    }
  }
});
test("bankers rounding", () => {
  assert.equal(pythonRound(2.5), 2);
  assert.equal(pythonRound(3.5), 4);
  assert.equal(pythonRound(1.5), 2);
});
test("unknown ratio throws", () => assert.throws(() => computeSize("5:4", 1.0)));
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test "tests/js/*.test.js"`
Expected: `ERR_MODULE_NOT_FOUND` for `web/size.js`.

- [ ] **Step 4: Implement `web/size.js`**

Copy the ratio table and formula from the spec. `pythonRound` must match Python for exact halves.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/js/*.test.js"`
Expected: 8 tests pass.

- [ ] **Step 6: Commit (only if the user authorized git)**

```bash
git add package.json web/size.js tests/js/size.test.js
git commit -m "feat: add JS size preview"
```

---

### Task 4: JS pure — geometry and state/history

**Files:**
- Create: `web/geometry.js`
- Create: `web/state.js`
- Test: `tests/js/geometry.test.js`
- Test: `tests/js/state.test.js`

**Interfaces:**
- `geometry.js`:
  - `normalizeBbox(bbox: number[]) -> [number, number, number, number]` — sorted, rounded, clamped 0–1000, yxyx.
  - `bboxToRect(bbox, canvasW, canvasH) -> {x, y, w, h}` — x uses width, y uses height.
  - `rectToBbox(x, y, w, h, canvasW, canvasH) -> [y0, x0, y1, x1]` — normalized ints.
  - `hitTest(boxes, px, py, canvasW, canvasH, handleRadius = 6) -> {id, part} | null`; `part` is `move` or one of `tl`, `tc`, `tr`, `ml`, `mr`, `bl`, `bc`, `br`; later boxes win.
- `state.js`:
  - `createBox(id, bbox, {label = "character", caption = "", text = ""}) -> box`
  - `createState() -> {version: 1, boxes: [], selectedId: null}`
  - `addBox(state, box)`, `updateBox(state, id, patch)`, `deleteBox(state, id)`, `duplicateBox(state, id, newId, offset = 30)`, `moveBox(state, id, delta)` — all return new state objects.
  - `serializeState(state) -> string` — JSON of `{version, boxes}` only, no `selectedId`.
  - `deserializeState(json) -> state` — invalid input returns an empty state.
  - `createHistory(limit = 50)`, `pushHistory(history, state)`, `undo(history, state)`, `redo(history, state)`.

- [ ] **Step 1: Write the failing geometry tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBbox, bboxToRect, rectToBbox, hitTest } from "../../web/geometry.js";

test("normalize sorts and clamps", () => {
  assert.deepEqual(normalizeBbox([400, 600, 100, 200]), [100, 200, 400, 600]);
  assert.deepEqual(normalizeBbox([-10, 0, 500, 1200]), [0, 0, 500, 1000]);
});
test("bbox to rect", () => {
  assert.deepEqual(bboxToRect([100, 200, 400, 600], 800, 600), { x: 160, y: 60, w: 320, h: 180 });
});
test("rect to bbox round-trips", () => {
  assert.deepEqual(rectToBbox(160, 60, 320, 180, 800, 600), [100, 200, 400, 600]);
});
test("hitTest topmost wins", () => {
  const boxes = [{ id: "a", bbox: [0, 0, 500, 500] }, { id: "b", bbox: [100, 100, 600, 600] }];
  assert.deepEqual(hitTest(boxes, 200, 200, 1000, 1000), { id: "b", part: "move" });
});
test("hitTest corner handle", () => {
  const boxes = [{ id: "b", bbox: [100, 100, 600, 600] }];
  assert.deepEqual(hitTest(boxes, 100, 100, 1000, 1000), { id: "b", part: "tl" });
});
test("hitTest outside is null", () => {
  assert.equal(hitTest([{ id: "b", bbox: [100, 100, 600, 600] }], 900, 900, 1000, 1000), null);
});
```

- [ ] **Step 2: Write the failing state tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { createBox, createState, addBox, updateBox, deleteBox, duplicateBox,
         moveBox, serializeState, deserializeState, createHistory, pushHistory,
         undo, redo } from "../../web/state.js";

const box = (id, bbox) => createBox(id, bbox);

test("add and select", () => {
  const s = addBox(createState(), box("b1", [100, 100, 200, 200]));
  assert.equal(s.boxes.length, 1);
  assert.equal(s.selectedId, "b1");
});
test("update", () => {
  let s = addBox(createState(), box("b1", [100, 100, 200, 200]));
  s = updateBox(s, "b1", { caption: "arm", label: "text", text: "hi" });
  assert.equal(s.boxes[0].caption, "arm");
  assert.equal(s.boxes[0].label, "text");
});
test("delete selects neighbor", () => {
  let s = addBox(createState(), box("b1", [0, 0, 100, 100]));
  s = addBox(s, box("b2", [100, 100, 200, 200]));
  s = deleteBox(s, "b2");
  assert.equal(s.boxes.length, 1);
  assert.equal(s.selectedId, "b1");
});
test("duplicate offsets and clamps", () => {
  let s = addBox(createState(), box("b1", [950, 950, 1000, 1000]));
  s = duplicateBox(s, "b1", "b2", 30);
  assert.deepEqual(s.boxes[1].bbox, [980, 980, 1000, 1000]);
  assert.equal(s.selectedId, "b2");
});
test("move order", () => {
  let s = addBox(createState(), box("b1", [0, 0, 100, 100]));
  s = addBox(s, box("b2", [100, 100, 200, 200]));
  s = moveBox(s, "b2", -1);
  assert.deepEqual(s.boxes.map(b => b.id), ["b2", "b1"]);
});
test("serialize omits selection", () => {
  let s = addBox(createState(), box("b1", [0, 0, 100, 100]));
  assert.deepEqual(JSON.parse(serializeState(s)), { version: 1, boxes: s.boxes });
  assert.equal(serializeState(s).includes("selectedId"), false);
});
test("deserialize invalid returns empty", () => {
  assert.deepEqual(deserializeState("nope"), createState());
});
test("undo and redo", () => {
  let s = createState();
  let h = createHistory(50);
  h = pushHistory(h, s);
  s = addBox(s, box("b1", [0, 0, 100, 100]));
  let r = undo(h, s);
  assert.deepEqual(r.state, createState());
  r = redo(r.history, r.state);
  assert.equal(r.state.boxes.length, 1);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `node --test "tests/js/*.test.js"`
Expected: module-not-found for `web/geometry.js` and `web/state.js`.

- [ ] **Step 4: Implement `web/geometry.js` and `web/state.js`**

Keep both modules DOM-free and ComfyUI-free. Use immutable updates. `deleteBox` selects the previous box when deleting the selected one, else the next, else `null`.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `node --test "tests/js/*.test.js"`
Expected: all JS tests pass.

- [ ] **Step 6: Commit (only if the user authorized git)**

```bash
git add web/geometry.js web/state.js tests/js/geometry.test.js tests/js/state.test.js
git commit -m "feat: add editor geometry and state"
```

---

### Task 5: ComfyUI node class and registration

**Files:**
- Create: `nodes.py`
- Create: `__init__.py`
- Test: `tests/node_schema_check.py` (deliberately not `test_*.py`, so system-pytest does not collect it)

**Interfaces:**
- `nodes.LayoutPromptBuilder(io.ComfyNode)` with the schema below and `execute(summary, aspect_ratio, megapixels, boxes_json="") -> io.NodeOutput(width, height, prompt)`.
- `__init__.py`: `NODE_CLASS_MAPPINGS`, `NODE_DISPLAY_NAME_MAPPINGS`, `WEB_DIRECTORY = "./web"`, `__all__`.
- Schema inputs: `summary` (`io.String.Input`, multiline, dynamic_prompts, default `""`), `aspect_ratio` (`io.Combo.Input`, options `list(ASPECT_RATIOS)`, default `"1:1 (Square)"`), `megapixels` (`io.Float.Input`, 0.1–16.0 step 0.1 default 1.0), `boxes_json` (`io.String.Input`, multiline False, default `""`, `socketless=True`).
- Schema outputs: `io.Int.Output("width")`, `io.Int.Output("height")`, `io.String.Output("prompt")`.

- [ ] **Step 1: Write the failing schema test**

`tests/node_schema_check.py` (unittest, no pytest in the ComfyUI venv):

```python
import importlib.util, sys, unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location(
    "layout_prompt_pkg", ROOT / "__init__.py",
    submodule_search_locations=[str(ROOT)])
pkg = importlib.util.module_from_spec(spec)
sys.modules["layout_prompt_pkg"] = pkg
spec.loader.exec_module(pkg)

class TestSchema(unittest.TestCase):
    def test_schema(self):
        cls = pkg.NODE_CLASS_MAPPINGS["LayoutPromptBuilder"]
        schema = cls.define_schema()
        self.assertEqual(schema.node_id, "LayoutPromptBuilder")
        self.assertEqual(schema.display_name, "Layout Prompt Builder")
        self.assertEqual([i.id for i in schema.inputs],
                         ["summary", "aspect_ratio", "megapixels", "boxes_json"])
        self.assertEqual([o.display_name for o in schema.outputs],
                         ["width", "height", "prompt"])

    def test_execute(self):
        cls = pkg.NODE_CLASS_MAPPINGS["LayoutPromptBuilder"]
        boxes = ('{"version":1,"boxes":[{"label":"character","caption":"miku",'
                 '"text":"","bbox":[100,200,400,600]}]}')
        out = cls.execute("1girl", "1:1 (Square)", 1.0, boxes)
        self.assertEqual(out.args[0:2], (1024, 1024))
        self.assertIn('"label":"character"', out.args[2])
        self.assertIn('"bbox":[-410,-308,-102,103]', out.args[2])

    def test_no_boxes_is_plain_summary(self):
        cls = pkg.NODE_CLASS_MAPPINGS["LayoutPromptBuilder"]
        out = cls.execute("  hello  ", "1:1 (Square)", 1.0, "")
        self.assertEqual(out.args[2], "  hello  ")

    def test_invalid_boxes_logs_warning(self):
        cls = pkg.NODE_CLASS_MAPPINGS["LayoutPromptBuilder"]
        with self.assertLogs(level="WARNING") as cm:
            out = cls.execute("hello", "1:1 (Square)", 1.0, "not json")
        self.assertEqual(out.args[2], "hello")
        self.assertTrue(any("boxes_json" in message for message in cm.output))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run it to verify it fails**

Run:
```bash
PYTHONPATH="C:/Users/sjmin/ComfyUI-Installs/ComfyUI/ComfyUI" \
E:/ComfyUI2/.venv/Scripts/python.exe -m unittest tests.node_schema_check -v
```
Expected: `FileNotFoundError` / no `__init__.py`.

- [ ] **Step 3: Implement `nodes.py` and `__init__.py`**

`execute` calls `compute_size`, `parse_boxes` (defaulting to `""`), and `build_layout_prompt`. If `boxes_json.strip()` is non-empty and `parse_boxes` returns no boxes, log a warning that mentions `boxes_json` (`logging.getLogger(__name__).warning(...)`) and still output the summary. Use relative imports (`from .layout_core import ...`) and the schema exactly as above.

- [ ] **Step 4: Run the schema test to verify it passes**

Run the same command.
Expected: 4 tests pass.

- [ ] **Step 5: Load the node in ComfyUI**

Restart the ComfyUI server that serves `E:/ComfyUI2/custom_nodes` and hard-refresh the browser.
Manual: the node appears under `model/conditioning/moss_image`; add it, set 1:1 / 1.0, and connect the outputs to a Preview Any node. Expect width 1024, height 1024, and the plain summary prompt. (The canvas UI does not exist yet.)

- [ ] **Step 6: Commit (only if the user authorized git)**

```bash
git add nodes.py __init__.py tests/node_schema_check.py
git commit -m "feat: register layout prompt node"
```

---

### Task 6: Frontend shell

**Files:**
- Create: `web/layout_prompt.js`
- Create: `web/editor.js`
- Create: `web/styles.js`

**Interfaces:**
- `layout_prompt.js`: `app.registerExtension({ name: "Moss.LayoutPromptBuilder", beforeRegisterNodeDef(nodeType, nodeData) { ... } })`.
- `editor.js`: `class LayoutEditor { constructor(node, hiddenWidget); mount(container); computeHeight(): number; destroy(); }`.
- `styles.js`: `injectStyles()` adds `<style id="layout-prompt-styles">` once.

- [ ] **Step 1: Write the extension shell**

In `beforeRegisterNodeDef`, return unless `nodeData.name === "LayoutPromptBuilder"`. Chain `onNodeCreated` to: find the `boxes_json` widget and set `hidden = true`; call `injectStyles()`; create a container div; `node.addDOMWidget("layout_editor", "LayoutEditor", container, { serialize: false, hideOnZoom: false, getHeight: () => editor.computeHeight(), getMinHeight: () => editor.computeHeight(), getMaxHeight: () => editor.computeHeight() })`; construct `new LayoutEditor(node, hiddenWidget)` and `mount(container)`; set the node width to 560 and clamp it to at least 440 on resize; chain `onResize`, `onConfigure`, `onRemoved`.

- [ ] **Step 2: Implement the editor skeleton**

`LayoutEditor` parses `hiddenWidget.value` with `deserializeState`, renders a placeholder panel (styled), and `computeHeight()` returns 400 for now. `destroy()` removes listeners.

- [ ] **Step 3: Load the node and verify the shell**

Restart the server if needed, hard-refresh, add the node.
Manual: a dark placeholder panel sits below the standard widgets; `boxes_json` is not visible; the node is 560 px wide; resizing the node doesn't clip the panel; outputs are top-right; no console errors.

- [ ] **Step 4: Commit (only if the user authorized git)**

```bash
git add web/layout_prompt.js web/editor.js web/styles.js
git commit -m "feat: add node frontend shell"
```

---

### Task 7: Box list and serialization

**Files:**
- Create: `web/list.js`
- Modify: `web/editor.js`
- Modify: `web/styles.js`

**Interfaces:**
- `list.js`: `renderBoxList(container, state, handlers) -> void`; handlers `{onSelect, onUpdate, onDelete, onDuplicate, onMove, onAdd}`.
- `LayoutEditor` owns `state`; every mutation sets `hiddenWidget.value = serializeState(state)` and calls `node.setDirtyCanvas(true, true)` / updates the widget height.

- [ ] **Step 1: Implement the list**

Single column, max-height about five rows, then the list scrolls. Row: index chip in the label color; `<select>` with `character`/`object`/`text`; caption `<input>`; `text` `<input>` only when label is `text`; duplicate, up, down, delete buttons. Header: `boxes · N` and `+ add`. Clicking a row selects it; the selected row gets the selected border. `+ add` creates a 20% centered box `[400,400,600,600]`, label `character`, selected. Switching a label away from `text` hides but retains the text value in state; switching back restores it. Editing any field commits on `change` (captions may also commit on `input` with a short debounce).

- [ ] **Step 2: Wire state and persistence**

Every handler updates `state` immutably, sets `hiddenWidget.value`, re-renders the list, and requests a node height update. On construction, `deserializeState(hiddenWidget.value)`; on `onConfigure`, re-read it.

- [ ] **Step 3: Verify the list manually**

Restart/reload; add the node.
Manual: `+ add` creates a row and updates the count; editing label/caption/text persists in the row; `text` only shows for text labels; deleting/duplicating/reordering works; selected row highlights; save the workflow and confirm `boxes_json` contains the version/boxes JSON with 0–1000 integers and no `selectedId`.

- [ ] **Step 4: Commit (only if the user authorized git)**

```bash
git add web/list.js web/editor.js web/styles.js
git commit -m "feat: add single-column box list"
```

---

### Task 8: Canvas, selection visuals, and reference transform

**Files:**
- Create: `web/canvas.js`
- Create: `web/background.js`
- Modify: `web/editor.js`
- Modify: `web/styles.js`

**Interfaces:**
- `canvas.js`: `class CanvasView { constructor(canvas); resize(canvasW, canvasH); render(state, background); }` — `background` is the `Background` instance, which owns the reference image and transform.
- `background.js`: `class Background { mode = "white", fit = "fill", zoom = 1, panX = 0, panY = 0, image = null; setFile(file); setMode(mode); setFit(fit); zoomBy(factor, anchor); panBy(dx, dy); loadStored(ref); }`.
- `LayoutEditor` computes the display canvas size from the ratio and node width (max long side 340, max width `nodeWidth - 24`), sets the canvas DPR, and wires the toolbar.

- [ ] **Step 1: Implement white-canvas box rendering**

Render the canvas: white background; boxes via `bboxToRect`; unselected outline in the label color; hover 12% tint + dashed outline; selected 30% fill + 2.5 px outline + 8 handles; selected box last. Use `devicePixelRatio` and `requestAnimationFrame`.

- [ ] **Step 2: Verify box rendering and selection**

Manual: add boxes from the list; they appear at the right positions; clicking a row highlights the box and vice versa (list selection already exists); the selected fill is legible with 10+ overlapping boxes; hover is weaker than selection; resizing the node reflows the canvas; 9:16 and 21:9 keep the right ratio and boxes stay normalized.

- [ ] **Step 3: Add the reference layer and file picker**

Add the toolbar: `White | Reference`, `Pick file`, `Fill`, `Fit`, `−`, `zoom %`, `+`, `Move bg`, and the hint line. `Pick file` uploads via `api.fetchApi("/upload/image", ...)` with `type=input`, `overwrite=true`, unique name; load the returned name with `api.apiURL("/view?...")`. Draw the reference clipped to the canvas with the Fit/Fill base scale, zoom, and pan; dim it to 55%.

- [ ] **Step 4: Implement transform interactions**

Wheel over the canvas zooms the reference at the cursor (`preventDefault` + `stopPropagation`); `−`/`+` step 10%; zoom is clamped to 0.5–8.0 (100% = the current Fill/Fit scale); `Move bg` drag pans; Space+drag and middle-drag pan in any mode; clamps keep the image visible. `Fit`/`Fill` reset zoom to 100% and center. Changing ratio/MP recomputes the base fit and preserves the source point at the canvas center plus the zoom; Fit/Fill recenters. Boxes never move.

- [ ] **Step 5: Verify the reference manually**

Manual: pick a reference; it appears dimmed; Fill covers, Fit letterboxes; wheel zoom stays under the cursor; pan works in all three ways; the graph does not zoom; switching White/Reference preserves the reference; changing ratio/MP reflows the canvas and keeps boxes in place.

- [ ] **Step 6: Commit (only if the user authorized git)**

```bash
git add web/canvas.js web/background.js web/editor.js web/styles.js
git commit -m "feat: render canvas and reference layer"
```

---

### Task 9: Pointer editing

**Files:**
- Modify: `web/canvas.js`
- Modify: `web/editor.js`
- Modify: `web/list.js`

**Interfaces:**
- Canvas pointer handlers use `getBoundingClientRect()` to map client coordinates to canvas pixels, then `hitTest` / `rectToBbox`.
- Drag state: `{kind: "draw"|"move"|"resize", id, part, startPx, startBox}`.

- [ ] **Step 1: Implement draw/move/resize/select**

Left-drag on empty canvas draws a new box (ignore <3 display px); left-drag inside a box moves it; handle drag resizes with the 8 parts; clamp to 0–1000 and enforce a 3 px minimum; pointer-down selects; empty-canvas click deselects; new boxes are selected and appended. Update the hidden widget and list after each commit (pointer-up), redraw on pointer-move.

- [ ] **Step 2: Verify pointer editing manually**

Manual: draw, move, resize from every handle, select, deselect; the list scrolls to the selected row; selection sync works in both directions; boxes stay under the cursor at graph zoom 0.5, 1, and 2; dragging outside the canvas clamps; clicking a box after a reference pan still selects (not pans).

- [ ] **Step 3: Commit (only if the user authorized git)**

```bash
git add web/canvas.js web/editor.js web/list.js
git commit -m "feat: add pointer box editing"
```

---

### Task 10: Keyboard and undo/redo

**Files:**
- Modify: `web/editor.js`
- Modify: `web/list.js`

**Interfaces:**
- Canvas has `tabindex="0"`; keydown handler ignores events from `input`, `select`, and `textarea`.
- History: `createHistory(50)`, snapshots pushed on pointer-up and committed field changes; `Ctrl+Z`/`Ctrl+Shift+Z` outside text fields.

- [ ] **Step 1: Implement keyboard and history**

Arrows nudge the selected box 1 unit, Shift+arrows 10; Delete/Backspace deletes; Ctrl+D duplicates; Esc deselects; Ctrl+Z/Ctrl+Shift+Z undo/redo. Space+drag and middle-drag pan without entering draw mode. Push snapshots only on commits; update the hidden widget after undo/redo.

- [ ] **Step 2: Verify manually**

Manual: nudge, delete, duplicate, deselect, undo/redo across add/move/resize/label/caption/text/reorder; Ctrl+Z inside a caption edits text, not the layout; keys only fire with canvas focus; Delete while typing in a caption does not delete a box; the wheel never zooms the graph.

- [ ] **Step 3: Commit (only if the user authorized git)**

```bash
git add web/editor.js web/list.js
git commit -m "feat: add keyboard editing and undo"
```

---

### Task 11: Last output and background persistence

**Files:**
- Modify: `web/background.js`
- Modify: `web/editor.js`
- Modify: `web/layout_prompt.js`

**Interfaces:**
- Global `api.addEventListener("executed", ({ detail }) => ...)`; `detail.output.images` last entry gives `{filename, type, subfolder}`.
- `node.properties.layoutPromptBg = { mode, source, file, last, fit, zoom, panX, panY }`; restore on `onConfigure`.

- [ ] **Step 1: Implement “Use last output”**

On any `executed` event with `detail.output.images`, store the last image reference on the node (prefer the most recent event). The `Use last output` button sets source `last`, mode `reference`, and loads via `api.apiURL("/view?" + new URLSearchParams({filename, type, subfolder, t: Date.now()}))`. Show a small source badge.

- [ ] **Step 2: Persist and restore the background**

Save `{mode, source, file, last, fit, zoom, panX, panY}` in `node.properties` on every committed change. On `onConfigure`, restore mode/source/fit/zoom/pan and load the stored file or last-output reference. On image load error, clear the visible image, show “reference unavailable”, and keep the stored reference; the canvas stays white.

- [ ] **Step 3: Verify manually**

Manual: generate an image with PreviewImage or SaveImage; click `Use last output`; it appears. Pick a file, transform it, save the workflow, reload; the reference and transform restore. Delete the referenced file (or rename it), reload; the node shows the hint and a white canvas without errors. White/Reference toggling returns to the stored source.

- [ ] **Step 4: Commit (only if the user authorized git)**

```bash
git add web/background.js web/editor.js web/layout_prompt.js
git commit -m "feat: add last-output reference and persistence"
```

---

### Task 12: Integration parity and end-to-end checks

**Files:**
- Modify: `layout_core.py` / frontend only if a check fails.

- [ ] **Step 1: Parity with the built-in chain**

Build identical boxes in our node and in `CreateBoundingBoxes` + `MOSSImageLayoutPrompt` (same 0–1000 bboxes, same width/height). Compare the two `prompt` strings character for character. Include a text item with a non-ASCII literal and a character item. If they differ, fix `layout_core.py`, rerun `python -m pytest tests/ -v`, and re-compare.

- [ ] **Step 2: End-to-end manual checklist**

Manual:
1. No boxes → `prompt` equals the summary unchanged; empty summary + no boxes → empty string.
2. Ratio/MP changes: width/height match `ResolutionSelector` at 1.0 and 1.5 MP; boxes do not move.
3. Save/reload with boxes, labels, text, order, and reference transform; everything restores.
4. 50 overlapping boxes on a 340 px canvas: selected fill is legible; dragging stays responsive; hit-test picks the topmost.
5. 9:16 and 21:9 at 0.1 and 16 MP: canvas reflows, no clipping.
6. Remove the node; no console errors; the global `executed` handler ignores removed nodes.
7. Generate through the full MOSS workflow using the node's width/height/prompt in place of the built-in chain; the image queues.

- [ ] **Step 3: Commit fixes (only if any code changed and git is authorized)**

```bash
git add layout_core.py web/
git commit -m "fix: align layout prompt with built-in parity"
```

---

### Task 13: README and CLAUDE.md

**Files:**
- Create: `README.md`
- Create: `CLAUDE.md`

- [ ] **Step 1: Write `README.md`**

Include: what the node does; install location; restart/reload; the controls table (draw, move, resize, select, Delete, Ctrl+D, arrows, undo, wheel, pan); reference sources and transform; the output JSON shape; limitations (no graph image input, no palette/meta, experimental MOSS format).

- [ ] **Step 2: Write `CLAUDE.md`**

Start with exactly:

```markdown
# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.
```

Then include: commands (`python -m pytest tests/ -v`, `node --test "tests/js/*.test.js"`, `PYTHONPATH="C:/Users/sjmin/ComfyUI-Installs/ComfyUI/ComfyUI" E:/ComfyUI2/.venv/Scripts/python.exe -m unittest tests.node_schema_check -v`, restart/reload); architecture (`layout_core.py` pure math/JSON, `nodes.py` V3 node, `web/*` editor modules); invariants (0–1000 yxyx, multiple 16, exact JSON, labels, selected fill); key gotchas (hidden `boxes_json` widget, `executed` event, `/upload/image`, wheel event consumption, `getBoundingClientRect` mapping).

- [ ] **Step 3: Verify the docs against the code**

Manual: run every command in `CLAUDE.md`; confirm each path and widget name exists; confirm the README controls match the editor.

- [ ] **Step 4: Commit (only if the user authorized git)**

```bash
git add README.md CLAUDE.md
git commit -m "docs: add usage and development guide"
```
