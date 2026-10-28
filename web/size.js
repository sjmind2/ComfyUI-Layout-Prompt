// Resolution math for the MOSS layout prompt node.
//
// Zero-dependency mirror of layout_core.py's ratio table and size formula,
// used by the frontend's live size preview.

export const ASPECT_RATIOS = Object.freeze({
  "1:1 (Square)": Object.freeze([1, 1]),
  "2:3 (Portrait Photo)": Object.freeze([2, 3]),
  "3:2 (Photo)": Object.freeze([3, 2]),
  "3:4 (Portrait Standard)": Object.freeze([3, 4]),
  "4:3 (Standard)": Object.freeze([4, 3]),
  "9:16 (Portrait Widescreen)": Object.freeze([9, 16]),
  "16:9 (Widescreen)": Object.freeze([16, 9]),
  "21:9 (Ultrawide)": Object.freeze([21, 9]),
});

/**
 * Round like Python's round(): nearest integer, ties to even.
 * @param {number} value
 * @returns {number}
 */
export function pythonRound(value) {
  const floor = Math.floor(value);
  const fraction = value - floor;
  if (fraction > 0.5) return floor + 1;
  if (fraction < 0.5) return floor;
  // Exact half: 0.5 goes to the even neighbour.
  return floor % 2 === 0 ? floor : floor + 1;
}

/**
 * Calculate width and height from aspect ratio and megapixel target.
 * @param {string} aspectRatio one of the ASPECT_RATIOS keys
 * @param {number} megapixels
 * @param {number} [multiple=16]
 * @returns {[number, number]}
 */
export function computeSize(aspectRatio, megapixels, multiple = 16) {
  if (!Object.prototype.hasOwnProperty.call(ASPECT_RATIOS, aspectRatio)) {
    throw new Error(`Unknown aspect ratio: ${aspectRatio}`);
  }
  const [wRatio, hRatio] = ASPECT_RATIOS[aspectRatio];
  const totalPixels = megapixels * 1024 * 1024;
  const scale = Math.sqrt(totalPixels / (wRatio * hRatio));
  const width = pythonRound((wRatio * scale) / multiple) * multiple;
  const height = pythonRound((hRatio * scale) / multiple) * multiple;
  return [width, height];
}
