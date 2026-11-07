// Everything plugins have added to the app. Menus, shortcuts and the status bar
// read from here and know nothing else about plugins. No DOM or store imports.
// Each add/register function returns the function that removes what it added.
// Plugins add actions (core/actions.js); shortcuts, menu items and status items name one by id.

import { defineAction, hasAction, isEnabled, menuItem, runAction } from "../core/actions.js";

const shortcuts = new Map(); // "KeyJ" | "Shift+KeyJ" -> { pluginId, action }
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

function assertAction(id, what) {
  if (typeof id !== "string") throw new TypeError(`${what} must be an action id`);
  if (!hasAction(id)) throw new Error(`Unknown action "${id}"`);
}

// ---------- actions ----------
/** The action's id is "<plugin id>.<id>". Returns { id, remove }. */
export function registerAction(pluginId, { id, label, run, enabled = null, danger = false }) {
  if (typeof id !== "string" || !/^[\w.-]+$/.test(id)) throw new TypeError(`Invalid action id: ${id}`);
  if (typeof label !== "string" || !label) throw new TypeError("Action needs a label");
  assertFn(run, "Action run");
  if (enabled !== null) assertFn(enabled, "Action enabled");
  const fullId = `${pluginId}.${id}`;
  const remove = defineAction({
    id: fullId,
    label,
    danger: !!danger,
    run: (...args) => runSafely(pluginId, run, ...args),
    enabled: enabled && ((...args) => runSafely(pluginId, enabled, ...args)),
  });
  return { id: fullId, remove };
}

// ---------- shortcuts ----------
/** "Mod+KeyJ" or "Mod+Shift+KeyJ", using KeyboardEvent.code names. Mod is Cmd on macOS, Ctrl elsewhere. */
export function registerShortcut(pluginId, combo, action) {
  const match = typeof combo === "string" && combo.match(/^Mod\+((?:Shift\+)?[A-Z][A-Za-z0-9]+)$/);
  if (!match) throw new TypeError(`Invalid shortcut: ${combo} (expected e.g. "Mod+KeyJ" or "Mod+Shift+KeyJ")`);
  assertAction(action, "A shortcut's action");
  const key = match[1];
  if (reserved.shortcuts.has(key)) throw new Error(`Shortcut ${combo} is built in`);
  const taken = shortcuts.get(key);
  if (taken) throw new Error(`Shortcut ${combo} already belongs to plugin "${taken.pluginId}"`);
  shortcuts.set(key, { pluginId, action });
  return () => shortcuts.delete(key);
}

/** key: "KeyJ" or "Shift+KeyJ". Returns a function to run, or undefined. */
export function getShortcut(key) {
  const shortcut = shortcuts.get(key);
  return shortcut && (() => runSafely(shortcut.pluginId, runAction, shortcut.action));
}

// ---------- menus ----------
export function addMenuItem(pluginId, kind, action) {
  assertAction(action, "A menu item's action");
  const entry = { pluginId, action };
  menuItems[kind].push(entry);
  return () => menuItems[kind].splice(menuItems[kind].indexOf(entry), 1);
}

/** Items for one right-click, in the shape menu.js takes, bound to the tab or group clicked. */
export function menuItemsFor(kind, target) {
  return menuItems[kind]
    .filter(({ pluginId, action }) => hasAction(action) && runSafely(pluginId, isEnabled, action, target))
    .map(({ action }) => menuItem(action, target));
}

// ---------- status bar ----------
const notifyStatus = () => statusListeners.forEach((fn) => fn());
export const onStatusChange = (fn) => statusListeners.add(fn);
export const statusItems = () => statusEntries;

/** Returns { remove, update(changes) }. Clicking runs `action`, if it has one. */
export function addStatusItem(pluginId, { text = "", title = "", action = null }) {
  if (action !== null) assertAction(action, "A status item's action");
  const entry = {
    text: String(text),
    title: String(title),
    onClick: action && (() => runSafely(pluginId, runAction, action)),
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
