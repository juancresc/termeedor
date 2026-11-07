// Runs a tab's commands on the backend (ports/backend.js) and shows the results. Its events
// become text through textModel, or go to xterm while a full-screen program runs.
// It doesn't know which backend it has: that is chosen in adapters/index.js.

import { $ } from "../util.js";
import { chooseBackend } from "../adapters/index.js";
import { getTab, state, subscribe } from "../store.js";
import { closeFullscreen, openFullscreen, refitFullscreen, showFullscreenFor, writeFullscreen } from "./fullscreen.js";
import { keyToBytes } from "./keys.js";
import { runs } from "./runState.js";
import { textAreaSize } from "./size.js";
import { createTextModel } from "./textModel.js";

const backend = chooseBackend(undefined, { getTab });
const FLUSH_MS = 50;
const started = new Set(); // tabs that have a shell

function flush(run) {
  clearTimeout(run.timer);
  run.timer = null;
  run.setOutput(run.model.text(), run.model.takeErasedScrollback());
}

function onEvent({ tabId, event }) {
  if (event.type === "exit") {
    started.delete(tabId);
    return;
  }
  const run = runs.shell(tabId);
  if (!run) return;
  if (event.type === "output") {
    if (run.fullscreen) {
      writeFullscreen(tabId, event.data);
    } else {
      run.model.write(event.data, () => {
        if (!run.ended) run.timer ??= setTimeout(() => flush(run), FLUSH_MS);
      });
    }
  } else if (event.type === "alt") {
    setFullscreen(tabId, run, event.on);
  } else if (event.type === "finish") {
    setFullscreen(tabId, run, false);
    runs.detachShell(tabId);
    run.tab.cwd = event.cwd;
    finishRun(run, event.exit);
  }
}

/** The terminal may still be parsing the command's last output. */
async function finishRun(run, exit) {
  await run.model.settled();
  flush(run);
  const output = run.model.text();
  endRun(run);
  run.resolve({ output, shown: true, exit });
}

function endRun(run) {
  run.ended = true;
  clearTimeout(run.timer);
  run.model.dispose();
}

function setFullscreen(tabId, run, on) {
  if (run.fullscreen === on) return;
  run.fullscreen = on;
  if (on) {
    openFullscreen(tabId, {
      onData: (data) => backend.write(tabId, data),
      onResize: (cols, rows) => backend.resize(tabId, cols, rows),
    });
    showFullscreenFor(state.ws.activeTab);
  } else {
    closeFullscreen(tabId);
    const { cols, rows } = textAreaSize();
    backend.resize(tabId, cols, rows);
    if (state.ws.activeTab === tabId) $("editor").focus();
  }
}

/**
 * Resolves when the command finishes, with { output, shown?, exit? }; shown means the output is
 * already on screen. setOutput(text, clearEarlier) replaces what the command has shown so far;
 * clearEarlier means the tab's earlier content should go too. signal is aborted on Ctrl+C or
 * when the tab closes.
 */
export async function runCommand(input, tab, { setOutput, signal }) {
  const command = input.trim();
  if (!command) return { output: "" };
  return new Promise((resolve) => {
    const size = textAreaSize();
    runs.attachShell(tab.id, { tab, model: createTextModel(size), setOutput, resolve, timer: null, fullscreen: false });
    started.add(tab.id);
    signal.addEventListener("abort", () => backend.write(tab.id, "\x03"), { once: true });
    backend.run(tab.id, command, { cwd: tab.cwd, ...size }).catch((err) => {
      const run = runs.shell(tab.id);
      runs.detachShell(tab.id);
      if (run) endRun(run);
      resolve({ output: err.message, exit: 1 });
    });
  });
}

/** Suggestions for the text typed so far. See ports/backend.js for what each one holds. */
export const getCompletions = (input, tab) => backend.complete(tab.id, input, { cwd: tab.cwd, history: tab.history });

/** Forwards a key press to the tab's running program. Returns true if it was used. */
export function forwardKey(tabId, event) {
  if (!backend.takesInput || !runs.shell(tabId)) return false;
  const bytes = keyToBytes(event);
  if (bytes === null) return false;
  backend.write(tabId, bytes);
  return true;
}

export function forwardPaste(tabId, text) {
  if (!backend.takesInput || !runs.shell(tabId)) return false;
  backend.write(tabId, text);
  return true;
}

export function initRunner() {
  backend.onEvent(onEvent);

  // A closed tab's shell ends with it. Closed tabs reopen with a new id and a new shell.
  subscribe(() => {
    const open = new Set(state.ws.tabs.map((tab) => tab.id));
    for (const tabId of started) {
      if (open.has(tabId)) continue;
      started.delete(tabId);
      const run = runs.shell(tabId);
      if (run) {
        closeFullscreen(tabId);
        runs.detachShell(tabId);
        endRun(run);
        run.resolve({ output: "", shown: true, exit: 130 });
      }
      backend.kill(tabId);
    }
    showFullscreenFor(state.ws.activeTab);
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      refitFullscreen();
      const { cols, rows } = textAreaSize();
      for (const tabId of started) {
        const run = runs.shell(tabId);
        if (run?.fullscreen) continue;
        run?.model.resize(cols, rows);
        backend.resize(tabId, cols, rows);
      }
    }, 100);
  });
}
