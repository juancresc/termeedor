// localStorage access, used by the browser build, the migration to files and plugins' api.storage.

export { cssColor, sanitizeWorkspace, sanitizePastEntry, sanitizeSettings } from "./core/sanitize.js";

export function load(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

export function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch (err) {
    console.warn(`Termeedor: could not save "${key}"`, err);
    return false;
  }
}
