// The app's own actions. Ids without a dot act on what is selected, and are what keymap.js names.
// Ids with a dot take a target: the tab, group or closed tab first. A target that is gone is ignored,
// so a menu left open, or a plugin holding an old copy, can't act on something no longer there.

import { defineAction } from "./core/actions.js";
import {
  state, activeTab, barGroups, barTabs, getGroup, getTab, isRunning, stopRun, tabsIn,
  activateTab, addTab, addGroup, closeActive, closeTab, duplicateTab, moveTabToNewGroup, setTabCollapsed, setTabMinimized,
  restoreMinimized, selectGroup, updateSettings, setGroupCollapsed, setGroupMinimized, setSidebarOpen, reopenLastClosed, reopenPast, deletePast,
} from "./store.js";
import { openSettings } from "./settings.js";
import { FONT_SIZE } from "./constants.js";
import { startRename } from "./rename.js";
import { confirmClearPast, confirmRemoveGroup, reopenLabel } from "./contextMenus.js";

function switchTab(offset) {
  const tabs = barTabs();
  if (!tabs.length) return;
  const index = tabs.indexOf(activeTab());
  activateTab(tabs[(index + offset + tabs.length) % tabs.length].id);
}

function switchGroup(offset) {
  const groups = barGroups();
  if (groups.length < 2) return;
  const index = groups.findIndex((g) => g.id === state.ws.activeGroup);
  selectGroup(groups[(index + offset + groups.length) % groups.length]);
}

function goToTab(n) {
  const tab = barTabs()[n - 1];
  if (tab) activateTab(tab.id);
}

function goToGroup(n) {
  const group = barGroups()[n - 1];
  if (group) selectGroup(group);
}

const isTab = (tab) => !!tab && getTab(tab.id) === tab;
const isGroup = (group) => !!group && getGroup(group.id) === group;
const isPast = (entry) => state.past.includes(entry);

/** Actions on one kind of target: `run` and `enabled` only see one that still exists. */
const onTarget = (exists) => ({ enabled, ...action }) => ({
  ...action,
  enabled: (target, ...rest) => exists(target) && (!enabled || enabled(target, ...rest)),
});
const tabAction = onTarget(isTab);
const groupAction = onTarget(isGroup);
const pastAction = onTarget(isPast);

const ACTIONS = [
  { id: "newTab", label: "New tab", run: () => addTab() },
  { id: "reopenTab", label: "Reopen closed tab", run: () => reopenLastClosed() },
  { id: "closeTab", label: "Close tab", run: () => closeActive() },
  { id: "newGroup", label: "New group", run: () => addGroup() },
  { id: "toggleSidebar", label: "Sidebar", run: () => setSidebarOpen(!state.ws.sidebarOpen) },
  { id: "openSettings", label: "Settings", run: () => openSettings() },
  { id: "previousTab", label: "Previous tab", run: () => switchTab(-1) },
  { id: "nextTab", label: "Next tab", run: () => switchTab(1) },
  { id: "previousGroup", label: "Previous group", run: () => switchGroup(-1) },
  { id: "nextGroup", label: "Next group", run: () => switchGroup(1) },
  { id: "goToTab", label: "Go to tab", run: goToTab },
  { id: "goToGroup", label: "Go to group", run: goToGroup },
  { id: "clearSessions", label: "Clear all sessions", run: () => confirmClearPast() },
  // Text size stays within FONT_SIZE.min..max (updateSettings clamps too)
  { id: "textLarger", label: "Larger text", enabled: () => state.settings.fontSize < FONT_SIZE.max, run: () => updateSettings({ fontSize: state.settings.fontSize + 1 }) },
  { id: "textSmaller", label: "Smaller text", enabled: () => state.settings.fontSize > FONT_SIZE.min, run: () => updateSettings({ fontSize: state.settings.fontSize - 1 }) },
  { id: "textReset", label: "Default text size", enabled: () => state.settings.fontSize !== FONT_SIZE.default, run: () => updateSettings({ fontSize: FONT_SIZE.default }) },

  tabAction({ id: "tab.rename", label: "Rename", run: (tab, where) => startRename("tab", tab, where) }),
  tabAction({ id: "tab.toggleCollapsed", label: (tab) => (tab?.collapsed ? "Expand" : "Collapse to chip"), run: (tab) => setTabCollapsed(tab, !tab.collapsed) }),
  tabAction({
    id: "tab.toggleMinimized",
    label: (tab) => (tab?.minimized ? "Restore" : "Minimize into group label"),
    run: (tab) => (tab.minimized ? activateTab(tab.id) : setTabMinimized(tab, true)),
  }),
  tabAction({ id: "tab.duplicate", label: "Duplicate", run: (tab) => duplicateTab(tab) }),
  tabAction({ id: "tab.stop", label: "Stop running command", enabled: (tab) => isRunning(tab.id), run: (tab) => stopRun(tab.id) }),
  tabAction({ id: "tab.sendToNewGroup", label: "Send to › New group", run: (tab) => moveTabToNewGroup(tab) }),
  tabAction({ id: "tab.close", label: "Close tab", danger: true, run: (tab) => closeTab(tab) }),

  groupAction({ id: "group.newTab", label: "New tab in group", run: (group) => addTab(group.id) }),
  groupAction({ id: "group.rename", label: "Rename", run: (group, where) => startRename("group", group, where) }),
  groupAction({ id: "group.toggleCollapsed", label: (group) => `${group?.collapsed ? "Expand" : "Collapse"} group`, run: (group) => setGroupCollapsed(group, !group.collapsed) }),
  groupAction({ id: "group.toggleMinimized", label: (group) => (group?.minimized ? "Restore" : "Minimize"), run: (group) => setGroupMinimized(group, !group.minimized) }),
  groupAction({ id: "group.restoreTabs", label: "Restore minimized tabs", enabled: (group) => tabsIn(group.id).some((t) => t.minimized), run: (group) => restoreMinimized(group) }),
  groupAction({ id: "group.close", label: "Close group", danger: true, run: (group) => confirmRemoveGroup(group) }),

  pastAction({ id: "past.reopen", label: () => reopenLabel(), run: (entry) => reopenPast(entry) }),
  pastAction({ id: "past.rename", label: "Rename", run: (entry) => startRename("past", entry) }),
  pastAction({ id: "past.delete", label: "Delete forever", danger: true, run: (entry) => deletePast(entry) }),
];

ACTIONS.forEach(defineAction);
