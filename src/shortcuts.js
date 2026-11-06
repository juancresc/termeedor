// Keyboard shortcuts. Alt is used because browsers reserve Cmd+T / Cmd+W.

import { state, activeTab, barTabs, activateTab, addTab, addGroup, closeTab, setSidebarOpen, reopenLastClosed, setAllGroupsCollapsed } from "./store.js";
import { startRename } from "./rename.js";
import { openSettings } from "./settings.js";

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

const ALT_SHORTCUTS = {
  KeyT: () => addTab(),
  "Shift+KeyT": () => reopenLastClosed(),
  KeyF: () => setAllGroupsCollapsed(!state.ws.groups.every((g) => g.collapsed)),
  KeyG: () => startRename("group", addGroup()),
  KeyW: () => activeTab() && closeTab(activeTab()),
  KeyB: () => setSidebarOpen(!state.ws.sidebarOpen),
  Comma: () => openSettings(),
  ArrowRight: () => switchTab(1),
  ArrowLeft: () => switchTab(-1),
};

export function initShortcuts() {
  document.addEventListener("keydown", (e) => {
    if (!e.altKey || document.getElementById("settings").open) return;
    const digit = e.code.match(/^Digit([1-9])$/);
    const action = digit ? () => goToTab(Number(digit[1])) : ALT_SHORTCUTS[(e.shiftKey ? "Shift+" : "") + e.code];
    if (!action) return;
    e.preventDefault();
    action();
  });
}
