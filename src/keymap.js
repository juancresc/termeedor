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

// macOS takes Shift+Cmd+3, 4 and 5 for screenshots, so there the group numbers go on Option+Cmd.
const GROUP_NUMBER = isMac ? { alt: true } : { shift: true };

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
  ...[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => ({ action: "goToGroup", arg: n, code: `Digit${n}`, key: String(n), ...GROUP_NUMBER })),
  { action: "toggleSidebar", code: "KeyB", key: "B", does: "sidebar", section: "Window" },
  { action: "openSettings", code: "Comma", key: ",", does: "settings", section: "Window" },
  // Text size goes by the character, not the key's position: on a Spanish keyboard + is where a US
  // one has ] and - where it has /. Cmd+= counts as + (no Shift on a US keyboard), as in browsers.
  { action: "textLarger", chars: ["+", "="], key: "+", does: "larger text", section: "Window" },
  { action: "textSmaller", chars: ["-"], key: "−", does: "smaller text", section: "Window" },
  { action: "textReset", chars: ["0"], key: "0", does: "default text size", section: "Window" },
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

// On the desktop Alt isn't part of the modifier: an entry asks for it (`alt`), like Shift.
const modifierHeld = (e) => {
  if (!isDesktop) return e.altKey && !e.metaKey && !e.ctrlKey;
  return isMac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
};
const altHeld = (e) => isDesktop && e.altKey;

/** Plugin shortcuts use the same modifier as the built-ins. "KeyJ" | "Shift+KeyJ", or null if it isn't held. */
export const pluginShortcutKey = (e) => (modifierHeld(e) && !altHeld(e) ? `${e.shiftKey ? "Shift+" : ""}${e.code}` : null);

/** Keys plugins can't take: every built-in shortcut, in the form pluginShortcutKey returns. Ones with Alt are out of their reach anyway. */
export const builtinShortcutKeys = () => KEYS.filter((k) => k.code && !k.alt).map((k) => `${k.shift ? "Shift+" : ""}${k.code}`);

/** The entry a keydown event triggers, if any. An entry by character wins over one by key position. */
export const findShortcut = (e) => {
  if (!modifierHeld(e)) return undefined;
  const alt = altHeld(e);
  return KEYS.find((k) => !alt && k.chars?.includes(e.key))
    ?? KEYS.find((k) => k.code && k.code === e.code && !!k.shift === e.shiftKey && !!k.alt === alt);
};

function keyLabel({ key, shift, alt }) {
  if (!isDesktop) return `Alt+${shift ? "Shift+" : ""}${key}`;
  if (isMac) return `${alt ? "⌥" : ""}${shift ? "⇧" : ""}⌘${key}`;
  return `Ctrl+${alt ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;
}

/** The key that, held alone, shows which number jumps where. Desktop only: the browser has no number keys. */
export const hintModifier = isDesktop ? (isMac ? "Meta" : "Control") : null;

/** The badge on the nth tab or group (from 1) while hintModifier is held, or null past 9. */
export const jumpHint = (kind, n) => (n >= 1 && n <= 9 ? `${kind === "group" ? (isMac ? "⌥" : "⇧") : ""}${n}` : null);

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
    rows.splice(rows.findIndex((r) => r.does === "next group") + 1, 0, { section: "Groups", keys: keyLabel({ key: "1–9", ...GROUP_NUMBER }), does: "go to group", note: GROUP_NOTE });
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
