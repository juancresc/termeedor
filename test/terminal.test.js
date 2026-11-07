import assert from "node:assert/strict";
import { test } from "node:test";
import { createTextModel } from "../src/terminal/textModel.js";
import { keyToBytes } from "../src/terminal/keys.js";

async function render(...chunks) {
  const model = createTextModel();
  chunks.forEach((chunk) => model.write(chunk));
  await model.settled();
  return model.text();
}

test("plain lines, with CRLF and trailing blank lines removed", async () => {
  assert.equal(await render("one\r\ntwo\r\n\r\n"), "one\ntwo");
});

test("colors and other styling are dropped", async () => {
  assert.equal(await render("\x1b[1;31mred\x1b[0m \x1b]0;title\x07text\x1b(B"), "red text");
});

test("a carriage return overwrites: progress bars stay on one line", async () => {
  assert.equal(await render("10%\r50%\r100%\r\ndone"), "100%\ndone");
  assert.equal(await render("long text\rhi\x1b[K"), "hi");
});

test("backspace moves back, tabs reach the next stop", async () => {
  assert.equal(await render("abc\b\bX"), "aXc");
  assert.equal(await render("a\tb"), "a       b");
});

test("cursor movement redraws earlier lines, as npm does", async () => {
  assert.equal(await render("a: 0\r\nb: 0\r\n\x1b[2A\x1b[Ka: 1\r\n\x1b[Kb: 1\r\n"), "a: 1\nb: 1");
  assert.equal(await render("abc\x1b[1G\x1b[2CX"), "abX");
});

test("docker compose: log lines stay together, with its menu at the bottom of the screen", async () => {
  const model = createTextModel({ cols: 60, rows: 6 });
  // Recorded from `docker compose up`: before each log line it erases to the bottom of the screen and comes back.
  const eraseBelow = `\x1b[0G\x1b7${"\x1b[1B\x1b[2K".repeat(5)}\x1b8`;
  const menu = "\x1b[0G\x1b7\x1b[6;0H\x1b[2Kv View in Docker Desktop\x1b8";
  model.write("Attaching to web-1\r\n");
  for (const n of [0, 1, 2]) model.write(`${eraseBelow}web-1  | log ${n}\r\n${menu}`);
  await model.settled();
  assert.equal(model.text(), "Attaching to web-1\nweb-1  | log 0\nweb-1  | log 1\nweb-1  | log 2\n\nv View in Docker Desktop");

  for (const n of [3, 4, 5, 6]) model.write(`${eraseBelow}web-1  | log ${n}\r\n${menu}`); // past the bottom: it scrolls
  await model.settled();
  const lines = model.text().split("\n");
  assert.deepEqual(lines.filter((line) => line.startsWith("web-1")).map((line) => line.at(-1)), ["0", "1", "2", "3", "4", "5", "6"]);
});

test("a scroll region keeps the lines around it in place", async () => {
  const model = createTextModel({ cols: 20, rows: 4 });
  model.write("header\r\n\x1b[2;3r\x1b[2;1Hone\r\ntwo\r\nthree\x1b[r\x1b[4;1Hfooter");
  await model.settled();
  assert.equal(model.text(), "header\ntwo\nthree\nfooter");
});

test("a line longer than the screen is wide stays one line, and survives a resize", async () => {
  const model = createTextModel({ cols: 10, rows: 5 });
  const long = "words with spaces go past the edge";
  model.write(`${long}\r\nnext`);
  await model.settled();
  assert.equal(model.text(), `${long}\nnext`);
  model.resize(7, 5);
  assert.equal(model.text(), `${long}\nnext`);
});

test("output parsed later still reports back, in order", async () => {
  const model = createTextModel();
  const seen = [];
  model.write("a", () => seen.push(model.text()));
  model.write("b", () => seen.push(model.text()));
  await model.settled();
  assert.deepEqual(seen, ["a", "ab"]);
});

test("clear screen wipes what is on it; erase-below removes the lines underneath", async () => {
  assert.equal(await render("old\r\n\x1b[2J\x1b[Hnew"), "new");
  assert.equal(await render("a\r\nb\r\nc\x1b[1A\x1b[1G\x1b[J"), "a");
});

test("erasing the scrollback is reported once; a plain clear screen isn't reported", async () => {
  const model = createTextModel();
  model.write("old\r\n\x1b[2J\x1b[Hnew");
  await model.settled();
  assert.equal(model.takeErasedScrollback(), false);
  model.write("\x1b[3J\x1b[H\x1b[2Jafter"); // what `clear` sends
  await model.settled();
  assert.equal(model.text(), "after");
  assert.equal(model.takeErasedScrollback(), true);
  assert.equal(model.takeErasedScrollback(), false);
});

test("a sequence cut across chunks isn't printed", async () => {
  assert.equal(await render("x\x1b", "[31", "my\x1b]0;ti", "tle\x07z"), "xyz");
});

test("control characters don't appear", async () => {
  assert.equal(await render("a\x07b\x00c\x7fd"), "abcd");
});

test("wide unicode text passes through", async () => {
  assert.equal(await render("✓ héllo ❯"), "✓ héllo ❯");
});

test("endless output keeps only the most recent lines", async () => {
  const model = createTextModel();
  for (let i = 0; i < 30000; i++) model.write(`line ${i}\r\n`);
  await model.settled();
  const lines = model.text().split("\n");
  assert.ok(lines.length <= 20024);
  assert.equal(lines.at(-1), "line 29999");
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
