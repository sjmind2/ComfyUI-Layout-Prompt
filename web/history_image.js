// Recover the newest generated image from a raw ComfyUI /history response.
//
// The server returns history entries in completion order (oldest first; see
// PromptQueue.get_history with max_items), so walk backwards and take the last
// valid image of the newest entry that has one. The returned descriptor
// matches the executed event's {filename, type, subfolder} shape.

/** @param {unknown} image */
function normalizeImage(image) {
  if (!image || typeof image !== "object") return null;
  if (typeof image.filename !== "string" || !image.filename) return null;
  return {
    filename: image.filename,
    type: typeof image.type === "string" && image.type ? image.type : "temp",
    subfolder: typeof image.subfolder === "string" ? image.subfolder : "",
  };
}

/**
 * Newest image descriptor in a /history response, or null.
 * @param {unknown} history raw response (object keyed by prompt id, or an
 *   array of entries)
 * @returns {{filename: string, type: string, subfolder: string} | null}
 */
export function lastHistoryImage(history) {
  if (!history || typeof history !== "object") return null;

  const entries = Array.isArray(history) ? history : Object.values(history);
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const outputs = entries[index]?.outputs;
    if (!outputs || typeof outputs !== "object") continue;

    let ref = null;
    for (const output of Object.values(outputs)) {
      const images = output?.images;
      if (!Array.isArray(images) || images.length === 0) continue;
      const normalized = normalizeImage(images[images.length - 1]);
      if (normalized) ref = normalized;
    }
    if (ref) return ref;
  }
  return null;
}
