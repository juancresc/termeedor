// The two top bars. First row: groups, like tabs of tabs. Second row: the selected group's tabs.
// Minimized groups go to a tray at the end of the first row; a group's tab counts its minimized tabs.
// Drag a tab onto a group to send it there.

import { $, el, spinner } from "./util.js";
import { colorVar } from "./constants.js";
import {
  state, getGroup, getTab, tabsIn, visibleTabsIn, barGroups, barTabs, isRunning, groupHasRunning, minimizedGroups,
  activateTab, addGroup, addTab, moveTab, selectGroup, restoreMinimized, updateSettings,
} from "./store.js";
import { nameLabel, startRename, isEditing } from "./rename.js";
import { tabMenu, groupMenu, minimizedGroupsMenu } from "./contextMenus.js";
import { tabBarButtons, groupBarButtons, expandTabButton } from "./controls.js";
import { renderRow } from "./slide.js";

export function initTabbar() {
  $("newGroupTabBtn").onclick = () => startRename("group", addGroup(), "tabbar");
  $("newTabBtn").onclick = () => addTab();
  $("allGroupsBtn").onclick = () => updateSettings({ showAllGroups: !state.settings.showAllGroups });
}

export function renderTabbar() {
  const tray = minimizedGroups().length ? [minimizedTray()] : [];
  renderRow($("groupTabs"), [...barGroups().map(groupTab), ...tray]);

  const showAll = state.settings.showAllGroups;
  const group = getGroup(state.ws.activeGroup);
  $("tabs").classList.toggle("showAll", showAll);
  renderRow($("tabs"), tabRowNodes(group, showAll));
  $("newTabBtn").hidden = !group || showAll; // in "show all" mode each group has its own

  const toggle = $("allGroupsBtn");
  toggle.setAttribute("aria-pressed", String(showAll));
  toggle.title = showAll ? "Show this group's tabs" : "Show all tabs";
}

function tabRowNodes(group, showAll) {
  if (!group) return minimizedGroups().length ? [el("span", "tabsEmpty", "All groups are minimized.")] : [];
  if (!showAll) return barTabs().map((tab) => tabNode(tab, group));
  return barGroups().map(groupSection);
}

/** "Show all" mode: a box around a group's name, its tabs and its own new tab button. */
function groupSection(group) {
  const isActive = group.id === state.ws.activeGroup;
  const label = el("span", "tabGroupLabel", group.name);
  label.dataset.slideKey = `label-${group.id}`;
  label.onclick = () => selectGroup(group);

  const add = el("button", "tb-btn groupAdd", "＋");
  add.dataset.slideKey = `add-${group.id}`;
  add.title = `New tab in ${group.name}`;
  add.onclick = () => addTab(group.id);

  const box = el("div", `tabGroupBox${isActive ? " active" : ""}`);
  if (group.color) box.style.setProperty("--group-color", colorVar(group.color));
  box.append(label, ...visibleTabsIn(group.id).map((tab) => tabNode(tab, group)), add);
  acceptTabDrops(box, group);
  return box;
}

function minimizedTray() {
  const hidden = minimizedGroups();
  const tray = el("div", "groupTab groupTray");
  tray.title = `${hidden.length} minimized group${hidden.length === 1 ? "" : "s"} — click to restore`;
  if (hidden.some((g) => groupHasRunning(g.id))) tray.append(spinner());
  tray.append(el("span", "chipName", "▢"), el("span", "chipCount", String(hidden.length)));
  tray.onclick = minimizedGroupsMenu;
  return tray;
}

function groupTab(group) {
  const tabs = tabsIn(group.id);
  const minimizedCount = tabs.filter((t) => t.minimized).length;
  const node = el("div", `groupTab${group.id === state.ws.activeGroup ? " active" : ""}`);
  node.dataset.slideKey = group.id;
  if (group.color) node.style.borderTopColor = colorVar(group.color);

  if (group.id !== state.ws.activeGroup && groupHasRunning(group.id)) node.append(spinner());
  node.append(nameLabel("group", group, "tabbar", "span", "chipName"), el("span", "chipCount", String(tabs.length)));
  if (minimizedCount) {
    const badge = el("button", "chipCount", `+${minimizedCount}`);
    badge.title = "Restore minimized tabs";
    badge.onclick = (e) => { e.stopPropagation(); restoreMinimized(group); };
    node.append(badge);
  }
  node.append(groupBarButtons(group));

  node.onclick = () => { if (group.id !== state.ws.activeGroup) selectGroup(group); };
  node.ondblclick = (e) => { e.stopPropagation(); startRename("group", group, "tabbar"); };
  node.oncontextmenu = (e) => groupMenu(group, e, "tabbar");
  acceptTabDrops(node, group);
  return node;
}

function tabNode(tab, group) {
  const isActive = tab.id === state.ws.activeTab;
  const node = el("div", `tab${isActive ? " active" : ""}${tab.collapsed ? " collapsed" : ""}`);
  node.dataset.slideKey = tab.id;
  if (group.color) {
    node.classList.add("groupColored");
    node.style.setProperty("--group-color", colorVar(group.color));
  }
  if (tab.color) node.style.borderTopColor = colorVar(tab.color);

  if (tab.collapsed) {
    // small chip: first letter (or spinner) + expand button
    node.title = tab.name;
    node.append(isRunning(tab.id) ? spinner() : el("span", "initial", tab.name.slice(0, 1).toUpperCase()), expandTabButton(tab));
  } else {
    if (isRunning(tab.id)) node.append(spinner());
    node.append(nameLabel("tab", tab, "tabbar", "span", "name"), tabBarButtons(tab));
  }

  node.onclick = () => activateTab(tab.id);
  node.ondblclick = () => startRename("tab", tab, "tabbar");
  node.oncontextmenu = (e) => tabMenu(tab, e, "tabbar");
  node.draggable = !isEditing("tab", tab.id, "tabbar");
  node.ondragstart = (e) => e.dataTransfer.setData("text/tab", tab.id);
  return node;
}

function acceptTabDrops(node, group) {
  node.ondragover = (e) => { e.preventDefault(); node.classList.add("dragover"); };
  node.ondragleave = () => node.classList.remove("dragover");
  node.ondrop = (e) => {
    e.preventDefault();
    node.classList.remove("dragover");
    const tab = getTab(e.dataTransfer.getData("text/tab"));
    if (tab) moveTab(tab, group.id);
  };
}
