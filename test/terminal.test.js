import assert from "node:assert/strict";
import { test } from "node:test";
import { createTextModel } from "../src/terminal/textModel.js";
import { keyToBytes } from "../src/terminal/keys.js";

function render(...chunks) {
  const model = createTextModel();
  chunks.forEach((chunk) => model.write(chunk));
  return model.text();
}

test("plain lines, with CRLF and trailing blank lines removed", () => {
  assert.equal(render("one\r\ntwo\r\n\r\n"), "one\ntwo");
});

test("colors and other styling are dropped", () => {
  assert.equal(render("\x1b[1;31mred\x1b[0m \x1b]0;title\x07text\x1b(B"), "red text");
});

test("a carriage return overwrites: progress bars stay on one line", () => {
  assert.equal(render("10%\r50%\r100%\r\ndone"), "100%\ndone");
  assert.equal(render("long text\rhi\x1b[K"), "hi");
});

test("backspace moves back, tabs reach the next stop", () => {
  assert.equal(render("abc\b\bX"), "aXc");
  assert.equal(render("a\tb"), "a       b");
});

test("cursor movement redraws earlier lines, as npm and docker do", () => {
  assert.equal(render("a: 0\r\nb: 0\r\n\x1b[2A\x1b[Ka: 1\r\n\x1b[Kb: 1\r\n"), "a: 1\nb: 1");
  assert.equal(render("abc\x1b[1G\x1b[2CX"), "abX");
});

test("clear screen starts over; erase-below removes the lines underneath", () => {
  assert.equal(render("old\r\n\x1b[2J\x1b[Hnew"), "new");
  assert.equal(render("a\r\nb\r\nc\x1b[1A\x1b[1G\x1b[J"), "a");
});

test("a sequence cut across chunks isn't printed", () => {
  assert.equal(render("x\x1b", "[31", "my\x1b]0;ti", "tle\x07z"), "xyz");
});

test("control characters don't appear", () => {
  assert.equal(render("a\x07b\x00c\x7fd"), "abcd");
});

test("wide unicode text passes through", () => {
  assert.equal(render("✓ héllo ❯"), "✓ héllo ❯");
});

test("endless output keeps only the most recent lines", () => {
  const model = createTextModel();
  for (let i = 0; i < 20010; i++) model.write(`${i}\r\n`);
  const lines = model.text().split("\n");
  assert.equal(lines.at(-1), "20009");
  assert.ok(lines.length <= 20000);
  model.write("\x1b[1Aup");
  assert.equal(model.text().split("\n").at(-1), "up009");
});

const key = (key, extra = {}) => ({ key, code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

test("keys become the bytes a terminal would send", () => {
  assert.equal(keyToBytes(key("a")), "a");
  assert.equal(keyToBytes(key("Enter")), "\r");
  assert.equal(keyToBytes(key("Backspace")), "\x7f");
  assert.equal(keyToBytes(key("ArrowUp")), "\x1b[A");
  assert.equal(keyToBytes(key("c", { ctrlKey: true, code: "KeyC" })), "\x03");
  assert.equal(keyToBytes(key("d", { ctrlKey: true, code: "KeyD" })), "\x04");
});

test("the app keeps Cmd shortcuts, selection keys and bare modifiers", () => {
  assert.equal(keyToBytes(key("c", { metaKey: true })), null);
  assert.equal(keyToBytes(key("ArrowLeft", { shiftKey: true })), null);
  assert.equal(keyToBytes(key("Shift", { shiftKey: true })), null);
});
