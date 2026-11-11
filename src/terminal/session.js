// One tab's terminal session: its commands on the backend (ports/backend.js), one at a time, from
// the block being added to it being finished. It owns the run state, the text model, flushing,
// fullscreen on or off, input for the program, cwd, and plugins' command events.
// No DOM and no store: views listen with on() and pass sizes in.
//
// Events, each listener(payload):
//   start      { block, command }    a block was added and its command is running
//   output     { block, snapshot, erased }  the block now holds what the command shows so far
//              (snapshot: see textModel.js); erased: the tab's earlier content went too
//   data       { data }              raw terminal bytes, for a view that draws them itself (xterm)
//   fullscreen { on, closing }       a program took over the screen, or gave it back
//   busy       { on }                the command started or stopped working (see below)
//   finish     { block, exit, closed }  the command ended; unless closed, its block is finished
//   typeahead  {}                    keys typed as the command ended went into the draft instead

import { addCommandBlock, appendOutput, clearEarlier, finishBlock, setBlockOutput, trimTranscript } from "../core/transcript.js";
import { createRunState } from "../core/runState.js";
import { keyToBytes } from "./keys.js";
import { createTextModel } from "./textModel.js";

export const FLUSH_MS = 50;

// Busy or waiting. A command is busy until it shows it reads input the way an interactive
// program does, by turning on bracketed paste or focus reports (claude, a REPL). From then on it
// is busy only while it draws: IDLE_MS of quiet means it waits for the user. Output right after
// a key is the program echoing it, not working. A program that reports its progress itself
// (OSC 9;4, as for Ghostty, iTerm and Windows Terminal) is believed instead, and so is a title
// that says it: claude starts its title with a spinning ◐ ◓ ◑ ◒ (or braille) while it works, ✳ while it waits.
export const IDLE_MS = 1000;
const ECHO_MS = 150;
const INTERACTIVE = /\x1b\[\?(?:2004|1004)h/;
const PROGRESS = /\x1b\]9;4;(\d)/g;
const TITLE = /\x1b\][02];([^\x07\x1b]*)/g;
const TITLE_BUSY = /^[\u25d0-\u25d3\u2801-\u28ff]/;
const TITLE_IDLE = /^\u2733/;
const BRACKETED_PASTE = /\x1b\[\?2004([hl])/g;

/**
 * The text of keys a command never read, for the input: escape sequences (arrows and the like)
 * and other control keys are dropped, and Backspace takes back the character before it.
 */
export function typedText(bytes) {
  let text = "";
  for (const char of bytes.replace(/\x1b(?:\[[0-9;?]*[ -\/]*[@-~]|O.|.)?/gs, "")) {
    if (char === "\x7f" || char === "\b") text = Array.from(text).slice(0, -1).join("");
    else if (char >= " ") text += char;
  }
  return text;
}

/** Pasted text as a terminal sends it: Enter for each line break, wrapped in markers if the program asked for them. */
export function pasteBytes(text, bracketed) {
  const lines = text.replace(/\r\n?|\n/g, "\r");
  if (!bracketed) return lines;
  return `\x1b[200~${lines.replaceAll("\x1b[201~", "")}\x1b[201~`;
}

export function createSession({
  tab, backend, runs = createRunState(), flushMs = FLUSH_MS, createModel = createTextModel, emitPlugin = () => {},
  idleMs = IDLE_MS,
}) {
  const listeners = new Map(); // type -> Set
  const emit = (type, payload) => listeners.get(type)?.forEach((fn) => fn(payload));
  // The command producing output: { block, model, resolve, timer, ended, interactive, reported, idleTimer, keyAt }
  let current = null;
  let fullscreen = false;
  let hasShell = false;
  let closed = false;

  /** Output can overwrite itself, so the block gets all of it again. */
  function flush(run) {
    clearTimeout(run.timer);
    run.timer = null;
    const snapshot = run.model.styled();
    const erased = run.model.takeErasedScrollback();
    if (erased) clearEarlier(tab, run.block);
    setBlockOutput(run.block, snapshot.text, snapshot.styles);
    emit("output", { block: run.block, snapshot, erased });
  }

  function setBusy(on) {
    if (runs.setBusy(tab.id, on)) emit("busy", { on });
  }

  /** What the output says about the program being busy. */
  function noteActivity(run, data) {
    if (INTERACTIVE.test(data)) run.interactive = true;
    for (const [, mode] of data.matchAll(BRACKETED_PASTE)) run.bracketedPaste = mode === "h";
    for (const [, state] of data.matchAll(PROGRESS)) run.reported = state !== "0";
    for (const [, title] of data.matchAll(TITLE)) {
      if (TITLE_BUSY.test(title)) run.reported = true;
      else if (TITLE_IDLE.test(title)) run.reported = false;
    }
    if (run.reported !== null) {
      clearTimeout(run.idleTimer);
      setBusy(run.reported);
      return;
    }
    if (!run.interactive) return;
    if (Date.now() - run.keyAt < ECHO_MS) {
      if (!runs.isBusy(tab.id)) return; // the echo of a key: still waiting
    } else setBusy(true);
    clearTimeout(run.idleTimer);
    run.idleTimer = setTimeout(() => { if (current === run) setBusy(false); }, idleMs);
  }

  function endRun(run) {
    run.ended = true;
    clearTimeout(run.timer);
    clearTimeout(run.idleTimer);
    run.model.dispose();
  }

  /** The terminal may still be parsing the command's last output. */
  async function finishRun(run, exit) {
    await run.model.settled();
    flush(run);
    const output = run.model.text();
    endRun(run);
    run.resolve({ output, shown: true, exit });
  }

  function setFullscreen(on, closing = false) {
    if (fullscreen === on) return;
    fullscreen = on;
    emit("fullscreen", { on, closing });
  }

  /** Resolves with { output, shown?, exit? }; shown means the output already went out as `output` events. */
  function execute(command, block, size, signal) {
    if (!command || closed) return { output: "" }; // a command:start listener may have closed the tab
    return new Promise((resolve) => {
      current = {
        block, model: createModel(size), resolve, timer: null, ended: false,
        interactive: false, bracketedPaste: false, reported: null, idleTimer: null, keyAt: 0,
      };
      hasShell = true;
      signal.addEventListener("abort", () => backend.write(tab.id, "\x03"), { once: true });
      backend.run(tab.id, command, { cwd: tab.cwd, ...size }).catch((err) => {
        const run = current;
        current = null;
        if (run) endRun(run);
        resolve({ output: err.message, exit: 1 });
      });
    });
  }

  return {
    tab,
    get phase() { return runs.phase(tab.id); },
    get running() { return runs.isRunning(tab.id); },
    get fullscreen() { return fullscreen; },
    get block() { return runs.block(tab.id); },

    /** listener(payload) for one of the events above. Returns a function that stops listening. */
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      return () => listeners.get(type).delete(listener);
    },

    /** Runs a command in a new block, sized { cols, rows }. Resolves once it has finished. */
    async run(command, size) {
      if (closed || runs.isRunning(tab.id)) return;
      const block = addCommandBlock(tab, command, tab.cwd);
      const signal = runs.start(tab.id, block);
      emit("start", { block, command });
      emitPlugin("command:start", { tab, command });
      let result;
      try {
        result = await execute(command, block, size, signal);
      } catch (err) {
        result = { output: signal.aborted ? "^C" : `error: ${err.message}` };
      } finally {
        runs.finish(tab.id);
      }
      emitPlugin("command:finish", { tab, command, output: result.output ?? "", aborted: signal.aborted });
      if (!closed) {
        if (result.output && !result.shown) appendOutput(block, result.output);
        finishBlock(tab, block, result.exit);
        trimTranscript(tab);
      }
      emit("finish", { block, exit: result.exit, closed });
    },

    /** Ctrl+C. The command stays "stopping" until the shell says it ended. False if nothing runs. */
    stop: () => runs.stop(tab.id),

    /** A backend event for this tab. */
    handle(event) {
      if (event.type === "exit") {
        hasShell = false;
        return;
      }
      if (event.type === "typeahead") { // typed as the command ended, too late for it
        tab.draft += typedText(event.data);
        emit("typeahead", {});
        return;
      }
      if (event.type === "output") emit("data", { data: event.data });
      const run = current;
      if (!run) return;
      if (event.type === "output") {
        noteActivity(run, event.data);
        if (fullscreen) return; // the fullscreen view draws the bytes
        run.model.write(event.data, () => {
          if (!run.ended) run.timer ??= setTimeout(() => flush(run), flushMs);
        });
      } else if (event.type === "alt") {
        setFullscreen(event.on);
      } else if (event.type === "finish") {
        setFullscreen(false);
        current = null;
        tab.cwd = event.cwd;
        if (event.typeahead) tab.draft = typedText(event.typeahead) + tab.draft; // typed first
        finishRun(run, event.exit);
      }
    },

    /** A key press for the running program. Returns true if it was used. */
    forwardKey(event) {
      if (!backend.takesInput || !current) return false;
      const bytes = keyToBytes(event);
      if (bytes === null) return false;
      current.keyAt = Date.now();
      backend.write(tab.id, bytes);
      return true;
    },

    forwardPaste(text) {
      if (!backend.takesInput || !current) return false;
      current.keyAt = Date.now();
      backend.write(tab.id, pasteBytes(text, current.bracketedPaste));
      return true;
    },

    /** The block view's size changed. A full-screen program's view resizes with resizePty instead. */
    resize(cols, rows) {
      if (!hasShell || fullscreen) return;
      current?.model.resize(cols, rows);
      backend.resize(tab.id, cols, rows);
    },

    // Raw access, for a view that is a terminal itself: bytes in, and its size.
    write(data) {
      if (current) current.keyAt = Date.now();
      backend.write(tab.id, data);
    },
    resizePty: (cols, rows) => backend.resize(tab.id, cols, rows),

    /** The tab closed: a running command ends with exit 130 and the shell goes. Nothing lands in the tab after this. */
    close() {
      if (closed) return;
      closed = true;
      runs.stop(tab.id);
      const run = current;
      if (run) {
        current = null;
        setFullscreen(false, true);
        endRun(run);
        run.resolve({ output: "", shown: true, exit: 130 });
      }
      if (hasShell) {
        hasShell = false;
        backend.kill(tab.id);
      }
    },
  };
}
