// The backend in the browser, which can't run real commands: a fake shell with a few fake
// commands. The only place they exist. On the desktop everything typed goes to the real shell.
//
// getTab(tabId) gives the live tab, because fake commands may change its name, color and cwd.
// Output goes out as terminal bytes, like a real shell's, so `clear` sends what `clear` sends.

import { TAB_COLORS } from "../constants.js";
import { createEventStream } from "../ports/backend.js";

const MOCK_FS = {
  "~": ["projects/", "notes.md", ".zshrc"],
  "~/projects": ["termeedor/", "api/", "README.md"],
  "~/projects/termeedor": ["index.html"],
  "~/projects/api": ["main.go", "go.mod"],
};

const HELP = [
  "Commands:",
  "  help, clear, echo <text>, date, pwd, ls, cd <dir>, whoami, history",
  "  sleep <seconds>   wait (shows the running indicator)",
  "  build             fake build with streaming output",
  "  rename <name>     rename this tab",
  "  color <1-8|none>  set this tab's color",
  "",
  "Tab completes a command or path. Up/Down browse history.",
  "Ctrl+C stops a running command.",
].join("\n");

const ERASE_EVERYTHING = "\x1b[3J\x1b[2J";
const BUILD_STEP_MS = () => 500 + Math.random() * 700;

/** Resolves after ms, rejects with AbortError if the signal fires first. */
function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal.aborted) return reject(new DOMException("Aborted", "AbortError"));
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    }, { once: true });
  });
}

function changeDir(session, arg) {
  if (!arg || arg === "~") session.cwd = "~";
  else if (arg === "..") session.cwd = session.cwd.includes("/") ? session.cwd.slice(0, session.cwd.lastIndexOf("/")) : "~";
  else {
    const next = `${session.cwd}/${arg.replace(/\/$/, "")}`;
    if (!MOCK_FS[next]) return `cd: no such file or directory: ${arg}`;
    session.cwd = next;
  }
  return "";
}

// Each returns the output it ends with. emit(text) streams a line before that.
const COMMANDS = {
  help: () => HELP,
  clear: () => ERASE_EVERYTHING,
  echo: ({ arg }) => arg,
  date: () => new Date().toString(),
  whoami: () => "you",
  pwd: ({ session }) => session.cwd.replace("~", "/Users/you"),
  ls: ({ session }) => (MOCK_FS[session.cwd] ?? []).join("  "),
  cd: ({ session, arg }) => changeDir(session, arg),
  history: ({ session }) => session.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join("\n"),

  rename: ({ session, arg }) => {
    if (!arg) return "usage: rename <name>";
    session.name = arg.slice(0, 60);
    return `renamed tab to '${session.name}'`;
  },

  color: ({ session, arg }) => {
    if (arg === "none") { session.color = null; return "color cleared"; }
    const n = Number.parseInt(arg, 10);
    if (n >= 1 && n <= TAB_COLORS.length) { session.color = TAB_COLORS[n - 1]; return "color set"; }
    return `usage: color <1-${TAB_COLORS.length}|none>`;
  },

  sleep: async ({ arg, signal }) => {
    const seconds = Math.min(600, Math.max(0, Number.parseFloat(arg) || 1));
    await wait(seconds * 1000, signal);
    return "";
  },

  build: async ({ emit, signal, stepMs }) => {
    const started = Date.now();
    for (const step of ["Resolving dependencies", "Compiling 42 modules", "Bundling", "Minifying", "Writing dist/"]) {
      await wait(stepMs(), signal);
      emit(`  ✓ ${step}`);
    }
    return `Build finished in ${((Date.now() - started) / 1000).toFixed(1)}s`;
  },
};

/** The output a command ends with, which is ^C if it was stopped. */
async function execute(command, context) {
  const [name, ...rest] = command.trim().split(/\s+/);
  if (!Object.hasOwn(COMMANDS, name)) return `zsh: command not found: ${name}`;
  try {
    return await COMMANDS[name]({ ...context, arg: rest.join(" ") });
  } catch (err) {
    return err.name === "AbortError" ? "^C" : `error: ${err.message}`;
  }
}

/** Files and folders that can complete `path`, relative to cwd. */
function pathCompletions(line, path, cwd, dirsOnly) {
  const slash = path.lastIndexOf("/") + 1;
  const [dir, partial] = [path.slice(0, slash), path.slice(slash)];
  const entries = MOCK_FS[dir ? `${cwd}/${dir.slice(0, -1)}` : cwd] ?? [];
  return entries
    .filter((name) => name.startsWith(partial) && (!dirsOnly || name.endsWith("/")))
    .map((name) => ({
      value: line + name.slice(partial.length) + (name.endsWith("/") ? "" : " "),
      label: name,
      kind: name.endsWith("/") ? "folder" : "file",
    }));
}

function completions(input, { cwd, history }) {
  const typed = input.trimStart();
  const leading = input.slice(0, input.length - typed.length);

  const arg = typed.match(/^(cd|ls)\s+(\S*)$/);
  if (arg) return pathCompletions(input, arg[2], cwd, arg[1] === "cd");

  const commands = /\s/.test(typed) ? [] : Object.keys(COMMANDS)
    .sort()
    .filter((name) => name.startsWith(typed))
    .map((name) => ({ value: `${leading}${name} `, label: name, kind: "command" }));
  if (!typed) return commands;

  const past = [...new Set(history)]
    .reverse()
    .filter((h) => h.startsWith(typed) && h !== typed && !Object.hasOwn(COMMANDS, h))
    .map((h) => ({ value: leading + h, label: h, kind: "history" }));
  return [...commands, ...past];
}

export function createMockBackend({ getTab, stepMs = BUILD_STEP_MS } = {}) {
  const stream = createEventStream();
  const running = new Map(); // tabId -> AbortController

  const print = (tabId, text) => {
    if (text) stream.send(tabId, { type: "output", data: `${text.replace(/\n/g, "\r\n")}\r\n` });
  };

  return {
    takesInput: false, // no fake command reads anything, so Ctrl+C is the only input that means something
    onEvent: stream.onEvent,

    async run(tabId, command) {
      if (running.has(tabId)) throw new Error("A command is already running in this tab.");
      const controller = new AbortController();
      running.set(tabId, controller);
      const session = getTab(tabId);
      const output = await execute(command, {
        session,
        stepMs,
        signal: controller.signal,
        emit: (text) => print(tabId, text),
      });
      if (running.get(tabId) !== controller) return; // killed: the exit event was the last word
      running.delete(tabId);
      print(tabId, output);
      stream.send(tabId, { type: "finish", cwd: session.cwd });
    },

    write(tabId, data) {
      if (data.includes("\x03")) running.get(tabId)?.abort();
    },

    prepare() {}, // nothing to start
    resize() {}, // nothing formats its output to fit

    kill(tabId) {
      const controller = running.get(tabId);
      running.delete(tabId);
      controller?.abort();
      stream.send(tabId, { type: "exit" });
    },

    complete: async (tabId, input, options) => completions(input, options),
  };
}
