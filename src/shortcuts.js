// Runs app actions from the keyboard. The keys themselves live in keymap.js.

import { state, activeTab, barTabs, activateTab, addTab, addGroup, closeTab, setSidebarOpen, reopenLastClosed, setAllGroupsCollapsed, allGroupsCollapsed } from "./store.js";
import { startRename } from "./rename.js";
import { openSettings } from "./settings.js";
import { getShortcut, reserve } from "./plugins/registry.js";
import { builtinShortcutKeys, findShortcut, pluginShortcutKey, shortcutList, withShortcut } from "./keymap.js";

// Copy, paste, undo and friends are in the editor, not the keymap, but plugins can't have them either.
reserve("shortcuts", [...builtinShortcutKeys(), "KeyA", "KeyC", "KeyV", "KeyX", "KeyZ", "Shift+KeyZ", "KeyQ"]);

function switchTab(offset) {
  const tabs = barTabs();
  if (!tabs.length) return;
  const index = tabs.indexOf(activeTab());
  activateTab(tabs[(index + offset + tabs.length) % tabs.length].id);
}

function goToTab(n) {
  const tab = barTabs()[n - 1];
  if (tab) activateTab(tab.id);
}

const ACTIONS = {
  newTab: () => addTab(),
  reopenTab: () => reopenLastClosed(),
  closeTab: () => activeTab() && closeTab(activeTab()),
  newGroup: () => startRename("group", addGroup(), "tabbar"),
  toggleSidebar: () => setSidebarOpen(!state.ws.sidebarOpen),
  toggleAllGroups: () => setAllGroupsCollapsed(!allGroupsCollapsed()),
  openSettings: () => openSettings(),
  previousTab: () => switchTab(-1),
  nextTab: () => switchTab(1),
  goToTab,
};

export function initShortcuts() {
  for (const node of document.querySelectorAll("[data-shortcut]")) {
    // tooltip.js may already have moved `title` to `data-tip`; it picks up the new title either way
    node.title = withShortcut(node.dataset.tip ?? node.title, node.dataset.shortcut);
  }
  document.getElementById("shortcutList").textContent = shortcutList().join(" · ");

  document.addEventListener("keydown", (e) => {
    if (document.getElementById("settings").open) return;
    const shortcut = findShortcut(e);
    const action = shortcut ? () => ACTIONS[shortcut.action](shortcut.arg) : getShortcut(pluginShortcutKey(e));
    if (!action) return;
    e.preventDefault();
    action();
  });
}
