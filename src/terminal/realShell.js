// Runs commands in the tab's real shell (electron/shellSessions.cjs) and shows the results.
// Only used on the desktop; the browser build keeps the mock in shell.js.

import { $ } from "../util.js";
import { state, subscribe } from "../store.js";
import { closeFullscreen, openFullscreen, refitFullscreen, showFullscreenFor, writeFullscreen } from "./fullscreen.js";
import { keyToBytes } from "./keys.js";
import { createTextModel } from "./textModel.js";

const host = globalThis.termeedorHost?.shell ?? null;
const FLUSH_MS = 50;
const runs = new Map(); // tabId -> the running command
const started = new Set(); // tabs that have a shell

export const hasRealShell = () => !!host;

/** The tab's size in characters, so programs format their output to fit. */
function textAreaSize() {
  const editor = $("editor");
  const probe = $("lineProbe");
  const box = probe.getBoundingClientRect();
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = getComputedStyle(editor).font;
  const charWidth = measure.measureText("x").width || 8;
  const lineHeight = box.height / 100 || 20;
  const style = getComputedStyle(editor);
  const usableWidth = editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return {
    cols: Math.max(20, Math.floor(usableWidth / charWidth)),
    rows: Math.max(5, Math.floor(editor.clientHeight / lineHeight)),
  };
}

function flush(run) {
  clearTimeout(run.timer);
  run.timer = null;
  run.setOutput(run.model.text(), run.model.takeErasedScrollback());
}

function onEvent({ tabId, event }) {
  const run = runs.get(tabId);
  if (!run) return;
  if (event.type === "output") {
    if (run.fullscreen) {
      writeFullscreen(tabId, event.data);
    } else {
      run.model.write(event.data);
      run.timer ??= setTimeout(() => flush(run), FLUSH_MS);
    }
  } else if (event.type === "alt") {
    setFullscreen(tabId, run, event.on);
  } else if (event.type === "finish") {
    flush(run);
    setFullscreen(tabId, run, false);
    runs.delete(tabId);
    if (event.shellExited) started.delete(tabId);
    run.tab.cwd = event.cwd;
    run.resolve({ output: run.model.text(), shown: true, exit: event.exit });
  }
}

function setFullscreen(tabId, run, on) {
  if (run.fullscreen === on) return;
  run.fullscreen = on;
  if (on) {
    openFullscreen(tabId, {
      onData: (data) => host.write(tabId, data),
      onResize: (cols, rows) => host.resize(tabId, cols, rows),
    });
    showFullscreenFor(state.ws.activeTab);
  } else {
    closeFullscreen(tabId);
    const { cols, rows } = textAreaSize();
    host.resize(tabId, cols, rows);
    if (state.ws.activeTab === tabId) $("editor").focus();
  }
}

/**
 * Resolves when the command finishes. setOutput(text, clearEarlier) replaces what the command
 * has shown so far; clearEarlier means the tab's earlier content should go too.
 */
export function runInShell(tab, command, { signal, setOutput }) {
  return new Promise((resolve) => {
    const run = { tab, model: createTextModel(), setOutput, resolve, timer: null, fullscreen: false };
    runs.set(tab.id, run);
    started.add(tab.id);
    signal.addEventListener("abort", () => host.write(tab.id, "\x03"), { once: true });
    host.run(tab.id, command, { cwd: tab.cwd, ...textAreaSize() }).catch((err) => {
      runs.delete(tab.id);
      resolve({ output: err.message.replace(/^Error invoking remote method '[^']*': (Error: )?/, ""), exit: 1 });
    });
  });
}

/** Forwards a key press to the tab's running program. Returns true if it was used. */
export function forwardKey(tabId, event) {
  if (!runs.has(tabId)) return false;
  const bytes = keyToBytes(event);
  if (bytes === null) return false;
  host.write(tabId, bytes);
  return true;
}

export function forwardPaste(tabId, text) {
  if (!runs.has(tabId)) return false;
  host.write(tabId, text);
  return true;
}

export const shellCompletions = (tab, input) => host.complete(tab.id, input, tab.cwd);

export function initRealShell() {
  if (!host) return;
  host.onEvent(onEvent);

  // A closed tab's shell ends with it. Closed tabs reopen with a new id and a new shell.
  subscribe(() => {
    const open = new Set(state.ws.tabs.map((tab) => tab.id));
    for (const tabId of started) {
      if (open.has(tabId)) continue;
      started.delete(tabId);
      const run = runs.get(tabId);
      if (run) {
        closeFullscreen(tabId);
        runs.delete(tabId);
        clearTimeout(run.timer);
        run.resolve({ output: "", shown: true, exit: 130 });
      }
      host.kill(tabId);
    }
    showFullscreenFor(state.ws.activeTab);
  });

  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      refitFullscreen();
      const { cols, rows } = textAreaSize();
      for (const tabId of started) if (!runs.get(tabId)?.fullscreen) host.resize(tabId, cols, rows);
    }, 100);
  });
}
