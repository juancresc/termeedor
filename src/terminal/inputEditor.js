// The input: a plain textarea holding the tab's draft, with the prompt beside it. Enter runs it,
// Shift+Enter adds a line, Up and Down browse history from its first and last lines, and Tab
// completes. While a command runs it is out of sight but keeps focus, so keys and pastes can
// go to the program.

import { $ } from "../util.js";
import { isMac } from "../platform.js";
import { state, activeTab, isRunning, saveSoon, stopRun } from "../store.js";
import { closeMenu, isMenuOpen, moveSelection, placeMenu, selectedItem, showMenu } from "../completionMenu.js";
import { forwardKey, forwardPaste, getCompletions } from "./runner.js";
import { promptFor } from "../core/transcript.js";

const MAX_ROWS = 12; // past this the input scrolls, so it never pushes the output out of view
const TAB_TEXT = "    ";
const CARET_KEYS = ["ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
const MODIFIER_KEYS = ["Shift", "Control", "Alt", "Meta", "CapsLock", "Fn"];

const editor = $("editor");
const row = $("inputRow");
const lineNumbers = $("inputLines");
const textMeasure = document.createElement("canvas").getContext("2d");
let shownTab = null;
let recall = null; // browsing past commands: { tabId, history, index, draft }
let completionRequest = 0; // only the newest request may show its results
let actions = null;

/** actions: { run(tab, text), dropDraft(tab), clearScreen(tab), resized(), pageOutput(direction), selectOutput() } */
export function initInput(provided) {
  actions = provided;
  editor.addEventListener("beforeinput", onBeforeInput);
  editor.addEventListener("input", onInput);
  editor.addEventListener("keydown", onKeyDown);
  editor.addEventListener("scroll", () => {
    lineNumbers.scrollTop = editor.scrollTop;
    if (isMenuOpen()) placeMenuAtCaret();
  });
  editor.addEventListener("mousedown", closeMenu);
  editor.addEventListener("blur", closeMenu);
  for (const type of ["keyup", "click", "select"]) editor.addEventListener(type, renderCursorPosition);
  row.addEventListener("mousedown", (event) => {
    if (event.target === editor) return;
    event.preventDefault(); // the line numbers and the prompt aren't anything to select
    focusInput();
  });
  window.addEventListener("resize", closeMenu);
  document.addEventListener("keydown", onKeyDownElsewhere);
  document.addEventListener("paste", onPasteElsewhere);
}

export const focusInput = (options) => editor.focus(options);

const runningNow = () => {
  const tab = activeTab();
  return !!tab && isRunning(tab.id);
};

/** Puts the tab's draft in the input. Called on every change of state, so most of the time there is nothing to do. */
export function renderInput(tab) {
  editor.disabled = !tab;
  const switched = (tab ?? null) !== shownTab;
  if (switched) {
    closeMenu();
    shownTab = tab ?? null;
    recall = null;
  }
  const draft = tab?.draft ?? "";
  if (editor.value !== draft) editor.value = draft; // this leaves the caret at the end
  const prompt = tab ? promptFor(tab.cwd) : "";
  if ($("promptMark").textContent !== prompt) $("promptMark").textContent = prompt;
  row.classList.toggle("running", !tab || isRunning(tab.id));
  renderShape();
  renderCursorPosition();
  return switched;
}

/** Sets the height, and the line numbers that go with it. */
function renderShape() {
  const lines = editor.value.split("\n").length;
  const rows = Math.min(lines, MAX_ROWS);
  row.classList.toggle("multiline", lines > 1);
  if (editor.rows !== rows) {
    editor.rows = rows;
    actions.resized();
  }
  if (lineNumbers.dataset.lines !== `${lines}`) {
    lineNumbers.dataset.lines = `${lines}`;
    lineNumbers.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  }
  lineNumbers.scrollTop = editor.scrollTop;
}

function renderCursorPosition() {
  const before = editor.value.slice(0, editor.selectionStart).split("\n");
  $("stPos").textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
}

// ---------- edits ----------
function draftChanged() {
  const tab = activeTab();
  if (tab) tab.draft = editor.value;
  renderShape();
  renderCursorPosition();
  saveSoon();
}

function onInput() {
  if (runningNow()) { // text being composed can't be stopped in advance, and belongs to no draft
    editor.value = activeTab().draft;
    return;
  }
  recall = null;
  draftChanged();
  if (isMenuOpen()) refreshMenu();
}

/** While a command runs nothing may change the hidden draft: text goes to the program, the rest goes nowhere. */
function onBeforeInput(event) {
  if (!runningNow()) return;
  event.preventDefault();
  if (event.inputType === "insertFromPaste" || event.inputType === "insertText") forwardPaste(state.ws.activeTab, event.data ?? "");
}

/** Replaces the selection. Text set from code doesn't scroll the textarea, so the caret is brought back into view. */
function insertAtCaret(text) {
  editor.setRangeText(text, editor.selectionStart, editor.selectionEnd, "end");
  onInput();
  revealCaret();
}

/** A value set from code puts the caret at the end, and a browser leaves the scroll where it was. */
function setDraft(text) {
  editor.value = text;
  draftChanged();
  revealCaret();
}

const lineStart = (at) => editor.value.lastIndexOf("\n", at - 1) + 1;

function deleteBack(from) {
  editor.setRangeText("", from, editor.selectionStart, "end");
  onInput();
}

function deleteLineBack() {
  deleteBack(lineStart(editor.selectionStart));
}

function deleteWordBack() {
  deleteBack(editor.value.slice(0, editor.selectionStart).replace(/\S*\s*$/, "").length);
}

// ---------- history ----------
const caretOnFirstLine = () => !editor.value.slice(0, editor.selectionStart).includes("\n");
const caretOnLastLine = () => !editor.value.slice(editor.selectionEnd).includes("\n");

function recallOnArrow(event) {
  if (event.shiftKey || event.metaKey || event.altKey || event.ctrlKey) return;
  const up = event.key === "ArrowUp";
  if (!(up ? caretOnFirstLine() : caretOnLastLine())) return; // moves between the input's own lines
  event.preventDefault();
  recallCommand(up ? -1 : 1);
}

/**
 * The tab's own commands come last, so Up reaches them first; other open tabs' follow, then closed
 * tabs' (newest closed first), without repeats.
 */
function recallList(tab) {
  if (!state.settings.sharedHistory) return tab.history;
  const closed = [...state.past].reverse().flatMap((entry) => entry.tab.history);
  const others = closed.concat(state.ws.tabs.filter((t) => t !== tab).flatMap((t) => t.history));
  const own = new Set(tab.history);
  return [...new Set(others.filter((c) => !own.has(c)).reverse())].reverse().concat(tab.history);
}

function recallCommand(delta) {
  const tab = activeTab();
  if (!tab) return;
  if (recall?.tabId !== tab.id) {
    const history = recallList(tab);
    recall = { tabId: tab.id, history, index: history.length, draft: editor.value };
  }
  const { history } = recall;
  // Only commands that start with what was typed before browsing, as zsh's history-beginning-search.
  let index = recall.index + delta;
  while (index >= 0 && index < history.length && !history[index].startsWith(recall.draft)) index += delta;
  if (index < 0 || index > history.length) return;
  recall.index = index;
  setDraft(index === history.length ? recall.draft : history[index]);
}

// ---------- keys ----------
// Cmd+A on Mac, Ctrl+A elsewhere. On a Mac, Ctrl+A keeps its usual "go to line start".
const isSelectAll = (event) =>
  event.code === "KeyA" && !event.altKey && !event.shiftKey && (isMac ? event.metaKey : event.ctrlKey);

const isOnlyCtrl = (event) => event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;

// Readline's keys. Ctrl+W is Mac only: elsewhere it closes the tab (keymap.js).
const CTRL_KEYS = {
  KeyU: deleteLineBack,
  KeyL: () => actions.clearScreen(activeTab()),
  KeyP: () => recallCommand(-1),
  KeyN: () => recallCommand(1),
  ...(isMac ? { KeyW: deleteWordBack } : {}),
};

/** Ctrl+C with nothing running: the line is abandoned for a fresh one, as in a shell, typed on or not. A selection is left for copying. */
function dropDraft() {
  const tab = activeTab();
  if (!tab || editor.selectionStart !== editor.selectionEnd) return false;
  actions.dropDraft(tab);
  recall = null;
  return true;
}

function submit() {
  const tab = activeTab();
  if (!tab) return;
  recall = null;
  actions.run(tab, editor.value);
}

function onKeyDown(event) {
  // While a real program runs, the keyboard belongs to it.
  if (forwardKey(state.ws.activeTab, event)) {
    event.preventDefault();
    return;
  }
  if (event.isComposing) return; // Enter is confirming the text being composed
  if (event.code === "KeyC" && event.ctrlKey && !event.metaKey) {
    if (stopRun(state.ws.activeTab) || dropDraft()) event.preventDefault();
  } else if (runningNow()) {
    onKeyDownWhileRunning(event);
  } else {
    onEditingKey(event);
  }
}

/** Only reached by what a program can't take, or when the mock is running and takes nothing. */
function onKeyDownWhileRunning(event) {
  if (!isSelectAll(event)) return;
  event.preventDefault();
  actions.selectOutput();
  editor.blur(); // a copy reads the focused text box first, and the input is out of sight
}

function onEditingKey(event) {
  if (isMenuOpen() && handleMenuKey(event)) return;

  if (event.key === "Tab") {
    event.preventDefault();
    if (event.shiftKey || !completeAtCursor()) insertAtCaret(TAB_TEXT);
  } else if (isOnlyCtrl(event) && CTRL_KEYS[event.code]) {
    event.preventDefault();
    CTRL_KEYS[event.code]();
  } else if (event.key === "Enter") {
    event.preventDefault();
    if (event.shiftKey) insertAtCaret("\n");
    else submit();
  } else if (isSelectAll(event)) {
    event.preventDefault();
    editor.select();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    recallOnArrow(event);
  } else if ((event.key === "PageUp" || event.key === "PageDown") && !event.ctrlKey && !event.metaKey) { // Ctrl+PageUp/Down: groups
    event.preventDefault();
    actions.pageOutput(event.key === "PageUp" ? -1 : 1);
  }
}

// ---------- focus elsewhere in the area ----------
/** True when focus is on nothing in particular, or on the output's text. Other controls keep their keys. */
function focusIsInArea() {
  if (document.querySelector("dialog[open], .inlineInput")) return false;
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  return active.tagName !== "BUTTON" && $("output").contains(active);
}

/** Copying what is selected in the output is what those keys mean there, unless a program is waiting for Ctrl+C. */
function isCopyOfOutput(event) {
  return !isMac && event.ctrlKey && event.code === "KeyC" && !getSelection().isCollapsed && !runningNow();
}

function onKeyDownElsewhere(event) {
  if (event.target === editor || !focusIsInArea() || MODIFIER_KEYS.includes(event.key)) return;
  if ((event.metaKey && !isSelectAll(event)) || isCopyOfOutput(event)) return;
  focusInput();
  onKeyDown(event); // a typed character then lands in the input by itself
}

function onPasteElsewhere(event) {
  if (event.target === editor || !focusIsInArea()) return;
  const text = event.clipboardData?.getData("text/plain") ?? "";
  event.preventDefault();
  focusInput();
  if (!text) return;
  if (runningNow()) forwardPaste(state.ws.activeTab, text);
  else insertAtCaret(text.replace(/\r\n?/g, "\n"));
}

// ---------- tab completion ----------
/** The current line up to the cursor, or null if nothing can be completed right now. */
function completionContext() {
  const { selectionStart: from, selectionEnd: to } = editor;
  if (from !== to || runningNow()) return null;
  const start = lineStart(from);
  return { tab: activeTab(), start, input: editor.value.slice(start, from) };
}

/** Returns false if there is nothing to complete from. */
function completeAtCursor() {
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
  const unchanged = now?.input === context.input && now.start === context.start && now.tab === context.tab;
  return request === completionRequest && unchanged ? items : null;
}

async function completeFrom(context) {
  const items = await fetchCompletions(context);
  if (!items) return;
  if (items.length === 1) {
    applyCompletion(items[0].value);
  } else if (items.length > 1) {
    const shared = sharedPrefix(items.map((item) => item.value));
    if (shared.length > context.input.length) applyCompletion(shared); // a looser match can't take back what is typed
    openMenu(items);
  }
}

const sharedPrefix = (values) => values.reduce((prefix, value) => {
  let length = 0;
  while (length < prefix.length && prefix[length] === value[length]) length++;
  return prefix.slice(0, length);
});

/** Replaces the line before the cursor; anything after the cursor stays. */
function applyCompletion(value) {
  editor.setRangeText(value, lineStart(editor.selectionStart), editor.selectionStart, "end");
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

// ---------- caret ----------
const lineHeight = () => parseFloat(getComputedStyle(editor).lineHeight) || 20;

/** Where the caret is, measured from the top left of the text. Lines never wrap. */
function caretOffset() {
  const before = editor.value.slice(0, editor.selectionStart).split("\n");
  textMeasure.font = getComputedStyle(editor).font;
  return { x: textMeasure.measureText(before.at(-1)).width, y: (before.length - 1) * lineHeight() };
}

function placeMenuAtCaret() {
  const box = editor.getBoundingClientRect();
  const { x, y } = caretOffset();
  const top = box.top + y - editor.scrollTop;
  if (top < box.top || top + lineHeight() > box.bottom + 1) return closeMenu(); // scrolled out of view
  placeMenu({ left: box.left + x - editor.scrollLeft, top, bottom: top + lineHeight() });
}

function revealCaret() {
  const { x, y } = caretOffset();
  const room = editor.clientWidth - 40;
  if (x < editor.scrollLeft || x > editor.scrollLeft + room) editor.scrollLeft = Math.max(0, x - room);
  if (y < editor.scrollTop) editor.scrollTop = y;
  else if (y + lineHeight() > editor.scrollTop + editor.clientHeight) editor.scrollTop = y + lineHeight() - editor.clientHeight;
  lineNumbers.scrollTop = editor.scrollTop;
}
