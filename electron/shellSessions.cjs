// One long-lived shell per tab, so `cd`, `export` and aliases carry over between commands.
// A session starts on its tab's first command. No Electron imports, so tests can use real shells.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const pty = require("node-pty");
const { createShellParser } = require("./shellParser.cjs");
const { chooseShell, shellLaunch } = require("./shellIntegration.cjs");

const READY_TIMEOUT_MS = 20000;
const PASTE_START = "\x1b[200~";
const PASTE_END = "\x1b[201~";
const DEFAULT_SIZE = { cols: 120, rows: 30 };

/** "~/x" → absolute. Falls back to home if the folder is gone. */
function resolveCwd(cwd) {
  const home = os.homedir();
  const full = !cwd || cwd === "~" ? home : cwd.startsWith("~/") ? path.join(home, cwd.slice(2)) : cwd;
  try {
    return path.isAbsolute(full) && fs.statSync(full).isDirectory() ? full : home;
  } catch {
    return home;
  }
}

/** Absolute → "~/x", the form tabs keep and show. */
function displayCwd(cwd) {
  const home = os.homedir();
  if (cwd === home) return "~";
  return cwd.startsWith(home + path.sep) ? `~/${cwd.slice(home.length + 1)}` : cwd;
}

/** Takes out anything that could end the paste early, even if removing one piece would form another. */
function withoutPasteMarks(text) {
  let clean = text;
  while (clean.includes(PASTE_START) || clean.includes(PASTE_END)) clean = clean.replaceAll(PASTE_START, "").replaceAll(PASTE_END, "");
  return clean;
}

/**
 * What to type at the prompt to run a command. The shell's line editor reads every byte as a key,
 * so a line break would run what came before it and a tab would start completing. Both editors
 * take a bracketed paste as plain text to insert, whatever their key bindings, and then Enter
 * runs all of it as one input. test/shellSessions.test.js proves this in real shells.
 */
function commandBytes(command) {
  const text = command.replace(/\r\n?/g, "\n");
  if (!/[\x00-\x1f\x7f]/.test(text)) return `${text}\r`;
  return `${PASTE_START}${withoutPasteMarks(text)}${PASTE_END}\r`;
}

/** send(tabId, event) receives output, alt, finish and exit events. */
function createShellSessions(send, { shell = chooseShell(), env = process.env, readyTimeoutMs = READY_TIMEOUT_MS } = {}) {
  const sessions = new Map();

  function start(tabId, cwd, size) {
    if (!shell) throw new Error("No supported shell found. Termeedor needs zsh or bash 4.4 or newer.");
    const launch = shellLaunch(shell, env);
    const parser = createShellParser(launch.token);
    const process_ = pty.spawn(launch.file, launch.args, {
      name: "xterm-256color",
      cwd: resolveCwd(cwd),
      env: launch.env,
      ...DEFAULT_SIZE,
      ...size,
    });
    const session = { pty: process_, parser, ready: false, running: false, sent: false, queued: null, path: null, cwd: displayCwd(resolveCwd(cwd)), readyTimer: null };
    sessions.set(tabId, session);

    session.readyTimer = setTimeout(() => {
      if (!session.queued) return;
      session.queued = null;
      session.running = false;
      send(tabId, { type: "output", data: "Your shell's startup files didn't finish. Check ~/.zshrc or ~/.bashrc for something waiting on input.\r\n" });
      send(tabId, { type: "finish", exit: 1, cwd: session.cwd });
    }, readyTimeoutMs);

    process_.onData((chunk) => {
      for (const event of parser.write(chunk)) handleEvent(tabId, session, event);
    });
    process_.onExit(() => {
      clearTimeout(session.readyTimer);
      if (sessions.get(tabId) === session) sessions.delete(tabId);
      if (session.running) send(tabId, { type: "finish", exit: 0, cwd: session.cwd, shellExited: true });
    });
    return session;
  }

  function handleEvent(tabId, session, event) {
    if (event.type === "reply") {
      session.pty.write(event.data);
    } else if (event.type === "ready") {
      session.ready = true;
      session.path = event.path;
      clearTimeout(session.readyTimer);
      if (session.queued !== null) {
        const command = session.queued;
        session.queued = null;
        writeCommand(session, command);
      }
    } else if (event.type === "finish") {
      session.cwd = displayCwd(event.cwd || resolveCwd(session.cwd));
      if (!session.sent) return; // the shell's first prompt, not a command
      session.sent = false;
      session.running = false;
      send(tabId, { ...event, cwd: session.cwd });
    } else if (event.type === "output" || event.type === "alt") {
      send(tabId, event);
    }
  }

  function writeCommand(session, command) {
    session.sent = true;
    session.parser.commandSent(command);
    session.pty.write(commandBytes(command));
  }

  return {
    /** Runs a command. Its results arrive through send(); a finish event ends it. */
    run(tabId, command, { cwd, cols, rows } = {}) {
      const size = cols && rows ? { cols, rows } : {};
      const session = sessions.get(tabId) ?? start(tabId, cwd, size);
      if (session.running) throw new Error("A command is already running in this tab.");
      session.running = true;
      if (session.ready) writeCommand(session, command);
      else session.queued = command;
    },
    write(tabId, data) {
      const session = sessions.get(tabId);
      if (session?.queued != null && data.includes("\x03")) {
        // Stopped before the shell got it. Sent on, this would only interrupt the rc files.
        session.queued = null;
        session.running = false;
        send(tabId, { type: "finish", exit: 130, cwd: session.cwd });
        return;
      }
      session?.pty.write(data);
    },
    resize(tabId, cols, rows) {
      const session = sessions.get(tabId);
      if (session && cols > 0 && rows > 0) session.pty.resize(cols, rows);
    },
    kill(tabId) {
      const session = sessions.get(tabId);
      if (!session) return;
      sessions.delete(tabId);
      clearTimeout(session.readyTimer);
      session.pty.kill();
    },
    killAll() {
      [...sessions.keys()].forEach((id) => this.kill(id));
    },
    /** The session's cwd and PATH, for completions. Null before its first command. */
    info(tabId) {
      const session = sessions.get(tabId);
      return session ? { cwd: session.cwd, path: session.path } : null;
    },
  };
}

module.exports = { commandBytes, createShellSessions, displayCwd, resolveCwd };
