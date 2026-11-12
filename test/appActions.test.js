// The app's actions on the desktop key set: shortcuts and menus through the registry, with the real
// store and a stub DOM. Nothing is saved: the data host below holds nothing.

import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, test } from "node:test";
import { installDom } from "./support/miniDom.js";

installDom();
Object.defineProperty(globalThis, "navigator", { value: { platform: "MacIntel" }, configurable: true });
const noop = () => {};
globalThis.termeedorHost = {
  platform: "darwin",
  data: { load: async () => ({}), write: async () => ({ ok: true }), writeSync: () => ({ ok: true }) },
  shell: { run: async () => {}, write: noop, resize: noop, kill: noop, onEvent: noop, complete: async () => [] },
};

const store = await import("../src/store.js");
const { actionIds, actionLabel, hasAction, runAction } = await import("../src/core/actions.js");
await import("../src/appActions.js");
const { builtinShortcutKeys, findShortcut } = await import("../src/keymap.js");
const { initShortcuts } = await import("../src/shortcuts.js");
const { groupMenu, pastMenu, tabMenu } = await import("../src/contextMenus.js");
const { closeMenu } = await import("../src/menu.js");
const { runs } = await import("../src/core/runState.js");
const { FONT_SIZE } = await import("../src/constants.js");

const { state } = store;
let settingsOpened = 0;
document.getElementById("settings").showModal = () => { settingsOpened++; };
initShortcuts();

const press = (code, extra = {}) => {
  const event = { metaKey: true, ctrlKey: false, altKey: false, shiftKey: false, code, preventDefault() { this.prevented = true; }, ...extra };
  document.listeners.keydown.forEach((fn) => fn(event));
  return event;
};
const fakeClick = { preventDefault: noop, stopPropagation: noop, clientX: 0, clientY: 0 };

function menuLabels(open) {
  open();
  const labels = document.body.querySelector(".menu").children.filter((node) => node.tagName === "BUTTON").map((node) => node.textContent);
  closeMenu();
  return labels;
}

function menuButton(open, label) {
  open();
  return document.body.querySelector(".menu").children.find((node) => node.textContent === label);
}

beforeEach(() => {
  closeMenu();
  state.ws.groups = [];
  state.ws.tabs = [];
  state.ws.activeTab = null;
  state.ws.activeGroup = null;
  state.past = [];
  state.settings.showAllGroups = false;
  store.addGroup();
});

test("a key the running program already took isn't also a shortcut", () => {
  const before = state.ws.tabs.length;
  press("KeyT", { defaultPrevented: true }); // e.g. Ctrl+T sent to ssh on Linux
  assert.equal(state.ws.tabs.length, before);
  press("KeyT");
  assert.equal(state.ws.tabs.length, before + 1);
});

test("every key in the keymap names a real action, and every action has a label", () => {
  for (const key of builtinShortcutKeys()) {
    const entry = findShortcut({ metaKey: true, ctrlKey: false, altKey: false, shiftKey: key.startsWith("Shift+"), code: key.replace("Shift+", "") });
    assert.ok(hasAction(entry.action), entry.action);
  }
  for (const id of actionIds()) {
    const target = { id: "x", collapsed: false, minimized: false };
    assert.ok(actionLabel(id, target), id);
  }
});

test("shortcuts run their actions", () => {
  const count = () => state.ws.tabs.length;
  const start = count();
  assert.ok(press("KeyT").prevented);
  assert.equal(count(), start + 1);
  press("KeyW");
  assert.equal(count(), start);
  press("KeyT", { shiftKey: true });
  assert.equal(count(), start + 1);
  press("KeyG");
  assert.equal(state.ws.groups.length, 2);
  press("KeyB");
  assert.equal(state.ws.sidebarOpen, false);
  press("KeyB");
  assert.equal(state.ws.sidebarOpen, true);
  press("Comma");
  assert.equal(settingsOpened, 1);
});

test("the keys for moving between tabs go around, and 1-9 go to a tab", () => {
  store.addTab();
  store.addTab();
  const [a, b, c] = state.ws.tabs;
  press("Digit1");
  assert.equal(store.activeTab(), a);
  press("BracketLeft", { shiftKey: true });
  assert.equal(store.activeTab(), c);
  press("BracketRight", { shiftKey: true });
  assert.equal(store.activeTab(), a);
  press("Digit2");
  assert.equal(store.activeTab(), b);
  press("Digit9");
  assert.equal(store.activeTab(), b);
});

test("Cmd+[ and Cmd+] move between groups, going around, back to each group's tab", () => {
  const first = store.activeTab();
  const second = store.addGroup();
  const third = store.addGroup();
  const tabInSecond = store.tabsIn(second.id)[0];
  store.activateTab(tabInSecond.id);
  press("BracketRight");
  assert.equal(state.ws.activeGroup, third.id);
  press("BracketRight");
  assert.equal(state.ws.activeGroup, first.groupId);
  assert.equal(store.activeTab(), first);
  press("BracketLeft");
  assert.equal(state.ws.activeGroup, third.id);
  press("BracketLeft");
  assert.equal(store.activeTab(), tabInSecond);
});

test("Shift+Cmd+1-9 go to a group, skipping minimized ones, back to its tab", () => {
  const first = store.activeTab();
  const second = store.addGroup();
  const third = store.addGroup();
  const tabInSecond = store.tabsIn(second.id)[0];
  press("Digit1", { shiftKey: true });
  assert.equal(store.activeTab(), first);
  press("Digit2", { shiftKey: true });
  assert.equal(store.activeTab(), tabInSecond);
  store.setGroupMinimized(second, true);
  press("Digit2", { shiftKey: true });
  assert.equal(state.ws.activeGroup, third.id);
  press("Digit9", { shiftKey: true });
  assert.equal(state.ws.activeGroup, third.id);
});

test("the shortcut list is split into sections, with group keys under Groups", async () => {
  const { shortcutList } = await import("../src/keymap.js");
  const sections = shortcutList();
  assert.deepEqual(sections.map((s) => s.section), ["Tabs", "Groups", "Window", "Input"]);
  assert.deepEqual(sections[1].rows.map((r) => `${r.keys} ${r.does}`), ["⌘G new group", "⌘[ previous group", "⌘] next group", "⇧⌘1–9 go to group"]);
  assert.match(sections[0].rows.find((r) => r.does === "go to tab").note, /Show all tabs/);
});

test("Cmd + - 0 change the text size by character, whatever the keyboard layout", () => {
  store.updateSettings({ fontSize: FONT_SIZE.default });
  press("Equal", { key: "=" }); // US: Cmd+=
  assert.equal(state.settings.fontSize, FONT_SIZE.default + 1);
  press("BracketRight", { key: "+" }); // Spanish: the + key, where US has ]
  assert.equal(state.settings.fontSize, FONT_SIZE.default + 2);
  press("Slash", { key: "-" }); // Spanish: the - key, where US has /
  assert.equal(state.settings.fontSize, FONT_SIZE.default + 1);
  press("Digit0", { key: "0" });
  assert.equal(state.settings.fontSize, FONT_SIZE.default);
  for (let i = 0; i < 30; i++) press("Minus", { key: "-" });
  assert.equal(state.settings.fontSize, FONT_SIZE.min);
  store.updateSettings({ fontSize: FONT_SIZE.default });
});

test("a key that isn't a shortcut does nothing", () => {
  assert.equal(press("KeyJ").prevented, undefined);
});

test("menu labels are the ones the app has always had, per state", () => {
  const tab = store.activeTab();
  const other = store.addGroup();
  store.activateTab(tab.id);
  const open = () => tabMenu(tab, fakeClick, "sidebar");
  assert.deepEqual(menuLabels(open), ["Rename", "Collapse to chip", "Minimize into group label", "Duplicate", "Send to › Unnamed group", "Send to › New group", "Close tab"]);

  tab.collapsed = true;
  tab.minimized = true;
  runs.start(tab.id);
  assert.deepEqual(menuLabels(open), ["Rename", "Expand", "Restore", "Duplicate", "Stop running command", "Send to › Unnamed group", "Send to › New group", "Close tab"]);
  runs.finish(tab.id);

  const group = store.getGroup(tab.groupId);
  const openGroup = () => groupMenu(group, fakeClick);
  assert.deepEqual(menuLabels(openGroup), ["New tab in group", "Rename", "Minimize", "Restore minimized tabs", "Close group"]);
  tab.minimized = false;
  assert.deepEqual(menuLabels(openGroup), ["New tab in group", "Rename", "Minimize", "Close group"]);
  group.minimized = true;
  assert.deepEqual(menuLabels(openGroup), ["New tab in group", "Rename", "Restore", "Close group"]);
  group.minimized = false;

  other.name = "Other";
  store.selectGroup(other);
  store.closeTab(store.activeTab());
  group.name = "Work";
  store.selectGroup(group);
  assert.deepEqual(menuLabels(() => pastMenu(state.past[0], fakeClick)), ["Reopen in › Work", "Rename", "Delete forever"]);
});

test("the dangerous items stay marked", () => {
  const tab = store.activeTab();
  assert.ok(menuButton(() => tabMenu(tab, fakeClick, "tabbar"), "Close tab").has("danger"));
  closeMenu();
  assert.ok(!menuButton(() => tabMenu(tab, fakeClick, "tabbar"), "Duplicate").has("danger"));
});

test("a menu item acts on the tab it was opened for", () => {
  const [first, second] = [store.activeTab(), store.addTab()];
  store.activateTab(second.id);
  menuButton(() => tabMenu(first, fakeClick, "sidebar"), "Duplicate").onclick();
  assert.equal(state.ws.tabs[1].name, `${first.name} copy`);
});

test("a tab, group or closed tab that has gone is left alone", () => {
  const tab = store.addTab();
  const count = state.ws.tabs.length;
  const copyOfTab = { ...tab };
  runAction("tab.close", copyOfTab); // not the app's own
  assert.equal(state.ws.tabs.length, count);
  const openMenuItem = menuButton(() => tabMenu(tab, fakeClick, "sidebar"), "Close tab");
  store.closeTab(tab);
  const left = state.ws.tabs.length;
  openMenuItem.onclick(); // the menu was still open when it closed
  assert.equal(state.ws.tabs.length, left);

  runAction("group.close", { id: "gone" });
  runAction("past.delete", { id: "gone" });
  assert.equal(state.ws.groups.length, 1);
});

test("what is typed has no way to reach an action", () => {
  for (const file of ["../src/editor.js", "../src/terminal/inputEditor.js", "../src/terminal/runner.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /actions\.js|appActions|runAction/, file);
  }
});

test("the app menu is Electron's own items and names no action", () => {
  const source = fs.readFileSync(new URL("../electron/menu.cjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /click|actions/);
});
