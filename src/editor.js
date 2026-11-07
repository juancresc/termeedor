// The terminal area: a plain textarea that behaves like a terminal. Only the text after
// the last prompt can be edited; the history above is read-only but can be selected and
// copied. Typing anywhere goes to the input, Enter runs it, Up/Down recall past commands.
// Enter on an earlier command runs it again. The text is only a view of the tab's transcript
// (terminal/transcript.js), which is what says where the commands are.

import { colorVar } from "./constants.js";
import { $, el } from "./util.js";
import { state, activeTab, getTab, getGroup, commit, saveSoon, hasSaveFailed, isRunning, startRun, finishRun, stopRun } from "./store.js";
import { isMac } from "./platform.js";
import { emit as emitPluginEvent } from "./plugins/registry.js";
import { isMenuOpen, selectedItem, showMenu, closeMenu, moveSelection, placeMenu } from "./completionMenu.js";
import { forwardKey, forwardPaste, getCompletions, runCommand } from "./terminal/runner.js";
import { runs } from "./terminal/runState.js";
import {
  addCommandBlock, addTextBlock, appendOutput, clearEarlier, clearTranscript, commandForEnter, finishBlock,
  layoutTranscript, oneLine, promptFor, promptLengthAt, trimTranscript,
} from "./terminal/transcript.js";

const editor = $("editor");
const gutter = $("gutter");
const PROBE_LINES = 100;
const CARET_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
const textMeasure = document.createElement("canvas").getContext("2d");
let commandLines = []; // indexes of the lines that start a command
let recall = null; // browsing past commands: { tabId, index, draft }
let completionRequest = 0; // only the newest request may show its results

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
    $("stRunning").textContent = statusNotice(null);
    renderGutter();
    return;
  }

  if (editor.dataset.tab !== tab.id) {
    editor.value = layoutOf(tab).text;
    editor.dataset.tab = tab.id;
    moveCursorToEnd();
    if (!document.querySelector(".inlineInput")) editor.focus();
  }
  $("stTab").textContent = `${getGroup(tab.groupId).name} › ${tab.name}`;
  $("stCwd").textContent = tab.cwd;
  $("stRunning").textContent = statusNotice(tab);
  renderGutter();
  renderCursorPosition();
}

function statusNotice(tab) {
  const notices = [];
  if (tab && isRunning(tab.id)) notices.push("● running — Ctrl+C to stop");
  if (hasSaveFailed()) notices.push("⚠ Couldn't save: storage may be full");
  return notices.join(" · ");
}

// ---------- events ----------
function onInput() {
  recall = null;
  const tab = activeTab();
  if (tab) syncDraft(tab);
  editor.scrollTop = editor.scrollHeight; // edits only happen on the last line, so show it fully
  renderGutter();
  saveSoon();
  if (isMenuOpen()) refreshMenu();
}

function onKeyDown(event) {
  // While a real program runs, the keyboard belongs to it.
  if (forwardKey(state.ws.activeTab, event)) {
    event.preventDefault();
    return;
  }
  if (isMenuOpen() && handleMenuKey(event)) return;

  if (event.key === "Tab") {
    event.preventDefault();
    if (event.shiftKey || !completeAtCursor()) insertIntoInput("    ");
  } else if (event.code === "KeyC" && event.ctrlKey && !event.metaKey) {
    if (stopRun(state.ws.activeTab) || dropDraft()) event.preventDefault();
  } else if (isOnlyCtrl(event) && CTRL_KEYS[event.code]) {
    event.preventDefault();
    CTRL_KEYS[event.code](event);
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
  if (type === "insertFromPaste" && forwardPaste(state.ws.activeTab, event.data ?? "")) {
    event.preventDefault();
    return;
  }
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
const layoutOf = (tab) => layoutTranscript(tab, { prompt: !isRunning(tab.id) });

/** Where the input starts, or null if it can't be edited right now (a command is running). */
function inputStart() {
  const tab = activeTab();
  return tab ? layoutOf(tab).draftStart : null;
}

/** Only the draft comes back from the text area. An edit that got past the input rules, such as undo, is put back. */
function syncDraft(tab) {
  const { text, draftStart } = layoutOf(tab);
  const draft = editor.value.slice(draftStart ?? 0);
  if (draftStart !== null && editor.value.startsWith(text.slice(0, draftStart)) && !/[\r\n]/.test(draft)) {
    tab.draft = draft;
  } else {
    editor.value = text;
    moveCursorToEnd();
  }
}

/** Inserts at the cursor if it is in the input, otherwise at the end of the input. */
function insertIntoInput(text) {
  const start = inputStart();
  if (start === null) return;
  const inInput = editor.selectionStart >= start;
  const end = editor.value.length;
  editor.setRangeText(text, inInput ? editor.selectionStart : end, inInput ? editor.selectionEnd : end, "end");
  onInput();
}

/** For the mouse, which can't be stopped in advance. Keys are handled by stopCursorAtInput. */
function keepCursorOutOfPrompt() {
  if (document.activeElement !== editor) return;
  const start = inputStart();
  const from = editor.selectionStart;
  if (start === null || from >= start || from < start - promptFor(activeTab().cwd).length) return;
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
  if (event.shiftKey || event.metaKey || event.altKey || event.ctrlKey) return;
  const start = inputStart();
  if (start === null || editor.selectionStart < start) return;
  event.preventDefault();
  recallCommand(event.key === "ArrowUp" ? -1 : 1);
}

function recallCommand(delta) {
  const tab = activeTab();
  const start = inputStart();
  if (start === null || editor.selectionStart < start) return;

  const { history } = tab;
  if (recall?.tabId !== tab.id) recall = { tabId: tab.id, index: history.length, draft: editor.value.slice(start) };
  const index = recall.index + delta;
  if (index < 0 || index > history.length) return;
  recall.index = index;

  editor.setRangeText(index === history.length ? recall.draft : oneLine(history[index]), start, editor.value.length, "end");
  editor.scrollTop = editor.scrollHeight;
  syncDraft(tab);
  renderGutter();
  renderCursorPosition();
  saveSoon();
}

// Cmd+A on Mac, Ctrl+A elsewhere. On a Mac, Ctrl+A keeps its usual "go to line start".
const isSelectAll = (event) =>
  event.code === "KeyA" && !event.altKey && !event.shiftKey && (isMac ? event.metaKey : event.ctrlKey);

const isOnlyCtrl = (event) => event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

function deleteToInput(type) {
  const start = inputStart();
  if (start !== null && editor.selectionStart >= start) deleteBackToInput(type, start, editor.selectionStart);
}

/** Ctrl+C with nothing running: the typed line is abandoned, as in a shell. A selection is left for copying. */
function dropDraft() {
  const tab = activeTab();
  if (!tab || inputStart() === null || !tab.draft || editor.selectionStart !== editor.selectionEnd) return false;
  addTextBlock(tab, `${promptFor(tab.cwd)}${tab.draft}^C`);
  tab.draft = "";
  recall = null;
  showContent(tab);
  moveCursorToEnd();
  return true;
}

/** Like the `clear` command. What is being typed stays. */
function clearScreen() {
  const tab = activeTab();
  if (!tab || inputStart() === null) return;
  clearTranscript(tab);
  showContent(tab);
  moveCursorToEnd();
}

// Readline's keys. Ctrl+W is Mac only: elsewhere it closes the tab (keymap.js).
const CTRL_KEYS = {
  KeyU: () => deleteToInput("deleteHardLineBackward"),
  KeyL: clearScreen,
  KeyP: () => recallCommand(-1),
  KeyN: () => recallCommand(1),
  ...(isMac ? { KeyW: () => deleteToInput("deleteWordBackward") } : {}),
};

/** Selects the cursor's line; on a prompt line, only the input after the prompt. */
function selectLineAtCursor() {
  const { start, end } = lineAtCursor();
  const tab = activeTab();
  editor.setSelectionRange(start + (tab ? promptLengthAt(layoutOf(tab), start) : 0), end);
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
  completeFrom(context);
  return true;
}

/** Completions can come from the disk. Returns null if the input changed while waiting for them. */
async function fetchCompletions(context) {
  const request = ++completionRequest;
  const items = await getCompletions(context.input, context.tab);
  const now = completionContext();
  return request === completionRequest && now?.input === context.input && now.tab === context.tab ? items : null;
}

async function completeFrom(context) {
  const items = await fetchCompletions(context);
  if (!items) return;
  if (items.length === 1) {
    applyCompletion(items[0].value);
  } else if (items.length > 1) {
    const shared = sharedPrefix(items.map((item) => item.value));
    if (shared !== context.input) applyCompletion(shared);
    openMenu(items);
  }
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
async function refreshMenu() {
  const context = completionContext();
  if (!context) return closeMenu();
  const items = await fetchCompletions(context);
  if (!items) return;
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
  return { start, end: newline === -1 ? value.length : newline };
}

function runLineAtCursor() {
  const tab = activeTab();
  if (!tab || isRunning(tab.id)) return;
  recall = null;

  // Re-running an earlier command leaves what is being typed in the draft, for when it ends.
  const { command: line, rerun } = commandForEnter(tab, editor.selectionStart);
  if (!rerun) tab.draft = "";
  const command = line.trim();
  if (command) tab.history.push(command);
  execute(tab, command);
}

async function execute(tab, command) {
  const block = addCommandBlock(tab, command, tab.cwd);
  const signal = startRun(tab, block);
  showContent(tab);
  if (editor.dataset.tab === tab.id) moveCursorToEnd();
  emitPluginEvent("command:start", { tab, command });
  let result;
  try {
    result = await runCommand(command, tab, {
      setOutput:(text, erased) => setRunningOutput(tab, block, text, erased),
      signal,
    });
  } catch (err) {
    result = { output: signal.aborted ? "^C" : `error: ${err.message}` };
  } finally {
    finishRun(tab);
  }
  emitPluginEvent("command:finish", { tab, command, output: result.output ?? "", aborted: signal.aborted });
  if (!getTab(tab.id)) return; // tab was closed meanwhile

  if (result.output && !result.shown) appendOutput(block, result.output);
  finishBlock(tab, block, result.exit);
  trimTranscript(tab);
  showContent(tab);
  if (editor.dataset.tab === tab.id) moveCursorToEnd();
  commit(); // refresh tab name/color/spinner and save
}

// ---------- content helpers ----------
/** Replaces what the running command has shown so far: output can overwrite itself. */
function setRunningOutput(tab, block, text, erased = false) {
  if (erased) clearEarlier(tab, block);
  block.output = text;
  showContent(tab);
}

/** Shows the transcript without moving the user's cursor, unless it was already at the end. */
function showContent(tab) {
  if (editor.dataset.tab === tab.id) {
    const atEnd = editor.selectionStart === editor.value.length;
    const { selectionStart, selectionEnd, scrollTop } = editor;
    editor.value = layoutOf(tab).text;
    if (atEnd) moveCursorToEnd();
    else {
      editor.setSelectionRange(selectionStart, selectionEnd);
      editor.scrollTop = scrollTop;
    }
    renderGutter();
  }
  saveSoon();
}

/** A line of output from outside a command. It goes above a running command, and above the prompt otherwise. */
export function printToTab(tab, text) {
  addTextBlock(tab, `${text}`, runs.block(tab.id));
  showContent(tab);
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
  const tab = getTab(editor.dataset.tab);
  commandLines = tab ? layoutOf(tab).commandLines.filter((line) => line > 0) : []; // nothing to separate above line 1
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
