// DOM shell for the Layout Prompt Builder node.
//
// Owns the parsed editor state, the canvas and reference background, and the
// single-column box list. The canvas supports selection plus draw/move/resize
// pointer gestures that commit once on pointer-up, keyboard editing (nudge,
// delete, duplicate, deselect), and undo/redo history for layout and reference
// transform commits. Background persistence lives in a later task.

import { api } from "../../scripts/api.js";

import { Background, ZOOM_MAX, ZOOM_MIN } from "./background.js";
import { CanvasView, paintOrder } from "./canvas.js";
import { hitTest, normalizeBbox, rectToBbox } from "./geometry.js";
import {
  captureFieldFocus,
  LABELS,
  renderBoxList,
  restoreFieldFocus,
  scrollRowIntoView,
  updateRowSelection,
} from "./list.js";
import { computeSize } from "./size.js";
import {
  addBox,
  createBox,
  createHistory,
  deleteBox,
  deserializeState,
  duplicateBox,
  moveBox,
  pushHistory,
  redo,
  serializeState,
  undo,
  updateBox,
} from "./state.js";

// These heights mirror the --lp-list-* custom properties in styles.js.
const CONTAINER_VERTICAL_PADDING = 6;
const LIST_HEADER_HEIGHT = 24;
const LIST_HEADER_GAP = 4;
const LIST_ROW_HEIGHT = 28;
const LIST_ROW_GAP = 2;
const MAX_VISIBLE_ROWS = 5;
const MIN_VISIBLE_ROWS = 1;

// Canvas stack geometry, mirroring the .lp-canvas-* rules in styles.js.
const CANVAS_MAX_HEIGHT = 340;
const CANVAS_HORIZONTAL_GUTTER = 24;
const MIN_CANVAS_WIDTH = 120;
const DEFAULT_NODE_WIDTH = 560;
const CANVAS_BOTTOM_GAP = 6;
const TOOLBAR_HEIGHT = 24;
const TOOLBAR_HINT_GAP = 2;
const HINT_HEIGHT = 14;
const HINT_LIST_GAP = 6;
const CANVAS_STACK_HEIGHT =
  CANVAS_BOTTOM_GAP +
  TOOLBAR_HEIGHT +
  TOOLBAR_HINT_GAP +
  HINT_HEIGHT +
  HINT_LIST_GAP;

const DEFAULT_ASPECT_RATIO = "1:1 (Square)";
const DEFAULT_MEGAPIXELS = 1;
const ZOOM_BUTTON_STEP = 0.1;
const HOVER_HANDLE_RADIUS = 6;
// A left-drag shorter than this is a click (empty canvas: deselect).
const DRAW_THRESHOLD_PX = 3;
// Smallest box a draw or resize may produce, in display pixels.
const MIN_BOX_SIZE_PX = 3;
const BBOX_MAX = 1000;
// A node that is taller than the panel by more than this is treated as a
// manual enlargement and is never auto-shrunk.
const HEIGHT_TOLERANCE = 1;

// Typing commits after this pause; blur flushes immediately.
const FIELD_DEBOUNCE_MS = 150;

// Undo/redo depth for layout and reference-transform snapshots.
const HISTORY_LIMIT = 50;
// Arrow-key nudges this close together share one undo entry, so a held key
// (auto-repeat) or a quick burst of taps undoes as one step.
const NUDGE_GROUP_MS = 500;
// An OS auto-repeat can arrive after a longer initial delay than the group
// window; a repeated keydown for the same box continues the open run.
const NUDGE_CONTINUE_MS = 2000;
// Wheel-zoom events this close together share one undo entry.
const ZOOM_BURST_MS = 500;

// A 20% box centered in the 0-1000 yxyx coordinate space.
const DEFAULT_BOX_BBOX = [400, 400, 600, 600];
const DEFAULT_BOX_LABEL = "character";

let boxIdCounter = 0;

function nextBoxId() {
  boxIdCounter += 1;
  return `box_${Date.now().toString(36)}_${boxIdCounter.toString(36)}`;
}

/** True for controls that consume Space themselves (typing, buttons, links). */
function isInteractiveTarget(target) {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT" ||
    tag === "BUTTON" ||
    tag === "A"
  );
}

/**
 * True for text-editing controls. Their key events (including Ctrl+Z) belong
 * to the browser, so the editor never intercepts them.
 */
function isEditableTarget(target) {
  if (!target) return false;
  if (target.isContentEditable === true) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Compare two normalized reference descriptors ({filename, type, subfolder}). */
function sameRef(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.filename === b.filename &&
    a.type === b.type &&
    a.subfolder === b.subfolder
  );
}

/** Compare two Background.toJSON() snapshots. */
function sameBackground(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.mode === b.mode &&
    a.source === b.source &&
    a.fit === b.fit &&
    a.zoom === b.zoom &&
    a.panX === b.panX &&
    a.panY === b.panY &&
    sameRef(a.file, b.file) &&
    sameRef(a.last, b.last)
  );
}

/** A unique input-folder filename for an uploaded reference. */
function uniqueUploadName(node, originalName) {
  const name = typeof originalName === "string" ? originalName : "";
  const dot = name.lastIndexOf(".");
  const rawExtension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  const extension = /^\.[a-z0-9]{1,8}$/.test(rawExtension)
    ? rawExtension
    : "";
  const rawNodeId = node?.id;
  const nodePart =
    String(rawNodeId ?? "node")
      .replace(/[^a-z0-9_-]/gi, "")
      .slice(0, 24) || "node";
  const stamp = Date.now().toString(36);
  const random = Math.floor(Math.random() * 0xffffff).toString(36);
  return `layout_ref_${nodePart}_${stamp}_${random}${extension}`;
}

/** Toggle a button's pressed styling and aria state. */
function setPressed(button, pressed) {
  if (!button) return;
  button.classList.toggle("lp-active", pressed);
  button.setAttribute("aria-pressed", pressed ? "true" : "false");
}

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** Compare two normalized yxyx bboxes. */
function sameBbox(a, b) {
  return (
    Array.isArray(a) &&
    Array.isArray(b) &&
    a.length === 4 &&
    b.length === 4 &&
    a.every((value, index) => value === b[index])
  );
}

/** Minimum bbox extent, in 0-1000 units, for a 3 display-pixel box. */
function minExtent(size) {
  return Math.ceil((MIN_BOX_SIZE_PX * BBOX_MAX) / Math.max(1, size));
}

/** Grow one axis of a bbox to the minimum extent, keeping it inside 0-1000. */
function withMinExtent(low, high, minimum) {
  if (high - low >= minimum) return [low, high];
  if (low + minimum <= BBOX_MAX) return [low, low + minimum];
  return [Math.max(0, high - minimum), high];
}

/** Bbox for a draw gesture: clamped to the canvas with a 3 px minimum. */
function drawBbox(start, end, canvasW, canvasH) {
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(end.x - start.x);
  const height = Math.abs(end.y - start.y);

  let [y0, x0, y1, x1] = rectToBbox(x, y, width, height, canvasW, canvasH);
  [x0, x1] = withMinExtent(x0, x1, minExtent(canvasW));
  [y0, y1] = withMinExtent(y0, y1, minExtent(canvasH));
  return normalizeBbox([y0, x0, y1, x1]);
}

/** Translate a bbox by a delta, keeping its size and clamping it on-canvas. */
function moveBbox(bbox, dx, dy) {
  const [y0, x0, y1, x1] = normalizeBbox(bbox);
  const width = x1 - x0;
  const height = y1 - y0;
  const nextX = Math.round(clampNumber(x0 + dx, 0, BBOX_MAX - width));
  const nextY = Math.round(clampNumber(y0 + dy, 0, BBOX_MAX - height));
  return normalizeBbox([nextY, nextX, nextY + height, nextX + width]);
}

/**
 * Resize a bbox from one of the 8 handle parts (tl, tc, tr, ml, mr, bl, bc,
 * br), clamping to 0-1000 and enforcing the 3 display-pixel minimum.
 */
function resizeBbox(bbox, part, dx, dy, canvasW, canvasH) {
  let [y0, x0, y1, x1] = normalizeBbox(bbox);
  const minimumWidth = minExtent(canvasW);
  const minimumHeight = minExtent(canvasH);

  if (part.includes("t")) {
    y0 = clampNumber(y0 + dy, 0, Math.max(0, y1 - minimumHeight));
  }
  if (part.includes("b")) {
    y1 = clampNumber(
      y1 + dy,
      Math.min(BBOX_MAX, y0 + minimumHeight),
      BBOX_MAX,
    );
  }
  if (part.includes("l")) {
    x0 = clampNumber(x0 + dx, 0, Math.max(0, x1 - minimumWidth));
  }
  if (part.includes("r")) {
    x1 = clampNumber(
      x1 + dx,
      Math.min(BBOX_MAX, x0 + minimumWidth),
      BBOX_MAX,
    );
  }

  const next = normalizeBbox([y0, x0, y1, x1]);
  [next[0], next[2]] = withMinExtent(next[0], next[2], minimumHeight);
  [next[1], next[3]] = withMinExtent(next[1], next[3], minimumWidth);
  return normalizeBbox(next);
}

export class LayoutEditor {
  /**
   * @param {object} node ComfyUI node instance
   * @param {{value?: string} | null} hiddenWidget boxes_json widget carrying the serialized state
   */
  constructor(node, hiddenWidget) {
    this.node = node;
    this.hiddenWidget = hiddenWidget ?? null;
    this.state = deserializeState(this.hiddenWidget?.value ?? "");

    this.container = null;
    this.root = null;
    this.listHost = null;
    this.abortController = null;

    this.canvas = null;
    this.canvasView = null;
    this.canvasSize = null;
    this.background = null;

    this.modeButtons = null;
    this.fitButtons = null;
    this.zoomLabel = null;
    this.moveButton = null;
    this.fileInput = null;
    this.hintElement = null;

    this.statusMessage = null;
    this.statusIsError = false;
    this.hoverId = null;
    this.moveBackground = false;
    this.spaceHeld = false;
    this.canvasHovered = false;
    this.panDrag = null;
    this.boxDrag = null;

    this.renderFrame = null;
    this.resizeObserver = null;
    this.lastRootWidth = 0;
    this.lastNodeHeight = Array.isArray(node?.size) ? node.size[1] : null;
    this.userSizedHeight = false;
    this.applyingSize = false;
    this.widgetWrappers = [];
    this.resizeWrapper = null;

    this.raf =
      globalThis.requestAnimationFrame?.bind(globalThis) ??
      ((callback) => setTimeout(callback, 16));
    this.caf =
      globalThis.cancelAnimationFrame?.bind(globalThis) ??
      ((handle) => clearTimeout(handle));

    this.pendingEdit = null;
    this.editTimer = null;

    // Undo/redo entries are { layout, background } composites. Coalesced
    // gestures (held arrows, a wheel-zoom burst) keep one entry open until
    // they go idle or another commit starts.
    this.history = createHistory(HISTORY_LIMIT);
    this.nudgeGroupActive = false;
    this.nudgeTimer = null;
    this.lastNudgeBoxId = null;
    this.lastNudgeAt = 0;
    this.zoomBurstActive = false;
    this.zoomBurstTimer = null;

    this.handlers = {
      onAdd: () => this.addNewBox(),
      onSelect: (id) => this.selectBox(id),
      onInput: (id, patch) => this.queueFieldEdit(id, patch),
      onUpdate: (id, patch) => this.applyUpdate(id, patch),
      onDelete: (id) => this.applyDelete(id),
      onDuplicate: (id) => this.applyDuplicate(id),
      onMove: (id, delta) => this.applyMove(id, delta),
    };

    // Compute this before mount so the DOM widget height callback has a
    // canvas height even if it is queried during creation.
    this.canvasSize = this.computeCanvasSize();
  }

  /**
   * Build the editor panel inside the DOM widget's container.
   * @param {HTMLElement} container
   */
  mount(container) {
    if (this.root) this.destroy();
    this.container = container;

    const root = document.createElement("div");
    root.className = "lp-root";

    const canvasArea = document.createElement("div");
    canvasArea.className = "lp-canvas-area";

    const stage = document.createElement("div");
    stage.className = "lp-canvas-stage";

    const canvas = document.createElement("canvas");
    canvas.className = "lp-canvas";
    canvas.tabIndex = 0;
    canvas.setAttribute("tabindex", "0");
    canvas.setAttribute("role", "img");
    canvas.setAttribute("aria-label", "Layout canvas");
    stage.append(canvas);

    const toolbar = this.buildToolbar();
    const hint = document.createElement("div");
    hint.className = "lp-hint";
    hint.setAttribute("role", "status");

    canvasArea.append(stage, toolbar, hint);

    const listHost = document.createElement("div");
    listHost.className = "lp-list-host";
    root.append(canvasArea, listHost);
    container.append(root);

    this.root = root;
    this.listHost = listHost;
    this.canvas = canvas;
    this.hintElement = hint;
    this.canvasView = new CanvasView(canvas);
    this.background = new Background({
      onChange: () => this.handleBackgroundChange(),
    });
    this.lastRootWidth = root.clientWidth ?? 0;

    // Keep pointer gestures inside the panel from reaching the graph canvas.
    this.abortController = new AbortController();
    root.addEventListener(
      "pointerdown",
      (event) => {
        // Any new pointer action closes a coalesced undo group.
        this.endHistoryGroups();
        event.stopPropagation();
      },
      { signal: this.abortController.signal },
    );

    this.addCanvasListeners();
    this.wireOutputWidgets();
    this.wireNodeResize();
    this.observeRootResize(root);

    this.refreshCanvasSize();
    this.renderState();
    this.updateToolbar();
    this.updateCursor();
    this.scheduleRender();
    this.requestHeight();
  }

  /** Height of the editor panel in CSS pixels. */
  computeHeight() {
    const size = this.canvasSize ?? this.computeCanvasSize();
    const count = this.state.boxes.length;
    const visibleRows = Math.max(
      MIN_VISIBLE_ROWS,
      Math.min(count, MAX_VISIBLE_ROWS),
    );
    return (
      CONTAINER_VERTICAL_PADDING +
      size.height +
      CANVAS_STACK_HEIGHT +
      LIST_HEADER_HEIGHT +
      LIST_HEADER_GAP +
      visibleRows * LIST_ROW_HEIGHT +
      (visibleRows - 1) * LIST_ROW_GAP
    );
  }

  /** Re-read state after ComfyUI restores saved widget values. */
  syncFromWidget() {
    this.cancelPendingEdit();
    this.endHistoryGroups();
    // A configured workflow starts fresh; snapshots from the previous document
    // must not be undoable into this one.
    this.history = createHistory(HISTORY_LIMIT);
    this.state = deserializeState(this.hiddenWidget?.value ?? "");
    this.refreshCanvasSize();
    this.renderState();
    this.updateToolbar();
    this.scheduleRender();
    this.requestHeight();
  }

  /** Release the panel DOM and every listener registered by the shell. */
  destroy() {
    this.cancelPendingEdit();
    this.endHistoryGroups();
    this.cancelScheduledRender();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;

    this.abortController?.abort();
    this.abortController = null;

    this.restoreWidgetCallbacks();
    this.restoreNodeResize();

    if (this.background) this.background.onChange = null;

    if (this.root?.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }

    this.root = null;
    this.listHost = null;
    this.container = null;
    this.canvas = null;
    this.canvasView = null;
    this.background = null;
    this.canvasSize = null;
    this.hintElement = null;
    this.modeButtons = null;
    this.fitButtons = null;
    this.zoomLabel = null;
    this.moveButton = null;
    this.fileInput = null;
    this.panDrag = null;
    this.boxDrag = null;
    this.renderFrame = null;
  }

  // ---------------------------------------------------------------------
  // Canvas sizing
  // ---------------------------------------------------------------------

  /** Current widget value by name (undefined when the widget is missing). */
  widgetValue(name) {
    const widget = this.node?.widgets?.find(
      (candidate) => candidate?.name === name,
    );
    return widget?.value;
  }

  /** Output pixels implied by the aspect_ratio / megapixels widgets. */
  outputSize() {
    const rawRatio = this.widgetValue("aspect_ratio");
    const ratio =
      typeof rawRatio === "string" && rawRatio
        ? rawRatio
        : DEFAULT_ASPECT_RATIO;
    const rawMegapixels = Number(
      this.widgetValue("megapixels") ?? DEFAULT_MEGAPIXELS,
    );
    const megapixels =
      Number.isFinite(rawMegapixels) && rawMegapixels > 0
        ? rawMegapixels
        : DEFAULT_MEGAPIXELS;

    try {
      return computeSize(ratio, megapixels);
    } catch {
      return computeSize(DEFAULT_ASPECT_RATIO, megapixels);
    }
  }

  nodeWidth() {
    const size = this.node?.size;
    if (Array.isArray(size) && Number.isFinite(size[0]) && size[0] > 0) {
      return size[0];
    }
    return DEFAULT_NODE_WIDTH;
  }

  /**
   * Display size of the output rectangle: the exact output aspect fitted into
   * (node width - 24) by 340 CSS pixels.
   * @returns {{width: number, height: number, outputWidth: number,
   *            outputHeight: number}}
   */
  computeCanvasSize() {
    const [outputWidth, outputHeight] = this.outputSize();
    const maxWidth = Math.max(
      MIN_CANVAS_WIDTH,
      this.nodeWidth() - CANVAS_HORIZONTAL_GUTTER,
    );
    const scale = Math.min(
      maxWidth / outputWidth,
      CANVAS_MAX_HEIGHT / outputHeight,
    );
    return {
      width: Math.max(1, Math.round(outputWidth * scale)),
      height: Math.max(1, Math.round(outputHeight * scale)),
      outputWidth,
      outputHeight,
    };
  }

  /** Recompute the canvas display size and reflow the reference layer. */
  refreshCanvasSize() {
    if (!this.canvasView) return;

    const next = this.computeCanvasSize();
    this.canvasSize = next;
    this.canvasView.resize(next.width, next.height);
    // Preserves the source point at the center and the zoom when the base
    // Fill/Fit scale changes.
    this.background?.setViewport(next.width, next.height);
    this.updateHint();
  }

  onOutputSettingsChanged() {
    this.refreshCanvasSize();
    this.scheduleRender();
    this.requestHeight();
  }

  // ---------------------------------------------------------------------
  // Toolbar
  // ---------------------------------------------------------------------

  /**
   * @param {string} label
   * @param {string} title
   * @param {() => void} onClick
   * @returns {HTMLButtonElement}
   */
  createToolButton(label, title, onClick) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "lp-tool";
    button.textContent = label;
    button.title = title;
    button.setAttribute("aria-label", title);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onClick();
    });
    return button;
  }

  buildToolbar() {
    const toolbar = document.createElement("div");
    toolbar.className = "lp-toolbar";

    const modeGroup = document.createElement("div");
    modeGroup.className = "lp-segment";
    modeGroup.setAttribute("role", "group");
    modeGroup.setAttribute("aria-label", "Background mode");
    const whiteButton = this.createToolButton(
      "White",
      "Show a plain white canvas",
      () => this.background?.setMode("white"),
    );
    const referenceButton = this.createToolButton(
      "Reference",
      "Show the reference image under the boxes",
      () => this.background?.setMode("reference"),
    );
    modeGroup.append(whiteButton, referenceButton);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.className = "lp-file-input";
    fileInput.hidden = true;
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0] ?? null;
      fileInput.value = "";
      if (file) void this.uploadReference(file);
    });

    const pickButton = this.createToolButton(
      "Pick file",
      "Upload a reference image from disk",
      () => fileInput.click(),
    );

    const fitGroup = document.createElement("div");
    fitGroup.className = "lp-segment";
    fitGroup.setAttribute("role", "group");
    fitGroup.setAttribute("aria-label", "Reference fit");
    const fillButton = this.createToolButton(
      "Fill",
      "Cover the canvas with the reference (crop overflow)",
      () => this.applyFit("fill"),
    );
    const fitButton = this.createToolButton(
      "Fit",
      "Contain the whole reference (letterboxed)",
      () => this.applyFit("fit"),
    );
    fitGroup.append(fillButton, fitButton);

    const zoomOut = this.createToolButton(
      "−",
      "Zoom the reference out by 10%",
      () => this.zoomStep(-1),
    );
    const zoomLabel = document.createElement("span");
    zoomLabel.className = "lp-zoom";
    zoomLabel.textContent = "100%";
    zoomLabel.title = "Reference zoom (100% = the Fill/Fit scale)";
    const zoomIn = this.createToolButton(
      "+",
      "Zoom the reference in by 10%",
      () => this.zoomStep(1),
    );

    const moveButton = this.createToolButton(
      "Move bg",
      "Drag the reference image (also Space-drag or middle-drag)",
      () => {
        this.moveBackground = !this.moveBackground;
        this.updateCursor();
        this.updateToolbar();
      },
    );

    toolbar.append(
      modeGroup,
      pickButton,
      fitGroup,
      zoomOut,
      zoomLabel,
      zoomIn,
      moveButton,
      fileInput,
    );

    this.modeButtons = { white: whiteButton, reference: referenceButton };
    this.fitButtons = { fill: fillButton, fit: fitButton };
    this.zoomLabel = zoomLabel;
    this.moveButton = moveButton;
    this.fileInput = fileInput;

    return toolbar;
  }

  updateToolbar() {
    const background = this.background;
    if (!background) return;

    setPressed(this.modeButtons?.white, background.mode === "white");
    setPressed(this.modeButtons?.reference, background.mode === "reference");
    setPressed(this.fitButtons?.fill, background.fit === "fill");
    setPressed(this.fitButtons?.fit, background.fit === "fit");
    setPressed(this.moveButton, this.moveBackground);

    if (this.zoomLabel) {
      const zoomText = `${Math.round(background.zoom * 100)}%`;
      if (this.zoomLabel.textContent !== zoomText) {
        this.zoomLabel.textContent = zoomText;
      }
    }

    this.updateHint();
  }

  updateHint() {
    if (!this.hintElement) return;

    const size = this.canvasSize ?? this.computeCanvasSize();
    const background = this.background;
    let message = `${size.outputWidth} × ${size.outputHeight} · wheel zoom · space / middle-drag pan`;
    let isError = false;

    if (this.statusMessage) {
      message = this.statusMessage;
      isError = this.statusIsError;
    } else if (background?.error) {
      message = background.error;
      isError = true;
    } else if (background?.loading) {
      message = "Loading reference…";
    } else if (background?.mode === "reference" && !background.hasImage()) {
      message = "No reference yet — use Pick file.";
    }

    if (this.hintElement.textContent !== message) {
      this.hintElement.textContent = message;
      this.hintElement.title = message;
    }
    this.hintElement.classList.toggle("lp-hint-error", isError);
  }

  /** −/+ toolbar buttons: 10 percentage points over the preset scale. */
  zoomStep(direction) {
    const background = this.background;
    if (!background?.hasImage()) return;

    const target = Math.round(
      Math.min(
        ZOOM_MAX,
        Math.max(ZOOM_MIN, background.zoom + direction * ZOOM_BUTTON_STEP),
      ) * 100,
    ) / 100;
    if (target === background.zoom) return;

    const before = background.toJSON();
    background.zoomBy(target / background.zoom);
    this.commitBackgroundChange(before);
  }

  /** Fit/Fill buttons: a committed transform change (Fit resets zoom/pan). */
  applyFit(fit) {
    const background = this.background;
    if (!background) return;

    const before = background.toJSON();
    background.setFit(fit);
    this.commitBackgroundChange(before);
  }

  // ---------------------------------------------------------------------
  // Reference file upload
  // ---------------------------------------------------------------------

  async uploadReference(file) {
    if (!file || !this.background) return;

    this.statusMessage = "Uploading reference…";
    this.statusIsError = false;
    this.updateHint();

    const fallbackName = uniqueUploadName(this.node, file.name);
    const formData = new FormData();
    formData.append("image", file, fallbackName);
    formData.append("type", "input");
    formData.append("overwrite", "true");

    try {
      const response = await api.fetchApi("/upload/image", {
        method: "POST",
        body: formData,
      });
      if (!response?.ok) {
        throw new Error(`upload failed with HTTP ${response?.status ?? "?"}`);
      }

      const data = await response.json();
      // The editor may have been removed while the upload was in flight.
      if (!this.background) return;

      // A pick is a background edit, not a view-only toggle. Snapshots carry
      // the file/source, so without its own entry a later undo of a layout
      // edit made before the pick would silently clear the new reference.
      const before = this.background.toJSON();
      this.background.setFile({
        filename: data?.name ?? fallbackName,
        type: data?.type ?? "input",
        subfolder: data?.subfolder ?? "",
      });
      this.background.setMode("reference");
      this.commitBackgroundChange(before);
      this.statusMessage = null;
      this.statusIsError = false;
    } catch (error) {
      if (!this.background) return;
      console.error(
        "[LayoutPromptBuilder] reference upload failed:",
        error,
      );
      this.statusMessage =
        "Reference upload failed — the previous image was kept.";
      this.statusIsError = true;
    }

    this.updateToolbar();
    this.scheduleRender();
  }

  handleBackgroundChange() {
    this.updateToolbar();
    this.scheduleRender();
  }

  // ---------------------------------------------------------------------
  // Canvas listeners: hover, wheel, and pan
  // ---------------------------------------------------------------------

  addCanvasListeners() {
    const signal = this.abortController.signal;
    const canvas = this.canvas;

    canvas.addEventListener("pointerenter", () => {
      this.canvasHovered = true;
    }, { signal });

    canvas.addEventListener("pointerleave", () => {
      this.canvasHovered = false;
      this.updateHover(null);
    }, { signal });

    canvas.addEventListener("pointermove", (event) => {
      this.handleHoverMove(event);
    }, { signal });

    canvas.addEventListener("pointerdown", (event) => {
      this.handleCanvasPointerDown(event);
    }, { signal });

    canvas.addEventListener("wheel", (event) => {
      this.handleWheel(event);
    }, { signal, passive: false });

    // Middle-click autoscroll belongs to the page, not the reference.
    canvas.addEventListener("auxclick", (event) => {
      if (event.button === 1) event.preventDefault();
    }, { signal });

    window.addEventListener("pointermove", (event) => {
      this.handlePanMove(event);
    }, { signal });
    window.addEventListener("pointerup", (event) => {
      this.handlePanEnd(event);
    }, { signal });
    window.addEventListener("pointercancel", (event) => {
      this.handlePanEnd(event);
    }, { signal });

    // Window-level listeners keep a box gesture alive outside the canvas.
    window.addEventListener("pointermove", (event) => {
      this.handleBoxMove(event);
    }, { signal });
    window.addEventListener("pointerup", (event) => {
      this.handleBoxEnd(event);
    }, { signal });
    window.addEventListener("pointercancel", (event) => {
      this.handleBoxCancel(event);
    }, { signal });

    // Capture phase: when the editor consumes an editing key, the graph must
    // never also act on it (Delete on the selected node, Ctrl+Z on the graph).
    window.addEventListener("keydown", (event) => {
      this.handleKeyDown(event);
    }, { signal, capture: true });
    window.addEventListener("keyup", (event) => {
      this.handleKeyUp(event);
    }, { signal, capture: true });
    window.addEventListener("blur", () => {
      this.resetTransientInput();
    }, { signal });
    window.addEventListener("resize", () => {
      // A monitor change can alter devicePixelRatio without a node resize.
      this.refreshCanvasSize();
      this.scheduleRender();
    }, { signal });
  }

  /** Canvas-space scale factors for graph-zoomed DOM widgets. */
  canvasScale() {
    const size = this.canvasSize ?? { width: 1, height: 1 };
    const rect = this.canvas?.getBoundingClientRect?.();
    if (!rect || rect.width <= 0 || rect.height <= 0) {
      return { x: 1, y: 1 };
    }
    return {
      x: size.width / rect.width,
      y: size.height / rect.height,
    };
  }

  /** Map a pointer/wheel event to canvas CSS pixel coordinates. */
  canvasPoint(event) {
    const rect = this.canvas?.getBoundingClientRect?.();
    if (!rect) return { x: 0, y: 0 };
    const scale = this.canvasScale();
    return {
      x: (event.clientX - rect.left) * scale.x,
      y: (event.clientY - rect.top) * scale.y,
    };
  }

  handleHoverMove(event) {
    if (!this.canvasView || this.panDrag || this.boxDrag) return;

    const point = this.canvasPoint(event);
    const size = this.canvasSize ?? this.computeCanvasSize();
    const hit = this.hitTestCanvas(point.x, point.y, size);
    this.updateHover(hit?.id ?? null);
  }

  /**
   * Hit-test in paint order: the selected box is painted last, so it must also
   * win the hit test over an unselected box underneath it.
   * @param {number} px canvas CSS pixels
   * @param {number} py canvas CSS pixels
   * @param {{width: number, height: number}} size
   * @param {number} [radius]
   * @returns {{id: string, part: string} | null}
   */
  hitTestCanvas(px, py, size, radius = HOVER_HANDLE_RADIUS) {
    const ordered = paintOrder(this.state.boxes, this.state.selectedId);
    return hitTest(ordered, px, py, size.width, size.height, radius);
  }

  findBox(id) {
    return this.state.boxes.find((box) => box.id === id) ?? null;
  }

  /**
   * Select a box from a canvas gesture. Quiet: the list keeps its rows and
   * only the selected row scrolls into view.
   * @param {string | null} id
   */
  applyCanvasSelection(id) {
    if (id !== null && !this.hasBox(id)) return;

    if (this.state.selectedId === id) {
      if (id !== null) scrollRowIntoView(this.listHost, id);
      return;
    }

    this.state = { ...this.state, selectedId: id };
    this.updateSelectionClasses();
    if (id !== null) scrollRowIntoView(this.listHost, id);
    this.scheduleRender();
  }

  updateHover(id) {
    const next = id ?? null;
    if (next === this.hoverId) return;
    this.hoverId = next;
    this.canvasView?.setHover(next);
    this.scheduleRender();
  }

  handleWheel(event) {
    // The editor owns the wheel over the canvas: never let the graph zoom.
    event.preventDefault();
    event.stopPropagation();

    // A box or pan gesture owns the pointer until it commits. `this.state`
    // may be a transient preview mid-drag, so zooming now would record an
    // uncommitted box position in history. Ignore the notch (still consumed);
    // a cancelled drag must leave no undoable trace.
    if (this.boxDrag || this.panDrag) return;

    if (event.deltaY === 0 || !this.background?.hasImage()) return;

    const before = this.background.toJSON();
    const point = this.canvasPoint(event);
    const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
    this.background.zoomBy(factor, point);
    // One undo entry per wheel burst, not per notch.
    this.commitBackgroundChange(before, { coalesce: true });
  }

  wantsPan(event) {
    return (
      event.button === 1 ||
      this.moveBackground ||
      (event.button === 0 && this.spaceHeld)
    );
  }

  handleCanvasPointerDown(event) {
    if (!this.canvas) return;
    if (event.button !== 0 && event.button !== 1) return;
    if (this.panDrag || this.boxDrag) return;

    this.canvas.focus?.({ preventScroll: true });
    // A new gesture closes any coalesced undo group before it can be extended.
    this.endHistoryGroups();

    // Move bg, Space+drag, and middle-drag pan before box editing sees the
    // press; a plain left-press over a box must still select it.
    if (this.wantsPan(event)) {
      event.preventDefault();
      event.stopPropagation();

      this.panDrag = {
        pointerId: event.pointerId,
        lastClientX: event.clientX,
        lastClientY: event.clientY,
        baseSnapshot: this.captureSnapshot(),
      };
      this.canvas.classList.add("lp-canvas-panning");
      return;
    }

    if (event.button !== 0) return;

    event.preventDefault();
    event.stopPropagation();
    this.flushPendingEdit();

    const point = this.canvasPoint(event);
    const size = this.canvasSize ?? this.computeCanvasSize();
    const hit = this.hitTestCanvas(point.x, point.y, size);

    if (!hit) {
      // Empty press: a click (<3 px) deselects, a drag draws a new box.
      this.applyCanvasSelection(null);
      this.boxDrag = {
        kind: "draw",
        id: null,
        part: null,
        startPx: point,
        startBox: null,
        baseState: this.state,
        baseSnapshot: this.captureSnapshot(),
        pointerId: event.pointerId,
        previewId: null,
      };
      this.updateHover(null);
      return;
    }

    const wasSelected = hit.id === this.state.selectedId;
    this.applyCanvasSelection(hit.id);
    const box = this.findBox(hit.id);
    if (!box) return;

    // Only the selected box's handles resize; the handle of an unselected box
    // selects that box and behaves like a move.
    const resizing = wasSelected && hit.part !== "move";
    this.boxDrag = {
      kind: resizing ? "resize" : "move",
      id: hit.id,
      part: resizing ? hit.part : null,
      startPx: point,
      startBox: { ...box, bbox: [...box.bbox] },
      baseState: this.state,
      baseSnapshot: this.captureSnapshot(),
      pointerId: event.pointerId,
      previewId: null,
    };
    this.updateHover(null);
  }

  handleBoxMove(event) {
    const drag = this.boxDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    this.applyDragPoint(this.canvasPoint(event));
  }

  /**
   * Recompute the transient state for the active gesture. Nothing is persisted
   * here; the pointer-up handler commits exactly once.
   * @param {{x: number, y: number}} point canvas CSS pixels
   * @returns {boolean} whether the transient state changed
   */
  applyDragPoint(point) {
    const drag = this.boxDrag;
    if (!drag) return false;

    const size = this.canvasSize ?? this.computeCanvasSize();
    if (!(size.width > 0) || !(size.height > 0)) return false;

    if (drag.kind === "draw") {
      const movedX = Math.abs(point.x - drag.startPx.x);
      const movedY = Math.abs(point.y - drag.startPx.y);
      if (
        drag.previewId === null &&
        Math.max(movedX, movedY) < DRAW_THRESHOLD_PX
      ) {
        return false;
      }

      const bbox = drawBbox(drag.startPx, point, size.width, size.height);
      if (drag.previewId === null) {
        // A drag creates and selects the new box, appended at the end.
        drag.previewId = this.newBoxId();
        this.state = addBox(
          this.state,
          createBox(drag.previewId, bbox, { label: DEFAULT_BOX_LABEL }),
        );
      } else {
        const preview = this.findBox(drag.previewId);
        if (preview && sameBbox(preview.bbox, bbox)) return false;
        this.state = updateBox(this.state, drag.previewId, { bbox });
      }
      this.scheduleRender();
      return true;
    }

    const box = this.findBox(drag.id);
    if (!box) return false;

    const dx = ((point.x - drag.startPx.x) * BBOX_MAX) / size.width;
    const dy = ((point.y - drag.startPx.y) * BBOX_MAX) / size.height;
    const bbox =
      drag.kind === "move"
        ? moveBbox(drag.startBox.bbox, dx, dy)
        : resizeBbox(
            drag.startBox.bbox,
            drag.part,
            dx,
            dy,
            size.width,
            size.height,
          );

    if (sameBbox(box.bbox, bbox)) return false;
    this.state = updateBox(this.state, drag.id, { bbox });
    this.scheduleRender();
    return true;
  }

  handleBoxEnd(event) {
    const drag = this.boxDrag;
    if (!drag) return;
    if (event.pointerId !== undefined && event.pointerId !== drag.pointerId) {
      return;
    }

    // Apply the release point too, so a synthetic up without a final move
    // still lands on the cursor.
    this.applyDragPoint(this.canvasPoint(event));

    const changed =
      drag.kind === "draw"
        ? drag.previewId !== null
        : !sameBbox(this.findBox(drag.id)?.bbox, drag.startBox.bbox);

    this.boxDrag = null;
    if (!changed) {
      // A plain click: selection was applied on pointer-down.
      this.scheduleRender();
      return;
    }

    // One commit per gesture: history, hidden widget, list, and height.
    this.endHistoryGroups();
    this.pushSnapshot(drag.baseSnapshot);
    this.applyState(this.state, { rebuild: true });
    scrollRowIntoView(this.listHost, this.state.selectedId);
  }

  handleBoxCancel(event) {
    const drag = this.boxDrag;
    if (!drag) return;
    if (event.pointerId !== undefined && event.pointerId !== drag.pointerId) {
      return;
    }

    // Revert the transient box and any geometry changes.
    this.boxDrag = null;
    this.endHistoryGroups();
    this.state = drag.baseState;
    this.updateSelectionClasses();
    this.scheduleRender();
  }

  handlePanMove(event) {
    const drag = this.panDrag;
    if (!drag || event.pointerId !== drag.pointerId) return;

    const scale = this.canvasScale();
    const dx = (event.clientX - drag.lastClientX) * scale.x;
    const dy = (event.clientY - drag.lastClientY) * scale.y;
    drag.lastClientX = event.clientX;
    drag.lastClientY = event.clientY;

    if (dx !== 0 || dy !== 0) {
      this.background?.panBy(dx, dy);
    }
  }

  handlePanEnd(event) {
    const drag = this.panDrag;
    if (!drag) return;
    if (event.pointerId !== undefined && event.pointerId !== drag.pointerId) {
      return;
    }

    this.panDrag = null;
    this.commitPan(drag);
    this.endHistoryGroups();
    this.canvas?.classList.remove("lp-canvas-panning");
    this.updateCursor();
  }

  /**
   * Push the pre-pan composite when a pan gesture actually moved the
   * reference. Snapshots are one per pointer-up, never per pointer-move.
   * @param {{baseSnapshot?: {layout: object, background: object | null}}} drag
   */
  commitPan(drag) {
    const base = drag?.baseSnapshot;
    if (!base?.background) return;

    const after = this.background?.toJSON() ?? null;
    if (sameBackground(base.background, after)) return;
    this.pushSnapshot(base);
  }

  isEditorEngaged() {
    const active = globalThis.document?.activeElement;
    if (this.root && active && this.root.contains(active)) return true;
    return this.canvasHovered;
  }

  /**
   * True when the canvas or a row control has keyboard focus. Toolbar buttons
   * and the list header (+ add) are not editing surfaces; focusing them must
   * not let Delete/arrows/Ctrl+Z edit the layout.
   */
  ownsKeyboardFocus() {
    const active = globalThis.document?.activeElement;
    if (!active) return false;
    if (active === this.canvas) return true;
    if (!this.listHost?.contains(active)) return false;
    if (typeof active.closest !== "function") return false;
    return active.closest(".lp-row") !== null;
  }

  /** Stop a handled shortcut before the graph's own key handlers see it. */
  consumeKey(event) {
    event.preventDefault();
    event.stopPropagation();
  }

  handleKeyDown(event) {
    // Text fields keep every key, including native Ctrl+Z text undo.
    if (isEditableTarget(event.target)) return;

    if (this.handleEditingKey(event)) return;

    if (event.code !== "Space" && event.key !== " ") return;
    if (isInteractiveTarget(event.target)) return;
    if (!this.isEditorEngaged()) return;

    this.spaceHeld = true;
    this.updateCursor();
    if (!this.panDrag) event.preventDefault();
  }

  /**
   * Keyboard editing shortcuts. They only fire while focus is inside the
   * panel (the canvas is focused on pointer-down) and never mid-gesture, so a
   * key can neither edit a box nor reach the graph from a text field.
   * @param {KeyboardEvent} event
   * @returns {boolean} whether the key was consumed
   */
  handleEditingKey(event) {
    if (!this.ownsKeyboardFocus()) return false;
    if (this.boxDrag || this.panDrag) return false;
    if (event.altKey) return false;

    const key = typeof event.key === "string" ? event.key : "";
    const lower = key.toLowerCase();
    const control = event.ctrlKey || event.metaKey;

    if (control) {
      if (lower === "z") {
        this.consumeKey(event);
        if (event.shiftKey) this.redoEdit();
        else this.undoEdit();
        return true;
      }
      if (lower === "d" && !event.shiftKey) {
        this.consumeKey(event);
        this.duplicateSelected();
        return true;
      }
      return false;
    }

    switch (key) {
      case "ArrowLeft":
        this.consumeKey(event);
        this.nudgeSelected(-1, 0, event.shiftKey ? 10 : 1, event.repeat);
        return true;
      case "ArrowRight":
        this.consumeKey(event);
        this.nudgeSelected(1, 0, event.shiftKey ? 10 : 1, event.repeat);
        return true;
      case "ArrowUp":
        this.consumeKey(event);
        this.nudgeSelected(0, -1, event.shiftKey ? 10 : 1, event.repeat);
        return true;
      case "ArrowDown":
        this.consumeKey(event);
        this.nudgeSelected(0, 1, event.shiftKey ? 10 : 1, event.repeat);
        return true;
      case "Delete":
      case "Backspace":
        this.consumeKey(event);
        this.deleteSelected();
        return true;
      case "Escape":
        this.consumeKey(event);
        this.endHistoryGroups();
        this.applyCanvasSelection(null);
        return true;
      default:
        return false;
    }
  }

  handleKeyUp(event) {
    if (event.code !== "Space" && event.key !== " ") return;
    this.spaceHeld = false;
    this.updateCursor();
  }

  /**
   * Move the selected box by whole 0-1000 units. Consecutive arrow presses
   * share one history entry until the group goes idle or another commit runs.
   * @param {number} dx
   * @param {number} dy
   * @param {number} step 1 unit, or 10 with Shift
   * @param {boolean} [repeat] the keydown is an OS auto-repeat
   */
  nudgeSelected(dx, dy, step, repeat = false) {
    const id = this.state.selectedId;
    const box = id ? this.findBox(id) : null;
    if (!box) return;

    // A nudge is a discrete action; a wheel-zoom burst ends here.
    this.endZoomBurst();

    const now = Date.now();
    const bbox = moveBbox(box.bbox, dx * step, dy * step);
    const changed = !sameBbox(box.bbox, bbox);
    const continues =
      Boolean(repeat) &&
      !this.nudgeGroupActive &&
      this.lastNudgeBoxId === id &&
      now - this.lastNudgeAt <= NUDGE_CONTINUE_MS;

    if (changed && !this.nudgeGroupActive) {
      // Capture before mutating. The whole held-key run shares this entry.
      if (!continues) this.pushSnapshot(this.captureSnapshot());
      this.nudgeGroupActive = true;
    }
    if (changed) {
      this.lastNudgeBoxId = id;
      this.lastNudgeAt = now;
    } else if (repeat && this.lastNudgeBoxId === id) {
      // A no-op repeat at a canvas edge still belongs to the same held run.
      this.lastNudgeAt = now;
    }
    this.armNudgeGroup();
    if (!changed) return;

    this.applyState(updateBox(this.state, id, { bbox }));
  }

  deleteSelected() {
    const id = this.state.selectedId;
    if (id) this.applyDelete(id);
  }

  duplicateSelected() {
    const id = this.state.selectedId;
    if (id) this.applyDuplicate(id);
  }

  resetTransientInput() {
    this.spaceHeld = false;

    if (this.panDrag) {
      // A focus loss ends the pan; keep its committed transform undoable.
      const drag = this.panDrag;
      this.panDrag = null;
      this.commitPan(drag);
    }
    this.endHistoryGroups();

    if (this.boxDrag) {
      // Never leave a half-finished, uncommitted box behind.
      this.state = this.boxDrag.baseState;
      this.boxDrag = null;
      this.updateSelectionClasses();
      this.scheduleRender();
    }

    this.canvas?.classList.remove("lp-canvas-panning");
    this.updateCursor();
  }

  updateCursor() {
    if (!this.canvas) return;
    const panReady = this.moveBackground || this.spaceHeld;
    this.canvas.classList.toggle("lp-canvas-pan", panReady);
  }

  // ---------------------------------------------------------------------
  // Undo / redo history
  // ---------------------------------------------------------------------
  //
  // Every entry is a composite { layout, background } where background is
  // Background.toJSON(). Snapshots are only taken at commits: pointer-up,
  // committed field edits, add/delete/duplicate/reorder, keyboard edits, and
  // Fit/Fill/zoom/pan. Selection-only changes and reference mode/source
  // toggles do not create entries.

  /** A {layout, background} snapshot of the state before a committed change. */
  captureSnapshot() {
    return {
      layout: this.state,
      background: this.background ? this.background.toJSON() : null,
    };
  }

  /** Store a pre-change composite; any new commit drops the redo stack. */
  pushSnapshot(snapshot) {
    if (!snapshot) return;
    this.history = pushHistory(this.history, snapshot);
  }

  /** Keep a held-arrow run open; it ends 500 ms after the last arrow. */
  armNudgeGroup() {
    if (this.nudgeTimer !== null) clearTimeout(this.nudgeTimer);
    this.nudgeTimer = setTimeout(() => {
      this.nudgeTimer = null;
      this.nudgeGroupActive = false;
    }, NUDGE_GROUP_MS);
  }

  endNudgeGroup() {
    if (this.nudgeTimer !== null) {
      clearTimeout(this.nudgeTimer);
      this.nudgeTimer = null;
    }
    this.nudgeGroupActive = false;
    this.lastNudgeBoxId = null;
    this.lastNudgeAt = 0;
  }

  /** Keep a wheel-zoom burst open; it ends 500 ms after the last notch. */
  armZoomBurst() {
    if (this.zoomBurstTimer !== null) clearTimeout(this.zoomBurstTimer);
    this.zoomBurstTimer = setTimeout(() => {
      this.zoomBurstTimer = null;
      this.zoomBurstActive = false;
    }, ZOOM_BURST_MS);
  }

  endZoomBurst() {
    if (this.zoomBurstTimer !== null) {
      clearTimeout(this.zoomBurstTimer);
      this.zoomBurstTimer = null;
    }
    this.zoomBurstActive = false;
  }

  endHistoryGroups() {
    this.endNudgeGroup();
    this.endZoomBurst();
  }

  /** Push the pre-change composite for a discrete committed mutation. */
  commitBeforeChange() {
    this.endHistoryGroups();
    this.pushSnapshot(this.captureSnapshot());
  }

  /**
   * Record a Fit/Fill/zoom/pan change.
   * @param {object} before Background.toJSON() captured before the change
   * @param {{coalesce?: boolean}} [options] coalesce wheel-zoom notches
   * @returns {boolean} whether the background actually changed
   */
  commitBackgroundChange(before, { coalesce = false } = {}) {
    const after = this.background?.toJSON() ?? null;
    if (sameBackground(before, after)) return false;

    if (!coalesce) {
      this.endHistoryGroups();
      this.pushSnapshot({ layout: this.state, background: before });
      return true;
    }

    // One entry per wheel burst: the first notch stores the pre-burst
    // transform, later notches only keep the burst alive.
    this.endNudgeGroup();
    if (!this.zoomBurstActive) {
      this.zoomBurstActive = true;
      this.pushSnapshot({ layout: this.state, background: before });
    }
    this.armZoomBurst();
    return true;
  }

  undoEdit() {
    this.flushPendingEdit();
    this.endHistoryGroups();
    if (this.history.past.length === 0) return false;

    const result = undo(this.history, this.captureSnapshot());
    this.history = result.history;
    this.restoreSnapshot(result.state);
    return true;
  }

  redoEdit() {
    this.flushPendingEdit();
    this.endHistoryGroups();
    if (this.history.future.length === 0) return false;

    const result = redo(this.history, this.captureSnapshot());
    this.history = result.history;
    this.restoreSnapshot(result.state);
    return true;
  }

  /**
   * Restore an undo/redo composite: layout state, hidden widget, list, height,
   * selection, and the reference transform.
   * @param {{layout?: object, background?: object | null}} snapshot
   */
  restoreSnapshot(snapshot) {
    this.applyState(snapshot?.layout ?? this.state, { rebuild: true });
    if (this.background && snapshot?.background) {
      // White/Reference is a view-only toggle, not a history edit: keep the
      // mode the user is currently looking at while the file/Fit/zoom/pan are
      // restored from the snapshot.
      const mode = this.background.mode;
      this.background.loadStored(snapshot.background);
      if (mode === "white" || mode === "reference") {
        this.background.setMode(mode);
      }
    }
    this.updateHover(null);
    this.updateToolbar();
  }

  // ---------------------------------------------------------------------
  // Rendering / height
  // ---------------------------------------------------------------------

  scheduleRender() {
    if (!this.canvasView || this.renderFrame !== null) return;

    this.renderFrame = this.raf(() => {
      this.renderFrame = null;
      this.canvasView?.render(this.state, this.background);
    });
  }

  cancelScheduledRender() {
    if (this.renderFrame === null) return;
    this.caf(this.renderFrame);
    this.renderFrame = null;
  }

  renderState() {
    if (!this.listHost) return;

    const scrollTop =
      this.listHost.querySelector(".lp-list")?.scrollTop ?? 0;
    const focus = captureFieldFocus(this.listHost);

    renderBoxList(this.listHost, this.state, this.handlers);

    const list = this.listHost.querySelector(".lp-list");
    if (list) list.scrollTop = scrollTop;
    restoreFieldFocus(this.listHost, focus);
  }

  wireOutputWidgets() {
    for (const name of ["aspect_ratio", "megapixels"]) {
      const widget = this.node?.widgets?.find(
        (candidate) => candidate?.name === name,
      );
      if (!widget) continue;

      const entry = {
        widget,
        original: widget.callback,
        wrapper: null,
      };
      entry.wrapper = (...args) => {
        const result = entry.original?.apply(widget, args);
        this.onOutputSettingsChanged();
        return result;
      };
      widget.callback = entry.wrapper;
      this.widgetWrappers.push(entry);
    }
  }

  restoreWidgetCallbacks() {
    for (const { widget, original, wrapper } of this.widgetWrappers) {
      if (widget.callback === wrapper) widget.callback = original;
    }
    this.widgetWrappers = [];
  }

  wireNodeResize() {
    const node = this.node;
    if (!node) return;

    const previous = node.onResize;
    const editor = this;
    const wrapper = function (...args) {
      previous?.apply(this, args);
      if (!editor.applyingSize) editor.handleNodeResize(args[0]);
    };

    node.onResize = wrapper;
    this.resizeWrapper = { wrapper, previous };
  }

  restoreNodeResize() {
    const entry = this.resizeWrapper;
    this.resizeWrapper = null;
    if (!entry || !this.node || this.node.onResize !== entry.wrapper) return;

    if (entry.previous === undefined) {
      try {
        delete this.node.onResize;
      } catch {
        this.node.onResize = undefined;
      }
    } else {
      this.node.onResize = entry.previous;
    }
  }

  handleNodeResize(size) {
    if (!Array.isArray(size)) return;

    // Recompute the canvas first: a width change can change the canvas height
    // (and therefore the node height required to fit it).
    this.refreshCanvasSize();
    const required = this.requiredNodeHeight();
    const height = size[1];
    const previousHeight = this.lastNodeHeight;

    if (Number.isFinite(height)) {
      const heightChanged =
        !Number.isFinite(previousHeight) ||
        Math.abs(height - previousHeight) > 0.5;

      if (heightChanged) {
        // The user changed the node height (usually by dragging the corner):
        // keep the extra room and stop auto-shrinking.
        this.userSizedHeight =
          Number.isFinite(required) &&
          height > required + HEIGHT_TOLERANCE;
      } else if (
        Number.isFinite(required) &&
        height <= required + HEIGHT_TOLERANCE
      ) {
        // A width-only change that now fits exactly clears the flag.
        this.userSizedHeight = false;
      }

      this.lastNodeHeight = height;
    }

    this.requestHeight();
  }

  observeRootResize(root) {
    if (typeof ResizeObserver !== "function") return;
    this.resizeObserver = new ResizeObserver(() => {
      const width = this.root?.clientWidth ?? 0;
      if (width <= 0 || width === this.lastRootWidth) return;
      this.lastRootWidth = width;
      this.refreshCanvasSize();
      this.requestHeight();
    });
    this.resizeObserver.observe(root);
  }

  /** Total node height required by the widgets plus the editor panel. */
  requiredNodeHeight() {
    if (typeof this.node?.computeSize === "function") {
      const computed = this.node.computeSize();
      if (Array.isArray(computed) && Number.isFinite(computed[1])) {
        return computed[1];
      }
    }
    return this.computeHeight();
  }

  applyNodeHeight(height) {
    const node = this.node;
    if (!node?.setSize || !Array.isArray(node.size)) return;

    this.applyingSize = true;
    try {
      node.setSize([node.size[0], Math.round(height)]);
      this.lastNodeHeight = Array.isArray(node.size)
        ? node.size[1]
        : Math.round(height);
    } finally {
      this.applyingSize = false;
    }
  }

  /**
   * Grow or shrink the node so the canvas, toolbar, and list fit. A node the
   * user manually enlarged is only ever grown further.
   */
  requestHeight() {
    const node = this.node;
    if (!node) return;

    if (Array.isArray(node.size) && typeof node.computeSize === "function") {
      const required = this.requiredNodeHeight();
      const height = node.size[1];
      if (Number.isFinite(required) && Number.isFinite(height)) {
        if (required > height + HEIGHT_TOLERANCE) {
          this.applyNodeHeight(required);
        } else if (
          required < height - HEIGHT_TOLERANCE &&
          !this.userSizedHeight
        ) {
          this.applyNodeHeight(required);
        }
      }
    }

    node.setDirtyCanvas?.(true, true);
  }

  // ---------------------------------------------------------------------
  // State mutation
  // ---------------------------------------------------------------------

  /**
   * Apply a new state and persist it.
   * @param {object} nextState
   * @param {{rebuild?: boolean, focusCaption?: boolean}} [options]
   */
  applyState(nextState, { rebuild = false, focusCaption = false } = {}) {
    this.state = nextState;
    if (this.hiddenWidget) {
      this.hiddenWidget.value = serializeState(nextState);
    }

    if (rebuild) {
      this.renderState();
      if (focusCaption) this.focusCaption();
    } else {
      // Quiet edits leave the row inputs in place; only selection styling
      // needs to follow the state.
      this.updateSelectionClasses();
    }

    this.requestHeight();
    this.scheduleRender();
  }

  /**
   * Buffer a caption/text edit and commit it after a short pause.
   * @param {string} id
   * @param {object} patch
   */
  queueFieldEdit(id, patch) {
    if (!patch || !this.hasBox(id)) return;

    if (this.editTimer !== null) clearTimeout(this.editTimer);
    if (this.pendingEdit?.id === id) {
      this.pendingEdit.patch = { ...this.pendingEdit.patch, ...patch };
    } else {
      this.flushPendingEdit();
      this.pendingEdit = { id, patch: { ...patch } };
    }

    this.editTimer = setTimeout(() => {
      this.editTimer = null;
      this.flushPendingEdit();
    }, FIELD_DEBOUNCE_MS);
  }

  /** Commit a buffered field edit without rebuilding the list. */
  flushPendingEdit() {
    if (this.editTimer !== null) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }

    const pending = this.pendingEdit;
    this.pendingEdit = null;
    if (!pending) return;

    this.applyQuietUpdate(pending.id, pending.patch);
  }

  cancelPendingEdit() {
    if (this.editTimer !== null) {
      clearTimeout(this.editTimer);
      this.editTimer = null;
    }
    this.pendingEdit = null;
  }

  updateSelectionClasses() {
    if (!this.listHost) return;
    updateRowSelection(this.listHost, this.state.selectedId);
  }

  focusCaption() {
    const id = this.state.selectedId;
    if (!id || !this.listHost) return;

    const row = [...this.listHost.querySelectorAll(".lp-row")].find(
      (candidate) => candidate.dataset.id === id,
    );
    row?.querySelector(".lp-caption")?.focus();
  }

  hasBox(id) {
    return this.state.boxes.some((box) => box.id === id);
  }

  /** Keep only fields this editor knows how to store. */
  filterPatch(patch) {
    const next = {};
    if (LABELS.includes(patch?.label)) next.label = patch.label;
    if (typeof patch?.caption === "string") next.caption = patch.caption;
    if (typeof patch?.text === "string") next.text = patch.text;
    return next;
  }

  /** A string id unique within the current state. */
  newBoxId() {
    const used = new Set(this.state.boxes.map((box) => box.id));
    let id = nextBoxId();
    while (used.has(id)) id = nextBoxId();
    return id;
  }

  /** Whether applying a filtered field patch would change the box. */
  patchChangesBox(id, patch) {
    const box = this.findBox(id);
    if (!box) return false;
    return Object.entries(patch).some(([key, value]) => box[key] !== value);
  }

  addNewBox() {
    this.flushPendingEdit();
    const box = createBox(this.newBoxId(), DEFAULT_BOX_BBOX, {
      label: DEFAULT_BOX_LABEL,
    });
    this.commitBeforeChange();
    this.applyState(addBox(this.state, box), {
      rebuild: true,
      focusCaption: true,
    });
  }

  selectBox(id) {
    if (!this.hasBox(id)) return;
    this.flushPendingEdit();
    this.endHistoryGroups();
    if (this.state.selectedId === id) return;
    // Selection alone is never a history entry.
    this.applyState({ ...this.state, selectedId: id });
  }

  applyUpdate(id, patch) {
    if (!this.hasBox(id)) return;

    const next = this.filterPatch(patch);
    if (Object.keys(next).length === 0) return;

    const structural = next.label !== undefined;
    // Label changes rebuild the row; preserve buffered caption/text edits
    // first. Blur commits are quiet and never disturb the pointer target.
    this.flushPendingEdit();
    if (!this.hasBox(id)) return;

    // A blur with an unchanged value (or a label re-pick) is not a commit.
    if (this.patchChangesBox(id, next)) this.commitBeforeChange();

    this.applyState(
      { ...updateBox(this.state, id, next), selectedId: id },
      { rebuild: structural },
    );
  }

  applyQuietUpdate(id, patch) {
    if (!this.hasBox(id)) return;

    const next = this.filterPatch(patch);
    if (Object.keys(next).length === 0) return;

    if (this.patchChangesBox(id, next)) this.commitBeforeChange();

    this.applyState(
      { ...updateBox(this.state, id, next), selectedId: id },
      { rebuild: next.label !== undefined },
    );
  }

  applyDelete(id) {
    if (!this.hasBox(id)) return;
    this.flushPendingEdit();
    if (!this.hasBox(id)) return;
    this.commitBeforeChange();
    this.applyState(deleteBox(this.state, id), { rebuild: true });
  }

  applyDuplicate(id) {
    if (!this.hasBox(id)) return;
    this.flushPendingEdit();
    if (!this.hasBox(id)) return;
    this.commitBeforeChange();
    this.applyState(duplicateBox(this.state, id, this.newBoxId()), {
      rebuild: true,
    });
  }

  applyMove(id, delta) {
    if (!this.hasBox(id)) return;
    this.flushPendingEdit();
    if (!this.hasBox(id)) return;

    const moved = moveBox(this.state, id, delta);
    const changed = moved.boxes.some(
      (box, index) => box !== this.state.boxes[index],
    );
    if (changed) this.commitBeforeChange();
    this.applyState(moved, { rebuild: true });
  }
}
