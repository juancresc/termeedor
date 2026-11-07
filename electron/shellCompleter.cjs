// Tab completion from the user's real zsh: one hidden shell, shared by all tabs and started on
// the first request, with completions.cjs answering whenever it can't. See zshCompletion.zsh.
// No Electron imports, so tests can use real shells.

const crypto = require("node:crypto");
const net = require("node:net");
const path = require("node:path");
const pty = require("node-pty");
const { complete: completeFromDisk } = require("./completions.cjs");
const { chooseShell, completionLaunch, completionSocketPath } = require("./shellIntegration.cjs");

const MAX_ITEMS = 200;
const ANSWER_MS = 1000; // how long Tab waits for zsh before answering from the disk
const STUCK_MS = 5000; // a request still running after this gets the shell killed
const START_MS = 15000; // startup files that take longer than this count as stuck
const IDLE_MS = 10 * 60 * 1000;
const RETRY_MS = 30000; // first wait after a failed start. It doubles with each failure.
const FIELDS = 6;

/**
 * Whether zsh may see this line. Completion functions evaluate what is typed: _path_files expands
 * `$(x)/` and _git expands --git-dir=$(x), and third-party functions eval words. A command
 * substitution, a glob qualifier and a math call all need a parenthesis or a backtick, and without
 * a hidden operator, an evaluated word can only be an argument. So anything else stays here.
 */
function isSafeToComplete(input) {
  if (/[`()\x00-\x08\x0b-\x1f\x7f]/.test(input)) return false;
  let quote = "";
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (c === "\\" && quote !== "'") {
      if (/[;&|<>$\n\\]/.test(input[++i] ?? "")) return false;
    } else if (c === quote) {
      quote = "";
    } else if (!quote && (c === "'" || c === '"')) {
      quote = c;
    } else if (quote && /[;&|<>\n]/.test(c)) {
      return false;
    } else if (c === "$") {
      if (quote === "'") return false;
      const name = input.slice(i).match(/^\$(?:\w+(?!\w|\[)|\{\w+\}|$)/);
      if (!name) return false;
    }
  }
  return true;
}

/** Keeps zsh's order of groups, sorts within each group unless it asked not to, and caps the list. */
function toItems(fields) {
  const hits = [];
  for (let i = 0; i + FIELDS <= fields.length; i += FIELDS) {
    const [value, label, kind, description, group, nosort] = fields.slice(i, i + FIELDS);
    if (/[\x00-\x1f\x7f]/.test(value) || !label) continue;
    hits.push({ value, label, kind, description, group: Number(group), nosort: nosort === "1" });
  }
  hits.sort((a, b) => a.group - b.group || (a.nosort ? 0 : a.label.localeCompare(b.label)));
  const seen = new Set();
  const items = [];
  for (const { value, label, kind, description } of hits) {
    if (seen.has(value)) continue;
    seen.add(value);
    items.push({ value, label, kind, ...(description ? { description } : {}) });
    if (items.length === MAX_ITEMS) break;
  }
  return items;
}

function createShellCompleter({
  shell = chooseShell(),
  env = process.env,
  answerMs = ANSWER_MS,
  stuckMs = STUCK_MS,
  startMs = START_MS,
  idleMs = IDLE_MS,
  retryMs = RETRY_MS,
  isSafe = isSafeToComplete,
} = {}) {
  const isZsh = shell && path.basename(shell) === "zsh";
  const tabs = new Set();
  let helper = null;
  let queue = [];
  let sent = null; // the one request zsh is working on
  let nextId = 1;
  let failures = 0;
  let retryAt = 0;
  let idleTimer = null;

  function settle(request, items) {
    clearTimeout(request.timer);
    request.resolve(items);
  }

  function drop(request) {
    queue = queue.filter((other) => other !== request);
    settle(request, null);
  }

  function killHelper(target) {
    if (helper === target) {
      helper = null;
      for (const request of [...queue, ...(sent ? [sent] : [])]) settle(request, null);
      queue = [];
      sent = null;
    }
    clearTimeout(target.startTimer);
    clearTimeout(target.stuckTimer);
    target.server.close();
    target.socket?.destroy();
    try {
      process.kill(-target.pty.pid, "SIGKILL"); // the shell and whatever a completion function started
    } catch {
      // already gone
    }
    target.pty.kill();
  }

  function startFailed() {
    retryAt = Date.now() + retryMs * 2 ** failures;
    failures++;
  }

  function start() {
    const socketPath = completionSocketPath();
    const server = net.createServer();
    const launch = completionLaunch(shell, env, socketPath);
    const process_ = pty.spawn(launch.file, launch.args, {
      name: "xterm-256color",
      cwd: launch.env.HOME || process.cwd(),
      env: launch.env,
      cols: 200,
      rows: 50,
    });
    const target = { pty: process_, server, socket: null, buffer: "", startTimer: null, stuckTimer: null };
    helper = target;

    target.startTimer = setTimeout(() => {
      startFailed();
      killHelper(target);
    }, startMs);
    process_.onData(() => {}); // read and thrown away, or a chatty rc file would block on a full terminal
    process_.onExit(() => {
      if (!target.socket && helper === target) startFailed();
      if (helper === target) killHelper(target);
    });
    server.on("error", () => {
      if (helper === target) {
        startFailed();
        killHelper(target);
      }
    });
    server.once("connection", (socket) => {
      server.close(); // only the shell that was started connects, and only once
      clearTimeout(target.startTimer);
      target.socket = socket;
      failures = 0;
      socket.setEncoding("utf8");
      socket.on("data", (chunk) => onData(target, chunk));
      socket.on("error", () => {});
      socket.on("close", () => { if (helper === target) killHelper(target); });
      pump();
    });
    server.listen(socketPath);
  }

  function onData(target, chunk) {
    target.buffer += chunk;
    for (;;) {
      const parts = target.buffer.split("\0");
      if (parts.length < 3) return;
      const end = 2 + Number(parts[1]) * FIELDS;
      if (parts.length - 1 < end) return;
      target.buffer = parts.slice(end).join("\0");
      if (helper !== target || !sent || String(sent.id) !== parts[0]) continue; // not the request zsh is working on
      clearTimeout(target.stuckTimer);
      settle(sent, toItems(parts.slice(2, end)));
      sent = null;
      pump();
    }
  }

  function pump() {
    if (sent || !helper?.socket || !queue.length) return;
    sent = queue.shift();
    const target = helper;
    target.stuckTimer = setTimeout(() => killHelper(target), stuckMs);
    target.socket.write(`${sent.id}\0${sent.cwd}\0${sent.pathVar ?? ""}\0${sent.input}\0`);
  }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, idleMs);
    idleTimer.unref?.();
  }

  function stop() {
    clearTimeout(idleTimer);
    if (helper) killHelper(helper);
    tabs.clear();
  }

  /** Items from zsh, or null when zsh has no answer in time. A newer request from a tab ends the older one. */
  function askShell(tabId, input, cwd, pathVar) {
    if (!isZsh || !input.trim() || !isSafe(input)) return Promise.resolve(null);
    if (!helper && Date.now() < retryAt) return Promise.resolve(null);
    touch();
    tabs.add(tabId);
    for (const request of queue.filter((other) => other.tabId === tabId)) drop(request);
    if (sent?.tabId === tabId) settle(sent, null); // its answer is ignored when it comes
    return new Promise((resolve) => {
      const request = { id: nextId++, tabId, input, cwd, pathVar, resolve, timer: null };
      request.timer = setTimeout(() => drop(request), answerMs);
      queue.push(request);
      if (!helper) {
        try {
          start();
        } catch {
          startFailed();
          drop(request);
          return;
        }
      }
      pump();
    });
  }

  return {
    askShell,
    /** Always answers, and soon: zsh's completions if it has any, otherwise the disk's. */
    async complete(tabId, input, cwd, pathVar) {
      const items = await askShell(tabId, input, cwd, pathVar);
      return items?.length ? items : completeFromDisk(input, cwd, pathVar ?? process.env.PATH ?? "");
    },
    /** A closed tab: its requests end, and the shell ends with the last tab that used it. */
    closeTab(tabId) {
      for (const request of queue.filter((other) => other.tabId === tabId)) drop(request);
      if (sent?.tabId === tabId) settle(sent, null);
      tabs.delete(tabId);
      if (!tabs.size) stop();
    },
    stop,
    helperPid: () => helper?.pty.pid ?? null,
  };
}

module.exports = { createShellCompleter, isSafeToComplete };
