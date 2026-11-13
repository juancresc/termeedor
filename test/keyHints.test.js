import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { initKeyHints } from "../src/keyHints.js";

function setup() {
  mock.timers.enable({ apis: ["setTimeout"] });
  const listeners = {};
  const target = {
    addEventListener: (type, fn) => { listeners[type] = fn; },
    removeEventListener: (type) => { delete listeners[type]; },
  };
  const classes = new Set();
  const root = { classList: { add: (c) => classes.add(c), remove: (c) => classes.delete(c), contains: (c) => classes.has(c) } };
  const stop = initKeyHints({ target, root, modifier: "Meta", delay: 400 });
  const fire = (type, key, extra = {}) => listeners[type]?.({ key, ...extra });
  return { fire, shown: () => classes.has("showHints"), stop };
}

test("holding the key a moment shows the badges; letting go hides them", (t) => {
  const { fire, shown, stop } = setup();
  t.after(() => { stop(); mock.timers.reset(); });
  fire("keydown", "Meta");
  mock.timers.tick(399);
  assert.equal(shown(), false);
  mock.timers.tick(1);
  assert.equal(shown(), true);
  fire("keydown", "Alt"); // for the group keys (Shift off the Mac)
  fire("keydown", "1"); // jumping while they show keeps them up
  assert.equal(shown(), true);
  fire("keyup", "Meta");
  assert.equal(shown(), false);
});

test("a quick shortcut never shows them", (t) => {
  const { fire, shown, stop } = setup();
  t.after(() => { stop(); mock.timers.reset(); });
  fire("keydown", "Meta");
  fire("keydown", "c");
  mock.timers.tick(1000);
  assert.equal(shown(), false);
});

test("leaving the window hides them, since the key-up never arrives", (t) => {
  const { fire, shown, stop } = setup();
  t.after(() => { stop(); mock.timers.reset(); });
  fire("keydown", "Meta");
  mock.timers.tick(400);
  fire("blur");
  assert.equal(shown(), false);
  fire("keydown", "Meta");
  fire("blur");
  mock.timers.tick(1000);
  assert.equal(shown(), false);
});

test("off the desktop there is nothing to show", () => {
  assert.doesNotThrow(() => initKeyHints({ modifier: null })());
});
