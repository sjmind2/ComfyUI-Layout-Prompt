// Pure height and width math for the editor DOM widget.
//
// The frontend sizes a DOM widget's element to `computedHeight - 2 * margin`
// (BaseDOMWidgetImpl.DEFAULT_MARGIN is 10), so the height returned from
// getHeight/getMinHeight/getMaxHeight must include that margin or the panel is
// clipped. The constants mirror the .lp-* rules in styles.js.

/** DOM widget margin on every side (frontend DEFAULT_MARGIN). */
export const DOM_WIDGET_MARGIN = 10;

// .layout-prompt-editor padding: 2px top + 4px bottom.
const CONTAINER_VERTICAL_PADDING = 6;
// .layout-prompt-editor padding: 4px left + 4px right.
const CONTAINER_HORIZONTAL_PADDING = 8;
// .lp-canvas-stage margin-bottom.
const CANVAS_BOTTOM_GAP = 6;
const TOOLBAR_HEIGHT = 24;
const TOOLBAR_HINT_GAP = 2;
const HINT_HEIGHT = 14;
// .lp-list-host margin-top.
const HINT_LIST_GAP = 6;
const LIST_HEADER_HEIGHT = 24;
// .lp-list-host gap.
const LIST_HEADER_GAP = 4;
const LIST_ROW_HEIGHT = 28;
const LIST_ROW_GAP = 2;
const MAX_VISIBLE_ROWS = 5;
const MIN_VISIBLE_ROWS = 1;

const CANVAS_STACK_HEIGHT =
  CANVAS_BOTTOM_GAP +
  TOOLBAR_HEIGHT +
  TOOLBAR_HINT_GAP +
  HINT_HEIGHT +
  HINT_LIST_GAP;

/**
 * Canvas width available inside a node: the node width minus the DOM widget's
 * margin on both sides and the panel's horizontal padding.
 */
export const CANVAS_HORIZONTAL_GUTTER =
  2 * DOM_WIDGET_MARGIN + CONTAINER_HORIZONTAL_PADDING;

/**
 * Height of the editor panel in CSS pixels, including the DOM widget margin
 * the frontend subtracts from the element.
 * @param {number} canvasHeight display height of the canvas
 * @param {number} boxCount number of boxes in the list
 * @returns {number}
 */
export function computeEditorHeight(canvasHeight, boxCount) {
  const height = Number.isFinite(canvasHeight) ? canvasHeight : 0;
  const count =
    Number.isFinite(boxCount) && boxCount > 0 ? Math.floor(boxCount) : 0;
  const visibleRows = Math.max(
    MIN_VISIBLE_ROWS,
    Math.min(count, MAX_VISIBLE_ROWS),
  );
  return (
    2 * DOM_WIDGET_MARGIN +
    CONTAINER_VERTICAL_PADDING +
    height +
    CANVAS_STACK_HEIGHT +
    LIST_HEADER_HEIGHT +
    LIST_HEADER_GAP +
    visibleRows * LIST_ROW_HEIGHT +
    (visibleRows - 1) * LIST_ROW_GAP
  );
}
