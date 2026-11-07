// Right-click / "⋯" menus for tabs, groups and past sessions.

import { TAB_COLORS } from "./constants.js";
import { isEnabled, menuItem } from "./core/actions.js";
import { openMenu } from "./menu.js";
import { askConfirm } from "./dialogs.js";
import { menuItemsFor } from "./plugins/registry.js";
import {
  state, getGroup, groupLabel, moveTab, setTabColor,
  closeGroup, shouldConfirmCloseGroup, setGroupColor, setGroupTabs, clearPast,
} from "./store.js";

/** An action as a menu item, or nothing if it doesn't apply here. Swatches and lists of groups aren't actions: each is one pick on one target. */
const item = (id, ...args) => (isEnabled(id, ...args) ? [menuItem(id, ...args)] : []);

/** Items added by plugins, as their own section. */
function pluginSection(kind, target) {
  const items = menuItemsFor(kind, target);
  return items.length ? ["-", ...items] : [];
}

/** where: "tabbar" | "sidebar" — rename happens in the same place the menu was opened. */
export function tabMenu(tab, event, where) {
  const otherGroups = state.ws.groups.filter((g) => g.id !== tab.groupId);
  openMenu(event, [
    ...item("tab.rename", tab, where),
    ...item("tab.toggleCollapsed", tab),
    ...item("tab.toggleMinimized", tab),
    ...item("tab.duplicate", tab),
    ...item("tab.stop", tab),
    { swatches: { label: "Tab color", colors: TAB_COLORS, current: tab.color, allowNone: true, onPick: (c) => setTabColor(tab, c) } },
    "-",
    ...otherGroups.map((g) => ({ label: `Send to › ${groupLabel(g)}`, onSelect: () => moveTab(tab, g.id) })),
    ...item("tab.sendToNewGroup", tab),
    ...pluginSection("tab", tab),
    "-",
    ...item("tab.close", tab),
  ]);
}

/** where: "tabbar" | "sidebar" — rename happens in the same place the menu was opened. */
export function groupMenu(group, event, where = "sidebar") {
  openMenu(event, [
    ...item("group.newTab", group),
    ...item("group.rename", group, where),
    ...item("group.toggleMinimized", group),
    ...item("group.restoreTabs", group),
    { swatches: { label: "Group color", colors: TAB_COLORS, current: group.color, allowNone: true, onPick: (c) => setGroupColor(group, c) } },
    { swatches: { label: "Color all tabs", colors: TAB_COLORS, allowNone: true, onPick: (c) => setGroupTabs(group, { color: c }) } },
    ...pluginSection("group", group),
    "-",
    ...item("group.close", group),
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
    ...item("past.reopen", entry),
    ...item("past.rename", entry),
    "-",
    ...item("past.delete", entry),
  ]);
}
