import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {} };

const { STORAGE_KEYS } = await import("../src/constants.js");
const { state, activeTab, addGroup, addTab, closeActive, closeGroup, closeTab, reopenPast, setGroupCollapsed, setGroupMinimized, setTabMinimized, tabsIn } = await import("../src/store.js");

beforeEach(() => {
  state.ws.groups = [];
  state.ws.tabs = [];
  state.ws.activeTab = null;
  state.ws.activeGroup = null;
  state.past = [];
});

test("a new group starts with a terminal, selected", () => {
  const group = addGroup();
  assert.equal(tabsIn(group.id).length, 1);
  assert.equal(activeTab(), tabsIn(group.id)[0]);
  assert.equal(state.ws.activeGroup, group.id);
});

test("an app that starts with nothing open gets a group with a terminal, and keeps it", async () => {
  const original = globalThis.localStorage;
  const saved = new Map([[STORAGE_KEYS.workspace, JSON.stringify({ groups: [], tabs: [] })]]);
  globalThis.localStorage = { getItem: (key) => saved.get(key) ?? null, setItem: (key, value) => saved.set(key, value) };
  try {
    const started = await import("../src/store.js?starts-empty");
    assert.equal(started.state.ws.groups.length, 1);
    assert.equal(started.tabsIn(started.state.ws.groups[0].id).length, 1);
    assert.equal(started.activeTab(), started.state.ws.tabs[0]);
    assert.equal(JSON.parse(saved.get(STORAGE_KEYS.workspace)).groups.length, 1);
  } finally {
    globalThis.localStorage = original;
  }
});

test("closes the selected tab, and the group stays when that was its last tab", () => {
  const group = addGroup();
  closeActive();
  assert.equal(tabsIn(group.id).length, 0);
  assert.deepEqual(state.ws.groups, [group]);
  assert.equal(state.ws.activeGroup, group.id);
  assert.equal(state.past.length, 1);
});

test("with an empty group selected, closes the group and selects its neighbor", () => {
  const first = addGroup();
  const tab = activeTab();
  const emptied = addGroup();
  closeActive(); // its terminal
  assert.equal(tabsIn(emptied.id).length, 0);
  closeActive(); // the group
  assert.deepEqual(state.ws.groups, [first]);
  assert.equal(activeTab(), tab);
});

test("a group whose tabs are all minimized is not empty, so it stays", () => {
  const group = addGroup();
  setTabMinimized(activeTab(), true);
  closeActive();
  assert.deepEqual(state.ws.groups, [group]);
  assert.equal(tabsIn(group.id).length, 1);
});

test("the last group can close, leaving nothing, and a new tab still works from there", () => {
  addGroup();
  closeActive(); // its terminal
  closeActive(); // the group
  assert.equal(state.ws.groups.length, 0);
  assert.equal(state.ws.activeGroup, null);

  closeActive(); // nothing left to close
  assert.equal(state.ws.groups.length, 0);

  const tab = addTab();
  assert.equal(state.ws.groups.length, 1);
  assert.equal(activeTab(), tab);
});

test("a past session reopens in the selected group, not the one it came from", () => {
  const original = addGroup();
  closeTab(activeTab());
  const selected = addGroup();
  reopenPast(state.past[0]);
  assert.equal(activeTab().groupId, selected.id);
  assert.equal(tabsIn(original.id).length, 0);
});

test("with no group selected, a past session reopens in a new group", () => {
  const closed = addGroup();
  closed.name = "Old name";
  closeGroup(closed);
  assert.equal(state.ws.groups.length, 0);
  reopenPast(state.past[0]);
  assert.equal(state.ws.groups.length, 1);
  assert.equal(state.ws.groups[0].name, "Group 1");
  assert.equal(activeTab().groupId, state.ws.groups[0].id);

  const minimized = state.ws.groups[0];
  setGroupMinimized(minimized, true);
  closeTab(state.ws.tabs[0]);
  reopenPast(state.past[0]);
  assert.equal(minimized.minimized, true);
  assert.equal(state.ws.groups.length, 2);
  assert.equal(activeTab().groupId, state.ws.groups[1].id);
});

test("a new group skips names already taken", () => {
  const [one, two, three] = [addGroup(), addGroup(), addGroup()];
  assert.deepEqual([one.name, two.name, three.name], ["Group 1", "Group 2", "Group 3"]);
  closeGroup(one); // leaves Group 2 and Group 3: the next number, 3, is taken
  assert.equal(addGroup().name, "Group 4");

  three.name = "group 5"; // differs only in case, and is what the next number would be
  assert.equal(addGroup().name, "Group 6");

  setGroupMinimized(two, true); // still counts while minimized
  const names = state.ws.groups.map((g) => g.name.toLowerCase());
  assert.equal(new Set(names).size, names.length);
});

test("a new group starts expanded", () => {
  assert.equal(addGroup().collapsed, false);
});

test("collapsing a group leaves it selected, in the top row, and its tab active", () => {
  const group = addGroup();
  const tab = activeTab();
  setGroupCollapsed(group, true);
  assert.equal(group.collapsed, true);
  assert.equal(group.minimized, false);
  assert.equal(state.ws.activeGroup, group.id);
  assert.equal(activeTab(), tab);
  setGroupCollapsed(group, false);
  assert.equal(group.collapsed, false);
});

test("minimizing and restoring a group leaves its collapsed state alone", () => {
  const group = addGroup();
  setGroupMinimized(group, true);
  assert.equal(group.collapsed, false);
  setGroupMinimized(group, false);
  setGroupCollapsed(group, true);
  setGroupMinimized(group, true);
  assert.equal(group.collapsed, true);
  setGroupMinimized(group, false);
  assert.equal(group.collapsed, true);
});

test("the sidebar hides a group's tabs when collapsed, not when minimized", () => {
  const css = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
  assert.match(css, /\.group\.collapsed \.glist \{ display: none; \}/);
  assert.doesNotMatch(css, /\.group\.minimized \.glist/);
});
