// Decides what runs a command. On the desktop: always the tab's real shell
// (terminal/realShell.js). In a browser, which can't run real commands: a mock.
//
// runCommand(input, session, { emit, setOutput, signal }) → Promise<{ output?: string, clear?: true, shown?: true }>
//   session: the tab (name, color, cwd, history may be changed by commands)
//   emit(text): stream a line of output while the command runs
//   setOutput(text, clearEarlier): replace everything the command has shown so far; clearEarlier also wipes the tab above it
//   signal: AbortSignal, aborted on Ctrl+C or when the tab closes
//   shown: the output is already on screen

import { TAB_COLORS } from "./constants.js";
import { hasRealShell, runInShell, shellCompletions } from "./terminal/realShell.js";

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

const COMMANDS = {
  help: () => ({ output: HELP }),
  clear: () => ({ clear: true }),
  echo: ({ arg }) => ({ output: arg }),
  date: () => ({ output: new Date().toString() }),
  whoami: () => ({ output: "you" }),
  pwd: ({ session }) => ({ output: session.cwd.replace("~", "/Users/you") }),
  ls: ({ session }) => ({ output: (MOCK_FS[session.cwd] ?? []).join("  ") }),
  cd: ({ session, arg }) => ({ output: changeDir(session, arg) }),
  history: ({ session }) => ({ output: session.history.map((h, i) => `${String(i + 1).padStart(4)}  ${h}`).join("\n") }),

  rename: ({ session, arg }) => {
    if (!arg) return { output: "usage: rename <name>" };
    session.name = arg.slice(0, 60);
    return { output: `renamed tab to '${session.name}'` };
  },

  color: ({ session, arg }) => {
    if (arg === "none") { session.color = null; return { output: "color cleared" }; }
    const n = Number.parseInt(arg, 10);
    if (n >= 1 && n <= TAB_COLORS.length) { session.color = TAB_COLORS[n - 1]; return { output: "color set" }; }
    return { output: `usage: color <1-${TAB_COLORS.length}|none>` };
  },

  sleep: async ({ arg, signal }) => {
    const seconds = Math.min(600, Math.max(0, Number.parseFloat(arg) || 1));
    await wait(seconds * 1000, signal);
    return { output: "" };
  },

  build: async ({ emit, signal }) => {
    const started = Date.now();
    for (const step of ["Resolving dependencies", "Compiling 42 modules", "Bundling", "Minifying", "Writing dist/"]) {
      await wait(500 + Math.random() * 700, signal);
      emit(`  ✓ ${step}`);
    }
    return { output: `Build finished in ${((Date.now() - started) / 1000).toFixed(1)}s` };
  },
};

/** Files and folders that can complete `path`, relative to the session's cwd. */
function pathCompletions(line, path, session, dirsOnly) {
  const slash = path.lastIndexOf("/") + 1;
  const [dir, partial] = [path.slice(0, slash), path.slice(slash)];
  const entries = MOCK_FS[dir ? `${session.cwd}/${dir.slice(0, -1)}` : session.cwd] ?? [];
  return entries
    .filter((name) => name.startsWith(partial) && (!dirsOnly || name.endsWith("/")))
    .map((name) => ({
      value: line + name.slice(partial.length) + (name.endsWith("/") ? "" : " "),
      label: name,
      kind: name.endsWith("/") ? "folder" : "file",
    }));
}

/**
 * Suggestions for the text typed so far.
 * Each one is { value, label, kind }, where value is the whole new input and always starts with `input`.
 */
export function getCompletions(input, session) {
  return hasRealShell() ? realCompletions(input, session) : mockCompletions(input, session);
}

async function realCompletions(input, session) {
  const typed = input.trimStart();
  const leading = input.slice(0, input.length - typed.length);
  const fromShell = await shellCompletions(session, input);
  if (!typed) return fromShell;
  const past = [...new Set(session.history)]
    .reverse()
    .filter((h) => h.startsWith(typed) && h !== typed)
    .map((h) => ({ value: leading + h, label: h, kind: "history" }));
  const seen = new Set();
  return [...fromShell, ...past].filter((item) => !seen.has(item.value.trim()) && seen.add(item.value.trim()));
}

function mockCompletions(input, session) {
  const typed = input.trimStart();
  const leading = input.slice(0, input.length - typed.length);

  const arg = typed.match(/^(cd|ls)\s+(\S*)$/);
  if (arg) return pathCompletions(input, arg[2], session, arg[1] === "cd");

  const commands = /\s/.test(typed) ? [] : Object.keys(COMMANDS)
    .sort()
    .filter((name) => name.startsWith(typed))
    .map((name) => ({ value: `${leading}${name} `, label: name, kind: "command" }));
  if (!typed) return commands;

  const past = [...new Set(session.history)]
    .reverse()
    .filter((h) => h.startsWith(typed) && h !== typed && !Object.hasOwn(COMMANDS, h))
    .map((h) => ({ value: leading + h, label: h, kind: "history" }));
  return [...commands, ...past];
}

export async function runCommand(input, session, { emit, setOutput, signal }) {
  const [name, ...rest] = input.trim().split(/\s+/);
  if (!name) return { output: "" };
  if (hasRealShell()) return runInShell(session, input.trim(), { signal, setOutput });
  if (Object.hasOwn(COMMANDS, name)) return COMMANDS[name]({ arg: rest.join(" "), args: rest, session, emit, signal });
  return { output: `zsh: command not found: ${name}` };
}
