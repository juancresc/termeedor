import assert from "node:assert/strict";
import { test } from "node:test";
import { filterSettings, matchRanges, showTopic } from "../src/settingsSearch.js";

// Just enough DOM: a group has a heading and items, and the hidden class is what the page styles.
const node = (textContent, keywords) => {
  const classes = new Set();
  return {
    textContent,
    classes,
    dataset: keywords ? { keywords } : {},
    classList: { toggle: (name, on) => { if (on) classes.add(name); else classes.delete(name); } },
    get hidden() { return classes.has("searchHidden"); },
  };
};
const group = (title, ...items) => Object.assign(node(title), {
  items,
  querySelector: () => ({ textContent: title }),
  querySelectorAll: () => items,
});
const settings = () => {
  const groups = [
    group("Display", node("Font size"), node("Line numbers")),
    group("Tabs", node("Default color for new tabs"), node("Open new tabs in the current path", "directory folder cwd")),
  ];
  return { groups, querySelectorAll: () => groups };
};
const shown = ({ groups }) => groups.filter((g) => !g.hidden).map((g) => g.items.filter((i) => !i.hidden).map((i) => i.textContent));

test("an empty search shows everything, and clearing a search brings it back", () => {
  const root = settings();
  filterSettings(root, "font");
  assert.equal(filterSettings(root, "  "), 4);
  assert.deepEqual(shown(root), [["Font size", "Line numbers"], ["Default color for new tabs", "Open new tabs in the current path"]]);
});

test("a search keeps only matching items, ignoring case, and hides groups left empty", () => {
  const root = settings();
  assert.equal(filterSettings(root, "FONT"), 1);
  assert.deepEqual(shown(root), [["Font size"]]);
});

test("searching a group's name shows the whole group", () => {
  const root = settings();
  filterSettings(root, "display");
  assert.deepEqual(shown(root), [["Font size", "Line numbers"]]);
});

test("every word has to match, in any order", () => {
  const root = settings();
  filterSettings(root, "path new");
  assert.deepEqual(shown(root), [["Open new tabs in the current path"]]);
  assert.equal(filterSettings(root, "path font"), 0);
  assert.deepEqual(shown(root), []);
});

test("only the chosen topic shows, until a search looks through them all", () => {
  const root = settings();
  const hiddenByTopic = () => root.groups.map((g) => g.classes.has("topicHidden"));
  showTopic(root, "Tabs", false);
  assert.deepEqual(hiddenByTopic(), [true, false]);
  showTopic(root, "Tabs", true);
  assert.deepEqual(hiddenByTopic(), [false, false]);
});

test("matches are found for every word, ignoring case and taking symbols literally", () => {
  assert.deepEqual(matchRanges("Open new tabs", "TABS open"), [[0, 4], [9, 13]]);
  assert.deepEqual(matchRanges("Add .css file", ".css"), [[4, 8]]);
  assert.deepEqual(matchRanges("Font size", "x.z"), []);
  assert.deepEqual(matchRanges("Font size", "  "), []);
});

test("an item is found by its keywords", () => {
  const root = settings();
  filterSettings(root, "folder");
  assert.deepEqual(shown(root), [["Open new tabs in the current path"]]);
});
