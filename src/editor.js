// The terminal area: command blocks (terminal/outputView.js) over an input (terminal/inputEditor.js).
// This connects the two to the tabs' sessions (terminal/session.js), and keeps the status bar and
// the full-screen terminal. Both only display the tab's transcript (core/transcript.js), which is
// what says what is a command. The session changes it; this only listens.

import { $ } from "./util.js";
import { state, activeTab, getGroup, saveSoon, saveWorkspace, hasSaveFailed, isRunning } from "./store.js";
import { onRunChange, onSessionEvent, prepareShell, resizeSessions, runCommand } from "./terminal/runner.js";
import { runs } from "./core/runState.js";
import { closeFullscreen, openFullscreen, refitFullscreen, showFullscreenFor, writeFullscreen } from "./terminal/fullscreen.js";
import { textAreaSize } from "./terminal/size.js";
import { focusInput, initInput, renderInput } from "./terminal/inputEditor.js";
import { followBottom, initOutput, keepPinned, noteSnapshot, pageOutput, renderOutput, selectAllOutput } from "./terminal/outputView.js";
import { addTextBlock, clearTranscript, promptFor } from "./core/transcript.js";

export function initEditor() {
  initOutput({ rerun, focusInput });
  initInput({
    run: runDraft,
    dropDraft,
    clearScreen,
    resized: keepPinned,
    pageOutput,
    selectOutput: selectAllOutput,
  });
  window.addEventListener("resize", keepPinned);
  onRunChange(renderRunStatus);
  listenToSessions();

  // The output area changes size with the window, and also with the sidebar or the input's height.
  let resizeTimer;
  let lastSize = "";
  const resized = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      refitFullscreen();
      const { cols, rows } = textAreaSize();
      if (`${cols}x${rows}` === lastSize) return;
      lastSize = `${cols}x${rows}`;
      resizeSessions(cols, rows);
    }, 100);
  };
  window.addEventListener("resize", resized);
  if (typeof ResizeObserver === "function") {
    const observer = new ResizeObserver(resized);
    observer.observe($("output"));
    observer.observe($("termScroll"));
  }
}

export const focusEditor = focusInput;

export function renderEditor() {
  const tab = activeTab() ?? null;
  showBoth(tab);
  if (tab) prepareShell(tab, textAreaSize); // a tab's shell starts when the tab is first shown
  $("stTab").textContent = tab ? [getGroup(tab.groupId).name, tab.name].filter(Boolean).join(" › ") : "No open tabs";
  renderRunStatus();
  if (!tab) $("stPos").textContent = "";
  showFullscreenFor(state.ws.activeTab);
}

/** The parts of the status bar that a command changes. */
function renderRunStatus() {
  const tab = activeTab() ?? null;
  $("stCwd").textContent = tab?.cwd ?? "";
  $("stRunning").textContent = statusNotice(tab);
}

function statusNotice(tab) {
  const notices = [];
  if (hasSaveFailed()) notices.push("⚠ Couldn't save: storage may be full");
  return notices.join(" · ");
}

function showBoth(tab) {
  renderOutput(tab, { running: !!tab && isRunning(tab.id) });
  if (renderInput(tab) && tab && !document.querySelector(".inlineInput")) focusInput();
  keepPinned(); // the input appearing or going away changes the output's height
}

/** Shows the tab if it is the one on screen. Either way, what changed gets saved. */
function showContent(tab) {
  if (activeTab() === tab) showBoth(tab);
  saveSoon();
}

// ---------- running commands ----------
function runDraft(tab, text) {
  if (isRunning(tab.id)) return;
  tab.draft = "";
  start(tab, text);
}

/** Clicking a block's button is the only way to run an old command. What is being typed stays in the draft, for when it ends. */
function rerun(block) {
  const tab = activeTab();
  if (!tab || isRunning(tab.id) || block.command === null || !tab.blocks.includes(block)) return;
  start(tab, block.command);
  focusInput();
}

function start(tab, text) {
  const command = text.trim();
  if (command) tab.history.push(command);
  runCommand(tab, command, textAreaSize());
}

/** What a session does shows here. A view of raw bytes (xterm for the whole tab) would listen to `data` instead. */
function listenToSessions() {
  onSessionEvent("start", ({ tab }) => {
    saveWorkspace();
    showContent(tab);
    if (activeTab() === tab) followBottom();
  });
  onSessionEvent("output", ({ tab }, { block, snapshot }) => {
    noteSnapshot(block, snapshot);
    showContent(tab);
  });
  onSessionEvent("typeahead", ({ tab }) => showContent(tab));
  onSessionEvent("finish", ({ tab }, { closed }) => {
    if (closed) return; // the tab was closed meanwhile
    showContent(tab);
    saveWorkspace();
  });

  // Full-screen programs (vim, top) get xterm over the terminal area while they run.
  onSessionEvent("fullscreen", (session, { on, closing }) => {
    const tabId = session.tab.id;
    if (on) {
      openFullscreen(tabId, { onData: session.write, onResize: session.resizePty });
      showFullscreenFor(state.ws.activeTab);
      return;
    }
    closeFullscreen(tabId);
    if (closing) return;
    const { cols, rows } = textAreaSize();
    session.resizePty(cols, rows);
    if (state.ws.activeTab === tabId) $("editor").focus();
  });
  onSessionEvent("data", (session, { data }) => {
    if (session.fullscreen) writeFullscreen(session.tab.id, data);
  });
}

// ---------- what the input's keys ask for ----------
function dropDraft(tab) {
  addTextBlock(tab, `${promptFor(tab.cwd)}${tab.draft}^C`);
  tab.draft = "";
  showContent(tab);
  followBottom();
}

/** Like the `clear` command. What is being typed stays. */
function clearScreen(tab) {
  if (!tab || isRunning(tab.id)) return;
  clearTranscript(tab);
  showContent(tab);
  followBottom();
}

/** A line of output from outside a command. It goes above a running command, and at the bottom otherwise. */
export function printToTab(tab, text) {
  addTextBlock(tab, `${text}`, runs.block(tab.id));
  showContent(tab);
}
