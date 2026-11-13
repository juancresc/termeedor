import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS } from "../src/constants.js";
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

test("the text stays plain whatever the styling", async () => {
  assert.equal(await render("\x1b[1;31mred\x1b[0m \x1b]0;title\x07text\x1b(B"), "red text");
});

async function styled(...chunks) {
  const model = createTextModel();
  chunks.forEach((chunk) => model.write(chunk));
  await model.settled();
  const { text, styles } = model.styled();
  assert.equal(text, model.text());
  return { text, styles };
}

test("each kind of styling comes out as a range over the plain text", async () => {
  const cases = [
    ["\x1b[31mx\x1b[0m", "31"], ["\x1b[97mx\x1b[0m", "97"], ["\x1b[41mx\x1b[0m", "41"], ["\x1b[107mx\x1b[0m", "107"],
    ["\x1b[38;5;200mx\x1b[0m", "38;5;200"], ["\x1b[48;5;16mx\x1b[0m", "48;5;16"], ["\x1b[38;5;3mx\x1b[0m", "33"], ["\x1b[38;5;9mx\x1b[0m", "91"],
    ["\x1b[38;2;1;2;3mx\x1b[0m", "38;2;1;2;3"], ["\x1b[48;2;255;0;9mx\x1b[0m", "48;2;255;0;9"],
    ["\x1b[38:2::1:2:3mx\x1b[0m", "38;2;1;2;3"], ["\x1b[38:5:200mx\x1b[0m", "38;5;200"],
    ["\x1b[1mx\x1b[0m", "1"], ["\x1b[2mx\x1b[0m", "2"], ["\x1b[3mx\x1b[0m", "3"], ["\x1b[4mx\x1b[0m", "4"], ["\x1b[4:3mx\x1b[0m", "4"], ["\x1b[7mx\x1b[0m", "7"],
    ["\x1b[1;2;3;4;7;31;42mx\x1b[m", "1;2;3;4;7;31;42"],
  ];
  for (const [input, code] of cases) assert.deepEqual(await styled(input), { text: "x", styles: [[0, 1, code]] }, JSON.stringify(input));
});

test("styling turns off the way the program says", async () => {
  assert.deepEqual((await styled("\x1b[1;31ma\x1b[22mb\x1b[39mc")).styles, [[0, 1, "1;31"], [1, 2, "31"]]);
  assert.deepEqual((await styled("\x1b[3;4;7;41ma\x1b[23;24;27;49mb")).styles, [[0, 1, "3;4;7;41"]]);
  assert.deepEqual((await styled("\x1b[31ma\x1b[mb")).styles, [[0, 1, "31"]]);
});

test("broken or private sequences leave the text alone and print nothing", async () => {
  for (const input of ["\x1b[>4;2mx", "\x1b[?1mx", "\x1b[999mx", "\x1b[58;5;9mx"]) {
    assert.deepEqual(await styled(input), { text: "x", styles: [] }, JSON.stringify(input));
  }
});

test("a sequence cut across chunks still takes effect", async () => {
  assert.deepEqual(await styled("\x1b", "[3", "1mred"), { text: "red", styles: [[0, 3, "31"]] });
});

test("overwriting redraws the style too: progress bars and cursor movement", async () => {
  assert.deepEqual(await styled("\x1b[31m 10%\x1b[0m\r\x1b[32m100%\x1b[0m"), { text: "100%", styles: [[0, 4, "32"]] });
  assert.deepEqual(await styled("\x1b[31mabc\x1b[0m\rX"), { text: "Xbc", styles: [[1, 3, "31"]] });
  assert.deepEqual(await styled("a: \x1b[31m0\x1b[0m\r\nb: 0\r\n\x1b[2A\x1b[Ka: \x1b[32m1\x1b[0m\r\n\r\n"), { text: "a: 1\nb: 0", styles: [[3, 4, "32"]] });
});

test("clearing the screen clears its colors", async () => {
  assert.deepEqual(await styled("\x1b[31mold\x1b[2J\x1b[Hnew"), { text: "new", styles: [[0, 3, "31"]] });
  assert.deepEqual(await styled("\x1b[31ma\r\nb\x1b[1A\x1b[1G\x1b[J\x1b[0mc"), { text: "c", styles: [] });
});

test("ranges stay inside the text, past blank ends and gaps", async () => {
  assert.deepEqual(await styled("\x1b[41mab\x1b[K\x1b[0m\r\n\x1b[41m\x1b[K\x1b[0m\r\n"), { text: "ab", styles: [[0, 2, "41"]] });
  assert.deepEqual(await styled("one\r\n\x1b[5C\x1b[31mx"), { text: "one\n     x", styles: [[9, 10, "31"]] });
  assert.deepEqual(await styled("héllo ✓ \x1b[31mok"), { text: "héllo ✓ ok", styles: [[8, 10, "31"]] });
});

test("wide characters take one place in the text, however many cells they fill", async () => {
  assert.deepEqual(await styled("\x1b[31m日本\x1b[0m語\x1b[32mz"), { text: "日本語z", styles: [[0, 2, "31"], [3, 4, "32"]] });
});

test("a prompt with no line break keeps its space, so typing lands after it", async () => {
  assert.equal((await styled(">>> ")).text, ">>> ");
});

test("a long line's color carries over the wrap as one range", async () => {
  const model = createTextModel({ cols: 5, rows: 3 });
  model.write("\x1b[31mabcdefgh\x1b[0m");
  await model.settled();
  assert.deepEqual(model.styled().styles, [[0, 8, "31"]]);
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

test("endless colored output keeps the newest ranges, and they still match", async () => {
  const model = createTextModel();
  for (let i = 0; i < 25000; i++) model.write(`\x1b[${31 + (i % 2)}m${i % 10}\x1b[0m\r\n`);
  await model.settled();
  const { text, styles } = model.styled();
  assert.ok(styles.length <= LIMITS.styleRanges);
  assert.ok(styles.every(([start, end]) => end <= text.length && start < end));
  assert.equal(text.slice(styles.at(-1)[0], styles.at(-1)[1]), "9");
  assert.deepEqual(styles.at(-1).slice(2), ["32"]);
});

// ---------- only reading what can have changed ----------
const lineOf = (n) => `\x1b[${31 + (n % 7)}mline\x1b[0m ${n} ${"x".repeat(n % 45)}\r\n`;

test("a snapshot only reads the screen and what newly scrolled off it", async () => {
  const model = createTextModel({ cols: 40, rows: 10 });
  for (let n = 0; n < 500; n++) model.write(lineOf(n));
  await model.settled();
  model.styled();
  const before = model.rowsRead();
  model.write("one more\r\n");
  await model.settled();
  model.styled();
  assert.ok(model.rowsRead() - before <= 11, `read ${model.rowsRead() - before} rows`);
});

test("what can't change any more is reported, and it really doesn't change", async () => {
  const model = createTextModel({ cols: 20, rows: 3 });
  model.write("a\r\nb\r\nc\r\nd\r\ne");
  await model.settled();
  const first = model.styled();
  assert.equal(first.text, "a\nb\nc\nd\ne");
  assert.equal(first.text.slice(0, first.stable), "a\nb\n");
  model.write("\x1b[2J\x1b[Hz");
  await model.settled();
  const second = model.styled();
  assert.equal(second.since, first.text);
  assert.equal(second.text, "a\nb\nz");
  assert.equal(second.text.slice(0, second.stable), "a\nb\n");
});

test("cached lines and a first read agree, whatever the program does", async () => {
  let seed = 12345;
  const random = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const moves = [
    () => lineOf(random(200)),
    () => `\x1b[3${random(8)}m${"long ".repeat(random(30))}\x1b[0m\r\n`,
    () => "progress\r\x1b[K",
    () => `\x1b[${1 + random(4)}A\x1b[Kup\x1b[${1 + random(4)}B\r`,
    () => "\x1b[2J\x1b[H",
    () => "\x1b7\x1b[6;1H\x1b[2Kmenu\x1b8",
    () => "日本語 ".repeat(random(12)),
    () => "\r\n",
  ];
  const stream = createTextModel({ cols: 24, rows: 6, scrollback: 40 });
  const chunks = [];
  for (let step = 0; step < 600; step++) {
    const chunk = moves[random(moves.length)]();
    chunks.push(chunk);
    stream.write(chunk);
    if (step % 7 === 0) {
      await stream.settled();
      const seen = stream.styled();
      const fresh = createTextModel({ cols: 24, rows: 6, scrollback: 40 });
      chunks.forEach((c) => fresh.write(c));
      await fresh.settled();
      const expected = fresh.styled();
      fresh.dispose();
      assert.equal(seen.text, expected.text, `text at step ${step}`);
      assert.deepEqual(seen.styles, expected.styles, `styles at step ${step}`);
      assert.ok(seen.text.slice(0, seen.stable).length === seen.stable);
    }
  }
  stream.dispose();
});

test("once the scrollback is full, what goes from the front is reported", async () => {
  const model = createTextModel({ cols: 20, rows: 3, scrollback: 5 });
  for (let n = 0; n < 7; n++) model.write(`\x1b[32ml${n}\x1b[0m\r\n`);
  await model.settled();
  const first = model.styled();
  for (let n = 7; n < 9; n++) model.write(`\x1b[32ml${n}\x1b[0m\r\n`);
  await model.settled();
  const second = model.styled();
  assert.equal(second.cut, "l1\nl2\n".length);
  assert.equal(second.since, first.text);
  assert.ok(second.text.startsWith(first.text.slice(second.cut, first.stable)));
  assert.equal(second.text.slice(second.styles[0][0], second.styles[0][1]), second.text.split("\n")[0]);
  assert.ok(second.styles.every(([, end]) => end <= second.text.length));
});

test("a wrapped line cut in half by the scrollback limit keeps its end", async () => {
  const model = createTextModel({ cols: 5, rows: 2, scrollback: 2 });
  model.write("\x1b[31mabcdefghijklmno\x1b[0m\r\nend\r\n");
  await model.settled();
  const seen = model.styled();
  model.write("more\r\n");
  await model.settled();
  const fresh = createTextModel({ cols: 5, rows: 2, scrollback: 2 });
  fresh.write("\x1b[31mabcdefghijklmno\x1b[0m\r\nend\r\nmore\r\n");
  await fresh.settled();
  const after = model.styled();
  const expected = fresh.styled();
  assert.equal(after.text, expected.text);
  assert.deepEqual(after.styles, expected.styles);
  assert.ok(seen.since === null);
});

test("erasing the scrollback, a reset or a resize starts over", async () => {
  const model = createTextModel({ cols: 20, rows: 3 });
  const fill = async () => {
    for (let n = 0; n < 10; n++) model.write(`l${n}\r\n`);
    await model.settled();
    return model.styled();
  };
  await fill();
  model.write("\x1b[3Jx");
  await model.settled();
  assert.equal(model.styled().since, null);

  await fill();
  model.write("\x1bcfresh");
  await model.settled();
  const reset = model.styled();
  assert.equal(reset.since, null);
  assert.equal(reset.text, "fresh");

  await fill();
  model.resize(30, 3);
  assert.equal(model.styled().since, null);
});

const key = (key, extra = {}) => ({ key, code: "", metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...extra });

test("keys become the bytes a terminal would send", () => {
  assert.equal(keyToBytes(key("a")), "a");
  assert.equal(keyToBytes(key("Enter")), "\r");
  assert.equal(keyToBytes(key("Enter", { shiftKey: true })), "\x1b\r");
  assert.equal(keyToBytes(key("Enter", { altKey: true })), "\x1b\r");
  assert.equal(keyToBytes(key("Backspace")), "\x7f");
  assert.equal(keyToBytes(key("ArrowUp")), "\x1b[A");
  assert.equal(keyToBytes(key("c", { ctrlKey: true, code: "KeyC" })), "\x03");
  assert.equal(keyToBytes(key("d", { ctrlKey: true, code: "KeyD" })), "\x04");
});

test("modified keys send what macOS terminals send", () => {
  assert.equal(keyToBytes(key("Tab", { shiftKey: true })), "\x1b[Z");
  assert.equal(keyToBytes(key("Tab")), "\t");
  assert.equal(keyToBytes(key("Backspace", { altKey: true })), "\x1b\x7f");
  assert.equal(keyToBytes(key("ArrowLeft", { altKey: true })), "\x1bb");
  assert.equal(keyToBytes(key("ArrowRight", { altKey: true })), "\x1bf");
  assert.equal(keyToBytes(key("_", { ctrlKey: true, shiftKey: true, code: "Minus" })), "\x1f");
  assert.equal(keyToBytes(key("]", { ctrlKey: true, code: "BracketRight" })), "\x1d");
  assert.equal(keyToBytes(key(" ", { ctrlKey: true, code: "Space" })), "\x00");
  assert.equal(keyToBytes(key("[", { ctrlKey: true, code: "BracketLeft" })), "\x1b");
  assert.equal(keyToBytes(key("Delete", { altKey: true })), "\x1bd");
});

test("Cmd's line-editing keys send what macOS terminals send", () => {
  assert.equal(keyToBytes(key("ArrowLeft", { metaKey: true })), "\x01");
  assert.equal(keyToBytes(key("ArrowRight", { metaKey: true })), "\x05");
  assert.equal(keyToBytes(key("Backspace", { metaKey: true })), "\x15");
  assert.equal(keyToBytes(key("ArrowLeft", { metaKey: true, shiftKey: true })), null);
});

test("the app keeps Cmd shortcuts, selection keys and bare modifiers", () => {
  assert.equal(keyToBytes(key("c", { metaKey: true })), null);
  assert.equal(keyToBytes(key("ArrowLeft", { shiftKey: true })), null);
  assert.equal(keyToBytes(key("Shift", { shiftKey: true })), null);
});

// ---------- the cursor ----------
async function cursorAfter(data, size = { cols: 10, rows: 5 }) {
  const model = createTextModel(size);
  model.write(data);
  await model.settled();
  const { text, cursor } = model.styled();
  return cursor === null ? null : `${text.slice(0, cursor)}|${text.slice(cursor)}`;
}

test("the cursor is where the program left it, as when a shell's line is edited over ssh", async () => {
  assert.equal(await cursorAfter("$ echo hi"), "$ echo hi|");
  assert.equal(await cursorAfter("$ echo hi\b\b\b"), "$ echo| hi");
  assert.equal(await cursorAfter("one\r\ntwo\r\n$ abc\x1b[2D"), "one\ntwo\n$ a|bc");
});

test("the cursor is found in a line that wrapped, on any of its rows", async () => {
  const typed = "$ echo one two three four"; // 25 characters over 3 rows of 10
  assert.equal(await cursorAfter(typed), `${typed}|`);
  assert.equal(await cursorAfter(`${typed}\x1b[A\x1b[3G`), "$ echo one t|wo three four");
  assert.equal(await cursorAfter(`${typed}\x1b[2A\r`), `|${typed}`);
  assert.equal(await cursorAfter("0123456789"), "0123456789|", "at the edge, before the next character wraps");
});

test("the cursor counts in the text's characters, not in columns", async () => {
  assert.equal(await cursorAfter("日本語\b\b"), "日本|語");
  assert.equal(await cursorAfter("a😀b\b"), "a😀|b");
});

test("a cursor past the text shows at the end of its line, or of all the text", async () => {
  assert.equal(await cursorAfter("ab\x1b[5C"), "ab|");
  assert.equal(await cursorAfter("ab\r\ncd\x1b[A\x1b[5C"), "ab|\ncd");
  assert.equal(await cursorAfter("ab\r\n\r\n"), "ab|");
  assert.equal(await cursorAfter("ab\r\n\r\ncd\x1b[A"), "ab\n|\ncd");
});

test("the cursor stays right once lines have scrolled off", async () => {
  assert.equal(await cursorAfter("1\r\n2\r\n3\r\n4\r\n$ abc\b", { cols: 10, rows: 2 }), "1\n2\n3\n4\n$ ab|c");
});

test("a program can hide the cursor and show it again", async () => {
  assert.equal(await cursorAfter("ab\x1b[?25l"), null);
  assert.equal(await cursorAfter("ab\x1b[?25l\x1b[?25h"), "ab|");
  assert.equal(await cursorAfter("ab\x1b[?25l\x1bccd"), "cd|", "a reset shows it");
});
