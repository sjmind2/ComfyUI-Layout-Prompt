import test from "node:test";
import assert from "node:assert/strict";
import { createBox, createState, addBox, updateBox, deleteBox, duplicateBox,
         moveBox, serializeState, deserializeState, createHistory, pushHistory,
         undo, redo } from "../../web/state.js";

const box = (id, bbox) => createBox(id, bbox);

test("add and select", () => {
  const s = addBox(createState(), box("b1", [100, 100, 200, 200]));
  assert.equal(s.boxes.length, 1);
  assert.equal(s.selectedId, "b1");
});
test("update", () => {
  let s = addBox(createState(), box("b1", [100, 100, 200, 200]));
  s = updateBox(s, "b1", { caption: "arm", label: "text", text: "hi" });
  assert.equal(s.boxes[0].caption, "arm");
  assert.equal(s.boxes[0].label, "text");
});
test("delete selects neighbor", () => {
  let s = addBox(createState(), box("b1", [0, 0, 100, 100]));
  s = addBox(s, box("b2", [100, 100, 200, 200]));
  s = deleteBox(s, "b2");
  assert.equal(s.boxes.length, 1);
  assert.equal(s.selectedId, "b1");
});
test("duplicate translates the copy and keeps its size", () => {
  let s = addBox(createState(), box("b1", [100, 100, 200, 200]));
  s = duplicateBox(s, "b1", "b2", 30);
  assert.deepEqual(s.boxes[1].bbox, [130, 130, 230, 230]);
  assert.equal(s.selectedId, "b2");
});
test("duplicate near the bottom-right edge shifts opposite, keeping size", () => {
  let s = addBox(createState(), box("b1", [950, 950, 1000, 1000]));
  s = duplicateBox(s, "b1", "b2", 30);
  assert.deepEqual(s.boxes[1].bbox, [920, 920, 970, 970]);
});
test("duplicate of an edge box smaller than the offset stays full-size", () => {
  let s = addBox(createState(), box("b1", [990, 990, 1000, 1000]));
  s = duplicateBox(s, "b1", "b2", 30);
  assert.deepEqual(s.boxes[1].bbox, [960, 960, 970, 970]);
});
test("duplicate at full frame is unchanged", () => {
  let s = addBox(createState(), box("b1", [0, 0, 1000, 1000]));
  s = duplicateBox(s, "b1", "b2", 30);
  assert.deepEqual(s.boxes[1].bbox, [0, 0, 1000, 1000]);
});
test("duplicate translates each axis independently", () => {
  let s = addBox(createState(), box("b1", [950, 0, 1000, 1000]));
  s = duplicateBox(s, "b1", "b2", 30);
  assert.deepEqual(s.boxes[1].bbox, [920, 0, 970, 1000]);
});
test("move order", () => {
  let s = addBox(createState(), box("b1", [0, 0, 100, 100]));
  s = addBox(s, box("b2", [100, 100, 200, 200]));
  s = moveBox(s, "b2", -1);
  assert.deepEqual(s.boxes.map(b => b.id), ["b2", "b1"]);
});
test("serialize omits selection", () => {
  let s = addBox(createState(), box("b1", [0, 0, 100, 100]));
  assert.deepEqual(JSON.parse(serializeState(s)), { version: 1, boxes: s.boxes });
  assert.equal(serializeState(s).includes("selectedId"), false);
});
test("deserialize invalid returns empty", () => {
  assert.deepEqual(deserializeState("nope"), createState());
});
test("undo and redo", () => {
  let s = createState();
  let h = createHistory(50);
  h = pushHistory(h, s);
  s = addBox(s, box("b1", [0, 0, 100, 100]));
  let r = undo(h, s);
  assert.deepEqual(r.state, createState());
  r = redo(r.history, r.state);
  assert.equal(r.state.boxes.length, 1);
});
