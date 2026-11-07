// The app's saved data as files. No Electron imports, so it can be tested with plain Node.
//
//   <dir>/settings.json    theme, font size
//   <dir>/workspace.json   groups, tab order, layout (no scrollback)
//   <dir>/tabs/<id>.json   one open tab's scrollback
//   <dir>/past/<id>.json   one closed tab
//
// Scrollback can contain secrets, so nothing here is readable by other users. Calls are
// synchronous so that one writer keeps one order, and so the final save can finish during unload.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const DIR_MODE = 0o700;
const FILE_MODE = 0o600;
const VALID_ID = /^[A-Za-z0-9-]{1,20}$/; // the same ids src/core/sanitize.js accepts: no dots or slashes
const JSON_FILE = /^([A-Za-z0-9-]{1,20})\.json$/;
const TEMP_FILE = /\.tmp$/;

const isObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isId = (v) => typeof v === "string" && VALID_ID.test(v);
const isFile = (v) => isObject(v) && isId(v.id);
const isWorkspace = (v) => isObject(v) && Array.isArray(v.groups) && Array.isArray(v.tabs);

const defaultDataDir = (env = process.env) => env.TERMEEDOR_DATA_DIR || path.join(os.homedir(), ".termeedor");

/** Returns what is wrong with a batch of changes from the page, or null. */
function problemWith(changes) {
  if (!isObject(changes)) return "changes must be an object";
  const { seq, settings, workspace, tabs, past, removeTabs, removePast } = changes;
  if (seq !== undefined && !Number.isSafeInteger(seq)) return "bad seq";
  if (settings !== undefined && !isObject(settings)) return "bad settings";
  if (workspace !== undefined && !isWorkspace(workspace)) return "bad workspace";
  for (const list of [tabs, past]) if (!Array.isArray(list) || !list.every(isFile)) return "bad file";
  for (const list of [removeTabs, removePast]) if (!Array.isArray(list) || !list.every(isId)) return "bad id";
  return null;
}

function createDataStore(dir) {
  let newestSeq = 0;

  const fileIn = (folder, id) => {
    if (!isId(id)) throw new Error(`Bad id: ${id}`); // the last check before an id becomes a path
    return path.join(dir, folder, `${id}.json`);
  };

  function ensureDirs() {
    for (const folder of [dir, path.join(dir, "tabs"), path.join(dir, "past")]) {
      fs.mkdirSync(folder, { recursive: true, mode: DIR_MODE });
      fs.chmodSync(folder, DIR_MODE); // it may already exist: creating the plugins folder makes the parent
    }
  }

  /** Temp file, then rename: a crash leaves the old file or the new one, never half of one. */
  function writeJson(file, value) {
    const temp = `${file}.${process.pid}.tmp`;
    try {
      const fd = fs.openSync(temp, "w", FILE_MODE);
      try {
        fs.fchmodSync(fd, FILE_MODE); // the temp file may be left over from a crash
        fs.writeFileSync(fd, JSON.stringify(value));
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temp, file);
    } catch (err) {
      fs.rmSync(temp, { force: true });
      throw err;
    }
  }

  function setAside(file, reason) {
    console.warn(`Termeedor: keeping ${file} aside: ${reason}`);
    try {
      fs.renameSync(file, `${file}.corrupt-${Date.now()}`);
    } catch {
      // It stays in place and a later save replaces it. Loading must still go on.
    }
  }

  /** null if missing. A file we can't use moves aside, so saving can't overwrite it. */
  function readJson(file, isValid = isObject) {
    let value;
    try {
      if (!fs.lstatSync(file).isFile()) throw new Error("not a regular file");
      value = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (err) {
      if (err.code !== "ENOENT") setAside(file, err.message);
      return null;
    }
    if (isValid(value)) return value;
    setAside(file, "unexpected contents");
    return null;
  }

  /** A crash can leave these behind, and they hold the same data as the real files. */
  function removeTempFiles(folder) {
    for (const name of fs.readdirSync(folder)) {
      if (TEMP_FILE.test(name)) fs.rmSync(path.join(folder, name), { force: true });
    }
  }

  /** Its files as [{ id, ...contents }]. The file name decides the id. */
  function readFolder(folder) {
    const found = [];
    for (const name of fs.readdirSync(path.join(dir, folder))) {
      const file = path.join(dir, folder, name);
      const id = name.match(JSON_FILE)?.[1];
      if (!id) continue;
      const value = readJson(file);
      if (value) found.push({ ...value, id });
    }
    return found;
  }

  function load() {
    newestSeq = 0; // a new page counts from the start
    ensureDirs();
    [dir, path.join(dir, "tabs"), path.join(dir, "past")].forEach(removeTempFiles);
    return {
      settings: readJson(path.join(dir, "settings.json")),
      workspace: readJson(path.join(dir, "workspace.json"), isWorkspace),
      tabs: readFolder("tabs"),
      past: readFolder("past"),
    };
  }

  /**
   * Stops at the first failure, in an order that keeps what is stored usable: a closed tab
   * reaches past/ before its tab file goes, and a new tab's file exists before workspace.json
   * mentions it. So once workspace.json is written, everything before it was too.
   */
  function applyChanges({ settings, workspace, tabs, past, removeTabs, removePast }) {
    const writeTo = (folder) => ({ id, ...contents }) => writeJson(fileIn(folder, id), contents);
    ensureDirs();
    if (settings) writeJson(path.join(dir, "settings.json"), settings);
    past.forEach(writeTo("past"));
    tabs.forEach(writeTo("tabs"));
    if (workspace) writeJson(path.join(dir, "workspace.json"), workspace);
    removeTabs.forEach((id) => fs.rmSync(fileIn("tabs", id), { force: true }));
    removePast.forEach((id) => fs.rmSync(fileIn("past", id), { force: true }));
  }

  /** Returns { ok, error?, stale? } and never throws: the final save's caller is waiting on it. */
  function write(changes) {
    const problem = problemWith(changes);
    if (problem) return { ok: false, error: problem };
    // Every batch holds the full contents of its files, so an older one must not win.
    if (changes.seq !== undefined) {
      if (changes.seq <= newestSeq) return { ok: false, stale: true };
      newestSeq = changes.seq;
    }
    try {
      applyChanges(changes);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  }

  return { dir, load, write };
}

module.exports = { createDataStore, defaultDataDir };
