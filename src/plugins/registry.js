// Everything plugins have added to the app. Menus, shortcuts and the status bar
// read from here and know nothing else about plugins. No DOM or store imports.
// Each add/register function returns the function that removes what it added.

const shortcuts = new Map(); // "KeyJ" | "Shift+KeyJ" -> { pluginId, handler }
const menuItems = { tab: [], group: [] };
const statusEntries = [];
const reserved = { shortcuts: new Set() };

export const EVENTS = ["tab:open", "tab:close", "tab:activate", "command:start", "command:finish"];
const listeners = new Map(EVENTS.map((name) => [name, new Set()]));
const statusListeners = new Set();

/** Report a failure in plugin code without letting it break the app. */
function runSafely(pluginId, fn, ...args) {
  try {
    return fn(...args);
  } catch (err) {
    console.error(`[plugin ${pluginId}]`, err);
    return undefined;
  }
}

/** Built-ins call this so that a plugin can't silently replace them. */
export function reserve(kind, names) {
  names.forEach((name) => reserved[kind].add(name));
}

function assertFn(value, what) {
  if (typeof value !== "function") throw new TypeError(`${what} must be a function`);
}

// ---------- shortcuts ----------
/** "Mod+KeyJ" or "Mod+Shift+KeyJ", using KeyboardEvent.code names. Mod is Cmd on macOS, Ctrl elsewhere. */
export function registerShortcut(pluginId, combo, handler) {
  const match = typeof combo === "string" && combo.match(/^Mod\+((?:Shift\+)?[A-Z][A-Za-z0-9]+)$/);
  if (!match) throw new TypeError(`Invalid shortcut: ${combo} (expected e.g. "Mod+KeyJ" or "Mod+Shift+KeyJ")`);
  assertFn(handler, "Shortcut handler");
  const key = match[1];
  if (reserved.shortcuts.has(key)) throw new Error(`Shortcut ${combo} is built in`);
  const taken = shortcuts.get(key);
  if (taken) throw new Error(`Shortcut ${combo} already belongs to plugin "${taken.pluginId}"`);
  shortcuts.set(key, { pluginId, handler });
  return () => shortcuts.delete(key);
}

/** key: "KeyJ" or "Shift+KeyJ". Returns a function to run, or undefined. */
export function getShortcut(key) {
  const shortcut = shortcuts.get(key);
  return shortcut && (() => runSafely(shortcut.pluginId, shortcut.handler));
}

// ---------- menus ----------
export function addMenuItem(pluginId, kind, { label, onSelect, danger = false, when = null }) {
  if (typeof label !== "string" || !label) throw new TypeError("Menu item needs a label");
  assertFn(onSelect, "Menu item onSelect");
  const entry = { pluginId, label, onSelect, danger: !!danger, when };
  menuItems[kind].push(entry);
  return () => menuItems[kind].splice(menuItems[kind].indexOf(entry), 1);
}

/** Items for one right-click, in the shape menu.js takes, bound to the tab or group clicked. */
export function menuItemsFor(kind, target) {
  return menuItems[kind]
    .filter((item) => !item.when || runSafely(item.pluginId, item.when, target))
    .map((item) => ({ label: item.label, danger: item.danger, onSelect: () => runSafely(item.pluginId, item.onSelect, target) }));
}

// ---------- status bar ----------
const notifyStatus = () => statusListeners.forEach((fn) => fn());
export const onStatusChange = (fn) => statusListeners.add(fn);
export const statusItems = () => statusEntries;

/** Returns { remove, update(changes) }. */
export function addStatusItem(pluginId, { text = "", title = "", onClick = null }) {
  const entry = {
    text: String(text),
    title: String(title),
    onClick: onClick && (() => runSafely(pluginId, onClick)),
  };
  statusEntries.push(entry);
  notifyStatus();
  return {
    remove: () => { statusEntries.splice(statusEntries.indexOf(entry), 1); notifyStatus(); },
    update: (changes) => {
      if (changes.text !== undefined) entry.text = String(changes.text);
      if (changes.title !== undefined) entry.title = String(changes.title);
      notifyStatus();
    },
  };
}

// ---------- events ----------
export function on(pluginId, name, handler) {
  const set = listeners.get(name);
  if (!set) throw new Error(`Unknown event "${name}". Events: ${EVENTS.join(", ")}`);
  assertFn(handler, "Event handler");
  const listener = (payload) => runSafely(pluginId, handler, payload);
  set.add(listener);
  return () => set.delete(listener);
}

export function emit(name, payload) {
  listeners.get(name).forEach((listener) => listener(payload));
}
