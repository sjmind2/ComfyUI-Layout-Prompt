import test from "node:test";
import assert from "node:assert/strict";
import { isNodeSize } from "../../web/node_size.js";

test("accepts a plain [width, height] array", () => {
  assert.equal(isNodeSize([560, 634]), true);
});

test("accepts the Float64Array the current frontend stores", () => {
  assert.equal(isNodeSize(new Float64Array([560, 634])), true);
});

test("accepts a reactive-style proxy over a Float64Array", () => {
  // The frontend wraps node.size in a proxy that reads the raw typed array,
  // so Array.isArray and ArrayBuffer.isView both report false while length
  // and the indices stay readable.
  const size = new Proxy(new Float64Array([560, 634]), {
    get(target, property) {
      return Reflect.get(target, property, target);
    },
  });
  assert.equal(isNodeSize(size), true);
});

test("accepts a plain array-like object", () => {
  assert.equal(isNodeSize({ length: 2, 0: 560, 1: 634 }), true);
});

test("rejects missing, short, and non-finite sizes", () => {
  assert.equal(isNodeSize(null), false);
  assert.equal(isNodeSize(undefined), false);
  assert.equal(isNodeSize([560]), false);
  assert.equal(isNodeSize([Number.NaN, 634]), false);
  assert.equal(isNodeSize(["560", 634]), false);
});
