// ComfyUI frontend extension for the Layout Prompt Builder node.
//
// Adds the DOM-widget editor below the standard widgets and keeps the hidden
// boxes_json string widget serialized as the frontend's source of truth.

import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

import { LayoutEditor } from "./editor.js";
import { DOM_WIDGET_MARGIN } from "./editor_height.js";
import { lastHistoryImage } from "./history_image.js";
import { isNodeSize } from "./node_size.js";
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

  // Every live editor stores the newest image for its "Use last" button. The
  // displayed reference is never switched automatically.
  for (const editor of liveEditors) {
    editor.setLastOutput?.(ref);
  }
});

// One history lookup per page. On node creation the newest generated image is
// offered to "Use last", so the button still works after a reload or for
// images produced before the node existed. Live executed events win.
let lastHistoryImagePromise = null;

function fetchLastHistoryImage() {
  if (!lastHistoryImagePromise) {
    lastHistoryImagePromise = (async () => {
      try {
        const response = await api.fetchApi("/history?max_items=20");
        if (!response?.ok) return null;
        return lastHistoryImage(await response.json());
      } catch {
        return null;
      }
    })();
  }
  return lastHistoryImagePromise;
}

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
        // The frontend insets the element by this margin on every side; the
        // editor's height callbacks include it.
        margin: DOM_WIDGET_MARGIN,
        getHeight: editorHeight,
        getMinHeight: editorHeight,
        getMaxHeight: editorHeight,
      });

      editor = new LayoutEditor(node, hiddenWidget);
      node.layoutEditor = editor;
      editor.onDestroy = () => liveEditors.delete(editor);
      liveEditors.add(editor);
      editor.mount(container);

      // Seed "Use last" from the newest generated image. A live execution
      // that already populated lastOutput wins; the seed never switches the
      // displayed reference on its own.
      void fetchLastHistoryImage().then((ref) => {
        if (!ref || node.layoutEditor !== editor || editor.lastOutput) return;
        editor.setLastOutput(ref);
      });

      const computed = node.computeSize();
      const initialHeight = isNodeSize(node.size) ? node.size[1] : 0;
      node.setSize([DEFAULT_WIDTH, Math.max(initialHeight, computed[1])]);
    });

    chainCallback(nodeType.prototype, "onConfigure", function () {
      // Saved widget values and node.properties are restored before
      // onConfigure runs; syncFromWidget re-reads both. Restoring the
      // background is a load, not an edit.
      this.layoutEditor?.syncFromWidget();
      // A hand-edited or older workflow must not restore narrower than the
      // panel minimum; the toolbar would clip. Clamp after the editor has
      // re-read the restored state.
      if (isNodeSize(this.size) && this.size[0] < MIN_WIDTH) {
        if (typeof this.setSize === "function") {
          this.setSize([MIN_WIDTH, this.size[1]]);
        } else {
          this.size[0] = MIN_WIDTH;
        }
      }
    });

    chainCallback(nodeType.prototype, "onResize", function (size) {
      if (!isNodeSize(size)) return;
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
