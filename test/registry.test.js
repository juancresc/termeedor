import assert from "node:assert/strict";
import { test, mock } from "node:test";
import {
  addMenuItem, addStatusItem, emit, getCommand, getShortcut, listCommands, menuItemsFor, on,
  onStatusChange, registerCommand, registerShortcut, reserve, statusItems,
} from "../src/plugins/registry.js";

const quietly = () => mock.method(console, "error", () => {});

test("commands register, list and remove", () => {
  const remove = registerCommand("a", "greet", () => "hi", "say hi");
  assert.equal(getCommand("greet").pluginId, "a");
  assert.deepEqual(listCommands(), [{ name: "greet", description: "say hi" }]);
  remove();
  assert.equal(getCommand("greet"), undefined);
});

test("commands can't replace built-ins or another plugin's command", () => {
  reserve("commands", ["ls"]);
  assert.throws(() => registerCommand("a", "ls", () => {}), /built in/);
  const remove = registerCommand("a", "mine", () => {});
  assert.throws(() => registerCommand("b", "mine", () => {}), /already belongs to plugin "a"/);
  remove();
});

test("invalid commands are rejected", () => {
  assert.throws(() => registerCommand("a", "has space", () => {}), /Invalid command name/);
  assert.throws(() => registerCommand("a", "__proto__", () => {}), /Invalid command name/);
  assert.throws(() => registerCommand("a", "ok", "not a function"), /must be a function/);
});

test("shortcuts need Mod, skip built-ins and resolve by key", () => {
  reserve("shortcuts", ["KeyT"]);
  assert.throws(() => registerShortcut("a", "Alt+KeyJ", () => {}), /Invalid shortcut/);
  assert.throws(() => registerShortcut("a", "Mod+KeyT", () => {}), /built in/);
  const handler = mock.fn();
  const remove = registerShortcut("a", "Mod+Shift+KeyJ", handler);
  getShortcut("Shift+KeyJ")();
  assert.equal(handler.mock.callCount(), 1);
  remove();
  assert.equal(getShortcut("Shift+KeyJ"), undefined);
});

test("menu items are bound to the clicked target and filtered by when()", () => {
  const onSelect = mock.fn();
  const removeA = addMenuItem("a", "tab", { label: "Always", onSelect });
  const removeB = addMenuItem("a", "tab", { label: "Never", onSelect, when: () => false });
  const items = menuItemsFor("tab", { id: "t1" });
  assert.deepEqual(items.map((i) => i.label), ["Always"]);
  items[0].onSelect();
  assert.deepEqual(onSelect.mock.calls[0].arguments, [{ id: "t1" }]);
  assert.deepEqual(menuItemsFor("group", {}), []);
  removeA();
  removeB();
  assert.deepEqual(menuItemsFor("tab", {}), []);
});

test("errors in plugin callbacks stay inside the plugin", () => {
  const log = quietly();
  const boom = () => { throw new Error("boom"); };
  const removes = [
    addMenuItem("a", "tab", { label: "Bad", onSelect: boom }),
    addMenuItem("a", "tab", { label: "Bad when", onSelect: () => {}, when: boom }),
    on("a", "tab:open", boom),
    registerShortcut("a", "Mod+KeyZ", boom),
  ];
  const after = mock.fn();
  removes.push(on("b", "tab:open", after));

  menuItemsFor("tab", {})[0].onSelect();
  emit("tab:open", {});
  getShortcut("KeyZ")();
  assert.equal(after.mock.callCount(), 1);
  assert.ok(log.mock.callCount() >= 3);
  removes.forEach((remove) => remove());
  log.mock.restore();
});

test("unknown events are refused so typos fail loudly", () => {
  assert.throws(() => on("a", "tab:opne", () => {}), /Unknown event/);
});

test("status items notify on add, update and remove", () => {
  const changed = mock.fn();
  onStatusChange(changed);
  const { remove, update } = addStatusItem("a", { text: "one" });
  assert.equal(statusItems()[0].text, "one");
  update({ text: 2 });
  assert.equal(statusItems()[0].text, "2");
  remove();
  assert.deepEqual(statusItems(), []);
  assert.equal(changed.mock.callCount(), 3);
});
