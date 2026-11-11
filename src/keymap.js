// Which keys trigger which app action. Everything that shows a shortcut reads it from here.
//
// Browser: browsers reserve Cmd+T / Cmd+W, and Option types characters on a Mac, so only
// Alt+arrows are bound. Desktop (Electron): the full set, on Cmd (Ctrl on Windows/Linux).

import { isDesktop, isMac } from "./platform.js";

const IN_GROUP = "In the selected group. With Show all tabs on, across every group.";
const GROUP_NOTE = "Returns to the tab you last used there. Skips minimized groups.";

// Ctrl+[ is Escape in a terminal, so off the Mac the group keys are Ctrl+PageUp/PageDown.
const GROUP_KEYS = isMac
  ? [
    { action: "previousGroup", code: "BracketLeft", key: "[", does: "previous group" },
    { action: "nextGroup", code: "BracketRight", key: "]", does: "next group" },
  ]
  : [
    { action: "previousGroup", code: "PageUp", key: "PageUp", does: "previous group" },
    { action: "nextGroup", code: "PageDown", key: "PageDown", does: "next group" },
  ];

const DESKTOP_KEYS = [
  { action: "newTab", code: "KeyT", key: "T", does: "new tab", section: "Tabs", note: "Opens in the selected group." },
  { action: "reopenTab", code: "KeyT", key: "T", shift: true, does: "reopen closed tab", section: "Tabs" },
  { action: "closeTab", code: "KeyW", key: "W", does: "close tab", section: "Tabs" },
  // Cmd+arrows stay with the editor (line start/end)
  { action: "previousTab", code: "BracketLeft", key: "[", shift: true, does: "previous tab", section: "Tabs", note: IN_GROUP },
  { action: "nextTab", code: "BracketRight", key: "]", shift: true, does: "next tab", section: "Tabs", note: IN_GROUP },
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ action: "goToTab", arg: n, code: `Digit${n}`, key: String(n) })),
  { action: "newGroup", code: "KeyG", key: "G", does: "new group", section: "Groups" },
  ...GROUP_KEYS.map((k) => ({ ...k, section: "Groups", note: GROUP_NOTE })),
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ action: "goToGroup", arg: n, code: `Digit${n}`, key: String(n), shift: true })),
  { action: "toggleSidebar", code: "KeyB", key: "B", does: "sidebar", section: "Window" },
  { action: "openSettings", code: "Comma", key: ",", does: "settings", section: "Window" },
];

const BROWSER_KEYS = [
  { action: "previousTab", code: "ArrowLeft", key: "←", does: "previous tab", section: "Tabs", note: IN_GROUP },
  { action: "nextTab", code: "ArrowRight", key: "→", does: "next tab", section: "Tabs", note: IN_GROUP },
];

// Not app shortcuts, but worth knowing. Listed after the keymap's own.
const OTHER_KEYS = [
  { label: "Tab", does: "complete", section: "Input" },
  { label: "↑ / ↓", does: "browse history", section: "Input" },
  { label: "Double-click", does: "rename a tab or group", section: "Input" },
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

/** The documented shortcuts for the settings dialog, by section: [{ section, rows: [{ keys, does, note? }] }]. */
export function shortcutList() {
  const rows = KEYS.filter((k) => k.does).map((k) => ({ section: k.section, keys: keyLabel(k), does: k.does, note: k.note }));
  if (isDesktop) {
    rows.splice(rows.findIndex((r) => r.does === "next tab") + 1, 0, { section: "Tabs", keys: keyLabel({ key: "1–9" }), does: "go to tab", note: IN_GROUP });
    rows.splice(rows.findIndex((r) => r.does === "next group") + 1, 0, { section: "Groups", keys: keyLabel({ key: "1–9", shift: true }), does: "go to group", note: GROUP_NOTE });
  }
  rows.push(...OTHER_KEYS.map((k) => ({ section: k.section, keys: k.label, does: k.does })));
  const sections = [];
  for (const { section, ...row } of rows) {
    const last = sections.at(-1);
    if (last?.section === section) last.rows.push(row);
    else sections.push({ section, rows: [row] });
  }
  return sections;
}
