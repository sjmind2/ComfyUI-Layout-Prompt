// DOM-free geometry helpers for the layout editor.
//
// Bounding boxes use the node's 0-1000 yxyx convention: [y0, x0, y1, x1],
// with y running top to bottom. Boxes are stored in a 1000-unit square
// regardless of the canvas aspect ratio.

const BBOX_MAX = 1000;

const HANDLE_OFFSETS = Object.freeze([
  ["tl", 0, 0],
  ["tc", 0.5, 0],
  ["tr", 1, 0],
  ["ml", 0, 0.5],
  ["mr", 1, 0.5],
  ["bl", 0, 1],
  ["bc", 0.5, 1],
  ["br", 1, 1],
]);

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function ratioToPixels(value, size) {
  return (value * size) / BBOX_MAX;
}

function pixelsToRatio(value, size) {
  return size > 0 ? (value * BBOX_MAX) / size : 0;
}

/**
 * Sort, round and clamp a bbox to 0-1000 integer yxyx coordinates.
 * @param {number[]} bbox
 * @returns {[number, number, number, number]}
 */
export function normalizeBbox(bbox) {
  const [y0, x0, y1, x1] = bbox.map((value) =>
    clamp(Math.round(value), 0, BBOX_MAX),
  );
  // Sort each axis independently: a yxyx box is not a globally sorted list.
  return [
    Math.min(y0, y1),
    Math.min(x0, x1),
    Math.max(y0, y1),
    Math.max(x0, x1),
  ];
}

/**
 * Convert a 0-1000 yxyx bbox into canvas pixels.
 * @param {number[]} bbox
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {{x: number, y: number, w: number, h: number}}
 */
export function bboxToRect(bbox, canvasW, canvasH) {
  const [y0, x0, y1, x1] = normalizeBbox(bbox);
  return {
    x: ratioToPixels(x0, canvasW),
    y: ratioToPixels(y0, canvasH),
    w: ratioToPixels(x1 - x0, canvasW),
    h: ratioToPixels(y1 - y0, canvasH),
  };
}

/**
 * Convert a pixel rect into a normalized 0-1000 integer yxyx bbox.
 * @param {number} x
 * @param {number} y
 * @param {number} w
 * @param {number} h
 * @param {number} canvasW
 * @param {number} canvasH
 * @returns {[number, number, number, number]}
 */
export function rectToBbox(x, y, w, h, canvasW, canvasH) {
  return normalizeBbox([
    pixelsToRatio(y, canvasH),
    pixelsToRatio(x, canvasW),
    pixelsToRatio(y + h, canvasH),
    pixelsToRatio(x + w, canvasW),
  ]);
}

function hitHandle(rect, px, py, radius) {
  for (const [part, fx, fy] of HANDLE_OFFSETS) {
    const hx = rect.x + rect.w * fx;
    const hy = rect.y + rect.h * fy;
    if (Math.abs(px - hx) <= radius && Math.abs(py - hy) <= radius) return part;
  }
  return null;
}

/**
 * True when a box is small enough that its handles cover the whole interior
 * (either side no wider than the handle diameter). Such a box could otherwise
 * never be moved: every press would become a resize.
 */
function isTinyRect(rect, radius) {
  return rect.w <= radius * 2 || rect.h <= radius * 2;
}

/** True inside the central quarter of the box, where a press means "move". */
function nearRectCenter(rect, px, py) {
  const centerX = rect.x + rect.w / 2;
  const centerY = rect.y + rect.h / 2;
  return (
    Math.abs(px - centerX) <= rect.w / 4 &&
    Math.abs(py - centerY) <= rect.h / 4
  );
}

function insideRect(rect, px, py) {
  return (
    px >= rect.x &&
    px <= rect.x + rect.w &&
    py >= rect.y &&
    py <= rect.y + rect.h
  );
}

/**
 * Find the topmost box and the part under a canvas-space point.
 * @param {{id: string, bbox: number[]}[]} boxes painted bottom to top
 * @param {number} px
 * @param {number} py
 * @param {number} canvasW
 * @param {number} canvasH
 * @param {number} [handleRadius=6]
 * @returns {{id: string, part: string} | null}
 */
export function hitTest(boxes, px, py, canvasW, canvasH, handleRadius = 6) {
  for (let index = boxes.length - 1; index >= 0; index -= 1) {
    const box = boxes[index];
    const rect = bboxToRect(box.bbox, canvasW, canvasH);
    const inside = insideRect(rect, px, py);
    // For a box no larger than the handle hit area, prefer moving when the
    // press is near its center; presses near a corner or edge still resize.
    if (inside && isTinyRect(rect, handleRadius) && nearRectCenter(rect, px, py)) {
      return { id: box.id, part: "move" };
    }
    const part = hitHandle(rect, px, py, handleRadius);
    if (part) return { id: box.id, part };
    if (inside) return { id: box.id, part: "move" };
  }
  return null;
}
