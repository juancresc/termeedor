// A real terminal (xterm.js) for programs that take over the screen, such as vim or top.
// It covers the terminal area while the program runs, then goes away. Desktop only: it loads
// from /vendor, which the Electron main process serves.

import { $, el } from "../util.js";
import { keyToBytes } from "./keys.js";

const terminals = new Map(); // tabId -> { term, fit, node, queue, ready }
let modules = null;

function loadModules() {
  if (!modules) {
    const link = el("link");
    link.rel = "stylesheet";
    link.href = "/vendor/xterm/css/xterm.css";
    document.head.append(link);
  }
  modules ??= Promise.all([
    import("/vendor/xterm/lib/xterm.mjs"),
    import("/vendor/addon-fit/lib/addon-fit.mjs"),
  ]);
  return modules;
}

function themeFromPage() {
  const style = getComputedStyle(document.documentElement);
  const value = (name) => style.getPropertyValue(name).trim();
  return { background: value("--term"), foreground: value("--text"), cursor: value("--accent"), selectionBackground: value("--sel") };
}

/** The program entered full-screen. onData gets keystrokes; onResize gets (cols, rows). */
export function openFullscreen(tabId, { onData, onResize }) {
  const entry = { term: null, fit: null, node: el("div", "fullTerm"), queue: [], onResize };
  terminals.set(tabId, entry);
  $("fullTerms").append(entry.node);

  loadModules().then(([{ Terminal }, { FitAddon }]) => {
    if (terminals.get(tabId) !== entry) return; // the program already quit
    const style = getComputedStyle($("editor"));
    entry.term = new Terminal({
      fontFamily: style.fontFamily,
      fontSize: parseFloat(style.fontSize),
      theme: themeFromPage(),
      scrollback: 0,
      allowProposedApi: false,
    });
    entry.fit = new FitAddon();
    entry.term.loadAddon(entry.fit);
    entry.term.open(entry.node);
    // Cmd's line-editing keys go to the program as in other macOS terminals (xterm drops them);
    // the app's own shortcuts (Cmd+T and so on) pass through.
    // Shift+Enter too: xterm sends a plain Enter, which would submit in claude instead of adding a line.
    entry.term.attachCustomKeyEventHandler((event) => {
      if (event.key === "Enter" && event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey) {
        if (event.type === "keydown") {
          event.preventDefault();
          onData(keyToBytes(event));
        }
        return false;
      }
      if (!event.metaKey) return true;
      const bytes = event.type === "keydown" ? keyToBytes(event) : null;
      if (bytes) {
        event.preventDefault();
        onData(bytes);
      }
      return false;
    });
    entry.term.onData(onData);
    refit(entry);
    entry.queue.forEach((data) => entry.term.write(data));
    entry.queue = [];
    entry.term.focus();
  });
}

function refit(entry) {
  if (!entry.term || entry.node.hidden) return;
  entry.fit.fit();
  entry.onResize(entry.term.cols, entry.term.rows);
}

export function writeFullscreen(tabId, data) {
  const entry = terminals.get(tabId);
  if (!entry) return;
  if (entry.term) entry.term.write(data);
  else entry.queue.push(data);
}

export function closeFullscreen(tabId) {
  const entry = terminals.get(tabId);
  if (!entry) return;
  terminals.delete(tabId);
  entry.term?.dispose();
  entry.node.remove();
}

/** Shows only the active tab's terminal. Returns true if that tab has one. */
export function showFullscreenFor(activeTabId) {
  for (const [tabId, entry] of terminals) {
    const active = tabId === activeTabId;
    const changed = entry.node.hidden === active;
    entry.node.hidden = !active;
    if (active && changed) {
      refit(entry);
      entry.term?.focus();
    }
  }
  return terminals.has(activeTabId);
}

export function refitFullscreen() {
  terminals.forEach(refit);
}
