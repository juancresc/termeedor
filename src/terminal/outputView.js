// The output area: a tab's blocks as read-only DOM, with native selection and copy. Only what
// changed is touched, so a command streaming output never rebuilds the other blocks and text
// selected in them survives. Text is only ever set as text, and colors come through styles.js.
//
// A running block's output has two parts. What the text model says can't change any more goes
// into chunks, which are added once and only removed from the front when scrollback runs out.
// What is left, the screen, goes into the tail, whose pieces are compared on each redraw. So a
// redraw costs what changed, not the whole 20,000 lines of scrollback.

import { $, el } from "../util.js";
import { styleCss, styledSegments } from "./styles.js";
import { promptFor } from "./transcript.js";

const PIN_SLACK = 4; // px from the bottom that still counts as being at the bottom
const CHUNK_CHARS = 32_768; // how much text one chunk holds, so a long output isn't one huge box

const output = $("output");
const scroller = $("termScroll"); // holds the output and the input, which scroll together
const savedScroll = new WeakMap(); // tab -> { top, pinned }, while it isn't the tab on screen
const changes = new WeakMap(); // block -> the latest snapshot of it, which says what can be kept
let shown = null;
let views = new Map(); // block -> what is drawn for it
let pinned = true; // following the bottom, because the user hasn't scrolled up
let onRerun = () => {};

export function initOutput({ rerun, focusInput }) {
  onRerun = rerun;
  scroller.addEventListener("scroll", () => { pinned = isAtBottom(); });
  // A click focuses the input, but a drag or double click has selected text to copy.
  scroller.addEventListener("mouseup", (event) => {
    if (event.button === 0 && getSelection().isCollapsed) focusInput();
  });
}

/** Tells the view what a snapshot from the text model allows it to keep. Call when setting the block's output from one. */
export function noteSnapshot(block, snapshot) {
  changes.set(block, snapshot);
}

// ---------- scrolling ----------
const isAtBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight <= PIN_SLACK;

const toBottom = () => { scroller.scrollTop = scroller.scrollHeight; };

/** Call after the area changed size, or anything else that can leave the bottom out of view. */
export function keepPinned() {
  if (pinned) toBottom();
}

/** Back to following the bottom, as when a new command starts. */
export function followBottom() {
  pinned = true;
  toBottom();
}

export function pageOutput(direction) {
  scroller.scrollTop += direction * Math.max(1, scroller.clientHeight - (parseFloat(getComputedStyle(output).lineHeight) || 0));
}

export function selectAllOutput() {
  getSelection().selectAllChildren(output);
}

// ---------- commands ----------
function rerunButton(block) {
  const button = el("button", "rerun");
  button.type = "button";
  button.title = "Run again";
  button.setAttribute("aria-label", "Run again");
  button.addEventListener("mousedown", (event) => event.preventDefault()); // keep focus in the input
  button.addEventListener("click", () => onRerun(block));
  return button;
}

/** A migrated or printed block has a null command, so nothing in its text can ever get a button. */
function drawCommand(view, block) {
  if (view.command === block.command) return;
  view.command = block.command;
  view.commandLine?.remove();
  view.commandLine = null;
  view.node.classList.toggle("isCommand", block.command !== null);
  if (block.command === null) return;

  const line = el("div", "commandLine");
  line.append(el("span", "commandPrompt", promptFor(block.cwd)), el("span", "commandText", block.command));
  if (block.command.trim()) line.append(rerunButton(block));
  view.node.insertBefore(line, view.body);
  view.commandLine = line;
}

// ---------- text ----------
function pieceNode({ text, code }) {
  const textNode = document.createTextNode(text);
  const css = code === null ? null : styleCss(code);
  if (!css) return { text, code, node: textNode, textNode };

  const span = el("span", css.className);
  if (css.color) span.style.color = css.color;
  if (css.background) span.style.backgroundColor = css.background;
  span.append(textNode);
  return { text, code, node: span, textNode };
}

function fillChunk(node, text, styles, from, to) {
  node.replaceChildren(...styledSegments(text, styles, from, to).map((segment) => pieceNode(segment).node));
}

function addChunk(view, text, styles, from, to) {
  const node = el("div", "outputChunk");
  fillChunk(node, text, styles, from, to);
  view.body.insertBefore(node, view.tail);
  view.chunks.push({ node, length: to - from });
}

/** Moves [view.frozen, end) into chunks, each ending on a line break where one is near. */
function freezeUpTo(view, end, text, styles) {
  while (view.frozen < end) {
    const wanted = view.frozen + CHUNK_CHARS;
    const newline = wanted < end ? text.indexOf("\n", wanted) : -1;
    const to = newline === -1 || newline >= end ? end : newline + 1;
    addChunk(view, text, styles, view.frozen, to);
    view.frozen = to;
  }
}

/** The first `cut` characters of what was frozen have gone. What is left of a chunk starts the new text. */
function dropFromFront(view, cut, text, styles) {
  let left = cut;
  while (left > 0) {
    const chunk = view.chunks[0];
    if (chunk.length <= left) {
      left -= chunk.length;
      chunk.node.remove();
      view.chunks.shift();
    } else {
      chunk.length -= left;
      fillChunk(chunk.node, text, styles, 0, chunk.length);
      left = 0;
    }
  }
  view.frozen -= cut;
}

function startOver(view) {
  for (const chunk of view.chunks) chunk.node.remove();
  view.chunks = [];
  view.frozen = 0;
  view.pieces.splice(0).forEach((piece) => piece.node.remove());
}

/** Keeps every piece that is still the same, so a selection in it survives. Most output only adds to the end. */
function drawTail(view, text, styles) {
  const next = styledSegments(text, styles, view.frozen);
  const drawn = view.pieces;
  let same = 0;
  while (same < drawn.length && same < next.length && drawn[same].text === next[same].text && drawn[same].code === next[same].code) same++;

  const last = drawn[same];
  if (same === drawn.length - 1 && next[same]?.code === last.code && next[same].text.startsWith(last.text)) {
    last.textNode.appendData(next[same].text.slice(last.text.length));
    last.text = next[same].text;
    same++;
  }

  for (const stale of drawn.splice(same)) stale.node.remove();
  for (const segment of next.slice(same)) {
    const piece = pieceNode(segment);
    view.tail.append(piece.node);
    drawn.push(piece);
  }
}

/** How far the block's output can be frozen, and whether what is drawn is a start on it. Without a snapshot, the text is taken as final. */
function readChange(view, block) {
  const snapshot = changes.get(block);
  if (snapshot?.text !== block.output) return { stable: block.output.length, follows: false, cut: 0 };
  const follows = snapshot.since !== null && snapshot.since === view.output && snapshot.stable >= view.frozen - snapshot.cut && snapshot.cut <= view.frozen;
  return { stable: snapshot.stable, follows, cut: snapshot.cut };
}

function drawOutput(view, block) {
  if (view.output === block.output && view.styles === block.styles) return;
  const { stable, follows, cut } = readChange(view, block);
  if (follows) dropFromFront(view, cut, block.output, block.styles);
  else startOver(view);
  view.output = block.output;
  view.styles = block.styles;

  freezeUpTo(view, stable, block.output, block.styles);
  drawTail(view, block.output, block.styles);
}

function createView() {
  const node = el("div", "block");
  const body = el("div", "blockOutput");
  const tail = el("div", "outputTail");
  body.append(tail);
  node.append(body);
  return { node, body, tail, commandLine: null, command: undefined, output: "", styles: undefined, chunks: [], frozen: 0, pieces: [] };
}

// ---------- rendering ----------
function drawBlocks(tab) {
  const current = new Set(tab.blocks);
  for (const [block, view] of views) {
    if (current.has(block)) continue;
    view.node.remove();
    views.delete(block);
  }
  let cursor = output.firstChild;
  for (const block of tab.blocks) {
    if (!views.has(block)) views.set(block, createView());
    const view = views.get(block);
    drawCommand(view, block);
    drawOutput(view, block);
    if (view.node === cursor) cursor = cursor.nextSibling;
    else output.insertBefore(view.node, cursor);
  }
}

function switchTo(tab) {
  if (shown) savedScroll.set(shown, { top: scroller.scrollTop, pinned });
  output.replaceChildren();
  views = new Map();
  shown = tab;
}

/** Shows the tab's blocks, or nothing if there is no tab. */
export function renderOutput(tab, { running = false } = {}) {
  const switched = tab !== shown;
  if (switched) switchTo(tab ?? null);
  output.classList.toggle("running", running);
  if (!tab) return;

  drawBlocks(tab);
  if (switched) {
    const saved = savedScroll.get(tab);
    pinned = saved?.pinned ?? true;
    if (!pinned) scroller.scrollTop = saved.top;
  }
  keepPinned();
}
