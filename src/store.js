// The import path for state and actions (core/workspace.js). This adds what core must not know
// about: where data is kept and what is running. Loading finishes before any importer runs,
// because reading files is async and the UI modules expect `state` to be ready.

import { addGroup, commit, connect, defaultWorkspace, hydrate, notify, state } from "./core/workspace.js";
import { readSnapshot } from "./core/saved.js";
import { createSaver } from "./core/saver.js";
import { chooseAdapter } from "./adapters/index.js";
import { runs } from "./terminal/runState.js";

export * from "./core/workspace.js";

const adapter = chooseAdapter();
const saver = createSaver({
  adapter,
  read: () => state,
  onStatus: () => queueMicrotask(notify), // so the status bar can say so
});

async function loadSaved() {
  try {
    return await adapter.load();
  } catch (err) {
    console.warn("Termeedor: could not load saved data", err); // start anyway
    return { saveFailed: true };
  }
}

const snapshot = await loadSaved();
const loaded = readSnapshot(snapshot);
hydrate({ ...loaded, ws: loaded.ws ?? defaultWorkspace() });
saver.seed(snapshot, loaded.recovered);

// ---------- persistence ----------
export const hasSaveFailed = () => saver.hasFailed();
/** Debounced workspace save, used while typing (no re-render). */
export const saveSoon = () => saver.saveSoon();
/** Everything is written when this returns, so it is safe while the page unloads. */
export const saveNow = () => saver.saveNow(); // no arguments: this is also an event listener

// ---------- running commands (runtime only, never saved) ----------
export const isRunning = (tabId) => runs.isRunning(tabId);
export const groupHasRunning = (groupId) => state.ws.tabs.some((t) => t.groupId === groupId && runs.isRunning(t.id));

export function startRun(tab, block) {
  const signal = runs.start(tab.id, block);
  commit();
  return signal;
}
export function finishRun(tab) {
  runs.finish(tab.id);
}
export const stopRun = (tabId) => runs.stop(tabId);

connect({ save: saver.save, saveNow: saver.saveNow, stopRun });
if (!state.ws.groups.length) addGroup(); // never start on a blank workspace
