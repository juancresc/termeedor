// One tab's terminal session: its commands on the backend (ports/backend.js), one at a time, from
// the block being added to it being finished. It owns the run state, the text model, flushing,
// fullscreen on or off, input for the program, cwd, and plugins' command events.
// Startup files that take long (the backend's startup events) show in a text block of their own
// and get the keys; with no command waiting on them, that block holds the tab's run until they end.
// No DOM and no store: views listen with on() and pass sizes in.
//
// Events, each listener(payload):
//   start      { block, command }    a block was added and its command is running; command is null
//              for the startup files
//   output     { block, snapshot, erased }  the block now holds what the command shows so far
//              (snapshot: see textModel.js; no cursor once the command has ended); erased: the
//              tab's earlier content went too
//   data       { data }              raw terminal bytes, for a view that draws them itself (xterm)
//   fullscreen { on, closing }       a program took over the screen, or gave it back
//   busy       { on }                the command started or stopped working (see below)
//   finish     { block, exit, closed }  the command ended; unless closed, its block is finished
//   typeahead  {}                    keys typed as the command ended went into the draft instead

import { addCommandBlock, addTextBlock, appendOutput, clearEarlier, finishBlock, setBlockOutput, trimTranscript } from "../core/transcript.js";
import { createRunState } from "../core/runState.js";
import { keyToBytes } from "./keys.js";
import { createTextModel } from "./textModel.js";

export const FLUSH_MS = 50;

// Busy or not, as in iTerm: a command is busy only while it says so itself, with a progress
// report (OSC 9;4, as for Ghostty, iTerm and Windows Terminal) or a title that says it: claude
// starts its title with a spinning ◐ ◓ ◑ ◒ (or braille) while it works, ✳ while it waits.
// Output alone says nothing: a server printing its log (docker compose up) isn't busy.
const PROGRESS = /\x1b\]9;4;(\d)/g;
const TITLE = /\x1b\][02];([^\x07\x1b]*)/g;
const TITLE_BUSY = /^[\u25d0-\u25d3\u2801-\u28ff]/;
const TITLE_IDLE = /^\u2733/;

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

/**
 * Pasted text as a terminal sends it: Enter for each line break, wrapped in markers if the program asked for them.
 * Line breaks at the very end are dropped, so pasting a copied line doesn't also run it.
 */
export function pasteBytes(text, bracketed) {
  const lines = text.replace(/(?:\r\n?|\n)+$/, "").replace(/\r\n?|\n/g, "\r");
  if (!bracketed) return lines;
  return `\x1b[200~${lines.replaceAll("\x1b[201~", "")}\x1b[201~`;
}

export function createSession({
  tab, backend, runs = createRunState(), flushMs = FLUSH_MS, createModel = createTextModel, emitPlugin = () => {},
}) {
  const listeners = new Map(); // type -> Set
  const emit = (type, payload) => listeners.get(type)?.forEach((fn) => fn(payload));
  // The command producing output: { block, model, resolve, timer, ended }
  let current = null;
  // The startup files, while they show: { block, model, timer, ended, startup: true, own }. own: it holds the tab's run.
  let startup = null;
  let lastSize; // what the shell was last sized to, for a block the backend starts
  let fullscreen = false;
  let hasShell = false;
  let closed = false;

  /** Output can overwrite itself, so the block gets all of it again. */
  function flush(run, ended = false) {
    clearTimeout(run.timer);
    run.timer = null;
    const snapshot = run.model.styled();
    if (ended) snapshot.cursor = null;
    const erased = run.model.takeErasedScrollback() && !run.startup; // startup files don't get to clear the tab
    if (erased) clearEarlier(tab, run.block);
    setBlockOutput(run.block, snapshot.text, snapshot.styles);
    emit("output", { block: run.block, snapshot, erased });
  }

  function setBusy(on) {
    if (runs.setBusy(tab.id, on)) emit("busy", { on });
  }

  /** What the output says about the program being busy. */
  function noteActivity(data) {
    let busy = null;
    for (const [, state] of data.matchAll(PROGRESS)) busy = state !== "0";
    for (const [, title] of data.matchAll(TITLE)) {
      if (TITLE_BUSY.test(title)) busy = true;
      else if (TITLE_IDLE.test(title)) busy = false;
    }
    if (busy !== null) setBusy(busy);
  }

  function endRun(run) {
    run.ended = true;
    clearTimeout(run.timer);
    run.model.dispose();
  }

  /** The terminal may still be parsing the command's last output. */
  async function finishRun(run, exit) {
    await run.model.settled();
    flush(run, true);
    const output = run.model.text();
    endRun(run);
    run.resolve({ output, shown: true, exit });
  }

  /** The startup files' block takes the tab's run, so that keys reach them and nothing else starts. */
  function holdRunForStartup() {
    startup.own = true;
    const signal = runs.start(tab.id, startup.block);
    signal.addEventListener("abort", () => backend.write(tab.id, "\x03"), { once: true });
    emit("start", { block: startup.block, command: null });
  }

  function showStartup(data) {
    if (closed) return;
    if (!startup) {
      const block = addTextBlock(tab, "", current?.block ?? null); // above a command that waits on them
      startup = { block, model: createModel(lastSize), timer: null, ended: false, startup: true, own: false };
      if (!runs.isRunning(tab.id)) holdRunForStartup();
    }
    const run = startup;
    run.model.write(data, () => {
      if (!run.ended) run.timer ??= setTimeout(() => flush(run), flushMs);
    });
  }

  async function endStartup(event) {
    const run = startup;
    if (!run) return;
    startup = null;
    if (!current) tab.cwd = event.cwd ?? tab.cwd; // a waiting command's finish says where it ended up
    if (event.typeahead) tab.draft = typedText(event.typeahead) + tab.draft;
    await run.model.settled();
    if (run.ended) return; // the tab closed meanwhile
    flush(run, true);
    endRun(run);
    finishBlock(tab, run.block); // gone if they printed nothing
    if (run.own) runs.finish(tab.id);
    emit("finish", { block: run.block, exit: null, closed });
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
      current = { block, model: createModel(size), resolve, timer: null, ended: false };
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
    /**
     * Resolves with the bytes that turn on what the program has asked of the terminal so far
     * (bracketed paste, mouse reports, ...), for a view that is a terminal itself and starts fresh:
     * claude asks before it takes over the screen. "" if nothing runs.
     */
    async modes() {
      const run = current;
      if (!run) return "";
      await run.model.settled();
      return run.ended ? "" : run.model.modes();
    },
    get block() { return runs.block(tab.id); },

    /** listener(payload) for one of the events above. Returns a function that stops listening. */
    on(type, listener) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(listener);
      return () => listeners.get(type).delete(listener);
    },

    /** True once the tab's shell was started, or asked to be, until it ends. */
    get hasShell() { return hasShell; },

    /** Starts the shell ahead of the first command, sized { cols, rows }, so that command doesn't wait for it. */
    prepare(size) {
      if (closed || hasShell) return;
      hasShell = true;
      lastSize = size;
      backend.prepare(tab.id, { cwd: tab.cwd, ...size });
    },

    /** Runs a command in a new block, sized { cols, rows }. Resolves once it has finished. */
    async run(command, size) {
      if (closed || runs.isRunning(tab.id)) return;
      lastSize = size;
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
      if (startup && !startup.own && !closed) holdRunForStartup(); // still going, and now nothing waits on them
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
      if (event.type === "startup") return showStartup(event.data);
      if (event.type === "started") return void endStartup(event);
      if (event.type === "output") emit("data", { data: event.data });
      const run = current;
      if (!run) return;
      if (event.type === "output") {
        noteActivity(event.data);
        if (fullscreen) { // the fullscreen view draws the bytes; the model only follows what they ask for
          run.model.write(event.data);
          return;
        }
        run.model.write(event.data, () => {
          if (!run.ended) run.timer ??= setTimeout(() => flush(run), flushMs);
        });
      } else if (event.type === "alt") {
        if (event.on !== fullscreen) run.model.setAlt(event.on);
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
      if (!backend.takesInput || !(current ?? startup)) return false;
      const bytes = keyToBytes(event);
      if (bytes === null) return false;
      backend.write(tab.id, bytes);
      return true;
    },

    forwardPaste(text) {
      const run = startup ?? current; // while the startup files show, they are who reads
      if (!backend.takesInput || !run) return false;
      backend.write(tab.id, pasteBytes(text, run.model.bracketedPaste()));
      return true;
    },

    /** The block view's size changed. A full-screen program's view resizes with resizePty instead. */
    resize(cols, rows) {
      if (!hasShell || fullscreen) return;
      lastSize = { cols, rows };
      startup?.model.resize(cols, rows);
      current?.model.resize(cols, rows);
      backend.resize(tab.id, cols, rows);
    },

    // Raw access, for a view that is a terminal itself: bytes in, and its size.
    write(data) {
      backend.write(tab.id, data);
    },
    resizePty: (cols, rows) => backend.resize(tab.id, cols, rows),

    /** The tab closed: a running command ends with exit 130 and the shell goes. Nothing lands in the tab after this. */
    close() {
      if (closed) return;
      closed = true;
      runs.stop(tab.id);
      if (startup) {
        endRun(startup);
        if (startup.own) runs.finish(tab.id);
        startup = null;
      }
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
