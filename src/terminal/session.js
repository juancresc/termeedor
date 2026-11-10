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
//   finish     { block, exit, closed }  the command ended; unless closed, its block is finished

import { addCommandBlock, appendOutput, clearEarlier, finishBlock, setBlockOutput, trimTranscript } from "../core/transcript.js";
import { createRunState } from "../core/runState.js";
import { keyToBytes } from "./keys.js";
import { createTextModel } from "./textModel.js";

export const FLUSH_MS = 50;

export function createSession({
  tab, backend, runs = createRunState(), flushMs = FLUSH_MS, createModel = createTextModel, emitPlugin = () => {},
}) {
  const listeners = new Map(); // type -> Set
  const emit = (type, payload) => listeners.get(type)?.forEach((fn) => fn(payload));
  let current = null; // the command producing output: { block, model, resolve, timer, ended }
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

  function endRun(run) {
    run.ended = true;
    clearTimeout(run.timer);
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
    if (!command) return { output: "" };
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
      if (event.type === "output") emit("data", { data: event.data });
      const run = current;
      if (!run) return;
      if (event.type === "output") {
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
        finishRun(run, event.exit);
      }
    },

    /** A key press for the running program. Returns true if it was used. */
    forwardKey(event) {
      if (!backend.takesInput || !current) return false;
      const bytes = keyToBytes(event);
      if (bytes === null) return false;
      backend.write(tab.id, bytes);
      return true;
    },

    forwardPaste(text) {
      if (!backend.takesInput || !current) return false;
      backend.write(tab.id, text);
      return true;
    },

    /** The block view's size changed. A full-screen program's view resizes with resizePty instead. */
    resize(cols, rows) {
      if (!hasShell || fullscreen) return;
      current?.model.resize(cols, rows);
      backend.resize(tab.id, cols, rows);
    },

    // Raw access, for a view that is a terminal itself: bytes in, and its size.
    write: (data) => backend.write(tab.id, data),
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
