import assert from "node:assert/strict";
import { test } from "node:test";

globalThis.matchMedia = () => ({ matches: false });
const { renderRows, slideNextRender } = await import("../src/slide.js");
const renderRow = (row, nodes, enteringKey) => renderRows([{ row, nodes, enteringKey }]);

/** `seen` differs from `place` while a node is still sliding. */
function fakeNode(key, place, seen = place) {
  const node = {
    dataset: { slideKey: key },
    offsetLeft: place,
    getBoundingClientRect: () => ({ left: seen }),
    animations: [],
    animate(frames) { node.animations.push(frames); },
  };
  return node;
}

function fakeRow(nodes) {
  const row = {
    nodes,
    querySelectorAll: () => row.nodes,
    replaceChildren(...next) { row.nodes = next; },
  };
  return row;
}

test("a reorder slides the items that moved, from where they were seen", () => {
  const row = fakeRow([fakeNode("a", 0), fakeNode("b", 100)]);
  const [a, b] = [fakeNode("a", 100), fakeNode("b", 0)];
  slideNextRender();
  renderRow(row, [b, a]);
  assert.equal(a.animations[0][0].transform, "translateX(-100px)");
  assert.equal(b.animations[0][0].transform, "translateX(100px)");
});

test("an item still sliding from the last reorder stays put if this one doesn't move it", () => {
  const row = fakeRow([fakeNode("sliding", 100, 140), fakeNode("a", 200), fakeNode("b", 300)]);
  const [sliding, a, b] = [fakeNode("sliding", 100), fakeNode("a", 300), fakeNode("b", 200)];
  slideNextRender();
  renderRow(row, [sliding, b, a]);
  assert.equal(sliding.animations.length, 0);
  assert.equal(a.animations.length, 1);
  assert.equal(b.animations.length, 1);
});

test("nothing animates on an ordinary render", async () => {
  await Promise.resolve(); // the reorder's render is over
  const row = fakeRow([fakeNode("a", 0)]);
  const moved = fakeNode("a", 50);
  renderRow(row, [moved]);
  assert.equal(moved.animations.length, 0);
});

test("a new tab comes in, tabs it pushes aside slide, and the rest stay", () => {
  const row = fakeRow([fakeNode("a", 0), fakeNode("b", 100)]);
  const [a, fresh, b] = [fakeNode("a", 0), fakeNode("new", 100), fakeNode("b", 200)];
  renderRow(row, [a, fresh, b], "new");
  assert.equal(a.animations.length, 0);
  assert.equal(fresh.animations[0][0].opacity, 0);
  assert.equal(b.animations[0][0].transform, "translateX(-100px)");
});

test("opening a tab in another group only brings that tab in", () => {
  const row = fakeRow([fakeNode("other", 0)]);
  const [fresh, sibling] = [fakeNode("new", 100), fakeNode("sibling", 0)];
  renderRow(row, [sibling, fresh], "new");
  assert.equal(sibling.animations.length, 0);
  assert.equal(fresh.animations.length, 1);
});

test("places are read after the rows are arranged, so arranging alone doesn't animate", () => {
  const row = fakeRow([fakeNode("a", 40)]);
  const a = fakeNode("a", 0);
  slideNextRender();
  renderRows([{ row, nodes: [a] }], () => { a.offsetLeft = 40; });
  assert.equal(a.animations.length, 0);
});

test("a change that slides the row fades in what it newly shows", () => {
  const row = fakeRow([fakeNode("a", 0)]);
  const [a, shown] = [fakeNode("a", 50), fakeNode("shown", 0)];
  slideNextRender();
  renderRow(row, [shown, a]);
  assert.equal(shown.animations[0][0].opacity, 0);
  assert.ok(a.animations[0][0].transform);
});
