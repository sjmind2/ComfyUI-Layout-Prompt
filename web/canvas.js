// Canvas renderer for the Layout Prompt Builder.
//
// Draws the output rectangle, the optional reference layer, and the boxes.
// Boxes use the 0-1000 yxyx coordinate space (bboxToRect maps them onto the
// canvas), while the reference transform comes from the Background instance.
// The selected box is painted last so it stays legible over overlaps.

import { bboxToRect } from "./geometry.js";
import { LABEL_COLORS } from "./list.js";

const CANVAS_BACKGROUND = "#ffffff";
const FALLBACK_BOX_COLOR = "#f0a030";
const OUTLINE_WIDTH = 1.5;
const SELECTED_OUTLINE_WIDTH = 2.5;
const HOVER_FILL_ALPHA = 0.12;
const SELECTED_FILL_ALPHA = 0.3;
const REFERENCE_DIM_ALPHA = 0.45;
const HANDLE_SIZE = 7;
const HANDLE_HALF = HANDLE_SIZE / 2;
const HANDLE_FILL = "#ffffff";
const HANDLE_STROKE = "rgba(0, 0, 0, 0.55)";
const DASH_PATTERN = [4, 3];

const HANDLE_POSITIONS = Object.freeze([
  [0, 0],
  [0.5, 0],
  [1, 0],
  [0, 0.5],
  [1, 0.5],
  [0, 1],
  [0.5, 1],
  [1, 1],
]);

/**
 * Convert a #rrggbb label color into an rgba() string with the given alpha.
 * Keeping the alpha explicit avoids relying on 8-digit hex canvas support.
 * @param {string} hex
 * @param {number} alpha 0-1
 * @returns {string}
 */
function withAlpha(hex, alpha) {
  const value = typeof hex === "string" ? hex : FALLBACK_BOX_COLOR;
  const match = /^#([0-9a-f]{6})$/i.exec(value);
  if (!match) return `rgba(240, 160, 48, ${alpha})`;

  const number = Number.parseInt(match[1], 16);
  const red = (number >> 16) & 0xff;
  const green = (number >> 8) & 0xff;
  const blue = number & 0xff;
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function boxColor(box) {
  return LABEL_COLORS[box?.label] ?? FALLBACK_BOX_COLOR;
}

/**
 * Boxes in paint order: every unselected box in list order, then the selected
 * box last so overlaps never hide it. Hit-testing must use the same order so
 * pointer-down agrees with what the user sees.
 * @param {object[]} boxes
 * @param {string | null} selectedId
 * @returns {object[]}
 */
export function paintOrder(boxes, selectedId) {
  const list = Array.isArray(boxes) ? boxes : [];
  const selected = list.find((box) => box.id === selectedId) ?? null;
  if (!selected) return [...list];
  return [...list.filter((box) => box !== selected), selected];
}

/**
 * Canvas view layer. The editor owns state and scheduling; this class only
 * resizes the backing store and paints one frame.
 */
export class CanvasView {
  /** @param {HTMLCanvasElement} canvas */
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas?.getContext?.("2d") ?? null;
    this.width = 1;
    this.height = 1;
    this.dpr = 1;
    this.hoverId = null;
    this.resized = false;
  }

  /**
   * Match the CSS size to the display size and scale the backing store by the
   * device pixel ratio.
   * @param {number} canvasW CSS pixels
   * @param {number} canvasH CSS pixels
   * @param {number} [dpr] defaults to window.devicePixelRatio
   */
  resize(canvasW, canvasH, dpr = null) {
    const width = Math.max(1, Math.round(canvasW));
    const height = Math.max(1, Math.round(canvasH));
    const pixelRatio =
      dpr ??
      (typeof window !== "undefined" && window.devicePixelRatio) ??
      1;

    if (
      this.resized &&
      width === this.width &&
      height === this.height &&
      pixelRatio === this.dpr
    ) {
      return;
    }

    this.width = width;
    this.height = height;
    this.dpr = pixelRatio;
    this.resized = true;

    if (!this.canvas) return;

    this.canvas.width = Math.max(1, Math.round(width * pixelRatio));
    this.canvas.height = Math.max(1, Math.round(height * pixelRatio));
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;

    // Resizing the backing store resets the context; restore the CSS-pixel
    // coordinate system used by every drawing call.
    this.ctx?.setTransform?.(pixelRatio, 0, 0, pixelRatio, 0, 0);
  }

  /**
   * Mark which box is hovered. The editor clears it when the pointer leaves.
   * @param {string | null} id
   */
  setHover(id) {
    this.hoverId = id ?? null;
  }

  /**
   * Paint one frame.
   * @param {{boxes?: object[], selectedId?: string | null}} state
   * @param {import("./background.js").Background | null} background
   */
  render(state, background) {
    const ctx = this.ctx;
    if (!ctx) return;

    const width = this.width;
    const height = this.height;

    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.fillStyle = CANVAS_BACKGROUND;
    ctx.fillRect(0, 0, width, height);

    if (background) this.drawReference(ctx, background, width, height);

    const boxes = Array.isArray(state?.boxes) ? state.boxes : [];
    const selectedId = state?.selectedId ?? null;
    const selected = boxes.find((box) => box.id === selectedId) ?? null;

    // The selection is always the topmost box, regardless of list order.
    for (const box of paintOrder(boxes, selectedId)) {
      const isSelected = box === selected;
      this.drawBox(ctx, box, width, height, {
        hovered: !isSelected && box.id === this.hoverId,
        selected: isSelected,
      });
    }

    ctx.restore();
  }

  /** @private */
  drawReference(ctx, background, width, height) {
    if (background.mode !== "reference" || !background.hasImage?.()) return;

    const image = background.image;
    if (!image || image.complete === false) return;

    const rect = background.getDrawRect(width, height);
    if (!(rect.width > 0) || !(rect.height > 0)) return;

    ctx.save();
    // The reference never paints outside the output rectangle.
    ctx.beginPath();
    ctx.rect(0, 0, width, height);
    ctx.clip();

    try {
      ctx.drawImage(image, rect.x, rect.y, rect.width, rect.height);
    } catch {
      ctx.restore();
      return;
    }

    // Dim to ~55% brightness by darkening only the image area; the letterbox
    // around a Fit image stays white.
    const left = Math.max(0, rect.x);
    const top = Math.max(0, rect.y);
    const right = Math.min(width, rect.x + rect.width);
    const bottom = Math.min(height, rect.y + rect.height);
    if (right > left && bottom > top) {
      ctx.fillStyle = `rgba(0, 0, 0, ${REFERENCE_DIM_ALPHA})`;
      ctx.fillRect(left, top, right - left, bottom - top);
    }

    ctx.restore();
  }

  /** @private */
  drawBox(ctx, box, width, height, { hovered, selected }) {
    const rect = bboxToRect(box.bbox, width, height);
    const color = boxColor(box);

    ctx.save();

    if (selected) {
      ctx.fillStyle = withAlpha(color, SELECTED_FILL_ALPHA);
      ctx.fillRect(rect.x, rect.y, rect.w, rect.h);

      ctx.strokeStyle = color;
      ctx.lineWidth = SELECTED_OUTLINE_WIDTH;
      ctx.setLineDash([]);
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);

      this.drawHandles(ctx, rect);
    } else {
      if (hovered) {
        ctx.fillStyle = withAlpha(color, HOVER_FILL_ALPHA);
        ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
        ctx.setLineDash(DASH_PATTERN);
      } else {
        ctx.setLineDash([]);
      }

      ctx.strokeStyle = color;
      ctx.lineWidth = OUTLINE_WIDTH;
      ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    }

    ctx.restore();
  }

  /** @private Eight white handles at the corners and edge midpoints. */
  drawHandles(ctx, rect) {
    ctx.setLineDash([]);
    ctx.fillStyle = HANDLE_FILL;
    ctx.strokeStyle = HANDLE_STROKE;
    ctx.lineWidth = 1;

    for (const [fx, fy] of HANDLE_POSITIONS) {
      const x = rect.x + rect.w * fx - HANDLE_HALF;
      const y = rect.y + rect.h * fy - HANDLE_HALF;
      ctx.fillRect(x, y, HANDLE_SIZE, HANDLE_SIZE);
      ctx.strokeRect(x + 0.5, y + 0.5, HANDLE_SIZE - 1, HANDLE_SIZE - 1);
    }
  }
}
