import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { beforeEach, test } from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {} };

const { STORAGE_KEYS } = await import("../src/constants.js");
const { state, activateTab, activeTab, addGroup, addTab, closeActive, closeGroup, closeTab, groupLabel, moveTabToNewGroup, placeGroup, placeTab, reopenPast, setGroupCollapsed, setGroupMinimized, setTabMinimized, tabsIn } = await import("../src/store.js");

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

test("closing a group's last tab minimizes the group and selects its neighbor", () => {
  const first = addGroup();
  const tab = activeTab();
  const emptied = addGroup();
  closeActive();
  assert.deepEqual(state.ws.groups, [first, emptied]);
  assert.equal(emptied.minimized, true);
  assert.equal(activeTab(), tab);
  assert.equal(state.past.length, 1);
});

test("closing the only group's last tab leaves it minimized, with nothing selected", () => {
  const group = addGroup();
  closeActive();
  assert.deepEqual(state.ws.groups, [group]);
  assert.equal(group.minimized, true);
  assert.equal(state.ws.activeGroup, null);
});

test("closing the last tab of a group that isn't selected keeps the selection", () => {
  const emptied = addGroup();
  const closing = activeTab();
  addGroup();
  const selected = activeTab();
  closeTab(closing);
  assert.equal(emptied.minimized, true);
  assert.equal(activeTab(), selected);
});

test("show all: closing a group's last tab selects the group next to it, not the first", () => {
  state.settings.showAllGroups = true;
  try {
    addGroup();
    const emptied = addGroup();
    const next = addGroup();
    activateTab(tabsIn(emptied.id)[0].id);
    closeActive();
    assert.equal(state.ws.activeGroup, next.id);
  } finally {
    state.settings.showAllGroups = false;
  }
});

test("a group that still has a minimized tab isn't minimized when its last visible tab closes", () => {
  const group = addGroup();
  const hidden = activeTab();
  addTab(group.id);
  setTabMinimized(hidden, true);
  closeActive();
  assert.equal(group.minimized, false);
  assert.deepEqual(tabsIn(group.id), [hidden]);
});

test("a group minimized by closing its last tab restores empty and takes new tabs", () => {
  addGroup();
  const emptied = addGroup();
  closeActive();
  setGroupMinimized(emptied, false);
  assert.equal(emptied.minimized, false);
  assert.equal(state.ws.activeGroup, emptied.id);
  assert.equal(activeTab(), undefined);
  assert.equal(addTab().groupId, emptied.id);
});

test("with a restored empty group selected, closes the group and selects its neighbor", () => {
  const first = addGroup();
  const tab = activeTab();
  const emptied = addGroup();
  closeActive(); // its terminal
  setGroupMinimized(emptied, false);
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
  const group = addGroup();
  closeActive(); // its terminal
  setGroupMinimized(group, false);
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
  assert.equal(state.ws.groups[0].name, "");
  assert.equal(activeTab().groupId, state.ws.groups[0].id);

  const minimized = state.ws.groups[0];
  setGroupMinimized(minimized, true);
  closeTab(state.ws.tabs[0]);
  reopenPast(state.past[0]);
  assert.equal(minimized.minimized, true);
  assert.equal(state.ws.groups.length, 2);
  assert.equal(activeTab().groupId, state.ws.groups[1].id);
});

test("a new group has no name until renamed, and menus still have something to call it", () => {
  const group = addGroup();
  assert.equal(group.name, "");
  assert.equal(groupLabel(group), "Unnamed group");
  group.name = "Work";
  assert.equal(groupLabel(group), "Work");
});

test("a tab sent to a new group leaves it unnamed", () => {
  const tab = tabsIn(addGroup().id)[0];
  assert.equal(moveTabToNewGroup(tab).name, "");
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

test("minimizing a group collapses it in the sidebar", () => {
  const group = addGroup();
  setGroupMinimized(group, true);
  assert.equal(group.collapsed, true);
});

test("a minimized group can be expanded in the sidebar and stays minimized", () => {
  const group = addGroup();
  setGroupMinimized(group, true);
  setGroupCollapsed(group, false);
  assert.equal(group.collapsed, false);
  assert.equal(group.minimized, true);
});

test("restoring a minimized group expands it", () => {
  const group = addGroup();
  setGroupMinimized(group, true);
  setGroupMinimized(group, false);
  assert.equal(group.minimized, false);
  assert.equal(group.collapsed, false);
});

test("adding a tab to a minimized group restores and expands it", () => {
  const group = addGroup();
  setGroupMinimized(group, true);
  addTab(group.id);
  assert.equal(group.minimized, false);
  assert.equal(group.collapsed, false);
});

test("activating a tab in a collapsed group that is not minimized leaves it collapsed", () => {
  const group = addGroup();
  const tab = activeTab();
  setGroupCollapsed(group, true);
  activateTab(tab.id);
  assert.equal(group.collapsed, true);
});

test("the sidebar hides a group's tabs when collapsed, not when minimized", () => {
  const css = readFileSync(new URL("../styles/base.css", import.meta.url), "utf8");
  assert.match(css, /\.group\.collapsed \.glist \{ display: none; \}/);
  assert.doesNotMatch(css, /\.group\.minimized \.glist/);
});

test("a tab is placed before or after another, joining that tab's group", () => {
  const [work, other] = [addGroup(), addGroup()];
  const [a] = tabsIn(work.id);
  const [b, c] = [addTab(work.id), addTab(work.id)];
  const [x] = tabsIn(other.id);
  const names = (group) => tabsIn(group.id);

  placeTab(c, a, false);
  assert.deepEqual(names(work), [c, a, b]);
  placeTab(c, b, true);
  assert.deepEqual(names(work), [a, b, c]);
  placeTab(a, a, true); // onto itself: nothing
  assert.deepEqual(names(work), [a, b, c]);
  assert.equal(activeTab(), c); // reordering selects nothing

  placeTab(x, b, false);
  assert.deepEqual(names(work), [a, x, b, c]);
  assert.equal(activeTab(), x); // sent to another group: shown there
  assert.equal(state.ws.activeGroup, work.id);
});

test("a group is placed before or after another", () => {
  const [a, b, c] = [addGroup(), addGroup(), addGroup()];
  placeGroup(c, a, false);
  assert.deepEqual(state.ws.groups, [c, a, b]);
  placeGroup(c, a, true);
  assert.deepEqual(state.ws.groups, [a, c, b]);
});
