// Tab completion from the real filesystem: command names from PATH, and paths.
// Returns the same shape as the mock shell: { value, label, kind }, where value is the whole new input.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_ITEMS = 200;
const COMMAND_CACHE_MS = 30000;
const SHELL_BUILTINS = ["alias", "bg", "cd", "command", "echo", "eval", "exec", "exit", "export", "fg", "jobs", "kill", "printf", "pushd", "popd", "pwd", "set", "source", "test", "type", "ulimit", "umask", "unalias", "unset", "wait", "which"];

let commandCache = { path: null, at: 0, names: [] };

function commandsOnPath(pathVar) {
  if (commandCache.path === pathVar && Date.now() - commandCache.at < COMMAND_CACHE_MS) return commandCache.names;
  const names = new Set(SHELL_BUILTINS);
  for (const dir of pathVar.split(path.delimiter)) {
    try {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) continue;
        try {
          fs.accessSync(path.join(dir, entry.name), fs.constants.X_OK);
          names.add(entry.name);
        } catch {
          // not executable
        }
      }
    } catch {
      // a PATH entry that doesn't exist
    }
  }
  commandCache = { path: pathVar, at: Date.now(), names: [...names].sort() };
  return commandCache.names;
}

/** The word being typed. A backslash keeps a space inside it, as the shell would read it. */
function lastWord(input) {
  const match = input.match(/(?:\\.|[^\s\\])*$/);
  return match[0];
}

const unescape = (word) => word.replace(/\\(.)/g, "$1");
const escape = (name) => name.replace(/([\s\\'"$`&|;<>()*?#!])/g, "\\$1");

function isDirectory(dir, entry) {
  if (entry.isDirectory()) return true;
  if (!entry.isSymbolicLink()) return false;
  try {
    return fs.statSync(path.join(dir, entry.name)).isDirectory();
  } catch {
    return false;
  }
}

function pathCompletions(input, word, cwd, dirsOnly) {
  const typed = unescape(word);
  const slash = typed.lastIndexOf("/") + 1;
  const [dirPart, partial] = [typed.slice(0, slash), typed.slice(slash)];
  const home = os.homedir();
  const expanded = dirPart === "~/" || dirPart.startsWith("~/") ? path.join(home, dirPart.slice(2)) : dirPart;
  const dir = path.resolve(cwd, expanded || ".");

  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const base = input.slice(0, input.length - word.length);
  const prefix = base + word.slice(0, word.length - escape(partial).length);
  return entries
    .filter((entry) => entry.name.startsWith(partial) && (partial.startsWith(".") || !entry.name.startsWith(".")))
    .map((entry) => ({ name: entry.name, folder: isDirectory(dir, entry) }))
    .filter((entry) => !dirsOnly || entry.folder)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(({ name, folder }) => ({
      value: `${prefix}${escape(name)}${folder ? "/" : " "}`,
      label: folder ? `${name}/` : name,
      kind: folder ? "folder" : "file",
    }));
}

/** input: text typed so far. cwd: absolute. pathVar: the shell's PATH. */
function complete(input, cwd, pathVar) {
  const word = lastWord(input);
  const before = input.slice(0, input.length - word.length);
  const isFirstWord = !before.trim() || /[;&|]\s*$/.test(before);

  if (isFirstWord && !word.includes("/")) {
    if (!word) return [];
    return commandsOnPath(pathVar)
      .filter((name) => name.startsWith(word))
      .slice(0, MAX_ITEMS)
      .map((name) => ({ value: `${before}${name} `, label: name, kind: "command" }));
  }
  return pathCompletions(input, word, cwd, /^\s*cd\s+$/.test(before)).slice(0, MAX_ITEMS);
}

module.exports = { complete };
