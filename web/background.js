// Reference background for the Layout Prompt Builder canvas.
//
// Owns the reference image and its transform. Positions are CSS pixels in the
// canvas coordinate space: the image is centered in the viewport and panX /
// panY measure its displacement from that centered position. The Fill/Fit
// preset determines the base scale; `zoom` is a multiplier over that base and
// 100% always means the preset scale.
//
// The transform math is DOM-free (the only browser object is the Image used
// to load a reference), so it can be exercised by a small test harness.

import { api } from "../../scripts/api.js";

/** Lowest reference zoom (50% of the Fill/Fit base scale). */
export const ZOOM_MIN = 0.5;
/** Highest reference zoom (800% of the Fill/Fit base scale). */
export const ZOOM_MAX = 8;

const MIN_VIEWPORT = 1;
const DEFAULT_VIEW_WIDTH = 1;
const DEFAULT_VIEW_HEIGHT = 1;

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

/**
 * Normalize the many shapes a reference can arrive in (a bare filename, an
 * upload response with `name`, or a stored `{filename, type, subfolder}`).
 * @param {string | {filename?: string, name?: string, type?: string,
 *                  subfolder?: string} | null} ref
 * @returns {{filename: string, type: string, subfolder: string} | null}
 */
function normalizeRef(ref) {
  if (typeof ref === "string") {
    const filename = ref.trim();
    return filename ? { filename, type: "input", subfolder: "" } : null;
  }
  if (ref === null || typeof ref !== "object") return null;

  const filename = typeof ref.filename === "string" ? ref.filename : ref.name;
  if (typeof filename !== "string" || filename.length === 0) return null;

  return {
    filename,
    type: typeof ref.type === "string" && ref.type ? ref.type : "input",
    subfolder: typeof ref.subfolder === "string" ? ref.subfolder : "",
  };
}

/** Build the /view URL for a reference descriptor. */
function viewURL(ref) {
  const params = new URLSearchParams({
    filename: ref.filename,
    type: ref.type,
    subfolder: ref.subfolder,
    t: String(Date.now()),
  });
  return api.apiURL(`/view?${params.toString()}`);
}

/**
 * Reference image layer. One instance per editor; the canvas renderer reads
 * `mode`, `image`, and `getDrawRect()` to paint it under the boxes.
 */
export class Background {
  /** "white" | "reference" */
  mode = "white";
  /** "fill" | "fit" */
  fit = "fill";
  /** Multiplier over the Fill/Fit base scale, clamped to 0.5-8. */
  zoom = 1;
  /** Horizontal image displacement from center, in canvas CSS pixels. */
  panX = 0;
  /** Vertical image displacement from center, in canvas CSS pixels. */
  panY = 0;
  /** Loaded HTMLImageElement (null while empty/loading). */
  image = null;

  /**
   * @param {{onChange?: (() => void) | null}} [options] onChange is called
   *   after every committed visual change (including asynchronous loads).
   */
  constructor({ onChange = null } = {}) {
    this.onChange = onChange;
    this.viewportWidth = DEFAULT_VIEW_WIDTH;
    this.viewportHeight = DEFAULT_VIEW_HEIGHT;
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.file = null;
    this.last = null;
    this.source = "file";
    this.error = null;
    this.loading = false;
    this.loadToken = 0;
  }

  /** True when a decoded reference with usable dimensions is available. */
  hasImage() {
    return Boolean(this.image && this.imageWidth > 0 && this.imageHeight > 0);
  }

  /**
   * Set the canvas size in CSS pixels. When a reference is loaded, the source
   * point at the canvas center and the zoom are preserved while the base
   * Fill/Fit scale is recomputed.
   * @param {number} width
   * @param {number} height
   */
  setViewport(width, height) {
    const nextWidth = Math.max(
      MIN_VIEWPORT,
      isFiniteNumber(width) ? width : MIN_VIEWPORT,
    );
    const nextHeight = Math.max(
      MIN_VIEWPORT,
      isFiniteNumber(height) ? height : MIN_VIEWPORT,
    );
    if (
      nextWidth === this.viewportWidth &&
      nextHeight === this.viewportHeight
    ) {
      return;
    }

    const hadImage = this.hasImage();
    const previousBase = this.getBaseScale();

    this.viewportWidth = nextWidth;
    this.viewportHeight = nextHeight;

    if (hadImage && previousBase > 0) {
      // The base scale changes with the viewport; scaling the pan by the same
      // ratio keeps the image point that was at the center at the new center.
      const ratio = this.getBaseScale() / previousBase;
      this.panX *= ratio;
      this.panY *= ratio;
    }

    this._clampPan();
    this._notify();
  }

  /**
   * The Fill or Fit scale for the current viewport (before the zoom multiplier).
   * @returns {number} scale in canvas CSS pixels per image pixel
   */
  getBaseScale() {
    if (!this.hasImage()) return 0;

    const scaleX = this.viewportWidth / this.imageWidth;
    const scaleY = this.viewportHeight / this.imageHeight;
    return this.fit === "fit"
      ? Math.min(scaleX, scaleY)
      : Math.max(scaleX, scaleY);
  }

  /** Effective scale: the Fill/Fit base multiplied by the zoom. */
  getScale() {
    return this.getBaseScale() * this.zoom;
  }

  /**
   * Where the reference should be drawn in canvas CSS pixels.
   * @param {number} [viewWidth]
   * @param {number} [viewHeight]
   * @returns {{x: number, y: number, width: number, height: number,
   *            scale: number}}
   */
  getDrawRect(viewWidth = this.viewportWidth, viewHeight = this.viewportHeight) {
    const scale = this.hasImage()
      ? this.getScale()
      : 0;
    const width = this.imageWidth * scale;
    const height = this.imageHeight * scale;
    return {
      x: (viewWidth - width) / 2 + this.panX,
      y: (viewHeight - height) / 2 + this.panY,
      width,
      height,
      scale,
    };
  }

  /**
   * Switch between the white canvas and the reference layer. The loaded image
   * is kept, so toggling back never forgets the source.
   * @param {"white" | "reference"} mode
   */
  setMode(mode) {
    if (mode !== "white" && mode !== "reference") return;
    if (mode === this.mode) return;
    this.mode = mode;
    this._notify();
  }

  /**
   * Change the Fill/Fit preset. Fit/Fill reset the zoom to 100% and recenter.
   * @param {"fill" | "fit"} fit
   */
  setFit(fit) {
    if (fit !== "fill" && fit !== "fit") return;
    this.fit = fit;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this._clampPan();
    this._notify();
  }

  /**
   * Multiply the zoom, keeping the image point under `anchor` stationary.
   * @param {number} factor
   * @param {{x: number, y: number}} [anchor] canvas CSS pixels; defaults to
   *   the canvas center
   * @returns {number} the resulting zoom
   */
  zoomBy(factor, anchor = null) {
    if (!this.hasImage()) return this.zoom;
    if (!isFiniteNumber(factor) || factor <= 0) return this.zoom;

    const nextZoom = clamp(this.zoom * factor, ZOOM_MIN, ZOOM_MAX);
    if (nextZoom === this.zoom) return this.zoom;

    const centerX = this.viewportWidth / 2;
    const centerY = this.viewportHeight / 2;
    const anchorX =
      anchor && isFiniteNumber(anchor.x) ? anchor.x : centerX;
    const anchorY =
      anchor && isFiniteNumber(anchor.y) ? anchor.y : centerY;

    const ratio = nextZoom / this.zoom;
    // Derivation: drawing position T = C - S/2 + pan. Holding the source
    // point under the anchor fixed gives pan' = (A - C)(1 - r) + r * pan.
    this.panX = (anchorX - centerX) * (1 - ratio) + this.panX * ratio;
    this.panY = (anchorY - centerY) * (1 - ratio) + this.panY * ratio;
    this.zoom = nextZoom;

    this._clampPan();
    this._notify();
    return this.zoom;
  }

  /**
   * Move the reference by a canvas-space delta.
   * @param {number} dx
   * @param {number} dy
   */
  panBy(dx, dy) {
    if (!this.hasImage()) return;
    if (!isFiniteNumber(dx) || !isFiniteNumber(dy)) return;

    this.panX += dx;
    this.panY += dy;
    this._clampPan();
    this._notify();
  }

  /**
   * Load a reference image. Resets the transform to Fill/Fit 100% centered.
   * The canvas shows white while the new image decodes; if the URL fails,
   * `error` is set and the canvas stays white. (An upload failure never
   * reaches this method, so the previous reference is kept in that case.)
   * @param {string | {filename?: string, name?: string, type?: string,
   *                  subfolder?: string}} file
   */
  setFile(file) {
    this.file = normalizeRef(file);
    this.source = "file";
    this.error = null;
    this.image = null;
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.zoom = 1;
    this.panX = 0;
    this.panY = 0;
    this.loadToken += 1;
    this.loading = false;

    if (!this.file) {
      this.error = "reference unavailable";
      this._notify();
      return;
    }

    this._loadRef(this.file);
  }

  /**
   * Restore a background snapshot (persistence hook used by Task 11). Accepts
   * `{mode, source, file, last, fit, zoom, panX, panY}` and loads `file`
   * without disturbing the restored transform.
   * @param {object | null} ref
   */
  loadStored(ref) {
    if (ref === null || typeof ref !== "object") return;

    if (ref.mode === "white" || ref.mode === "reference") this.mode = ref.mode;
    if (ref.fit === "fill" || ref.fit === "fit") this.fit = ref.fit;
    if (isFiniteNumber(ref.zoom)) {
      this.zoom = clamp(ref.zoom, ZOOM_MIN, ZOOM_MAX);
    }
    if (isFiniteNumber(ref.panX)) this.panX = ref.panX;
    if (isFiniteNumber(ref.panY)) this.panY = ref.panY;
    if (ref.source === "file" || ref.source === "last") this.source = ref.source;
    this.file = normalizeRef(ref.file);
    this.last = normalizeRef(ref.last);

    // Restore the source selection, falling back to the other stored ref.
    const fileRef = this.file;
    const lastRef = this.last;
    const loadRef =
      this.source === "last"
        ? lastRef ?? fileRef
        : fileRef ?? lastRef ?? normalizeRef(ref);

    this.image = null;
    this.imageWidth = 0;
    this.imageHeight = 0;
    this.loadToken += 1;
    this.loading = false;

    if (loadRef) {
      this.error = null;
      this._loadRef(loadRef);
      return;
    }

    this._clampPan();
    this._notify();
  }

  /**
   * Write a background snapshot for persistence. Task 11 owns storing it on
   * node.properties; this keeps the field set in one place.
   * @returns {{mode: string, source: string, file: object | null,
   *            last: object | null, fit: string, zoom: number,
   *            panX: number, panY: number}}
   */
  toJSON() {
    return {
      mode: this.mode,
      source: this.source,
      file: this.file ? { ...this.file } : null,
      last: this.last ? { ...this.last } : null,
      fit: this.fit,
      zoom: this.zoom,
      panX: this.panX,
      panY: this.panY,
    };
  }

  /** @private */
  _loadRef(ref) {
    const token = (this.loadToken += 1);
    this.loading = true;
    this.error = null;

    const image = new Image();
    image.onload = () => {
      if (token !== this.loadToken) return;
      this.loading = false;
      this.image = image;
      this.imageWidth = image.naturalWidth || image.width || 0;
      this.imageHeight = image.naturalHeight || image.height || 0;
      if (!this.hasImage()) {
        this.image = null;
        this.error = "reference unavailable";
      }
      this._clampPan();
      this._notify();
    };
    image.onerror = () => {
      if (token !== this.loadToken) return;
      this.loading = false;
      this.image = null;
      this.imageWidth = 0;
      this.imageHeight = 0;
      this.error = "reference unavailable";
      this._clampPan();
      this._notify();
    };

    try {
      image.src = viewURL(ref);
    } catch (error) {
      this.loading = false;
      this.error = "reference unavailable";
      this._notify();
    }
  }

  /** @private Clamp pan so the image keeps the canvas covered or contained. */
  _clampPan() {
    if (!this.hasImage()) {
      this.panX = 0;
      this.panY = 0;
      return;
    }

    const scale = this.getScale();
    // When the drawn image is larger than the viewport it must keep the
    // viewport covered (no empty gaps). When it is smaller it stays fully
    // inside. Both cases reduce to |pan| <= |drawn - viewport| / 2.
    const limitX =
      Math.abs(this.imageWidth * scale - this.viewportWidth) / 2;
    const limitY =
      Math.abs(this.imageHeight * scale - this.viewportHeight) / 2;

    this.panX = clamp(this.panX, -limitX, limitX);
    this.panY = clamp(this.panY, -limitY, limitY);
  }

  /** @private */
  _notify() {
    this.onChange?.();
  }
}
