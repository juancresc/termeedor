// Right-click / "⋯" menus for tabs, groups and past sessions.

import { TAB_COLORS } from "./constants.js";
import { openMenu } from "./menu.js";
import { startRename } from "./rename.js";
import {
  state, activeTab, activateTab, getGroup, isRunning, stopRun,
  addTab, closeTab, duplicateTab, moveTab, moveTabToNewGroup, setTabColor, setTabCollapsed, setTabMinimized, restoreMinimized, tabsIn,
  closeGroup, toggleGroupCollapsed, setGroupColor, setGroupTabs,
  reopenPast, deletePast,
} from "./store.js";

/** where: "tabbar" | "sidebar" — rename happens in the same place the menu was opened. */
export function tabMenu(tab, event, where) {
  const otherGroups = state.ws.groups.filter((g) => g.id !== tab.groupId);
  openMenu(event, [
    { label: "Rename", onSelect: () => startRename("tab", tab, where) },
    { label: tab.collapsed ? "Expand" : "Collapse to chip", onSelect: () => setTabCollapsed(tab, !tab.collapsed) },
    tab.minimized
      ? { label: "Restore", onSelect: () => activateTab(tab.id) }
      : { label: "Minimize into group label", onSelect: () => setTabMinimized(tab, true) },
    { label: "Duplicate", onSelect: () => duplicateTab(tab) },
    ...(isRunning(tab.id) ? [{ label: "Stop running command", onSelect: () => stopRun(tab.id) }] : []),
    { swatches: { label: "Tab color", colors: TAB_COLORS, current: tab.color, allowNone: true, onPick: (c) => setTabColor(tab, c) } },
    "-",
    ...otherGroups.map((g) => ({ label: `Send to › ${g.name}`, onSelect: () => moveTab(tab, g.id) })),
    { label: "Send to › New group", onSelect: () => startRename("group", moveTabToNewGroup(tab), where) },
    "-",
    { label: "Close tab", danger: true, onSelect: () => closeTab(tab) },
  ]);
}

/** where: "tabbar" | "sidebar" — rename happens in the same place the menu was opened. */
export function groupMenu(group, event, where = "sidebar") {
  openMenu(event, [
    { label: "New tab in group", onSelect: () => addTab(group.id) },
    { label: "Rename", onSelect: () => startRename("group", group, where) },
    { label: group.collapsed ? "Restore" : "Minimize into label", onSelect: () => toggleGroupCollapsed(group) },
    ...(tabsIn(group.id).some((t) => t.minimized) ? [{ label: "Restore minimized tabs", onSelect: () => restoreMinimized(group) }] : []),
    { swatches: { label: "Group color", colors: TAB_COLORS, current: group.color, allowNone: true, onPick: (c) => setGroupColor(group, c) } },
    { swatches: { label: "Color all tabs", colors: TAB_COLORS, allowNone: true, onPick: (c) => setGroupTabs(group, { color: c }) } },
    // removing a group is only offered from the sidebar
    ...(where === "sidebar" ? ["-", { label: "Remove group", danger: true, onSelect: () => confirmRemoveGroup(group) }] : []),
  ]);
}

function confirmRemoveGroup(group) {
  if (state.ws.groups.length === 1) return alert("You need at least one group.");
  const count = tabsIn(group.id).length;
  const message = count
    ? `Remove group "${group.name}"? Its ${count} tab(s) will move to Past sessions.`
    : `Remove empty group "${group.name}"?`;
  if (confirm(message)) closeGroup(group);
}

export function pastMenu(entry, event) {
  const current = activeTab() && getGroup(activeTab().groupId);
  openMenu(event, [
    { label: "Reopen", onSelect: () => reopenPast(entry) },
    ...(current && current.id !== entry.groupId ? [{ label: `Reopen in › ${current.name}`, onSelect: () => reopenPast(entry, current.id) }] : []),
    { label: "Rename", onSelect: () => startRename("past", entry) },
    "-",
    { label: "Delete forever", danger: true, onSelect: () => deletePast(entry) },
  ]);
}
