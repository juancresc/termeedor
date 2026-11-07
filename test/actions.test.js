// The registry itself: no DOM, no store.

import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { actionIds, actionLabel, defineAction, hasAction, isEnabled, menuItem, runAction } from "../src/core/actions.js";

test("an action runs by id, with its args, and goes away when removed", () => {
  const run = mock.fn(() => "done");
  const remove = defineAction({ id: "a.run", label: "Run", run });
  assert.ok(actionIds().includes("a.run"));
  assert.equal(runAction("a.run", 1, 2), "done");
  assert.deepEqual(run.mock.calls[0].arguments, [1, 2]);
  remove();
  assert.equal(hasAction("a.run"), false);
});

test("an unknown id is an error, and an id can't be taken twice", () => {
  assert.throws(() => runAction("a.none"), /Unknown action/);
  const remove = defineAction({ id: "a.twice", label: "x", run() {} });
  assert.throws(() => defineAction({ id: "a.twice", label: "y", run() {} }), /already exists/);
  remove();
});

test("removing twice can't remove a later action with the same id", () => {
  const removeFirst = defineAction({ id: "a.same", label: "first", run() {} });
  removeFirst();
  const removeSecond = defineAction({ id: "a.same", label: "second", run() {} });
  removeFirst();
  assert.equal(actionLabel("a.same"), "second");
  removeSecond();
});

test("a disabled action doesn't run", () => {
  const run = mock.fn();
  const remove = defineAction({ id: "a.gated", label: "x", run, enabled: (on) => on });
  assert.equal(isEnabled("a.gated", false), false);
  runAction("a.gated", false);
  assert.equal(run.mock.callCount(), 0);
  runAction("a.gated", true);
  assert.equal(run.mock.callCount(), 1);
  remove();
});

test("a menu item carries the label for its target, its danger, and is bound to its target", () => {
  const run = mock.fn();
  const remove = defineAction({ id: "a.menu", label: (target) => `Close ${target.name}`, danger: true, run });
  const target = { name: "one" };
  const item = menuItem("a.menu", target);
  assert.equal(item.label, "Close one");
  assert.equal(item.danger, true);
  item.onSelect();
  assert.deepEqual(run.mock.calls[0].arguments, [target]);
  remove();
});
