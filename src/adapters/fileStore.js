// Desktop: files in ~/.termeedor, through the main process (electron/dataStore.cjs).
// The first run also moves the data the app used to keep in localStorage.

import { STORAGE_KEYS } from "../constants.js";
import { allChanges, filesIn, readSnapshot } from "../core/saved.js";
import { sanitizeWorkspace } from "../core/sanitize.js";
import { load } from "../storage.js";

function succeeded(result) {
  if (!result?.ok && !result?.stale) console.warn("Termeedor: could not save", result?.error);
  return !!result?.ok;
}

/** The old keys that hold something usable. Anything else is left where it is, not deleted. */
function readLegacy() {
  const workspace = load(STORAGE_KEYS.workspace);
  const past = load(STORAGE_KEYS.past);
  const settings = load(STORAGE_KEYS.settings);
  const legacy = {
    ...(sanitizeWorkspace(workspace) ? { workspace } : {}),
    ...(Array.isArray(past) ? { past } : {}),
    ...(settings !== null && typeof settings === "object" ? { settings } : {}),
  };
  return Object.keys(legacy).length ? legacy : null;
}

function removeLegacy(legacy) {
  try {
    Object.keys(legacy).forEach((part) => localStorage.removeItem(STORAGE_KEYS[part]));
  } catch (err) {
    console.warn("Termeedor: could not remove the old saved data", err); // files win from now on anyway
  }
}

const withFiles = (snapshot) => ({ ...snapshot, files: filesIn(snapshot) });

export function createFileAdapter(host) {
  /** The old keys stay until every file is written and can be read back. */
  async function migrate(legacy, disk) {
    try {
      const changes = allChanges(readSnapshot(legacy));
      if (!succeeded(await host.write(changes))) throw new Error("not written");
      const written = await host.load();
      const readable = (found, files) => files.every((file) => found.some((item) => item.id === file.id));
      if ((changes.workspace && !written.workspace) || !readable(written.tabs, changes.tabs) || !readable(written.past, changes.past)) {
        throw new Error("not readable");
      }
      removeLegacy(legacy);
      return withFiles(written);
    } catch (err) {
      console.warn("Termeedor: could not move saved data to files", err);
      // Run from the old data. Saving writes it all again, and until then a restart retries this.
      const files = { ...filesIn(disk), settings: false, workspace: false };
      return { ...legacy, files, unsaved: true, saveFailed: true };
    }
  }

  return {
    async load() {
      const disk = await host.load();
      const legacy = readLegacy();
      if (!legacy) return withFiles(disk);
      if (!disk.workspace) return migrate(legacy, disk);
      // workspace.json goes last in a save, so everything before it was already written.
      removeLegacy(legacy);
      return withFiles(disk);
    },
    write: async (changes) => succeeded(await host.write(changes)),
    writeSync: (changes) => succeeded(host.writeSync(changes)),
  };
}
