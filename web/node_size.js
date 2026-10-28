// Litegraph node sizes are plain arrays in the legacy renderer, but the
// current Vue node renderer stores `node.size` as a Float64Array wrapped in a
// reactive proxy. Array.isArray() and ArrayBuffer.isView() both return false
// for that proxy, so size handling must use duck typing.

/**
 * True for a litegraph node size or computeSize result: a two-or-more item
 * array-like holding finite numbers.
 * @param {unknown} value
 * @returns {boolean}
 */
export function isNodeSize(value) {
  return Boolean(
    value &&
      typeof value.length === "number" &&
      value.length >= 2 &&
      Number.isFinite(value[0]) &&
      Number.isFinite(value[1]),
  );
}
