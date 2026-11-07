// Decides what to save and when. It compares state with what was last saved, so a commit writes
// only what changed, and it talks to storage only through a persistence adapter.

import { layoutOf, pastFile, pastPrint, samePrint, tabFile, tabPrint } from "./saved.js";

const DEBOUNCE_MS = 300;
const ALL_PARTS = ["settings", "past", "workspace"];

function diffFiles(items, saved, print, file) {
  const files = [];
  const prints = new Map();
  const removed = new Set(saved.keys());
  for (const item of items) {
    removed.delete(item.id);
    const current = print(item);
    if (samePrint(saved.get(item.id), current)) continue;
    files.push(file(item));
    prints.set(item.id, current);
  }
  return { files, prints, removed: [...removed] };
}

/** `read()` returns the current state. `onStatus()` runs when saving starts or stops failing. */
export function createSaver({ adapter, read, onStatus = () => {} }) {
  const saved = { settings: null, workspace: null, tabs: new Map(), past: new Map() }; // a null print: stored, contents unknown
  const pending = new Set();
  let inFlight = null;
  let seq = 0;
  let newestSync = 0; // a batch older than this was carried by that synchronous save
  let failed = false;
  let timer;

  function report(ok) {
    if (ok === !failed) return;
    failed = !ok;
    onStatus();
  }

  function collect(parts) {
    const { ws, past, settings } = read();
    const changes = { tabs: [], past: [], removeTabs: [], removePast: [] };
    const next = {};
    if (parts.has("settings")) {
      const json = JSON.stringify(settings);
      if (json !== saved.settings) {
        changes.settings = settings;
        next.settings = json;
      }
    }
    if (parts.has("past")) {
      next.past = diffFiles(past, saved.past, pastPrint, pastFile);
      changes.past = next.past.files;
      changes.removePast = next.past.removed;
    }
    if (parts.has("workspace")) {
      const layout = layoutOf(ws);
      const json = JSON.stringify(layout);
      if (json !== saved.workspace) {
        changes.workspace = layout;
        next.workspace = json;
      }
      next.tabs = diffFiles(ws.tabs, saved.tabs, tabPrint, tabFile);
      changes.tabs = next.tabs.files;
      changes.removeTabs = next.tabs.removed;
    }
    const empty = !changes.settings && !changes.workspace && !changes.tabs.length && !changes.past.length
      && !changes.removeTabs.length && !changes.removePast.length;
    if (empty) return null;
    changes.seq = ++seq;
    return { changes, next, parts };
  }

  function accept({ next }) {
    if (next.settings !== undefined) saved.settings = next.settings;
    if (next.workspace !== undefined) saved.workspace = next.workspace;
    for (const [name, map] of [["tabs", saved.tabs], ["past", saved.past]]) {
      if (!next[name]) continue;
      next[name].prints.forEach((print, id) => map.set(id, print));
      next[name].removed.forEach((id) => map.delete(id));
    }
  }

  function settle(batch, ok) {
    if (inFlight === batch) inFlight = null;
    if (batch.changes.seq < newestSync) return;
    if (ok) accept(batch);
    else batch.parts.forEach((part) => pending.add(part));
    report(ok);
    if (ok && pending.size) flush(); // a failure waits for the next save, so it can't spin
  }

  function callAdapter(method, batch) {
    try {
      return adapter[method](batch.changes);
    } catch (err) {
      console.warn("Termeedor: could not save", err);
      return false;
    }
  }

  function flush() {
    if (inFlight || !pending.size) return; // what arrives meanwhile goes in the next batch
    const batch = collect(new Set(pending));
    pending.clear();
    if (!batch) return report(true); // nothing differs from what is saved
    inFlight = batch;
    const result = callAdapter("write", batch);
    if (typeof result === "boolean") settle(batch, result);
    else result.then((ok) => settle(batch, ok), () => settle(batch, false));
  }

  return {
    /** Starts from what was loaded. Only what really is stored counts as saved. */
    seed({ files = {}, unsaved = false, saveFailed = false }, recovered = false) {
      for (const id of files.tabs ?? []) saved.tabs.set(id, null);
      for (const id of files.past ?? []) saved.past.set(id, null);
      if (unsaved) {
        ALL_PARTS.forEach((part) => pending.add(part));
      } else {
        const { ws, past, settings } = read();
        if (files.settings) saved.settings = JSON.stringify(settings);
        if (files.workspace) saved.workspace = JSON.stringify(layoutOf(ws));
        for (const tab of ws.tabs) if (saved.tabs.has(tab.id)) saved.tabs.set(tab.id, tabPrint(tab));
        for (const entry of past) if (saved.past.has(entry.id)) saved.past.set(entry.id, pastPrint(entry));
      }
      if (recovered) ["past", "workspace"].forEach((part) => pending.add(part));
      failed = saveFailed;
    },

    hasFailed: () => failed,

    save(parts) {
      parts.forEach((part) => pending.add(part));
      flush();
    },

    /** Debounced workspace save, used while typing and while output arrives. */
    saveSoon() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        pending.add("workspace");
        flush();
      }, DEBOUNCE_MS);
    },

    /**
     * Saves everything waiting and returns once it is written: the page may be going away, and an
     * unfinished async call could be lost. It includes what the batch in flight carries, since
     * state still differs from what was last confirmed. If that batch arrives later, the data
     * store refuses it as out of date.
     */
    saveNow(parts = ["workspace"]) {
      clearTimeout(timer);
      const batch = collect(new Set([...pending, ...parts, "workspace", ...(inFlight?.parts ?? [])]));
      pending.clear();
      if (!batch) {
        if (!inFlight) report(true);
        return !failed;
      }
      newestSync = batch.changes.seq;
      inFlight = null;
      const ok = callAdapter("writeSync", batch) === true;
      settle(batch, ok);
      return ok;
    },
  };
}
