// Single source of truth: workspace (groups + open tabs), past sessions, settings.
// UI modules read `state`, call the actions below, and re-render when `commit()` notifies them.
// No DOM, storage or running commands: store.js provides those through `connect`.

import { LIMITS, TAB_COLORS, SIDEBAR, FONT_SIZE } from "../constants.js";
import { uid } from "./uid.js";
import { sanitizeSettings } from "./sanitize.js";
import { copyBlocks, textBlock } from "./transcript.js";

// ---------- factories ----------
const banner = () =>
  textBlock(`Termeedor — ${new Date().toLocaleString()}\n`);

export function createTab(groupId, name = "shell") {
  return { id: uid(), groupId, name, color: null, collapsed: false, minimized: false, blocks: [banner()], draft: "", cwd: "~", history: [] };
}

function defaultTabColorFor(group) {
  const setting = state.settings.defaultTabColor;
  if (setting === "group") return group.color;
  return TAB_COLORS.includes(setting) ? setting : null;
}

/** New groups have no name until renamed. This is what to call one in menus and dialogs. */
export const groupLabel = (group) => group.name || "Unnamed group";

function createGroup(name = "", color = null) {
  return { id: uid(), name, color, collapsed: false, minimized: false };
}

export function defaultWorkspace() {
  const work = createGroup("Work");
  const personal = createGroup("Personal");
  const tabs = [createTab(work.id, "api"), createTab(work.id, "frontend"), createTab(personal.id, "dotfiles")];
  return { groups: [work, personal], tabs, activeTab: tabs[0].id, sidebarOpen: true, sidebarWidth: SIDEBAR.default };
}

// ---------- state ----------
export const state = {
  ws: { groups: [], tabs: [], activeTab: null, activeGroup: null, sidebarOpen: true, sidebarWidth: SIDEBAR.default },
  past: [], // newest first
  settings: sanitizeSettings(null),
};

/** Puts loaded data in place, before anything renders. */
export function hydrate({ ws, past, settings }) {
  state.ws = ws;
  state.past = past;
  state.settings = settings;
  ensureSelection();
}

// ---------- what the outside provides ----------
const outside = {
  save() {},           // (parts) a commit happened: save these parts when convenient
  saveNow: () => true, // saves before returning; false if that failed
  endSession() {},     // (tabId) a tab is closing: end its shell and whatever it runs
};

export const connect = (provided) => { Object.assign(outside, provided); };

// ---------- change notification ----------
const listeners = new Set();

export const subscribe = (fn) => listeners.add(fn);
export const notify = () => listeners.forEach((fn) => fn());

/** Save the given parts (default: workspace) and re-render. */
export function commit(...parts) {
  ensureSelection();
  outside.save(parts.length ? parts : ["workspace"]);
  notify();
}

// ---------- selectors ----------
export const getTab = (id) => state.ws.tabs.find((t) => t.id === id);
export const getGroup = (id) => state.ws.groups.find((g) => g.id === id);
export const activeTab = () => getTab(state.ws.activeTab);
export const tabsIn = (groupId) => state.ws.tabs.filter((t) => t.groupId === groupId);
export const visibleTabsIn = (groupId) => tabsIn(groupId).filter((t) => !t.minimized);
/** The groups in the top row, in order. */
export const barGroups = () => state.ws.groups.filter((g) => !g.minimized);
/** The tabs in the second row, in order: the selected group's, or every group's in "show all" mode. */
export const barTabs = () => (state.settings.showAllGroups
  ? barGroups().flatMap((g) => visibleTabsIn(g.id))
  : visibleTabsIn(state.ws.activeGroup));
export const minimizedGroups = () => state.ws.groups.filter((g) => g.minimized);

// ---------- what is selected ----------
const lastTabIn = new Map(); // groupId -> tabId, so returning to a group returns to its tab

const tabToShow = (group) => {
  const last = getTab(lastTabIn.get(group.id));
  return last && last.groupId === group.id && !last.minimized ? last : visibleTabsIn(group.id)[0];
};

function show(group) {
  state.ws.activeGroup = group?.id ?? null;
  state.ws.activeTab = group ? tabToShow(group)?.id ?? null : null;
}

/** The selected tab decides the selected group. With no usable tab, the group decides (it may be empty). */
function ensureSelection() {
  const tab = activeTab();
  if (tab && !tab.minimized && !getGroup(tab.groupId).minimized) {
    state.ws.activeGroup = tab.groupId;
    lastTabIn.set(tab.groupId, tab.id);
    return;
  }
  const group = getGroup(state.ws.activeGroup);
  show(group && !group.minimized ? group : barGroups()[0]);
}

/** Swaps an item with its neighbor in the bar. Items not in the bar keep their places. */
function moveInBar(list, bar, item, delta) {
  const other = bar[bar.indexOf(item) + delta];
  if (!other) return;
  const [a, b] = [list.indexOf(item), list.indexOf(other)];
  [list[a], list[b]] = [list[b], list[a]];
  commit();
}

// ---------- tab actions ----------
export function activateTab(id) {
  const tab = getTab(id);
  if (!tab) return;
  state.ws.activeTab = id;
  tab.minimized = false;
  showGroup(getGroup(tab.groupId));
  commit();
}

/** Opens at the end, or right after the `after` tab. */
export function addTab(groupId = state.ws.activeGroup ?? state.ws.groups[0]?.id, after = null) {
  let group = getGroup(groupId);
  if (!group) {
    group = createGroup();
    state.ws.groups.push(group);
  }
  showGroup(group);
  const tab = createTab(group.id, `shell ${state.ws.tabs.filter((t) => t.groupId === group.id).length + 1}`);
  tab.color = defaultTabColorFor(group);
  if (state.settings.newTabInCurrentPath && activeTab()) tab.cwd = activeTab().cwd;
  state.ws.tabs.splice(after ? state.ws.tabs.indexOf(after) + 1 : state.ws.tabs.length, 0, tab);
  state.ws.activeTab = tab.id;
  commit();
  return tab;
}

/** Closing a tab moves it to Past sessions. A group left with no tabs is minimized, to restore later. */
export function closeTab(tab) {
  outside.endSession(tab.id);
  archiveTab(tab);
  const siblings = tabsIn(tab.groupId);
  const position = siblings.indexOf(tab);
  state.ws.tabs.splice(state.ws.tabs.indexOf(tab), 1);
  if (state.ws.activeTab === tab.id) {
    const remaining = siblings.filter((t) => t !== tab && !t.minimized);
    state.ws.activeTab = (remaining[Math.min(position, remaining.length - 1)] ?? barTabs()[0])?.id ?? null;
  }
  if (siblings.length === 1) minimizeGroup(getGroup(tab.groupId));
  commit("workspace", "past");
}

export function duplicateTab(tab) {
  const copy = { ...tab, id: uid(), name: `${tab.name} copy`.slice(0, LIMITS.name), blocks: copyBlocks(tab.blocks), history: [...tab.history] };
  state.ws.tabs.splice(state.ws.tabs.indexOf(tab) + 1, 0, copy);
  state.ws.activeTab = copy.id;
  commit();
}

export const moveTabBy = (tab, delta) => moveInBar(state.ws.tabs, visibleTabsIn(tab.groupId), tab, delta);

/** Send one tab to another group (moves it to the end of that group). */
export function moveTab(tab, groupId) {
  if (tab.groupId === groupId) return;
  state.ws.tabs.splice(state.ws.tabs.indexOf(tab), 1);
  state.ws.tabs.push(tab);
  tab.groupId = groupId;
  showGroup(getGroup(groupId));
  state.ws.activeTab = tab.id;
  commit();
}

/** Send one tab to a brand-new group. Returns the group. */
export function moveTabToNewGroup(tab) {
  const group = createGroup();
  state.ws.groups.push(group);
  moveTab(tab, group.id);
  return group;
}

/** Collapse shrinks a tab to a small chip in place (it stays in the bar). */
export function setTabCollapsed(tab, collapsed) {
  tab.collapsed = collapsed;
  commit();
}

/** Minimize takes a tab out of the bar, counted on its group's tab; activating it brings it back. */
export function setTabMinimized(tab, minimized) {
  tab.minimized = minimized;
  if (minimized && state.ws.activeTab === tab.id) state.ws.activeTab = (visibleTabsIn(tab.groupId)[0] ?? barTabs()[0])?.id ?? null;
  commit();
}

export function restoreMinimized(group) {
  tabsIn(group.id).forEach((t) => { t.minimized = false; });
  showGroup(group);
  commit();
}

export function setTabColor(tab, color) {
  tab.color = color;
  commit();
}

// ---------- group actions ----------
/** Creates a group with one terminal and selects it. */
export function addGroup() {
  const group = createGroup();
  state.ws.groups.push(group);
  addTab(group.id);
  return group;
}

export function selectGroup(group) {
  show(group);
  commit();
}

export const moveGroupBy = (group, delta) => moveInBar(state.ws.groups, barGroups(), group, delta);

/** A tab nothing was ever typed or run in: just the banner, no history, no draft. */
const isUntouched = (tab) => tab.history.length === 0 && !tab.draft && tab.blocks.length <= 1;

/** Empty groups (no tabs, or only untouched ones) always close without asking. */
export const shouldConfirmCloseGroup = (group) => state.settings.confirmCloseGroup && !tabsIn(group.id).every(isUntouched);

/** Closing a group moves all its tabs to Past sessions. */
export function closeGroup(group) {
  leaveGroup(group);
  const tabs = state.ws.tabs.filter((t) => t.groupId === group.id);
  tabs.reverse().forEach((t) => { outside.endSession(t.id); archiveTab(t); });
  state.ws.tabs = state.ws.tabs.filter((t) => t.groupId !== group.id);
  state.ws.groups = state.ws.groups.filter((g) => g !== group);
  commit("workspace", "past");
}

/** Closes the selected tab. With an empty group selected (restored after its last tab closed), closes the group instead. */
export function closeActive() {
  const tab = activeTab();
  if (tab) return closeTab(tab);
  const group = getGroup(state.ws.activeGroup);
  if (group && !tabsIn(group.id).length) closeGroup(group);
}

function showGroup(group) {
  if (!group.minimized) return;
  group.minimized = false;
  group.collapsed = false;
}

/** If this group is selected, select the group next to it instead. */
function leaveGroup(group) {
  if (state.ws.activeGroup !== group.id) return;
  const bar = barGroups();
  const index = bar.indexOf(group);
  show(bar[index + 1] ?? bar[index - 1]);
}

function minimizeGroup(group) {
  leaveGroup(group);
  group.minimized = true;
  group.collapsed = true;
}

/** Collapse only hides the group's tabs in the sidebar. The group stays in the top row and stays selected. */
export function setGroupCollapsed(group, collapsed) {
  group.collapsed = collapsed;
  commit();
}

/**
 * Minimizing takes the group out of the top row and collapses it in the sidebar, where it can
 * still be expanded while minimized. Restoring brings it back expanded and selects it.
 */
export function setGroupMinimized(group, minimized) {
  if (minimized) {
    minimizeGroup(group);
  } else {
    showGroup(group);
    show(group);
  }
  commit();
}

export function setGroupColor(group, color) {
  group.color = color;
  commit();
}

export function setGroupTabs(group, changes) {
  state.ws.tabs.filter((t) => t.groupId === group.id).forEach((t) => Object.assign(t, changes));
  commit();
}

// ---------- past sessions ----------
function archiveTab(tab) {
  state.past.unshift({
    id: uid(),
    name: tab.name,
    // Past files have no list to keep their order in, so no two may share a time.
    closedAt: Math.max(Date.now(), (state.past[0]?.closedAt ?? 0) + 1),
    tab: { color: tab.color, blocks: copyBlocks(tab.blocks), draft: tab.draft, cwd: tab.cwd, history: [...tab.history] },
  });
  state.past.length = Math.min(state.past.length, LIMITS.past);
}

/** Reopens into the selected group. With none selected, into a new group. */
export function reopenPast(entry) {
  let group = getGroup(state.ws.activeGroup);
  if (!group) {
    group = createGroup();
    state.ws.groups.push(group);
  }
  const tab = { id: uid(), groupId: group.id, name: entry.name, collapsed: false, minimized: false, ...entry.tab, history: [...entry.tab.history] };
  state.ws.tabs.push(tab);
  state.ws.activeTab = tab.id;
  state.past = state.past.filter((p) => p !== entry);
  commit("workspace", "past");
}

export function reopenLastClosed() {
  if (state.past.length) reopenPast(state.past[0]);
}

export function deletePast(entry) {
  state.past = state.past.filter((p) => p !== entry);
  commit("past");
}

export function clearPast() {
  state.past = [];
  commit("past");
}

// ---------- shared ----------
/** kind: "tab" | "group" | "past" */
export function renameItem(kind, item, name) {
  item.name = name.trim().slice(0, LIMITS.name);
  commit(kind === "past" ? "past" : "workspace");
}

// ---------- layout ----------
export function setSidebarOpen(open) {
  state.ws.sidebarOpen = open;
  commit();
}

export function setSidebarWidth(px) {
  state.ws.sidebarWidth = Math.round(Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, px)));
  commit();
}

// ---------- settings ----------
export function updateSettings(changes) {
  Object.assign(state.settings, changes);
  state.settings.fontSize = Math.min(FONT_SIZE.max, Math.max(FONT_SIZE.min, state.settings.fontSize));
  commit("settings");
}

/** Theme text can hit the storage limit, so a failed save is undone and reported instead of silently lost. */
function commitThemes(customThemes, selectedId) {
  const before = state.settings;
  state.settings = { ...before, customThemes, theme: selectedId };
  if (!outside.saveNow(["settings"])) {
    state.settings = before;
    throw new Error("Storage is full, so this was not saved.");
  }
  notify();
}

export function addCustomTheme(theme) {
  if (state.settings.customThemes.length >= LIMITS.customThemes) throw new Error(`You can have up to ${LIMITS.customThemes} of your own themes.`);
  commitThemes([...state.settings.customThemes, theme], theme.id);
}

export function updateCustomTheme(theme) {
  commitThemes(state.settings.customThemes.map((t) => (t.id === theme.id ? theme : t)), theme.id);
}

export function removeCustomTheme(id) {
  state.settings.customThemes = state.settings.customThemes.filter((t) => t.id !== id);
  if (state.settings.theme === id) state.settings.theme = "default";
  commit("settings");
}
