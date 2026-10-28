import test from "node:test";
import assert from "node:assert/strict";
import {
  CANVAS_HORIZONTAL_GUTTER,
  computeEditorHeight,
  DOM_WIDGET_MARGIN,
} from "../../web/editor_height.js";

// Mirrors the panel CSS: container padding, canvas, toolbar/hint stack,
// list header and header gap; one row is always reserved.
const CONTENT = 6 + 340 + 52 + 24 + 4;
const ROW = 28;
const GAP = 2;

test("includes the DOM widget margin on both sides", () => {
  assert.equal(DOM_WIDGET_MARGIN, 10);
  assert.equal(
    computeEditorHeight(340, 0),
    2 * DOM_WIDGET_MARGIN + CONTENT + ROW,
  );
});

test("an empty list reserves one visible row", () => {
  assert.equal(computeEditorHeight(340, 0), computeEditorHeight(340, 1));
});

test("each additional row adds its height and the row gap", () => {
  assert.equal(
    computeEditorHeight(340, 2) - computeEditorHeight(340, 1),
    ROW + GAP,
  );
  assert.equal(
    computeEditorHeight(340, 5) - computeEditorHeight(340, 4),
    ROW + GAP,
  );
});

test("caps the visible list at five rows", () => {
  assert.equal(computeEditorHeight(340, 6), computeEditorHeight(340, 5));
  assert.equal(computeEditorHeight(340, 50), computeEditorHeight(340, 5));
});

test("canvas height is added once", () => {
  assert.equal(computeEditorHeight(500, 3) - computeEditorHeight(340, 3), 160);
});

test("canvas gutter covers the widget margin and panel padding", () => {
  assert.equal(CANVAS_HORIZONTAL_GUTTER, 2 * DOM_WIDGET_MARGIN + 8);
});
