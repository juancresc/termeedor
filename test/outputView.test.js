// The output view against real snapshots from the text model, with the stub DOM. What matters is
// that the page always reads the same as the block, however little of it was redrawn.

import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeFor } from "./support/editorDom.js";

const { initOutput, noteSnapshot, renderOutput } = await import("../src/terminal/outputView.js");
const { createTextModel } = await import("../src/terminal/textModel.js");
const { setBlockOutput } = await import("../src/core/transcript.js");
const { styledSegments, styleCss, parseStyleCode } = await import("../src/core/styles.js");

initOutput({ rerun() {}, focusInput() {} });
const output = nodeFor("output");

const newTab = () => ({ blocks: [{ command: "run", output: "", exit: null, cwd: "~" }], draft: "" });
const bodyNode = () => output.children.at(-1).allWithClass("blockOutput")[0];
const chunks = () => output.children.at(-1).allWithClass("outputChunk");

function show(tab, snapshot) {
  const [block] = tab.blocks;
  setBlockOutput(block, snapshot.text, snapshot.styles);
  noteSnapshot(block, snapshot);
  renderOutput(tab, { running: true });
}

async function write(model, data) {
  model.write(data);
  await model.settled();
  return model.styled();
}

/** What the page shows, as [text, is it styled] for each piece of text. */
const shownPieces = () => bodyNode().children.flatMap((part) => part.children).map((node) => [node.textContent, node.tagName !== "#text"]);

function assertReads(tab) {
  const [block] = tab.blocks;
  assert.equal(bodyNode().textContent, block.output);
  const expected = styledSegments(block.output, block.styles).filter((piece) => piece.code !== null).map((piece) => piece.text).join("");
  const styled = shownPieces().filter(([, isStyled]) => isStyled).map(([text]) => text).join("");
  assert.equal(styled, expected);
}

test("lines that scrolled off are never redrawn while the screen keeps changing", async () => {
  const tab = newTab();
  const model = createTextModel({ cols: 20, rows: 4 });
  show(tab, await write(model, "a\r\nb\r\nc\r\nd\r\ne\r\nf"));
  assertReads(tab);
  const [first] = chunks();
  assert.ok(first);
  const firstText = first.children[0];

  show(tab, await write(model, "\rrewritten\x1b[K"));
  assertReads(tab);
  assert.equal(chunks()[0], first);
  assert.equal(first.children[0], firstText);

  show(tab, await write(model, "\r\nnew\r\nlines\r\nhere\r\nnow"));
  assertReads(tab);
  assert.equal(chunks()[0], first);
  assert.equal(first.children[0], firstText);
});

test("when the scrollback is full, the front goes and the rest stays", async () => {
  const tab = newTab();
  const model = createTextModel({ cols: 20, rows: 3, scrollback: 6 });
  show(tab, await write(model, "\x1b[32ma\x1b[0m\r\nb\r\nc\r\nd\r\ne\r\n"));
  const kept = chunks()[0];
  for (const line of ["f", "g", "h", "i", "j", "k", "l", "m"]) {
    show(tab, await write(model, `\x1b[3${line.charCodeAt(0) % 8}m${line}\x1b[0m\r\n`));
    assertReads(tab);
  }
  assert.equal(kept.parent, null); // it scrolled out of what is kept
  assert.ok(bodyNode().textContent.endsWith("m"));
  assert.ok(!bodyNode().textContent.includes("b"));
});

test("a chunk cut in half by the scrollback limit shows only what is left", async () => {
  const tab = newTab();
  const model = createTextModel({ cols: 5, rows: 2, scrollback: 3 });
  show(tab, await write(model, "\x1b[31mabcdefghijklmn\x1b[0m\r\nx\r\ny\r\n"));
  assertReads(tab);
  show(tab, await write(model, "z\r\n"));
  assertReads(tab);
});

test("a reset or a resize redraws, and the page still reads the same", async () => {
  const tab = newTab();
  const model = createTextModel({ cols: 20, rows: 3 });
  show(tab, await write(model, "a\r\nb\r\nc\r\nd\r\ne\r\n"));
  model.resize(30, 3);
  show(tab, model.styled());
  assertReads(tab);
  show(tab, await write(model, "\x1bcfresh"));
  assertReads(tab);
  assert.equal(bodyNode().textContent, "fresh");
});

test("coming back to a tab mid-run draws all of it, and later output carries on from there", async () => {
  const tab = newTab();
  const model = createTextModel({ cols: 20, rows: 3 });
  show(tab, await write(model, "a\r\nb\r\nc\r\nd\r\ne\r\n"));
  renderOutput(newTab());
  const [block] = tab.blocks;
  const away = await write(model, "f\r\ng\r\n"); // nothing draws this tab while it is away
  setBlockOutput(block, away.text, away.styles);
  noteSnapshot(block, away);

  renderOutput(tab, { running: true });
  assertReads(tab);
  show(tab, await write(model, "h\r\ni\r\nj\r\nk\r\n"));
  assertReads(tab);
});

test("a block that wasn't given a snapshot is drawn whole, and any change to it too", () => {
  const tab = { blocks: [{ command: null, output: "plain\ntext", exit: null, cwd: null, styles: [[0, 5, "31"]] }], draft: "" };
  renderOutput(tab);
  assertReads(tab);
  tab.blocks[0].output = "changed\ntext";
  tab.blocks[0].styles = [[8, 12, "32"]];
  renderOutput(tab);
  assertReads(tab);
});

test("a long saved output is split into chunks on line breaks, and reads the same", () => {
  const text = Array.from({ length: 6000 }, (_, i) => `line ${i} ${"x".repeat(20)}`).join("\n");
  const tab = { blocks: [{ command: null, output: text, exit: null, cwd: null }], draft: "" };
  renderOutput(tab);
  assert.ok(chunks().length > 1);
  assert.ok(chunks().slice(0, -1).every((chunk) => chunk.textContent.endsWith("\n")));
  assert.equal(bodyNode().textContent, text);
});

test("whatever the program does, the page reads the same as the block", async () => {
  let seed = 4242;
  const random = (n) => { seed = (seed * 1103515245 + 12345) % 2147483648; return seed % n; };
  const moves = [
    () => `\x1b[3${random(8)}mcolor ${random(99)}\x1b[0m plain ${"x".repeat(random(30))}\r\n`,
    () => `\x1b[1;4${random(8)}m${"long ".repeat(random(20))}\x1b[0m\r\n`,
    () => "partial",
    () => "\rover\x1b[K",
    () => `\x1b[${1 + random(3)}A\x1b[Kup\x1b[${1 + random(3)}B\r`,
    () => "\x1b[2J\x1b[H",
    () => "日本語 ",
    () => "\r\n\r\n",
  ];
  const tab = newTab();
  const model = createTextModel({ cols: 16, rows: 5, scrollback: 30 });
  for (let step = 0; step < 500; step++) {
    show(tab, await write(model, moves[random(moves.length)]()));
    assertReads(tab);
  }
  model.dispose();
});

test("colors reach the page only as theme variables or checked numbers", () => {
  assert.deepEqual(styleCss("1;31"), { className: "ansiBold", color: "var(--ansi-1)", background: null });
  assert.deepEqual(styleCss("97;100"), { className: "", color: "var(--ansi-15)", background: "var(--ansi-8)" });
  assert.equal(styleCss("38;5;196").color, "rgb(255, 0, 0)");
  assert.equal(styleCss("38;5;232").color, "rgb(8, 8, 8)");
  assert.equal(styleCss("48;2;1;2;3").background, "rgb(1, 2, 3)");
  assert.deepEqual(styleCss("7"), { className: "", color: "var(--term)", background: "var(--text)" });
  assert.deepEqual(styleCss("7;31;42"), { className: "", color: "var(--ansi-2)", background: "var(--ansi-1)" });
  for (const bad of ["</span>", "38;2;999;0;0", "38;5;1", "31;1", "99", "", "1;;2"]) {
    assert.equal(styleCss(bad), null, bad);
    assert.equal(parseStyleCode(bad), null, bad);
  }
});
