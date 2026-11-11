// Runs app actions from the keyboard. The keys themselves live in keymap.js.

import { runAction } from "./core/actions.js";
import { isMac } from "./platform.js";
import { getShortcut, reserve } from "./plugins/registry.js";
import { builtinShortcutKeys, findShortcut, pluginShortcutKey, shortcutList, withShortcut } from "./keymap.js";

// Copy, paste, undo and friends are in the editor, not the keymap, but plugins can't have them either.
reserve("shortcuts", [...builtinShortcutKeys(), "KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "Shift+KeyZ", "KeyQ"]);
// Cmd+arrows and Cmd+Backspace edit the line, in the input and in a running program.
if (isMac) reserve("shortcuts", ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Backspace"]);
// Where the shortcut modifier is Ctrl, the editor's readline keys use it too.
if (!isMac) reserve("shortcuts", ["KeyU", "KeyL", "KeyP", "KeyN"]);

const el = (tag, className, text) => Object.assign(document.createElement(tag), { className, textContent: text ?? "" });

/** One titled block per section, one searchable row per shortcut. */
function renderShortcutList() {
  const blocks = shortcutList().map(({ section, rows }) => {
    const block = el("div", "setSub");
    block.append(el("h5", "", section));
    for (const { keys, does, note } of rows) {
      const row = el("div", "setRow shortcutRow");
      row.dataset.keywords = section;
      const text = el("span", "setText");
      text.append(el("span", "", does));
      if (note) text.append(el("span", "hint", note));
      row.append(text, el("kbd", "", keys));
      block.append(row);
    }
    return block;
  });
  document.getElementById("shortcutList").replaceChildren(...blocks);
}

export function initShortcuts() {
  for (const node of document.querySelectorAll("[data-shortcut]")) {
    // tooltip.js may already have moved `title` to `data-tip`; it picks up the new title either way
    node.title = withShortcut(node.dataset.tip ?? node.title, node.dataset.shortcut);
  }
  renderShortcutList();

  document.addEventListener("keydown", (e) => {
    if (document.getElementById("settings").open) return;
    const shortcut = findShortcut(e);
    const action = shortcut ? () => runAction(shortcut.action, shortcut.arg) : getShortcut(pluginShortcutKey(e));
    if (!action) return;
    e.preventDefault();
    action();
  });
}
