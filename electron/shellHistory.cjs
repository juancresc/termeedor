// The shell's own history file, read so that Up reaches what zsh or bash would: commands from
// earlier runs of the app, closed tabs and other terminals. Read only, and never logged: history
// can hold secrets. No Electron imports, so it can be tested with plain Node.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_BYTES = 2 * 1024 * 1024; // the end of the file: the newest commands
const MAX_COMMANDS = 5000;
const MAX_COMMAND_LENGTH = 10_000;
const ZSH_META = 0x83; // zsh stores some bytes as this marker and the byte xor 32
const ZSH_EXTENDED = /^: \d+:\d+;/; // EXTENDED_HISTORY: ": <start>:<seconds>;<command>"
const BASH_TIMESTAMP = /^#\d+$/; // HISTTIMEFORMAT: a line before each command

/** Where the shell keeps its history, unless its startup files say otherwise and don't export it. */
function historyFile(shell, env = process.env) {
  if (!shell) return null;
  const home = env.HOME || os.homedir();
  if (env.HISTFILE && path.isAbsolute(env.HISTFILE)) return env.HISTFILE;
  return path.basename(shell) === "zsh" ? path.join(env.ZDOTDIR || home, ".zsh_history") : path.join(home, ".bash_history");
}

function unmetafy(bytes) {
  if (!bytes.includes(ZSH_META)) return bytes;
  const plain = Buffer.alloc(bytes.length);
  let length = 0;
  for (let i = 0; i < bytes.length; i++) {
    plain[length++] = bytes[i] === ZSH_META && i + 1 < bytes.length ? bytes[++i] ^ 32 : bytes[i];
  }
  return plain.subarray(0, length);
}

/** A command's lines end in a backslash, except its last. */
function parseZsh(bytes) {
  const commands = [];
  let pending = null;
  for (const line of unmetafy(bytes).toString("utf8").split("\n")) {
    const text = pending === null ? line.replace(ZSH_EXTENDED, "") : `${pending}\n${line}`;
    if (text.endsWith("\\")) pending = text.slice(0, -1);
    else {
      commands.push(text);
      pending = null;
    }
  }
  return commands;
}

const parseBash = (bytes) => bytes.toString("utf8").split("\n").filter((line) => !BASH_TIMESTAMP.test(line));

/** Oldest first, as the file has them. */
function parseHistory(shell, bytes) {
  const commands = path.basename(shell) === "zsh" ? parseZsh(bytes) : parseBash(bytes);
  return commands
    .map((command) => command.trim())
    .filter((command) => command && command.length <= MAX_COMMAND_LENGTH)
    .slice(-MAX_COMMANDS);
}

async function readEnd(file) {
  const handle = await fs.promises.open(file, "r");
  try {
    const stat = await handle.stat();
    if (!stat.isFile()) return { stat, bytes: Buffer.alloc(0) };
    const start = Math.max(0, stat.size - MAX_BYTES);
    const { bytesRead, buffer } = await handle.read(Buffer.alloc(stat.size - start), 0, stat.size - start, start);
    const bytes = buffer.subarray(0, bytesRead);
    // A read that starts mid-file starts mid-command: drop up to the first line break.
    return { stat, bytes: start ? bytes.subarray(bytes.indexOf(0x0a) + 1) : bytes };
  } finally {
    await handle.close();
  }
}

/** read(): Promise<string[]>, never rejecting. A file that hasn't changed isn't parsed again. */
function createShellHistory({ shell, env = process.env } = {}) {
  const file = historyFile(shell, env);
  let cached = { stamp: null, commands: [] };

  async function read() {
    if (!file) return [];
    try {
      const { mtimeMs, size } = await fs.promises.stat(file);
      const stamp = `${mtimeMs}:${size}`;
      if (stamp !== cached.stamp) cached = { stamp, commands: parseHistory(shell, (await readEnd(file)).bytes) };
      return cached.commands;
    } catch {
      return []; // no history yet, or not ours to read
    }
  }

  return { file, read };
}

module.exports = { createShellHistory, historyFile, parseHistory };
