// Which keys trigger which app action. Everything that shows a shortcut reads it from here.
//
// Browser: browsers reserve Cmd+T / Cmd+W, and Option types characters on a Mac, so only
// Alt+arrows are bound. Desktop (Electron): the full set, on Cmd (Ctrl on Windows/Linux).

import { isDesktop, isMac } from "./platform.js";

const DESKTOP_KEYS = [
  { action: "newTab", code: "KeyT", key: "T", does: "new tab" },
  { action: "reopenTab", code: "KeyT", key: "T", shift: true, does: "reopen closed tab" },
  { action: "closeTab", code: "KeyW", key: "W", does: "close tab" },
  { action: "newGroup", code: "KeyG", key: "G", does: "new group" },
  { action: "toggleSidebar", code: "KeyB", key: "B", does: "sidebar" },
  { action: "openSettings", code: "Comma", key: ",", does: "settings" },
  // Cmd+arrows stay with the editor (line start/end)
  { action: "previousTab", code: "BracketLeft", key: "[", shift: true, does: "previous tab" },
  { action: "nextTab", code: "BracketRight", key: "]", shift: true, does: "next tab" },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ action: "goToTab", arg: n, code: `Digit${n}`, key: String(n) })),
];

const BROWSER_KEYS = [
  { action: "previousTab", code: "ArrowLeft", key: "←", does: "previous tab" },
  { action: "nextTab", code: "ArrowRight", key: "→", does: "next tab" },
];

const KEYS = isDesktop ? DESKTOP_KEYS : BROWSER_KEYS;

const modifierHeld = (e) => {
  if (!isDesktop) return e.altKey && !e.metaKey && !e.ctrlKey;
  return isMac ? e.metaKey && !e.ctrlKey && !e.altKey : e.ctrlKey && !e.metaKey && !e.altKey;
};

/** Plugin shortcuts use the same modifier as the built-ins. "KeyJ" | "Shift+KeyJ", or null if it isn't held. */
export const pluginShortcutKey = (e) => (modifierHeld(e) ? `${e.shiftKey ? "Shift+" : ""}${e.code}` : null);

/** Keys plugins can't take: every built-in shortcut, in the form pluginShortcutKey returns. */
export const builtinShortcutKeys = () => KEYS.map((k) => `${k.shift ? "Shift+" : ""}${k.code}`);

/** The entry a keydown event triggers, if any. */
export const findShortcut = (e) =>
  modifierHeld(e) ? KEYS.find((k) => k.code === e.code && !!k.shift === e.shiftKey) : undefined;

function keyLabel({ key, shift }) {
  if (!isDesktop) return `Alt+${shift ? "Shift+" : ""}${key}`;
  if (isMac) return `${shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${shift ? "Shift+" : ""}${key}`;
}

/** Tooltip text: adds the key when this action has one here. */
export function withShortcut(label, action) {
  const entry = KEYS.find((k) => k.action === action);
  return entry ? `${label} (${keyLabel(entry)})` : label;
}

/** One "key: what it does" string per documented shortcut, for the settings dialog. */
export function shortcutList() {
  const list = KEYS.filter((k) => k.does).map((k) => `${keyLabel(k)} ${k.does}`);
  if (isDesktop) list.push(`${keyLabel({ key: "1–9" })} go to tab`);
  return list;
}
