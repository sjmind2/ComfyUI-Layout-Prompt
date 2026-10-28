// DOM shell for the Layout Prompt Builder node.
//
// Owns the parsed editor state and mounts the editor panel inside the node's
// DOM widget. This task adds the single-column box list; the canvas and
// reference controls are added by later tasks.

import {
  captureFieldFocus,
  LABELS,
  renderBoxList,
  restoreFieldFocus,
} from "./list.js";
import {
  addBox,
  createBox,
  deleteBox,
  deserializeState,
  duplicateBox,
  moveBox,
  serializeState,
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

// A 20% box centered in the 0-1000 yxyx coordinate space.
const DEFAULT_BOX_BBOX = [400, 400, 600, 600];
const DEFAULT_BOX_LABEL = "character";

let boxIdCounter = 0;

function nextBoxId() {
  boxIdCounter += 1;
  return `box_${Date.now().toString(36)}_${boxIdCounter.toString(36)}`;
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

    this.handlers = {
      onAdd: () => this.addNewBox(),
      onSelect: (id) => this.selectBox(id),
      onUpdate: (id, patch) => this.applyUpdate(id, patch),
      onDelete: (id) => this.applyDelete(id),
      onDuplicate: (id) => this.applyDuplicate(id),
      onMove: (id, delta) => this.applyMove(id, delta),
    };
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

    const listHost = document.createElement("div");
    listHost.className = "lp-list-host";
    root.append(listHost);
    container.append(root);

    this.root = root;
    this.listHost = listHost;

    // Keep pointer gestures inside the panel from reaching the graph canvas.
    this.abortController = new AbortController();
    root.addEventListener(
      "pointerdown",
      (event) => event.stopPropagation(),
      { signal: this.abortController.signal },
    );

    this.renderState();
    this.requestHeight();
  }

  /** Height of the editor panel in CSS pixels. */
  computeHeight() {
    const count = this.state.boxes.length;
    const visibleRows = Math.max(
      MIN_VISIBLE_ROWS,
      Math.min(count, MAX_VISIBLE_ROWS),
    );
    return (
      CONTAINER_VERTICAL_PADDING +
      LIST_HEADER_HEIGHT +
      LIST_HEADER_GAP +
      visibleRows * LIST_ROW_HEIGHT +
      (visibleRows - 1) * LIST_ROW_GAP
    );
  }

  /** Re-read state after ComfyUI restores saved widget values. */
  syncFromWidget() {
    this.state = deserializeState(this.hiddenWidget?.value ?? "");
    this.renderState();
    this.requestHeight();
  }

  /** Release the panel DOM and every listener registered by the shell. */
  destroy() {
    this.abortController?.abort();
    this.abortController = null;

    if (this.root?.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }

    this.root = null;
    this.listHost = null;
    this.container = null;
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

  /**
   * Persist and display a new state after a mutation.
   * @param {object} nextState
   * @param {{focusCaption?: boolean}} [options]
   */
  commit(nextState, { focusCaption = false } = {}) {
    this.state = nextState;
    if (this.hiddenWidget) {
      this.hiddenWidget.value = serializeState(nextState);
    }

    this.renderState();
    if (focusCaption) this.focusCaption();
    this.requestHeight();
  }

  /** Ask the node to grow if the panel no longer fits in its body. */
  requestHeight() {
    const node = this.node;
    if (!node) return;

    if (Array.isArray(node.size) && typeof node.computeSize === "function") {
      const [width, height] = node.size;
      const computed = node.computeSize();
      const required = Array.isArray(computed) ? computed[1] : 0;
      if (required > height) {
        node.setSize?.([width, required]);
      }
    }

    node.setDirtyCanvas?.(true, true);
  }

  focusCaption() {
    const id = this.state.selectedId;
    if (!id || !this.listHost) return;

    const row = [...this.listHost.querySelectorAll(".lp-row")].find(
      (candidate) => candidate.dataset.id === id,
    );
    row?.querySelector(".lp-caption")?.focus();
  }

  /** A string id unique within the current state. */
  newBoxId() {
    const used = new Set(this.state.boxes.map((box) => box.id));
    let id = nextBoxId();
    while (used.has(id)) id = nextBoxId();
    return id;
  }

  addNewBox() {
    const box = createBox(this.newBoxId(), DEFAULT_BOX_BBOX, {
      label: DEFAULT_BOX_LABEL,
    });
    this.commit(addBox(this.state, box), { focusCaption: true });
  }

  selectBox(id) {
    if (this.state.selectedId === id) return;
    if (!this.state.boxes.some((box) => box.id === id)) return;
    this.commit({ ...this.state, selectedId: id });
  }

  applyUpdate(id, patch) {
    if (!patch || !this.state.boxes.some((box) => box.id === id)) return;

    const next = {};
    if (LABELS.includes(patch.label)) next.label = patch.label;
    if (typeof patch.caption === "string") next.caption = patch.caption;
    if (typeof patch.text === "string") next.text = patch.text;
    if (Object.keys(next).length === 0) return;

    this.commit({ ...updateBox(this.state, id, next), selectedId: id });
  }

  applyDelete(id) {
    if (!this.state.boxes.some((box) => box.id === id)) return;
    this.commit(deleteBox(this.state, id));
  }

  applyDuplicate(id) {
    if (!this.state.boxes.some((box) => box.id === id)) return;
    this.commit(duplicateBox(this.state, id, this.newBoxId()));
  }

  applyMove(id, delta) {
    if (!this.state.boxes.some((box) => box.id === id)) return;
    this.commit(moveBox(this.state, id, delta));
  }
}
