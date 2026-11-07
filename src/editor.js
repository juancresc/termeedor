// The terminal area: command blocks (terminal/outputView.js) over an input (terminal/inputEditor.js).
// This connects the two, runs commands, and keeps the status bar. Both only display the tab's
// transcript (terminal/transcript.js), which is what says what is a command.

import { colorVar } from "./constants.js";
import { $ } from "./util.js";
import { activeTab, getTab, getGroup, commit, saveSoon, hasSaveFailed, isRunning, startRun, finishRun } from "./store.js";
import { emit as emitPluginEvent } from "./plugins/registry.js";
import { runCommand } from "./terminal/runner.js";
import { runs } from "./terminal/runState.js";
import { focusInput, initInput, renderInput } from "./terminal/inputEditor.js";
import { followBottom, initOutput, keepPinned, noteSnapshot, pageOutput, renderOutput, selectAllOutput } from "./terminal/outputView.js";
import {
  addCommandBlock, addTextBlock, appendOutput, clearEarlier, clearTranscript, finishBlock, promptFor, setBlockOutput, trimTranscript,
} from "./terminal/transcript.js";

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
}

export const focusEditor = focusInput;

export function renderEditor() {
  const tab = activeTab() ?? null;
  $("colorbar").style.background = colorVar(tab?.color) ?? "transparent";
  showBoth(tab);
  $("stTab").textContent = tab ? `${getGroup(tab.groupId).name} › ${tab.name}` : "No open tabs";
  $("stCwd").textContent = tab?.cwd ?? "";
  $("stRunning").textContent = statusNotice(tab);
  if (!tab) $("stPos").textContent = "";
}

function statusNotice(tab) {
  const notices = [];
  if (tab && isRunning(tab.id)) notices.push("● running — Ctrl+C to stop");
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
  execute(tab, command);
}

async function execute(tab, command) {
  const block = addCommandBlock(tab, command, tab.cwd);
  const signal = startRun(tab, block);
  showContent(tab);
  if (activeTab() === tab) followBottom();
  emitPluginEvent("command:start", { tab, command });
  let result;
  try {
    result = await runCommand(command, tab, {
      setOutput: (snapshot, erased) => setRunningOutput(tab, block, snapshot, erased),
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
  commit(); // refresh tab name/color/spinner and save
}

/** Replaces what the running command has shown so far: output can overwrite itself. */
function setRunningOutput(tab, block, snapshot, erased = false) {
  if (erased) clearEarlier(tab, block);
  setBlockOutput(block, snapshot.text, snapshot.styles);
  noteSnapshot(block, snapshot);
  showContent(tab);
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
