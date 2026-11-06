// The terminal area: a plain textarea, so the cursor can go anywhere like in an editor.
// Pressing Enter on a line that starts with the prompt runs that line as a command.

import { PROMPT, colorVar } from "./constants.js";
import { $ } from "./util.js";
import { state, activeTab, getTab, getGroup, commit, saveSoon, isRunning, startRun, finishRun, stopRun } from "./store.js";
import { runCommand } from "./shell.js";

const editor = $("editor");
const gutter = $("gutter");

export function initEditor() {
  editor.addEventListener("input", onInput);
  editor.addEventListener("keydown", onKeyDown);
  editor.addEventListener("scroll", () => { gutter.scrollTop = editor.scrollTop; });
  for (const type of ["keyup", "click", "select"]) editor.addEventListener(type, renderCursorPosition);
}

export const focusEditor = () => editor.focus();

export function renderEditor() {
  const tab = activeTab();
  editor.disabled = !tab;
  $("colorbar").style.background = colorVar(tab?.color) ?? "transparent";

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
  const tab = activeTab();
  if (tab) tab.content = editor.value;
  renderGutter();
  saveSoon();
}

function onKeyDown(event) {
  if (event.key === "Tab") {
    event.preventDefault();
    editor.setRangeText("    ", editor.selectionStart, editor.selectionEnd, "end");
    onInput();
  } else if (event.key === "c" && event.ctrlKey && !event.metaKey) {
    if (stopRun(state.ws.activeTab)) event.preventDefault();
  } else if (event.key === "Enter" && !event.shiftKey) {
    runLineAtCursor(event);
  }
}

// ---------- running commands ----------
function lineAtCursor() {
  const value = editor.value;
  const pos = editor.selectionStart;
  const start = value.lastIndexOf("\n", pos - 1) + 1;
  const newline = value.indexOf("\n", pos);
  const end = newline === -1 ? value.length : newline;
  return { text: value.slice(start, end), end };
}

function runLineAtCursor(event) {
  const tab = activeTab();
  if (!tab || isRunning(tab.id)) return; // while running, Enter just inserts a newline
  const line = lineAtCursor();
  if (!line.text.startsWith(PROMPT)) return; // not a prompt line: normal editor newline
  event.preventDefault();

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
  let result;
  try {
    result = await runCommand(command, tab, { emit: (text) => appendToTab(tab, `\n${text}`), signal });
  } catch (err) {
    result = { output: signal.aborted ? "^C" : `error: ${err.message}` };
  } finally {
    finishRun(tab);
  }
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

function moveCursorToEnd() {
  editor.selectionStart = editor.selectionEnd = editor.value.length;
  editor.scrollTop = editor.scrollHeight;
}

// ---------- gutter & status ----------
function renderGutter() {
  const lines = editor.value.split("\n").length;
  gutter.textContent = Array.from({ length: lines }, (_, i) => i + 1).join("\n");
  gutter.scrollTop = editor.scrollTop;
}

function renderCursorPosition() {
  const before = editor.value.slice(0, editor.selectionStart).split("\n");
  $("stPos").textContent = `Ln ${before.length}, Col ${before.at(-1).length + 1}`;
}
