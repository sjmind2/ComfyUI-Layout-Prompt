// Stylesheet for the Layout Prompt Builder editor.
//
// Injected once per page from layout_prompt.js. Rules are scoped under
// .layout-prompt-editor so they never leak into the ComfyUI graph UI.

const STYLE_ID = "layout-prompt-styles";

const STYLES = `
.layout-prompt-editor {
  --lp-panel: #1c1c22;
  --lp-border: #34343d;
  --lp-text: #e2e2e8;
  --lp-muted: #8e8e9a;
  --lp-accent: #4a9eff;
  --lp-list-header-height: 24px;
  --lp-list-row-height: 28px;
  --lp-list-gap: 2px;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 2px 4px 4px;
  overflow: hidden;
  color-scheme: dark;
  color: var(--lp-text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 12px;
}

.layout-prompt-editor *,
.layout-prompt-editor *::before,
.layout-prompt-editor *::after {
  box-sizing: border-box;
}

.layout-prompt-editor .lp-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.layout-prompt-editor .lp-canvas-area {
  flex: 0 0 auto;
  min-width: 0;
}

.layout-prompt-editor .lp-canvas-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  margin-bottom: 6px;
}

.layout-prompt-editor .lp-canvas {
  display: block;
  flex: 0 0 auto;
  border-radius: 2px;
  background: #ffffff;
  box-shadow: 0 0 0 1px var(--lp-border);
  touch-action: none;
}

.layout-prompt-editor .lp-canvas:focus {
  outline: none;
}

.layout-prompt-editor .lp-canvas:focus-visible {
  box-shadow: 0 0 0 1px var(--lp-accent);
}

.layout-prompt-editor .lp-canvas.lp-canvas-pan {
  cursor: grab;
}

.layout-prompt-editor .lp-canvas.lp-canvas-panning {
  cursor: grabbing;
}

.layout-prompt-editor .lp-toolbar {
  display: flex;
  align-items: center;
  gap: 3px;
  height: 24px;
  min-height: 24px;
  overflow: hidden;
  white-space: nowrap;
  user-select: none;
}

.layout-prompt-editor .lp-tool {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  height: 20px;
  padding: 0 5px;
  border: 1px solid var(--lp-border);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.04);
  color: var(--lp-text);
  font: inherit;
  font-size: 10px;
  line-height: 1;
  white-space: nowrap;
  cursor: pointer;
}

.layout-prompt-editor .lp-tool:hover {
  border-color: var(--lp-muted);
}

.layout-prompt-editor .lp-tool.lp-active {
  border-color: var(--lp-accent);
  background: rgba(74, 158, 255, 0.18);
  color: var(--lp-accent);
}

.layout-prompt-editor .lp-segment {
  display: flex;
  flex: 0 0 auto;
}

.layout-prompt-editor .lp-segment .lp-tool {
  border-radius: 0;
}

.layout-prompt-editor .lp-segment .lp-tool:first-child {
  border-radius: 4px 0 0 4px;
}

.layout-prompt-editor .lp-segment .lp-tool:last-child {
  border-radius: 0 4px 4px 0;
}

.layout-prompt-editor .lp-segment .lp-tool + .lp-tool {
  border-left: none;
}

.layout-prompt-editor .lp-zoom {
  flex: 0 0 auto;
  min-width: 34px;
  color: var(--lp-muted);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  text-align: center;
  user-select: none;
}

.layout-prompt-editor .lp-hint {
  height: 14px;
  margin-top: 2px;
  overflow: hidden;
  color: var(--lp-muted);
  font-size: 10px;
  line-height: 14px;
  text-overflow: ellipsis;
  white-space: nowrap;
  user-select: none;
}

.layout-prompt-editor .lp-hint.lp-hint-error {
  color: #ff9a9a;
}

.layout-prompt-editor .lp-file-input {
  display: none;
}

.layout-prompt-editor .lp-list-host {
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  gap: 4px;
  min-height: 0;
  margin-top: 6px;
}

.layout-prompt-editor .lp-list-header {
  display: flex;
  flex: 0 0 var(--lp-list-header-height);
  align-items: center;
  justify-content: space-between;
  height: var(--lp-list-header-height);
  padding: 0 2px;
  user-select: none;
}

.layout-prompt-editor .lp-list-title {
  color: var(--lp-muted);
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.04em;
}

.layout-prompt-editor .lp-add {
  height: 20px;
  padding: 0 8px;
  border: 1px solid var(--lp-border);
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--lp-text);
  font: inherit;
  font-size: 11px;
  line-height: 1;
  cursor: pointer;
}

.layout-prompt-editor .lp-add:hover {
  border-color: var(--lp-accent);
  color: var(--lp-accent);
}

.layout-prompt-editor .lp-add:active {
  background: rgba(74, 158, 255, 0.18);
}

.layout-prompt-editor .lp-list {
  display: flex;
  flex: 0 1 auto;
  flex-direction: column;
  gap: var(--lp-list-gap);
  min-height: 0;
  max-height: calc(
    5 * var(--lp-list-row-height) + 4 * var(--lp-list-gap)
  );
  overflow-x: hidden;
  overflow-y: auto;
  scrollbar-color: var(--lp-border) transparent;
  scrollbar-width: thin;
}

.layout-prompt-editor .lp-list-empty {
  display: flex;
  flex: 0 0 var(--lp-list-row-height);
  align-items: center;
  justify-content: center;
  height: var(--lp-list-row-height);
  border: 1px dashed var(--lp-border);
  border-radius: 5px;
  color: var(--lp-muted);
  font-size: 11px;
}

.layout-prompt-editor .lp-row {
  display: flex;
  flex: 0 0 var(--lp-list-row-height);
  align-items: center;
  gap: 4px;
  height: var(--lp-list-row-height);
  padding: 0 4px;
  border: 1px solid var(--lp-border);
  border-radius: 5px;
  background: var(--lp-panel);
  cursor: pointer;
  user-select: none;
}

.layout-prompt-editor .lp-row:hover {
  border-color: var(--lp-muted);
}

.layout-prompt-editor .lp-row-selected,
.layout-prompt-editor .lp-row-selected:hover {
  border-color: var(--lp-box-color, var(--lp-accent));
  background: var(--lp-box-color-soft, rgba(74, 158, 255, 0.15));
  box-shadow: inset 0 0 0 1px var(--lp-box-color, var(--lp-accent));
}

.layout-prompt-editor .lp-chip {
  display: inline-flex;
  flex: 0 0 auto;
  align-items: center;
  justify-content: center;
  min-width: 22px;
  height: 18px;
  padding: 0 3px;
  border-radius: 4px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--lp-box-color, var(--lp-accent));
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.layout-prompt-editor .lp-field {
  height: 20px;
  min-width: 0;
  padding: 0 4px;
  border: 1px solid var(--lp-border);
  border-radius: 4px;
  background: #101014;
  color: var(--lp-text);
  font: inherit;
  font-size: 11px;
}

.layout-prompt-editor .lp-field:focus {
  border-color: var(--lp-accent);
  outline: none;
}

.layout-prompt-editor .lp-label {
  flex: 0 0 82px;
}

.layout-prompt-editor .lp-caption {
  flex: 1 1 60px;
}

.layout-prompt-editor .lp-text {
  flex: 1 1 60px;
}

.layout-prompt-editor .lp-row-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 1px;
}

.layout-prompt-editor .lp-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 20px;
  height: 20px;
  padding: 0;
  border: 1px solid transparent;
  border-radius: 4px;
  background: transparent;
  color: var(--lp-muted);
  font: inherit;
  font-size: 12px;
  line-height: 1;
  cursor: pointer;
}

.layout-prompt-editor .lp-icon:hover:not(:disabled) {
  border-color: var(--lp-border);
  color: var(--lp-text);
}

.layout-prompt-editor .lp-icon:disabled {
  opacity: 0.28;
  cursor: default;
}

.layout-prompt-editor .lp-icon.lp-delete:hover:not(:disabled) {
  border-color: rgba(255, 107, 107, 0.5);
  color: #ff7b7b;
}
`;

/** Add the editor stylesheet to the page exactly once. */
export function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = STYLES;
  document.head.appendChild(style);
}
