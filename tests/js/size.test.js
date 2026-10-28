import test from "node:test";
import assert from "node:assert/strict";
import { computeSize, pythonRound, ASPECT_RATIOS } from "../../web/size.js";

test("square 1 MP", () => assert.deepEqual(computeSize("1:1 (Square)", 1.0), [1024, 1024]));
test("portrait photo 1 MP", () => assert.deepEqual(computeSize("2:3 (Portrait Photo)", 1.0), [832, 1248]));
test("widescreen 1 MP", () => assert.deepEqual(computeSize("16:9 (Widescreen)", 1.0), [1360, 768]));
test("ultrawide 1 MP", () => assert.deepEqual(computeSize("21:9 (Ultrawide)", 1.0), [1568, 672]));
test("square 1.5 MP", () => assert.deepEqual(computeSize("1:1 (Square)", 1.5), [1248, 1248]));
test("all results are multiples of 16", () => {
  for (const ratio of Object.keys(ASPECT_RATIOS)) {
    for (const mp of [0.1, 0.5, 1.0, 1.5, 2.0, 4.0]) {
      const [w, h] = computeSize(ratio, mp);
      assert.equal(w % 16, 0);
      assert.equal(h % 16, 0);
    }
  }
});
test("bankers rounding", () => {
  assert.equal(pythonRound(2.5), 2);
  assert.equal(pythonRound(3.5), 4);
  assert.equal(pythonRound(1.5), 2);
});
test("unknown ratio throws", () => assert.throws(() => computeSize("5:4", 1.0)));
