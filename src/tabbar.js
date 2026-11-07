// The two top bars. First row: groups, like tabs of tabs. Second row: the selected group's tabs.
// Minimized groups go to a tray at the end of the first row; a group's tab counts its minimized tabs.
// Drag a tab onto a group to send it there.

import { $, el, spinner } from "./util.js";
import { colorVar } from "./constants.js";
import {
  state, getGroup, getTab, tabsIn, barGroups, barTabs, isRunning, groupHasRunning, minimizedGroups,
  activateTab, addGroup, addTab, moveTab, selectGroup, restoreMinimized, setSidebarOpen,
} from "./store.js";
import { nameLabel, startRename, isEditing } from "./rename.js";
import { tabMenu, groupMenu, minimizedGroupsMenu } from "./contextMenus.js";
import { tabBarButtons, groupBarButtons, expandTabButton } from "./controls.js";

export function initTabbar() {
  $("newGroupTabBtn").onclick = () => startRename("group", addGroup(), "tabbar");
  $("newTabBtn").onclick = () => addTab();
  $("toggleSidebar").onclick = () => setSidebarOpen(!state.ws.sidebarOpen);
}

export function renderTabbar() {
  const tray = minimizedGroups().length ? [minimizedTray()] : [];
  $("groupTabs").replaceChildren(...barGroups().map(groupTab), ...tray);

  const group = getGroup(state.ws.activeGroup);
  const tabs = barTabs();
  $("tabs").replaceChildren(...(tabs.length
    ? tabs.map((tab) => tabNode(tab, group))
    : [el("span", "tabsEmpty", group ? "No tabs here — ＋ to add a terminal" : "All groups are minimized")]));
  $("newTabBtn").hidden = !group;
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
  if (group.color) node.style.setProperty("--group-color", colorVar(group.color));
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
