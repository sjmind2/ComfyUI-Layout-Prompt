// Stylesheet for the Layout Prompt Builder editor.
//
// Injected once per page from layout_prompt.js. Later tasks extend this
// string with canvas, toolbar, and box-list rules.

const STYLE_ID = "layout-prompt-styles";

const STYLES = `
.layout-prompt-editor {
  --lp-background: #141418;
  --lp-panel: #1c1c22;
  --lp-border: #34343d;
  --lp-text: #e2e2e8;
  --lp-muted: #8e8e9a;
  --lp-accent: #4a9eff;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  padding: 2px 4px 4px;
  overflow: hidden;
  color: var(--lp-text);
  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
  font-size: 12px;
}

.layout-prompt-editor *,
.layout-prompt-editor *::before,
.layout-prompt-editor *::after {
  box-sizing: border-box;
}

.lp-root {
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  min-height: 0;
}

.lp-placeholder {
  display: flex;
  flex: 1 1 auto;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  padding: 16px;
  border: 1px dashed var(--lp-border);
  border-radius: 6px;
  background:
    radial-gradient(
      circle at 50% 35%,
      rgba(74, 158, 255, 0.08),
      transparent 55%
    ),
    var(--lp-panel);
  text-align: center;
  user-select: none;
}

.lp-placeholder-title {
  font-size: 13px;
  font-weight: 600;
  letter-spacing: 0.02em;
}

.lp-placeholder-hint {
  color: var(--lp-muted);
  line-height: 1.4;
}

.lp-placeholder-count {
  margin-top: 2px;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  color: var(--lp-muted);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 11px;
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
