// Immutable layout state and undo/redo history for the editor.
//
// DOM-free and ComfyUI-free. Every mutation returns a new state object;
// history snapshots can safely share box objects because states never
// mutate in place.

import { normalizeBbox } from "./geometry.js";

const STATE_VERSION = 1;
const DEFAULT_LABEL = "character";
const DUPLICATE_OFFSET = 30;

/**
 * @param {string} id
 * @param {number[]} bbox 0-1000 yxyx coordinates
 * @param {{label?: string, caption?: string, text?: string}} [fields]
 * @returns {{id: string, bbox: number[], label: string, caption: string, text: string}}
 */
export function createBox(
  id,
  bbox,
  { label = DEFAULT_LABEL, caption = "", text = "" } = {},
) {
  return { id, bbox: normalizeBbox(bbox), label, caption, text };
}

/** @returns {{version: number, boxes: object[], selectedId: string | null}} */
export function createState() {
  return { version: STATE_VERSION, boxes: [], selectedId: null };
}

export function addBox(state, box) {
  return { ...state, boxes: [...state.boxes, box], selectedId: box.id };
}

export function updateBox(state, id, patch) {
  const boxes = state.boxes.map((box) => {
    if (box.id !== id) return box;
    const next = { ...box, ...patch, id: box.id };
    if (patch.bbox !== undefined) next.bbox = normalizeBbox(patch.bbox);
    return next;
  });
  return { ...state, boxes };
}

export function deleteBox(state, id) {
  const index = state.boxes.findIndex((box) => box.id === id);
  if (index === -1) return { ...state, boxes: [...state.boxes] };

  const boxes = state.boxes.filter((_, boxIndex) => boxIndex !== index);
  let selectedId = state.selectedId;
  if (selectedId === id) {
    if (index > 0) selectedId = boxes[index - 1].id;
    else selectedId = boxes.length > 0 ? boxes[0].id : null;
  }
  return { ...state, boxes, selectedId };
}

export function duplicateBox(state, id, newId, offset = DUPLICATE_OFFSET) {
  const source = state.boxes.find((box) => box.id === id);
  if (!source) return { ...state, boxes: [...state.boxes] };

  const copy = {
    ...source,
    id: newId,
    bbox: normalizeBbox(source.bbox.map((value) => value + offset)),
  };
  return { ...state, boxes: [...state.boxes, copy], selectedId: newId };
}

export function moveBox(state, id, delta) {
  const index = state.boxes.findIndex((box) => box.id === id);
  if (index === -1) return { ...state, boxes: [...state.boxes] };

  const target = Math.max(0, Math.min(state.boxes.length - 1, index + delta));
  if (target === index) return { ...state, boxes: [...state.boxes] };

  const boxes = [...state.boxes];
  const [moved] = boxes.splice(index, 1);
  boxes.splice(target, 0, moved);
  return { ...state, boxes };
}

export function serializeState(state) {
  return JSON.stringify({ version: state.version, boxes: state.boxes });
}

function isValidBox(raw) {
  return (
    raw !== null &&
    typeof raw === "object" &&
    typeof raw.id === "string" &&
    Array.isArray(raw.bbox) &&
    raw.bbox.length === 4 &&
    raw.bbox.every(
      (value) => typeof value === "number" && Number.isFinite(value),
    )
  );
}

export function deserializeState(json) {
  let data;
  try {
    data = JSON.parse(json);
  } catch {
    return createState();
  }
  if (
    data === null ||
    typeof data !== "object" ||
    data.version !== STATE_VERSION ||
    !Array.isArray(data.boxes) ||
    !data.boxes.every(isValidBox)
  ) {
    return createState();
  }

  const boxes = data.boxes.map((raw) =>
    createBox(raw.id, raw.bbox, {
      label: typeof raw.label === "string" ? raw.label : DEFAULT_LABEL,
      caption: typeof raw.caption === "string" ? raw.caption : "",
      text: typeof raw.text === "string" ? raw.text : "",
    }),
  );
  return { version: STATE_VERSION, boxes, selectedId: null };
}

export function createHistory(limit = 50) {
  return { limit, past: [], future: [] };
}

export function pushHistory(history, state) {
  const past = [...history.past, state];
  if (past.length > history.limit) {
    past.splice(0, past.length - history.limit);
  }
  return { limit: history.limit, past, future: [] };
}

export function undo(history, state) {
  if (history.past.length === 0) return { state, history };
  return {
    state: history.past[history.past.length - 1],
    history: {
      limit: history.limit,
      past: history.past.slice(0, -1),
      future: [...history.future, state],
    },
  };
}

export function redo(history, state) {
  if (history.future.length === 0) return { state, history };
  return {
    state: history.future[history.future.length - 1],
    history: {
      limit: history.limit,
      past: [...history.past, state],
      future: history.future.slice(0, -1),
    },
  };
}
