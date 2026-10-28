// ComfyUI frontend extension for the Layout Prompt Builder node.
//
// Adds the DOM-widget editor below the standard widgets and keeps the hidden
// boxes_json string widget serialized as the frontend's source of truth.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

import { LayoutEditor } from "./editor.js";
import { injectStyles } from "./styles.js";

const NODE_NAME = "LayoutPromptBuilder";
const DOM_WIDGET_NAME = "layout_editor";
const DOM_WIDGET_TYPE = "LayoutEditor";
const HIDDEN_WIDGET_NAME = "boxes_json";
const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 440;
const FALLBACK_HEIGHT = 400;

// Live layout editors, so the global "executed" listener only offers the last
// image to nodes still on the graph. Editors unregister on destroy.
const liveEditors = new Set();

/**
 * Extract the newest image from an executed event payload. The last entry of
 * detail.output.images is the most recently written image of that event.
 * @param {{output?: {images?: Array<{filename?: string, type?: string,
 *                  subfolder?: string}>}} | undefined} detail
 * @returns {{filename: string, type: string, subfolder: string} | null}
 */
function executedImage(detail) {
  const images = detail?.output?.images;
  if (!Array.isArray(images) || images.length === 0) return null;

  const image = images[images.length - 1];
  if (!image || typeof image.filename !== "string" || !image.filename) {
    return null;
  }
  return {
    filename: image.filename,
    type: typeof image.type === "string" && image.type ? image.type : "temp",
    subfolder: typeof image.subfolder === "string" ? image.subfolder : "",
  };
}

api.addEventListener("executed", ({ detail } = {}) => {
  const ref = executedImage(detail);
  if (!ref) return;

  // Every live editor stores the newest image for its "Last" button. The
  // displayed reference is never switched automatically.
  for (const editor of liveEditors) {
    editor.setLastOutput?.(ref);
  }
});

/**
 * Wrap an existing node lifecycle handler without dropping it.
 * @param {object} prototype node prototype
 * @param {string} name handler name
 * @param {(this: object, ...args: any[]) => void} callback
 */
function chainCallback(prototype, name, callback) {
  const original = prototype[name];
  prototype[name] = function (...args) {
    const result = original?.apply(this, args);
    callback.apply(this, args);
    return result;
  };
}

app.registerExtension({
  name: "Moss.LayoutPromptBuilder",

  beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_NAME) return;

    chainCallback(nodeType.prototype, "onNodeCreated", function () {
      const node = this;

      const hiddenWidget = node.widgets?.find(
        (widget) => widget.name === HIDDEN_WIDGET_NAME,
      );
      if (hiddenWidget) {
        // Keep the widget so its value still serializes with the workflow;
        // only its row is removed from the node.
        hiddenWidget.hidden = true;
      } else {
        console.warn(
          `[LayoutPromptBuilder] ${HIDDEN_WIDGET_NAME} widget not found; ` +
            "editor state will not persist.",
        );
      }

      injectStyles();

      const container = document.createElement("div");
      container.className = "layout-prompt-editor";

      let editor = null;
      const editorHeight = () =>
        editor?.computeHeight() ?? FALLBACK_HEIGHT;

      node.addDOMWidget(DOM_WIDGET_NAME, DOM_WIDGET_TYPE, container, {
        serialize: false,
        hideOnZoom: false,
        getHeight: editorHeight,
        getMinHeight: editorHeight,
        getMaxHeight: editorHeight,
      });

      editor = new LayoutEditor(node, hiddenWidget);
      node.layoutEditor = editor;
      editor.onDestroy = () => liveEditors.delete(editor);
      liveEditors.add(editor);
      editor.mount(container);

      const computed = node.computeSize();
      node.setSize([DEFAULT_WIDTH, Math.max(node.size[1], computed[1])]);
    });

    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Saved widget values and node.properties are restored before
      // onConfigure runs; syncFromWidget re-reads both. Restoring the
      // background is a load, not an edit.
      this.layoutEditor?.syncFromWidget();
    });

    chainCallback(nodeType.prototype, "onResize", function (size) {
      if (!Array.isArray(size)) return;
      if (size[0] < MIN_WIDTH) size[0] = MIN_WIDTH;
      if (this.size && this.size[0] < MIN_WIDTH) this.size[0] = MIN_WIDTH;
    });

    chainCallback(nodeType.prototype, "onRemoved", function () {
      const editor = this.layoutEditor;
      this.layoutEditor = null;
      if (!editor) return;

      // The destroy hook also unregisters; this keeps the registry exact even
      // if teardown throws partway through.
      liveEditors.delete(editor);
      editor.destroy();
    });
  },
});
