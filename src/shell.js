// Mock shell. A browser page can't run real commands; this module is the piece
// to replace with a real backend (e.g. a PTY over WebSocket) when this becomes an app.
//
// runCommand(input, session, { emit, signal }) → Promise<{ output?: string, clear?: true }>
//   session: the tab (name, color, cwd, history may be changed by commands)
//   emit(text): stream a line of output while the command runs
//   signal: AbortSignal, aborted on Ctrl+C or when the tab closes

import { TAB_COLORS } from "./constants.js";
import { getCommand, listCommands, reserve } from "./plugins/registry.js";

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

function helpText() {
  const fromPlugins = listCommands().map(({ name, description }) => `  ${name}${description ? `  ${description}` : ""}`);
  return fromPlugins.length ? `${HELP}\n\nFrom plugins:\n${fromPlugins.join("\n")}` : HELP;
}

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
  help: () => ({ output: helpText() }),
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

reserve("commands", Object.keys(COMMANDS));

export async function runCommand(input, session, { emit, signal }) {
  const [name, ...rest] = input.trim().split(/\s+/);
  if (!name) return { output: "" };
  const context = { arg: rest.join(" "), args: rest, session, emit, signal };
  if (Object.hasOwn(COMMANDS, name)) return COMMANDS[name](context);
  const plugin = getCommand(name);
  if (!plugin) return { output: `zsh: command not found: ${name}` };
  const result = await plugin.handler(context);
  return typeof result === "string" ? { output: result } : result ?? { output: "" };
}
