import assert from "node:assert/strict";
import { test, mock } from "node:test";
import {
  addMenuItem, addStatusItem, emit, getShortcut, menuItemsFor, on,
  onStatusChange, registerAction, registerShortcut, reserve, statusItems,
} from "../src/plugins/registry.js";

const quietly = () => mock.method(console, "error", () => {});

/** Registers an action under plugin "a"; returns { id, remove }. */
let actionCount = 0;
const action = (run, extra = {}) => registerAction("a", { id: `act${actionCount++}`, label: "Act", run, ...extra });

test("shortcuts need Mod, skip built-ins and resolve by key", () => {
  reserve("shortcuts", ["KeyT"]);
  const handler = mock.fn();
  const { id, remove: removeAction } = action(handler);
  assert.throws(() => registerShortcut("a", "Alt+KeyJ", id), /Invalid shortcut/);
  assert.throws(() => registerShortcut("a", "Mod+KeyT", id), /built in/);
  const remove = registerShortcut("a", "Mod+Shift+KeyJ", id);
  getShortcut("Shift+KeyJ")();
  assert.equal(handler.mock.callCount(), 1);
  remove();
  assert.equal(getShortcut("Shift+KeyJ"), undefined);
  removeAction();
});

test("menu items are bound to the clicked target and filtered by enabled()", () => {
  const run = mock.fn();
  const always = action(run, { label: "Always" });
  const never = action(run, { label: "Never", enabled: () => false });
  const removeA = addMenuItem("a", "tab", always.id);
  const removeB = addMenuItem("a", "tab", never.id);
  const items = menuItemsFor("tab", { id: "t1" });
  assert.deepEqual(items.map((i) => i.label), ["Always"]);
  items[0].onSelect();
  assert.deepEqual(run.mock.calls[0].arguments, [{ id: "t1" }]);
  assert.deepEqual(menuItemsFor("group", {}), []);
  removeA();
  removeB();
  assert.deepEqual(menuItemsFor("tab", {}), []);
  always.remove();
  never.remove();
});

test("errors in plugin callbacks stay inside the plugin", () => {
  const log = quietly();
  const boom = () => { throw new Error("boom"); };
  const bad = action(boom, { label: "Bad" });
  const badCheck = action(() => {}, { label: "Bad when", enabled: boom });
  const removes = [
    addMenuItem("a", "tab", bad.id),
    addMenuItem("a", "tab", badCheck.id),
    on("a", "tab:open", boom),
    registerShortcut("a", "Mod+KeyZ", bad.id),
    bad.remove,
    badCheck.remove,
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
