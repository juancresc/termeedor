// Runs app actions from the keyboard. The keys themselves live in keymap.js.

import { runAction } from "./core/actions.js";
import { isMac } from "./platform.js";
import { getShortcut, reserve } from "./plugins/registry.js";
import { builtinShortcutKeys, findShortcut, pluginShortcutKey, shortcutList, withShortcut } from "./keymap.js";

// Copy, paste, undo and friends are in the editor, not the keymap, but plugins can't have them either.
reserve("shortcuts", [...builtinShortcutKeys(), "KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "Shift+KeyZ", "KeyQ"]);
// Where the shortcut modifier is Ctrl, the editor's readline keys use it too.
if (!isMac) reserve("shortcuts", ["KeyU", "KeyL", "KeyP", "KeyN"]);

export function initShortcuts() {
  for (const node of document.querySelectorAll("[data-shortcut]")) {
    // tooltip.js may already have moved `title` to `data-tip`; it picks up the new title either way
    node.title = withShortcut(node.dataset.tip ?? node.title, node.dataset.shortcut);
  }
  document.getElementById("shortcutList").textContent = shortcutList().join(" · ");

  document.addEventListener("keydown", (e) => {
    if (document.getElementById("settings").open) return;
    const shortcut = findShortcut(e);
    const action = shortcut ? () => runAction(shortcut.action, shortcut.arg) : getShortcut(pluginShortcutKey(e));
    if (!action) return;
    e.preventDefault();
    action();
  });
}
