import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

globalThis.localStorage = { getItem: () => null, setItem() {} };

const { state, activeTab, addGroup, addTab, closeActive, selectGroup, setTabMinimized, tabsIn } = await import("../src/store.js");

beforeEach(() => {
  state.ws.groups = [];
  state.ws.tabs = [];
  state.ws.activeTab = null;
  state.ws.activeGroup = null;
  state.past = [];
});

test("closes the selected tab, and the group stays when that was its last tab", () => {
  const group = addGroup();
  addTab(group.id);
  closeActive();
  assert.equal(tabsIn(group.id).length, 0);
  assert.deepEqual(state.ws.groups, [group]);
  assert.equal(state.ws.activeGroup, group.id);
  assert.equal(state.past.length, 1);
});

test("with an empty group selected, closes the group and selects its neighbor", () => {
  const first = addGroup();
  const tab = addTab(first.id);
  const empty = addGroup();
  selectGroup(empty);
  closeActive();
  assert.deepEqual(state.ws.groups, [first]);
  assert.equal(activeTab(), tab);
});

test("a group whose tabs are all minimized is not empty, so it stays", () => {
  const group = addGroup();
  setTabMinimized(addTab(group.id), true);
  closeActive();
  assert.deepEqual(state.ws.groups, [group]);
  assert.equal(tabsIn(group.id).length, 1);
});

test("the last group can close, leaving nothing, and a new tab still works from there", () => {
  addGroup();
  closeActive();
  assert.equal(state.ws.groups.length, 0);
  assert.equal(state.ws.activeGroup, null);

  closeActive(); // nothing left to close
  assert.equal(state.ws.groups.length, 0);

  const tab = addTab();
  assert.equal(state.ws.groups.length, 1);
  assert.equal(activeTab(), tab);
});
