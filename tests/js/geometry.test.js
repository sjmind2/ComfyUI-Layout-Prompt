import test from "node:test";
import assert from "node:assert/strict";
import { normalizeBbox, bboxToRect, rectToBbox, hitTest } from "../../web/geometry.js";

test("normalize sorts and clamps", () => {
  assert.deepEqual(normalizeBbox([400, 600, 100, 200]), [100, 200, 400, 600]);
  assert.deepEqual(normalizeBbox([-10, 0, 500, 1200]), [0, 0, 500, 1000]);
});
test("bbox to rect", () => {
  assert.deepEqual(bboxToRect([100, 200, 400, 600], 800, 600), { x: 160, y: 60, w: 320, h: 180 });
});
test("rect to bbox round-trips", () => {
  assert.deepEqual(rectToBbox(160, 60, 320, 180, 800, 600), [100, 200, 400, 600]);
});
test("hitTest topmost wins", () => {
  const boxes = [{ id: "a", bbox: [0, 0, 500, 500] }, { id: "b", bbox: [100, 100, 600, 600] }];
  assert.deepEqual(hitTest(boxes, 200, 200, 1000, 1000), { id: "b", part: "move" });
});
test("hitTest corner handle", () => {
  const boxes = [{ id: "b", bbox: [100, 100, 600, 600] }];
  assert.deepEqual(hitTest(boxes, 100, 100, 1000, 1000), { id: "b", part: "tl" });
});
test("hitTest outside is null", () => {
  assert.equal(hitTest([{ id: "b", bbox: [100, 100, 600, 600] }], 900, 900, 1000, 1000), null);
});
test("tiny box center press moves; corner press still resizes", () => {
  // 10x10 display px on a 1000 px canvas: every point is within the 6 px
  // handle radius, so the center must be preferred for moving.
  const boxes = [{ id: "tiny", bbox: [495, 495, 505, 505] }];
  assert.deepEqual(hitTest(boxes, 500, 500, 1000, 1000), { id: "tiny", part: "move" });
  assert.deepEqual(hitTest(boxes, 495, 495, 1000, 1000), { id: "tiny", part: "tl" });
  // The opposite corner still resizes (an adjacent edge handle may win the
  // tie, but the press is never treated as a move).
  assert.notEqual(hitTest(boxes, 505, 505, 1000, 1000).part, "move");
});
