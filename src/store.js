// Single source of truth: workspace (groups + open tabs), past sessions, settings.
// UI modules read `state`, call the actions below, and re-render when `commit()` notifies them.

import { STORAGE_KEYS, LIMITS, TAB_COLORS, AUTO_GROUP_COLORS, PROMPT, SIDEBAR, FONT_SIZE } from "./constants.js";
import { uid } from "./util.js";
import { load, save, sanitizeWorkspace, sanitizePastEntry, sanitizeSettings } from "./storage.js";

// ---------- factories ----------
const banner = () =>
  `Termeedor — ${new Date().toLocaleString()}\n\n`;

export function createTab(groupId, name = "shell") {
  return { id: uid(), groupId, name, color: null, collapsed: false, minimized: false, content: banner() + PROMPT, cwd: "~", history: [] };
}

function defaultTabColorFor(group) {
  const setting = state.settings.defaultTabColor;
  if (setting === "group") return group.color;
  return TAB_COLORS.includes(setting) ? setting : null;
}

function createGroup(name, color = null) {
  return { id: uid(), name, color, minimized: false };
}

function defaultWorkspace() {
  const work = createGroup("Work");
  const personal = createGroup("Personal");
  const tabs = [createTab(work.id, "api"), createTab(work.id, "frontend"), createTab(personal.id, "dotfiles")];
  return { groups: [work, personal], tabs, activeTab: tabs[0].id, sidebarOpen: true, sidebarWidth: SIDEBAR.default };
}

function loadPast() {
  const raw = load(STORAGE_KEYS.past);
  return Array.isArray(raw) ? raw.map(sanitizePastEntry).filter(Boolean).slice(0, LIMITS.past) : [];
}

// ---------- state ----------
export const state = {
  ws: sanitizeWorkspace(load(STORAGE_KEYS.workspace)) ?? defaultWorkspace(),
  past: loadPast(), // newest first
  settings: sanitizeSettings(load(STORAGE_KEYS.settings)),
};

// ---------- persistence & change notification ----------
const failedSaves = new Set(); // the parts whose last save failed
const listeners = new Set();

/** Re-renders when a part starts or stops failing, so the status bar can say so. */
function savePart(part, value) {
  const ok = save(STORAGE_KEYS[part], value);
  const changed = ok === failedSaves.has(part);
  if (ok) failedSaves.delete(part);
  else failedSaves.add(part);
  if (changed) queueMicrotask(() => listeners.forEach((fn) => fn()));
  return ok;
}

const savers = {
  workspace: () => savePart("workspace", state.ws),
  past: () => savePart("past", state.past),
  settings: () => savePart("settings", state.settings),
};

export const hasSaveFailed = () => failedSaves.size > 0;

export const subscribe = (fn) => listeners.add(fn);

/** Save the given parts (default: workspace) and re-render. */
export function commit(...parts) {
  ensureSelection();
  for (const part of parts.length ? parts : ["workspace"]) savers[part]();
  listeners.forEach((fn) => fn());
}

let saveTimer;
/** Debounced workspace save, used while typing (no re-render). */
export function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(savers.workspace, 300);
}
export const saveNow = () => savers.workspace();

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
/** The color a group shows: the one picked for it, or in "show all" mode its automatic one. */
export const groupColor = (group) => group.color ?? (state.settings.showAllGroups ? group.autoColor : null);

/** Every group keeps one automatic color, the least used when it was created, so groups can be told apart. */
function assignAutoColors() {
  const uses = (color) => state.ws.groups.filter((g) => (g.color ?? g.autoColor) === color).length;
  for (const group of state.ws.groups) {
    if (group.autoColor) continue;
    group.autoColor = AUTO_GROUP_COLORS.reduce((best, color) => (uses(color) < uses(best) ? color : best));
  }
}

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
  assignAutoColors();
  const tab = activeTab();
  if (tab && !tab.minimized && !getGroup(tab.groupId).minimized) {
    state.ws.activeGroup = tab.groupId;
    lastTabIn.set(tab.groupId, tab.id);
    return;
  }
  const group = getGroup(state.ws.activeGroup);
  show(group && !group.minimized ? group : barGroups()[0]);
}
ensureSelection();

/** Swaps an item with its neighbor in the bar. Items not in the bar keep their places. */
function moveInBar(list, bar, item, delta) {
  const other = bar[bar.indexOf(item) + delta];
  if (!other) return;
  const [a, b] = [list.indexOf(item), list.indexOf(other)];
  [list[a], list[b]] = [list[b], list[a]];
  commit();
}

// ---------- running commands (runtime only, never saved) ----------
const runs = new Map(); // tabId -> AbortController

export const isRunning = (tabId) => runs.has(tabId);
export const groupHasRunning = (groupId) => state.ws.tabs.some((t) => t.groupId === groupId && runs.has(t.id));

export function startRun(tab) {
  const controller = new AbortController();
  runs.set(tab.id, controller);
  commit();
  return controller.signal;
}
export function finishRun(tab) {
  runs.delete(tab.id);
}
export function stopRun(tabId) {
  const controller = runs.get(tabId);
  if (!controller) return false;
  controller.abort();
  return true;
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

export function addTab(groupId = state.ws.activeGroup ?? state.ws.groups[0]?.id) {
  let group = getGroup(groupId);
  if (!group) {
    group = createGroup("Group 1");
    state.ws.groups.push(group);
  }
  showGroup(group);
  const tab = createTab(group.id, `shell ${state.ws.tabs.filter((t) => t.groupId === group.id).length + 1}`);
  tab.color = defaultTabColorFor(group);
  state.ws.tabs.push(tab);
  state.ws.activeTab = tab.id;
  commit();
  return tab;
}

/** Closing a tab moves it to Past sessions. */
export function closeTab(tab) {
  stopRun(tab.id);
  archiveTab(tab);
  const siblings = tabsIn(tab.groupId);
  const position = siblings.indexOf(tab);
  state.ws.tabs.splice(state.ws.tabs.indexOf(tab), 1);
  if (state.ws.activeTab === tab.id) {
    const remaining = siblings.filter((t) => t !== tab && !t.minimized);
    state.ws.activeTab = (remaining[Math.min(position, remaining.length - 1)] ?? barTabs()[0])?.id ?? null;
  }
  commit("workspace", "past");
}

export function duplicateTab(tab) {
  const copy = { ...tab, id: uid(), name: `${tab.name} copy`.slice(0, LIMITS.name), history: [...tab.history] };
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
  const group = createGroup(`Group ${state.ws.groups.length + 1}`);
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
/** Creates an empty group (no terminal) and selects it. */
export function addGroup() {
  const group = createGroup(`Group ${state.ws.groups.length + 1}`);
  state.ws.groups.push(group);
  show(group);
  commit();
  return group;
}

export function selectGroup(group) {
  show(group);
  commit();
}

export const moveGroupBy = (group, delta) => moveInBar(state.ws.groups, barGroups(), group, delta);

/** Closing a group moves all its tabs to Past sessions. */
export function closeGroup(group) {
  leaveGroup(group);
  const tabs = state.ws.tabs.filter((t) => t.groupId === group.id);
  tabs.reverse().forEach((t) => { stopRun(t.id); archiveTab(t); });
  state.ws.tabs = state.ws.tabs.filter((t) => t.groupId !== group.id);
  state.ws.groups = state.ws.groups.filter((g) => g !== group);
  commit("workspace", "past");
}

function showGroup(group) {
  group.minimized = false;
}

/** If this group is selected, select the group next to it instead. */
function leaveGroup(group) {
  if (state.ws.activeGroup !== group.id) return;
  const bar = barGroups();
  const index = bar.indexOf(group);
  show(bar[index + 1] ?? bar[index - 1]);
}

/** Minimizing takes the group out of the top row. Restoring brings it back and selects it. */
export function setGroupMinimized(group, minimized) {
  if (minimized) {
    leaveGroup(group);
    group.minimized = true;
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
  const group = getGroup(tab.groupId);
  state.past.unshift({
    id: uid(),
    name: tab.name,
    closedAt: Date.now(),
    groupId: tab.groupId,
    groupName: group?.name ?? "Group",
    groupColor: group?.color ?? null,
    tab: { color: tab.color, content: tab.content, cwd: tab.cwd, history: [...tab.history] },
  });
  state.past.length = Math.min(state.past.length, LIMITS.past);
}

/**
 * Reopens into the selected group. With none selected (all minimized): the original group,
 * else one with the same name, else recreate it.
 */
export function reopenPast(entry) {
  let group = getGroup(state.ws.activeGroup) ?? getGroup(entry.groupId) ?? state.ws.groups.find((g) => g.name === entry.groupName);
  if (!group) {
    group = createGroup(entry.groupName, entry.groupColor);
    state.ws.groups.push(group);
  }
  showGroup(group);
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
  if (!savers.settings()) {
    state.settings = before;
    throw new Error("Storage is full, so this was not saved.");
  }
  listeners.forEach((fn) => fn());
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
