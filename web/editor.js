// DOM shell for the Layout Prompt Builder node.
//
// Owns the parsed editor state and mounts the editor panel inside the node's
// DOM widget. The canvas, box list, and reference controls are added by later
// tasks; this shell only establishes the state read path and the panel.

import { deserializeState } from "./state.js";

const PLACEHOLDER_HEIGHT = 400;

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
    this.placeholder = null;
    this.countLabel = null;
    this.abortController = null;
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

    const placeholder = document.createElement("div");
    placeholder.className = "lp-placeholder";
    placeholder.setAttribute("role", "status");

    const title = document.createElement("div");
    title.className = "lp-placeholder-title";
    title.textContent = "Layout editor";

    const hint = document.createElement("div");
    hint.className = "lp-placeholder-hint";
    hint.textContent = "Canvas and box list will appear here.";

    const count = document.createElement("div");
    count.className = "lp-placeholder-count";

    placeholder.append(title, hint, count);
    root.append(placeholder);
    container.append(root);

    this.root = root;
    this.placeholder = placeholder;
    this.countLabel = count;

    // Keep pointer gestures inside the panel from reaching the graph canvas.
    this.abortController = new AbortController();
    root.addEventListener(
      "pointerdown",
      (event) => event.stopPropagation(),
      { signal: this.abortController.signal },
    );

    this.renderState();
  }

  /** Height of the editor panel in CSS pixels. */
  computeHeight() {
    return PLACEHOLDER_HEIGHT;
  }

  /** Re-read state after ComfyUI restores saved widget values. */
  syncFromWidget() {
    this.state = deserializeState(this.hiddenWidget?.value ?? "");
    this.renderState();
  }

  /** Release the panel DOM and every listener registered by the shell. */
  destroy() {
    this.abortController?.abort();
    this.abortController = null;

    if (this.root?.parentNode) {
      this.root.parentNode.removeChild(this.root);
    }

    this.root = null;
    this.placeholder = null;
    this.countLabel = null;
    this.container = null;
  }

  renderState() {
    if (!this.countLabel) return;
    const count = this.state.boxes.length;
    this.countLabel.textContent = `${count} box${count === 1 ? "" : "es"}`;
  }
}
