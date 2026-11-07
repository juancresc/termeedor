// Browser build: everything stays in the keys it has always used, as whole values.

import { STORAGE_KEYS } from "../constants.js";
import { load, save } from "../storage.js";

export function createLocalStorageAdapter() {
  // Saves only send what changed and these keys hold it all, so keep the rest to write it back.
  // They start empty because load reports `unsaved`: the first save of each part sends all of it.
  let layout = null;
  const tabs = new Map();
  const past = new Map();

  const saveWorkspace = () => save(STORAGE_KEYS.workspace, {
    ...layout,
    tabs: layout.tabs.map((tab) => ({ ...tab, ...tabs.get(tab.id) })),
  });

  const savePast = () => save(STORAGE_KEYS.past, [...past.values()].sort((a, b) => b.closedAt - a.closedAt));

  function write(changes) {
    changes.tabs.forEach((file) => tabs.set(file.id, file));
    changes.removeTabs.forEach((id) => tabs.delete(id));
    changes.past.forEach((file) => past.set(file.id, file));
    changes.removePast.forEach((id) => past.delete(id));
    layout = changes.workspace ?? layout;

    let ok = true;
    if (changes.settings) ok = save(STORAGE_KEYS.settings, changes.settings) && ok;
    if (changes.past.length || changes.removePast.length) ok = savePast() && ok;
    if (layout && (changes.workspace || changes.tabs.length || changes.removeTabs.length)) ok = saveWorkspace() && ok;
    return ok;
  }

  return {
    async load() {
      const past = load(STORAGE_KEYS.past);
      return {
        settings: load(STORAGE_KEYS.settings),
        workspace: load(STORAGE_KEYS.workspace),
        past: Array.isArray(past) ? past : [],
        unsaved: true,
      };
    },
    write,
    writeSync: write,
  };
}
