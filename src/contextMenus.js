// Right-click / "⋯" menus for tabs, groups and past sessions.

import { TAB_COLORS } from "./constants.js";
import { openMenu } from "./menu.js";
import { askConfirm } from "./dialogs.js";
import { startRename } from "./rename.js";
import { menuItemsFor } from "./plugins/registry.js";
import {
  state, activateTab, getGroup, groupLabel, isRunning, stopRun,
  addTab, closeTab, duplicateTab, moveTab, moveTabToNewGroup, setTabColor, setTabCollapsed, setTabMinimized, restoreMinimized, tabsIn,
  closeGroup, shouldConfirmCloseGroup, setGroupMinimized, setGroupColor, setGroupTabs,
  reopenPast, deletePast, clearPast,
} from "./store.js";

/** Items added by plugins, as their own section. */
function pluginSection(kind, target) {
  const items = menuItemsFor(kind, target);
  return items.length ? ["-", ...items] : [];
}

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
    ...otherGroups.map((g) => ({ label: `Send to › ${groupLabel(g)}`, onSelect: () => moveTab(tab, g.id) })),
    { label: "Send to › New group", onSelect: () => moveTabToNewGroup(tab) },
    ...pluginSection("tab", tab),
    "-",
    { label: "Close tab", danger: true, onSelect: () => closeTab(tab) },
  ]);
}

/** where: "tabbar" | "sidebar" — rename happens in the same place the menu was opened. */
export function groupMenu(group, event, where = "sidebar") {
  openMenu(event, [
    { label: "New tab in group", onSelect: () => addTab(group.id) },
    { label: "Rename", onSelect: () => startRename("group", group, where) },
    { label: group.minimized ? "Restore" : "Minimize", onSelect: () => setGroupMinimized(group, !group.minimized) },
    ...(tabsIn(group.id).some((t) => t.minimized) ? [{ label: "Restore minimized tabs", onSelect: () => restoreMinimized(group) }] : []),
    { swatches: { label: "Group color", colors: TAB_COLORS, current: group.color, allowNone: true, onPick: (c) => setGroupColor(group, c) } },
    { swatches: { label: "Color all tabs", colors: TAB_COLORS, allowNone: true, onPick: (c) => setGroupTabs(group, { color: c }) } },
    ...pluginSection("group", group),
    "-",
    { label: "Close group", danger: true, onSelect: () => confirmRemoveGroup(group) },
  ]);
}

export async function confirmRemoveGroup(group) {
  if (!shouldConfirmCloseGroup(group) || await askConfirm({ title: `Close "${groupLabel(group)}"?`, acceptLabel: "Close group", danger: true })) closeGroup(group);
}

export async function confirmClearPast() {
  if (await askConfirm({ title: "Clear all sessions?", acceptLabel: "Clear all", danger: true })) clearPast();
}

/** Says where reopening a closed tab will put it. */
export function reopenLabel() {
  const group = getGroup(state.ws.activeGroup);
  return group ? `Reopen in › ${groupLabel(group)}` : "Reopen in a new group";
}

export function pastMenu(entry, event) {
  openMenu(event, [
    { label: reopenLabel(), onSelect: () => reopenPast(entry) },
    { label: "Rename", onSelect: () => startRename("past", entry) },
    "-",
    { label: "Delete forever", danger: true, onSelect: () => deletePast(entry) },
  ]);
}
