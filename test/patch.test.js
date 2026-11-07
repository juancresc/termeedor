import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { installDom, mutationsDuring } from "./support/miniDom.js";

installDom();
const { patchChildren } = await import("../src/patch.js");

function node(tag, className, ...children) {
  const made = document.createElement(tag);
  made.className = className;
  for (const child of children) made.append(typeof child === "string" ? document.createTextNode(child) : child);
  return made;
}

function keyed(key, ...children) {
  const made = node("div", "row", ...children);
  made.dataset.slideKey = key;
  return made;
}

let root;
beforeEach(() => {
  root = document.getElementById("root");
  root.replaceChildren();
  document.activeElement = document.body;
});

test("the same content changes nothing and keeps every node", () => {
  patchChildren(root, [keyed("a", node("span", "name", "one")), keyed("b", node("span", "name", "two"))]);
  const before = root.all();
  const mutations = mutationsDuring(() => {
    patchChildren(root, [keyed("a", node("span", "name", "one")), keyed("b", node("span", "name", "two"))]);
  });
  assert.equal(mutations, 0);
  assert.deepEqual(root.all(), before);
});

test("what differs is updated in place, including the current handlers", () => {
  patchChildren(root, [keyed("a", node("span", "name", "one"))]);
  const row = root.firstChild;
  const newer = keyed("a", node("span", "name", "uno"));
  newer.className = "row active";
  newer.onclick = () => "newer";
  newer.draggable = true;
  newer.style.setProperty("--group-color", "red");
  patchChildren(root, [newer]);

  assert.equal(root.firstChild, row);
  assert.equal(row.textContent, "uno");
  assert.equal(row.className, "row active");
  assert.equal(row.onclick(), "newer");
  assert.equal(row.draggable, true);
  assert.match(row.style.cssText, /--group-color: red/);
});

test("rows follow their keys: one goes, one comes, one moves, with the fewest changes", () => {
  patchChildren(root, [keyed("a"), keyed("b"), keyed("c")]);
  const [, b, c] = root.children;
  const fresh = keyed("d");
  const mutations = mutationsDuring(() => patchChildren(root, [c, b, fresh].map((n) => keyed(n.dataset.slideKey))));
  assert.deepEqual(root.children.map((n) => n.dataset.slideKey), ["c", "b", "d"]);
  assert.equal(root.children[0], c);
  assert.equal(root.children[1], b);
  assert.equal(mutations, 3); // a removed, b or c moved, d added
});

test("what stays doesn't move when something above it goes or is added, so it keeps focus", () => {
  const input = node("input", "other");
  patchChildren(root, [node("span", "dot"), node("label", "field", input)]);
  input.focus();
  patchChildren(root, [node("label", "field", node("input", "other"))]);
  assert.equal(document.activeElement, input);
  patchChildren(root, [node("span", "spinner"), node("label", "field", node("input", "other"))]);
  assert.equal(document.activeElement, input);
});

test("a rename box in use stays as it is", () => {
  const box = node("input", "inlineInput");
  box.value = "half typ";
  patchChildren(root, [node("span", "name", box)]);
  const newer = node("input", "inlineInput");
  newer.value = "old name";
  patchChildren(root, [node("span", "name", newer)]);
  assert.equal(root.querySelector(".inlineInput"), box);
  assert.equal(box.value, "half typ");
});

test("a rename box going away from inside the patch doesn't break it", () => {
  const blur = mock.fn();
  const box = node("input", "inlineInput");
  box.addEventListener("blur", blur);
  patchChildren(root, [node("span", "name", box)]);
  box.focus();
  patchChildren(root, [node("span", "name", "done")]);
  assert.equal(blur.mock.callCount(), 1);
  assert.equal(root.textContent, "done");
});

test("a clicked button lets go of focus on the next change; one tabbed to keeps it", () => {
  const clicked = node("button", "x");
  patchChildren(root, [clicked]);
  clicked.focus();
  patchChildren(root, [node("button", "x")]);
  assert.equal(root.firstChild, clicked);
  assert.equal(document.activeElement, document.body);

  clicked.focusVisible = true;
  clicked.focus();
  patchChildren(root, [node("button", "x")]);
  assert.equal(document.activeElement, clicked);
});

test("focus elsewhere isn't touched", () => {
  const outside = document.createElement("button");
  document.body.append(outside);
  outside.focus();
  patchChildren(root, [node("button", "x")]);
  assert.equal(document.activeElement, outside);
  outside.remove();
});

// tooltip.js moves `title` to data-tip, and only touches a tip when `title` changes.
function adopted(text) {
  const made = node("span", "name", text);
  made.dataset.tip = "tip";
  return made;
}

test("a title tooltip.js has adopted isn't set again", () => {
  const old = adopted("x");
  patchChildren(root, [old]);
  const same = node("span", "name", "x");
  same.title = "tip";
  assert.equal(mutationsDuring(() => patchChildren(root, [same])), 0);
  assert.equal(old.title, "");

  const changed = node("span", "name", "x");
  changed.title = "other tip";
  patchChildren(root, [changed]);
  assert.equal(old.title, "other tip");
});

test("a title that is no longer there clears the tip through tooltip.js", () => {
  const old = adopted("x");
  patchChildren(root, [old]);
  old.title = "";
  let cleared = false;
  Object.defineProperty(old, "title", { set(value) { cleared = value === ""; }, get: () => "", configurable: true });
  patchChildren(root, [node("span", "name", "x")]);
  assert.equal(cleared, true);
});

test("a tip for text cut off stays while the text does, and goes when the text changes", () => {
  const old = node("span", "name", "long name");
  old.dataset.tip = "long name";
  patchChildren(root, [old]);
  let cleared = false;
  Object.defineProperty(old, "title", { set(value) { cleared = value === ""; }, get: () => "", configurable: true });
  patchChildren(root, [node("span", "name", "long name")]);
  assert.equal(cleared, false);
  patchChildren(root, [node("span", "name", "other")]);
  assert.equal(cleared, true);
});
