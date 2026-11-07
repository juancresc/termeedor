import assert from "node:assert/strict";
import { test } from "node:test";
import { MiniElement, installDom } from "./support/miniDom.js";

installDom();
globalThis.matchMedia = () => ({ matches: false });
const { renderRows, slideNextRender } = await import("../src/slide.js");

/** `seen` differs from `offsetLeft` while a node is still sliding. */
class FakeNode extends MiniElement {
  seen = 0;
  running = [];
  getBoundingClientRect() { return { left: this.seen }; }
  getAnimations() { return this.running; }
  animate(frames) { this.animations.push(frames); }
}

function fakeNode(key, place, seen = place) {
  const node = new FakeNode();
  node.dataset.slideKey = key;
  node.offsetLeft = place;
  node.seen = seen;
  return node;
}

function fakeRow(nodes) {
  const row = new FakeNode();
  row.isRoot = true;
  row.append(...nodes);
  return row;
}

/** Renders [key, place] pairs: the row's nodes are updated, and layout then puts each at its place. Returns the nodes by key. */
function renderRow(row, places, enteringKey) {
  const layout = () => {
    for (const [key, place] of places) {
      const node = row.children.find((child) => child.dataset.slideKey === key);
      if (node.offsetLeft !== place) node.seen = place;
      node.offsetLeft = place;
    }
  };
  const nodes = places.map(([key, place]) => fakeNode(key, place));
  renderRows([{ row, nodes, enteringKey }], layout);
  return Object.fromEntries(row.children.map((child) => [child.dataset.slideKey, child]));
}

test("a reorder slides the items that moved, from where they were seen", () => {
  const row = fakeRow([fakeNode("a", 0), fakeNode("b", 100)]);
  slideNextRender();
  const { a, b } = renderRow(row, [["b", 0], ["a", 100]]);
  assert.equal(a.animations[0][0].transform, "translateX(-100px)");
  assert.equal(b.animations[0][0].transform, "translateX(100px)");
});

test("an item still sliding from the last reorder stays put if this one doesn't move it", () => {
  const row = fakeRow([fakeNode("sliding", 100, 140), fakeNode("a", 200), fakeNode("b", 300)]);
  slideNextRender();
  const { sliding, a, b } = renderRow(row, [["sliding", 100], ["b", 200], ["a", 300]]);
  assert.equal(sliding.animations.length, 0);
  assert.equal(a.animations.length, 1);
  assert.equal(b.animations.length, 1);
});

test("an item moved again while sliding starts from where it was seen, and its last slide stops", () => {
  const item = fakeNode("a", 100, 140);
  let cancelled = 0;
  item.running = [{ cancel() { cancelled++; item.seen = item.offsetLeft; } }];
  const row = fakeRow([item, fakeNode("b", 200)]);
  slideNextRender();
  const { a } = renderRow(row, [["b", 100], ["a", 200]]);
  assert.equal(cancelled, 1);
  assert.equal(a.animations[0][0].transform, "translateX(-60px)");
});

test("nothing animates on an ordinary render", async () => {
  await Promise.resolve(); // the reorder's render is over
  const row = fakeRow([fakeNode("a", 0)]);
  const { a } = renderRow(row, [["a", 50]]);
  assert.equal(a.animations.length, 0);
});

test("a new tab comes in, tabs it pushes aside slide, and the rest stay", () => {
  const row = fakeRow([fakeNode("a", 0), fakeNode("b", 100)]);
  const { a, new: fresh, b } = renderRow(row, [["a", 0], ["new", 100], ["b", 200]], "new");
  assert.equal(a.animations.length, 0);
  assert.equal(fresh.animations[0][0].opacity, 0);
  assert.equal(b.animations[0][0].transform, "translateX(-100px)");
});

test("opening a tab in another group only brings that tab in", () => {
  const row = fakeRow([fakeNode("other", 0)]);
  const { new: fresh, sibling } = renderRow(row, [["sibling", 0], ["new", 100]], "new");
  assert.equal(sibling.animations.length, 0);
  assert.equal(fresh.animations.length, 1);
});

test("places are read after the rows are arranged, so arranging alone doesn't animate", () => {
  const row = fakeRow([fakeNode("a", 40)]);
  slideNextRender();
  const { a } = renderRow(row, [["a", 40]]);
  assert.equal(a.animations.length, 0);
});

test("a change that slides the row fades in what it newly shows", () => {
  const row = fakeRow([fakeNode("a", 0)]);
  slideNextRender();
  const { a, shown } = renderRow(row, [["shown", 0], ["a", 50]]);
  assert.equal(shown.animations[0][0].opacity, 0);
  assert.ok(a.animations[0][0].transform);
});
