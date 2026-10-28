import test from "node:test";
import assert from "node:assert/strict";
import { paintOrder } from "../../web/canvas.js";

const boxes = [
  { id: "a", bbox: [0, 0, 100, 100] },
  { id: "b", bbox: [100, 100, 200, 200] },
  { id: "c", bbox: [200, 200, 300, 300] },
];

test("paintOrder keeps the unselected list order", () => {
  assert.deepEqual(
    paintOrder(boxes, null).map((box) => box.id),
    ["a", "b", "c"],
  );
  assert.deepEqual(
    paintOrder(boxes, "missing").map((box) => box.id),
    ["a", "b", "c"],
  );
});

test("paintOrder moves only the selected box to the end", () => {
  assert.deepEqual(
    paintOrder(boxes, "b").map((box) => box.id),
    ["a", "c", "b"],
  );
  // The selected box is painted exactly once.
  assert.deepEqual(
    paintOrder(boxes, "a").map((box) => box.id),
    ["b", "c", "a"],
  );
});
