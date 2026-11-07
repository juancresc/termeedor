// The terminal area: a plain textarea that behaves like a terminal. Only the text after
// the last prompt can be edited; the history above is read-only but can be selected and
// copied. Typing anywhere goes to the input, Enter runs it, Up/Down recall past commands.
// Enter on an earlier prompt line runs that line again.

import { PROMPT, colorVar } from "./constants.js";
import { $, el } from "./util.js";
import { state, activeTab, getTab, getGroup, commit, saveSoon, isRunning, startRun, finishRun, stopRun } from "./store.js";
import { runCommand, getCompletions } from "./shell.js";
import { emit as emitPluginEvent } from "./plugins/registry.js";
import { isMenuOpen, selectedItem, showMenu, closeMenu, moveSelection, placeMenu } from "./completionMenu.js";

const editor = $("editor");
const gutter = $("gutter");
const PROBE_LINES = 100;
const CARET_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
const textMeasure = document.createElement("canvas").getContext("2d");
let commandLines = []; // indexes of the lines that start a command
let recall = null; // browsing past commands: { tabId, index, draft }

export function initEditor() {
  $("lineProbe").textContent = "x\n".repeat(PROBE_LINES - 1) + "x";
  editor.addEventListener("beforeinput", onBeforeInput);
  editor.addEventListener("input", onInput);
  editor.addEventListener("keydown", onKeyDown);
  editor.addEventListener("scroll", () => {
    gutter.scrollTop = editor.scrollTop;
    renderCommandLines();
    if (isMenuOpen()) placeMenuAtCaret();
  });
  editor.addEventListener("mousedown", closeMenu);
  editor.addEventListener("blur", closeMenu);
  window.addEventListener("resize", () => { closeMenu(); renderCommandLines(); });
  document.addEventListener("selectionchange", keepCursorOutOfPrompt);
  for (const type of ["keyup", "click", "select"]) editor.addEventListener(type, renderCursorPosition);
}

export const focusEditor = () => editor.focus();

export function renderEditor() {
  const tab = activeTab();
  editor.disabled = !tab;
  $("colorbar").style.background = colorVar(tab?.color) ?? "transparent";

  if (editor.dataset.tab !== (tab?.id ?? "")) closeMenu();

  if (!tab) {
    editor.value = "";
    editor.dataset.tab = "";
    $("stTab").textContent = "No open tabs";
    $("stCwd").textContent = "";
    $("stRunning").textContent = "";
    renderGutter();
    return;
  }

  if (editor.dataset.tab !== tab.id) {
    ensurePrompt(tab);
    editor.value = tab.content;
    editor.dataset.tab = tab.id;
    moveCursorToEnd();
    if (!document.querySelector(".inlineInput")) editor.focus();
  }
  $("stTab").textContent = `${getGroup(tab.groupId).name} › ${tab.name}`;
  $("stCwd").textContent = tab.cwd;
  $("stRunning").textContent = isRunning(tab.id) ? "● running — Ctrl+C to stop" : "";
  renderGutter();
  renderCursorPosition();
}

// ---------- events ----------
function onInput() {
  recall = null;
  const tab = activeTab();
  if (tab) tab.content = editor.value;
  renderGutter();
  saveSoon();
  if (isMenuOpen()) refreshMenu();
}

function onKeyDown(event) {
  if (isMenuOpen() && handleMenuKey(event)) return;

  if (event.key === "Tab") {
    event.preventDefault();
    if (event.shiftKey || !completeAtCursor()) insertIntoInput("    ");
  } else if (event.code === "KeyC" && event.ctrlKey && !event.metaKey) {
    if (stopRun(state.ws.activeTab)) event.preventDefault();
  } else if (event.key === "Enter") {
    event.preventDefault();
    runLineAtCursor();
  } else if (isSelectAll(event)) {
    event.preventDefault();
    selectLineAtCursor();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    recallOnArrow(event);
  } else {
    stopCursorAtInput(event);
  }
}

/** Every edit passes through here, so nothing but the input can ever change. */
function onBeforeInput(event) {
  const type = event.inputType;
  const start = inputStart();
  const { selectionStart: from, selectionEnd: to } = editor;

  if (start === null || type === "insertLineBreak" || type === "insertParagraph" || type === "insertFromDrop" || type === "deleteByDrag") {
    event.preventDefault();
  } else if (type.startsWith("insert")) {
    const text = event.data ?? "";
    if (from >= start && !text.includes("\n")) return; // normal typing: let the browser do it
    event.preventDefault();
    insertIntoInput(text.replace(/\r?\n/g, " "));
  } else if (type.startsWith("delete")) {
    if (from < start) {
      event.preventDefault();
      if (type !== "deleteByCut") moveCursorToEnd();
    } else if (from === to && type.includes("Backward") && (from === start || type !== "deleteContentBackward")) {
      event.preventDefault(); // these could reach into the prompt; a plain Backspace inside the input can't
      deleteBackToInput(type, start, from);
    }
  }
}

/** Option+Backspace deletes a word, Cmd+Backspace everything before the cursor. Never the prompt. */
function deleteBackToInput(type, start, caret) {
  if (caret === start) return;
  const kept = type === "deleteWordBackward" ? editor.value.slice(start, caret).replace(/\S*\s*$/, "").length : 0;
  editor.setRangeText("", start + kept, caret, "end");
  onInput();
}

// ---------- the input: everything after the last prompt ----------
/** Where the input starts, or null if it can't be edited right now (a command is running). */
function inputStart() {
  const tab = activeTab();
  if (!tab || isRunning(tab.id)) return null;
  const lastLine = editor.value.lastIndexOf("\n") + 1;
  return editor.value.startsWith(PROMPT, lastLine) ? lastLine + PROMPT.length : null;
}

/** Tabs saved before the history became read-only may not end in a prompt. */
function ensurePrompt(tab) {
  if (isRunning(tab.id) || tab.content.slice(tab.content.lastIndexOf("\n") + 1).startsWith(PROMPT)) return;
  tab.content += `${tab.content ? "\n" : ""}${PROMPT}`;
}

/** Inserts at the cursor if it is in the input, otherwise at the end of the input. */
function insertIntoInput(text) {
  const start = inputStart();
  if (start === null) return;
  const inInput = editor.selectionStart >= start;
  const end = editor.value.length;
  editor.setRangeText(text, inInput ? editor.selectionStart : end, inInput ? editor.selectionEnd : end, "end");
  editor.scrollTop = editor.scrollHeight;
  onInput();
}

/** For the mouse, which can't be stopped in advance. Keys are handled by stopCursorAtInput. */
function keepCursorOutOfPrompt() {
  if (document.activeElement !== editor) return;
  const start = inputStart();
  const from = editor.selectionStart;
  if (start === null || from >= start || from < start - PROMPT.length) return;
  editor.setSelectionRange(start, Math.max(editor.selectionEnd, start), editor.selectionDirection);
  renderCursorPosition();
}

/** Decided before the cursor moves, so it never enters the prompt and has nothing to bounce back from. */
function stopCursorAtInput(event) {
  const start = inputStart();
  const { selectionStart: from, selectionEnd: to, selectionDirection } = editor;
  if (start === null || from < start) return;

  const left = event.key === "ArrowLeft";
  const macCtrl = isMac && event.ctrlKey; // Ctrl+A = line start, Ctrl+B = back one character
  const onlySpacesBefore = !editor.value.slice(start, from).trim();
  const jumpsToLineStart = event.key === "Home" || (macCtrl && event.code === "KeyA")
    || (left && (event.metaKey || (event.altKey && onlySpacesBefore)));
  const stepsBack = (left && !event.metaKey && !event.altKey) || (macCtrl && event.code === "KeyB");

  if (jumpsToLineStart) {
    event.preventDefault();
    if (event.shiftKey) editor.setSelectionRange(start, to, "backward");
    else editor.setSelectionRange(start, start);
  } else if (stepsBack && from === start && (from === to || (event.shiftKey && selectionDirection !== "forward"))) {
    event.preventDefault();
  }
}

function recallOnArrow(event) {
  const tab = activeTab();
  const start = inputStart();
  if (start === null || editor.selectionStart < start || event.shiftKey || event.metaKey || event.altKey || event.ctrlKey) return;
  event.preventDefault();

  const { history } = tab;
  if (recall?.tabId !== tab.id) recall = { tabId: tab.id, index: history.length, draft: editor.value.slice(start) };
  const index = recall.index + (event.key === "ArrowUp" ? -1 : 1);
  if (index < 0 || index > history.length) return;
  recall.index = index;

  editor.setRangeText(index === history.length ? recall.draft : history[index], start, editor.value.length, "end");
  editor.scrollTop = editor.scrollHeight;
  tab.content = editor.value;
  renderGutter();
  renderCursorPosition();
  saveSoon();
}

// Cmd+A on Mac, Ctrl+A elsewhere. On a Mac, Ctrl+A keeps its usual "go to line start".
const isMac = /Mac/.test(navigator.platform);
const isSelectAll = (event) =>
  event.code === "KeyA" && !event.altKey && !event.shiftKey && (isMac ? event.metaKey : event.ctrlKey);

/** Selects the cursor's line; on a prompt line, only the input after the prompt. */
function selectLineAtCursor() {
  const { text, start, end } = lineAtCursor();
  editor.setSelectionRange(start + (text.startsWith(PROMPT) ? PROMPT.length : 0), end);
}

// ---------- tab completion ----------
/** The typed text up to the cursor, or null if the cursor isn't in the input or text is selected. */
function completionContext() {
  const start = inputStart();
  const { selectionStart: from, selectionEnd: to } = editor;
  if (start === null || from !== to || from < start) return null;
  return { tab: activeTab(), start, input: editor.value.slice(start, from) };
}

/** Returns false if there is nothing to complete from. A cursor up in the history goes back to the input. */
function completeAtCursor() {
  const start = inputStart();
  if (start !== null && editor.selectionStart === editor.selectionEnd && editor.selectionStart < start) moveCursorToEnd();
  const context = completionContext();
  if (!context) return false;
  const items = getCompletions(context.input, context.tab);
  if (items.length === 1) {
    applyCompletion(items[0].value);
  } else if (items.length > 1) {
    const shared = sharedPrefix(items.map((item) => item.value));
    if (shared !== context.input) applyCompletion(shared);
    openMenu(items);
  }
  return true;
}

const sharedPrefix = (values) => values.reduce((prefix, value) => {
  let length = 0;
  while (length < prefix.length && prefix[length] === value[length]) length++;
  return prefix.slice(0, length);
});

/** Replaces the input before the cursor; anything after the cursor stays. */
function applyCompletion(value) {
  editor.setRangeText(value, inputStart(), editor.selectionStart, "end");
  onInput();
  revealCaret();
}

function openMenu(items) {
  showMenu(items, (item) => {
    closeMenu();
    applyCompletion(item.value);
  });
  placeMenuAtCaret();
}

/** Narrows the open menu to what is typed now, and closes it when nothing is left to offer. */
function refreshMenu() {
  const context = completionContext();
  const items = context ? getCompletions(context.input, context.tab) : [];
  const finished = items.length === 1 && items[0].value.trim() === context.input.trim();
  if (!items.length || finished) closeMenu();
  else openMenu(items);
}

/** Returns true if the menu used the key. */
function handleMenuKey(event) {
  if (event.metaKey || event.ctrlKey || event.altKey || CARET_KEYS.includes(event.key)) {
    closeMenu();
    return false;
  }
  if (event.key === "Tab") moveSelection(event.shiftKey ? -1 : 1);
  else if (event.key === "ArrowDown") moveSelection(1);
  else if (event.key === "ArrowUp") moveSelection(-1);
  else if (event.key === "Escape") closeMenu();
  else if (event.key === "Enter") {
    const { value } = selectedItem();
    closeMenu();
    applyCompletion(value);
  } else return false;
  event.preventDefault();
  return true;
}

/** Where the caret is, measured from the top left of the text. Lines never wrap. */
function caretOffset() {
  const before = editor.value.slice(0, editor.selectionStart).split("\n");
  textMeasure.font = getComputedStyle(editor).font;
  return { x: textMeasure.measureText(before.at(-1)).width, y: (before.length - 1) * lineHeight() };
}

function placeMenuAtCaret() {
  const box = editor.getBoundingClientRect();
  const style = getComputedStyle(editor);
  const { x, y } = caretOffset();
  const top = box.top + parseFloat(style.paddingTop) + y - editor.scrollTop;
  if (top < box.top || top + lineHeight() > box.bottom) return closeMenu(); // scrolled out of view
  placeMenu({ left: box.left + parseFloat(style.paddingLeft) + x - editor.scrollLeft, top, bottom: top + lineHeight() });
}

/** Setting text from code doesn't scroll the textarea, so bring the caret back into view. */
function revealCaret() {
  const { x } = caretOffset();
  const room = editor.clientWidth - 40;
  if (x < editor.scrollLeft || x > editor.scrollLeft + room) editor.scrollLeft = Math.max(0, x - room);
  editor.scrollTop = editor.scrollHeight; // the input is always the last line
}

// ---------- running commands ----------
function lineAtCursor() {
  const value = editor.value;
  const pos = editor.selectionStart;
  const start = value.lastIndexOf("\n", pos - 1) + 1;
  const newline = value.indexOf("\n", pos);
  const end = newline === -1 ? value.length : newline;
  return { text: value.slice(start, end), start, end };
}

function runLineAtCursor() {
  const tab = activeTab();
  if (!tab || isRunning(tab.id)) return;
  if (!lineAtCursor().text.startsWith(PROMPT)) moveCursorToEnd(); // on an output line: run the input
  const line = lineAtCursor();
  recall = null;

  const command = line.text.slice(PROMPT.length).trim();
  if (line.end !== editor.value.length) {
    // Re-running an earlier line: copy it onto the last prompt at the bottom.
    setTabContent(tab, tab.content.replace(/\n?❯ ?\s*$/, "") + `\n${PROMPT}${command}`);
  }
  if (command) tab.history.push(command);
  execute(tab, command);
}

async function execute(tab, command) {
  const signal = startRun(tab);
  emitPluginEvent("command:start", { tab, command });
  let result;
  try {
    result = await runCommand(command, tab, { emit: (text) => appendToTab(tab, `\n${text}`), signal });
  } catch (err) {
    result = { output: signal.aborted ? "^C" : `error: ${err.message}` };
  } finally {
    finishRun(tab);
  }
  emitPluginEvent("command:finish", { tab, command, output: result.output ?? "", aborted: signal.aborted });
  if (!getTab(tab.id)) return; // tab was closed meanwhile

  if (result.clear) setTabContent(tab, PROMPT);
  else appendToTab(tab, `${result.output ? `\n${result.output}` : ""}\n${PROMPT}`);
  if (editor.dataset.tab === tab.id) moveCursorToEnd();
  commit(); // refresh tab name/color/spinner and save
}

// ---------- content helpers ----------
function setTabContent(tab, content) {
  tab.content = content;
  if (editor.dataset.tab === tab.id) {
    editor.value = content;
    moveCursorToEnd();
    renderGutter();
  }
  saveSoon();
}

/** Append output without moving the user's cursor, unless it was already at the end. */
function appendToTab(tab, text) {
  tab.content += text;
  if (editor.dataset.tab === tab.id) {
    const atEnd = editor.selectionStart === editor.value.length;
    const { selectionStart, selectionEnd } = editor;
    editor.value = tab.content;
    if (atEnd) moveCursorToEnd();
    else editor.setSelectionRange(selectionStart, selectionEnd);
    renderGutter();
  }
  saveSoon();
}

/** A line of output from outside a command. Leaves a fresh prompt unless a command is still running. */
export function printToTab(tab, text) {
  appendToTab(tab, isRunning(tab.id) ? `\n${text}` : `\n${text}\n${PROMPT}`);
}

function moveCursorToEnd() {
  editor.selectionStart = editor.selectionEnd = editor.value.length;
  editor.scrollTop = editor.scrollHeight;
}

// ---------- gutter & status ----------
function renderGutter() {
  const lines = editor.value.split("\n");
  gutter.textContent = lines.map((_, i) => i + 1).join("\n");
  gutter.scrollTop = editor.scrollTop;
  commandLines = lines.flatMap((line, i) => (i > 0 && line.startsWith(PROMPT) ? [i] : [])); // nothing to separate above line 1
  renderCommandLines();
}

const lineHeight = () => $("lineProbe").getBoundingClientRect().height / PROBE_LINES; // browsers round the CSS value

/** Draws a hairline above each visible command. Lines never wrap, so a position is just line × height. */
function renderCommandLines() {
  const layer = $("cmdLines");
  layer.style.left = `${editor.offsetLeft}px`; // starts after the line numbers
  layer.style.width = `${editor.clientWidth}px`;

  const padding = parseFloat(getComputedStyle(editor).paddingTop);
  const visible = commandLines
    .map((line) => padding + line * lineHeight() - editor.scrollTop)
    .filter((top) => top >= 0 && top <= editor.clientHeight);

  layer.replaceChildren(...visible.map((top) => {
    const hairline = el("div");
    hairline.style.top = `${top}px`;
    return hairline;
  }));
}

function renderCursorPosition() {
  const before = editor.value.slice(0, editor.selectionStart).split("\n");
  $("stPos").textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
}
