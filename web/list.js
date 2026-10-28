// Single-column box list for the Layout Prompt Builder editor.
//
// Pure DOM renderer: the caller owns the layout state and applies every
// change through the handler callbacks. Structural changes (add, delete,
// reorder, label) re-render the rows; caption/text edits are reported as
// input events so the editor can commit them quietly without a rebuild.
// Row controls keep their editing keys local so graph shortcuts never fire
// while the user is typing or using a row button.

export const LABELS = Object.freeze(["character", "object", "text"]);

/** Label colors, shared with the canvas renderer added in a later task. */
export const LABEL_COLORS = Object.freeze({
  character: "#4a9eff",
  object: "#f0a030",
  text: "#c77dff",
});

const FALLBACK_LABEL = "object";
const ROW_NUMBER_PAD = 2;
const FIELD_CLASSES = Object.freeze(["lp-label", "lp-caption", "lp-text"]);

// Keys a focused row owns: its own editing/navigation keys plus the editor's
// shortcuts. They are stopped at the row so the graph cannot also delete a
// node, pan, duplicate, or undo the workflow while the user is in the list.
// Text inputs keep native editing and native undo.
const LOCAL_ROW_KEYS = Object.freeze([
  "Delete",
  "Backspace",
  "Escape",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  " ",
]);
const LOCAL_ROW_CTRL_KEYS = Object.freeze(["z", "d"]);

function isLocalRowKey(event) {
  if (LOCAL_ROW_KEYS.includes(event.key)) return true;
  if (event.code === "Space") return true;
  if (!(event.ctrlKey || event.metaKey)) return false;
  const key = typeof event.key === "string" ? event.key.toLowerCase() : "";
  return LOCAL_ROW_CTRL_KEYS.includes(key);
}

/** Stop keys a focused row owns from bubbling to the graph. */
function keepRowKeysLocal(row) {
  const stop = (event) => {
    if (isLocalRowKey(event)) event.stopPropagation();
  };
  row.addEventListener("keydown", stop);
  row.addEventListener("keyup", stop);
}

function displayLabel(box) {
  return LABELS.includes(box.label) ? box.label : FALLBACK_LABEL;
}

function labelColor(label) {
  return LABEL_COLORS[label] ?? LABEL_COLORS[FALLBACK_LABEL];
}

/**
 * @param {string} symbol
 * @param {string} title
 * @param {() => void} onClick
 * @param {boolean} [disabled=false]
 * @param {string} [extraClass=""]
 */
function createIconButton(symbol, title, onClick, disabled = false, extraClass = "") {
  const button = document.createElement("button");
  button.type = "button";
  button.className = extraClass ? `lp-icon ${extraClass}` : "lp-icon";
  button.textContent = symbol;
  button.title = title;
  button.setAttribute("aria-label", title);
  button.disabled = disabled;
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    if (!button.disabled) onClick();
  });
  return button;
}

/**
 * Build one editable row for a box.
 * @param {object} box
 * @param {number} index
 * @param {number} total
 * @param {boolean} selected
 * @param {object} handlers
 * @returns {HTMLDivElement}
 */
function createRow(box, index, total, selected, handlers) {
  const label = displayLabel(box);
  const color = labelColor(label);
  const rowNumber = index + 1;

  const row = document.createElement("div");
  row.className = selected ? "lp-row lp-row-selected" : "lp-row";
  row.dataset.id = box.id;
  row.setAttribute("role", "listitem");
  row.style.setProperty("--lp-box-color", color);
  row.style.setProperty("--lp-box-color-soft", `${color}26`);

  const chip = document.createElement("span");
  chip.className = "lp-chip";
  chip.textContent = String(rowNumber).padStart(ROW_NUMBER_PAD, "0");
  chip.setAttribute("aria-hidden", "true");

  const labelSelect = document.createElement("select");
  labelSelect.className = "lp-field lp-label";
  labelSelect.setAttribute("aria-label", `Box ${rowNumber} label`);
  for (const optionName of LABELS) {
    const option = document.createElement("option");
    option.value = optionName;
    option.textContent = optionName;
    labelSelect.append(option);
  }
  labelSelect.value = label;
  labelSelect.addEventListener("change", () => {
    handlers.onUpdate?.(box.id, { label: labelSelect.value });
  });

  const caption = document.createElement("input");
  caption.type = "text";
  caption.className = "lp-field lp-caption";
  caption.value = box.caption ?? "";
  caption.placeholder = "caption";
  caption.autocomplete = "off";
  caption.setAttribute("aria-label", `Box ${rowNumber} caption`);
  caption.addEventListener("input", () => {
    handlers.onInput?.(box.id, { caption: caption.value });
  });
  caption.addEventListener("blur", () => {
    handlers.onUpdate?.(box.id, { caption: caption.value });
  });

  row.append(chip, labelSelect, caption);

  if (label === "text") {
    const text = document.createElement("input");
    text.type = "text";
    text.className = "lp-field lp-text";
    text.value = box.text ?? "";
    text.placeholder = "text";
    text.autocomplete = "off";
    text.setAttribute("aria-label", `Box ${rowNumber} text`);
    text.addEventListener("input", () => {
      handlers.onInput?.(box.id, { text: text.value });
    });
    text.addEventListener("blur", () => {
      handlers.onUpdate?.(box.id, { text: text.value });
    });
    row.append(text);
  }

  const actions = document.createElement("div");
  actions.className = "lp-row-actions";
  actions.append(
    createIconButton("⧉", `Duplicate box ${rowNumber}`, () => {
      handlers.onDuplicate?.(box.id);
    }),
    createIconButton(
      "↑",
      `Move box ${rowNumber} up`,
      () => handlers.onMove?.(box.id, -1),
      index === 0,
    ),
    createIconButton(
      "↓",
      `Move box ${rowNumber} down`,
      () => handlers.onMove?.(box.id, 1),
      index === total - 1,
    ),
    createIconButton(
      "✕",
      `Delete box ${rowNumber}`,
      () => handlers.onDelete?.(box.id),
      false,
      "lp-delete",
    ),
  );
  row.append(actions);

  // Clicking the row body selects it; interacting with a control does not.
  row.addEventListener("click", (event) => {
    if (event.target.closest("button, input, select, textarea")) return;
    handlers.onSelect?.(box.id);
  });

  keepRowKeysLocal(row);

  return row;
}

/**
 * Render the box list into a container.
 * @param {HTMLElement} container
 * @param {{boxes: object[], selectedId: string | null}} state
 * @param {{onSelect?: Function, onInput?: Function, onUpdate?: Function,
 *          onDelete?: Function, onDuplicate?: Function, onMove?: Function,
 *          onAdd?: Function}} handlers
 * @returns {void}
 */
export function renderBoxList(container, state, handlers = {}) {
  const boxes = Array.isArray(state?.boxes) ? state.boxes : [];
  const selectedId = state?.selectedId ?? null;

  const header = document.createElement("div");
  header.className = "lp-list-header";

  const title = document.createElement("span");
  title.className = "lp-list-title";
  title.textContent = `boxes · ${boxes.length}`;

  const addButton = document.createElement("button");
  addButton.type = "button";
  addButton.className = "lp-add";
  addButton.textContent = "+ add";
  addButton.title = "Add a box";
  addButton.addEventListener("click", (event) => {
    event.stopPropagation();
    handlers.onAdd?.();
  });
  header.append(title, addButton);

  const list = document.createElement("div");
  list.className = "lp-list";
  list.setAttribute("role", "list");

  if (boxes.length === 0) {
    const empty = document.createElement("div");
    empty.className = "lp-list-empty";
    empty.textContent = "No boxes yet — use + add.";
    list.append(empty);
  } else {
    boxes.forEach((box, index) => {
      list.append(createRow(box, index, boxes.length, box.id === selectedId, handlers));
    });
  }

  container.replaceChildren(header, list);
}

/**
 * Update the selected-row styling without rebuilding the list.
 * @param {HTMLElement} container
 * @param {string | null} selectedId
 * @returns {void}
 */
export function updateRowSelection(container, selectedId) {
  for (const row of container.querySelectorAll(".lp-row")) {
    if (row.dataset.id === selectedId) {
      row.classList.add("lp-row-selected");
    } else {
      row.classList.remove("lp-row-selected");
    }
  }
}

/**
 * Scroll the row for a box into view. Used when selection comes from the
 * canvas rather than the list.
 * @param {HTMLElement} container
 * @param {string | null} selectedId
 * @returns {void}
 */
export function scrollRowIntoView(container, selectedId) {
  if (!container || !selectedId) return;

  const row = [...container.querySelectorAll(".lp-row")].find(
    (candidate) => candidate.dataset.id === selectedId,
  );
  if (!row) return;

  // "nearest" leaves an already-visible row alone and only scrolls when the
  // selected row is outside the five-row viewport.
  row.scrollIntoView?.({ block: "nearest", inline: "nearest" });
}

/**
 * Capture the field focus and text selection before a re-render.
 * @param {HTMLElement} host
 * @returns {{id: string, fieldClass: string, start: number | null,
 *            end: number | null} | null}
 */
export function captureFieldFocus(host) {
  const active = document.activeElement;
  if (!active || typeof active.closest !== "function") return null;

  const row = active.closest(".lp-row");
  if (!row || !host.contains(row)) return null;

  const fieldClass = FIELD_CLASSES.find((name) =>
    active.classList.contains(name),
  );
  if (!fieldClass) return null;

  return {
    id: row.dataset.id,
    fieldClass,
    start: typeof active.selectionStart === "number" ? active.selectionStart : null,
    end: typeof active.selectionEnd === "number" ? active.selectionEnd : null,
  };
}

/**
 * Restore focus and text selection captured by captureFieldFocus().
 * @param {HTMLElement} host
 * @param {ReturnType<typeof captureFieldFocus>} focus
 */
export function restoreFieldFocus(host, focus) {
  if (!focus) return;

  const row = [...host.querySelectorAll(".lp-row")].find(
    (candidate) => candidate.dataset.id === focus.id,
  );
  const field = row?.querySelector(`.${focus.fieldClass}`);
  if (!field) return;

  field.focus();
  if (typeof field.setSelectionRange !== "function") return;

  const start = focus.start ?? field.value.length;
  const end = focus.end ?? start;
  try {
    field.setSelectionRange(start, end);
  } catch {
    // Not every input type supports text selection ranges.
  }
}
