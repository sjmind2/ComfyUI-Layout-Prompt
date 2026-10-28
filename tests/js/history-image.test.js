import test from "node:test";
import assert from "node:assert/strict";
import { lastHistoryImage } from "../../web/history_image.js";

const image = (filename, type = "output", subfolder = "") => ({
  filename,
  type,
  subfolder,
});

test("returns null for missing or empty history", () => {
  assert.equal(lastHistoryImage(null), null);
  assert.equal(lastHistoryImage(undefined), null);
  assert.equal(lastHistoryImage({}), null);
  assert.equal(lastHistoryImage([]), null);
});

test("returns the newest image descriptor", () => {
  const history = {
    first: { outputs: { 9: { images: [image("old.png")] } } },
    second: { outputs: { 30: { images: [image("new.png", "temp")] } } },
  };
  assert.deepEqual(lastHistoryImage(history), {
    filename: "new.png",
    type: "temp",
    subfolder: "",
  });
});

test("falls back to the newest entry that has an image", () => {
  const history = {
    first: { outputs: { 30: { images: [image("kept.png")] } } },
    second: { outputs: { 33: { text: ["no image"] } } },
  };
  assert.deepEqual(lastHistoryImage(history), {
    filename: "kept.png",
    type: "output",
    subfolder: "",
  });
});

test("uses the last image when one output reports several", () => {
  const history = {
    only: { outputs: { 30: { images: [image("a.png"), image("b.png")] } } },
  };
  assert.equal(lastHistoryImage(history).filename, "b.png");
});

test("normalizes missing type and subfolder and skips invalid images", () => {
  const history = {
    only: {
      outputs: {
        1: { images: [{ filename: "plain.png" }] },
        2: { images: [{ filename: "" }, { type: "output" }] },
      },
    },
  };
  assert.deepEqual(lastHistoryImage(history), {
    filename: "plain.png",
    type: "temp",
    subfolder: "",
  });
});

test("accepts an array-shaped history", () => {
  const history = [
    { outputs: { 1: { images: [image("first.png")] } } },
    { outputs: { 2: { images: [image("last.png")] } } },
  ];
  assert.equal(lastHistoryImage(history).filename, "last.png");
});

test("skips malformed entries and keeps the subfolder", () => {
  const history = {
    a: null,
    b: { outputs: null },
    c: { outputs: { 1: { images: [image("sub.png", "output", "nested")] } } },
    d: { outputs: "not-an-object" },
  };
  assert.deepEqual(lastHistoryImage(history), {
    filename: "sub.png",
    type: "output",
    subfolder: "nested",
  });
});
