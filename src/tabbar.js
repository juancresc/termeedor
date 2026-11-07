// The two top bars. First row: groups, like tabs of tabs. Second row: the selected group's tabs.
// Minimized groups go to a tray at the end of the first row; a group's tab counts its minimized tabs.
// Drag a tab onto a group to send it there.
// In "show all" mode each group's tab sits right above where its tabs start.

import { $, el, spinner } from "./util.js";
import { colorVar } from "./constants.js";
import {
  state, getGroup, getTab, groupLabel, tabsIn, visibleTabsIn, barGroups, barTabs, isRunning, groupHasRunning, minimizedGroups,
  activateTab, addGroup, addTab, moveTab, selectGroup, restoreMinimized, updateSettings,
} from "./store.js";
import { nameLabel, startRename, isEditing } from "./rename.js";
import { tabMenu, groupMenu, minimizedGroupsMenu } from "./contextMenus.js";
import { tabBarButtons, groupBarButtons, expandTabButton } from "./controls.js";
import { renderRows, slideNextRender } from "./slide.js";

export function initTabbar() {
  $("newGroupTabBtn").onclick = () => addGroup();
  $("newTabBtn").onclick = () => addTab();
  $("allGroupsBtn").onclick = () => {
    slideNextRender();
    updateSettings({ showAllGroups: !state.settings.showAllGroups });
  };

  // the two rows scroll as one, so columns stay lined up
  const [groups, tabs] = [$("groupTabs"), $("tabs")];
  groups.addEventListener("scroll", () => { if (state.settings.showAllGroups) tabs.scrollLeft = groups.scrollLeft; });
  tabs.addEventListener("scroll", () => { if (state.settings.showAllGroups) groups.scrollLeft = tabs.scrollLeft; });
  window.addEventListener("resize", () => alignColumns());
}

export function renderTabbar() {
  const tray = minimizedGroups().length ? [minimizedTray()] : [];
  const showAll = state.settings.showAllGroups;
  const group = getGroup(state.ws.activeGroup);
  $("groupTabs").classList.toggle("showAll", showAll);
  $("tabs").classList.toggle("showAll", showAll);
  const scroll = $("groupTabs").scrollLeft; // read now: the new rows are narrower until they're aligned
  renderRows([
    { row: $("groupTabs"), nodes: [...barGroups().map(groupTab), ...tray] },
    { row: $("tabs"), nodes: tabRowNodes(group, showAll), enteringKey: newlyOpenedTab() },
  ], () => alignColumns(scroll));
  $("newTabBtn").hidden = !group || showAll; // in "show all" mode each group has its own

  const toggle = $("allGroupsBtn");
  toggle.setAttribute("aria-pressed", String(showAll));
  toggle.title = showAll ? "Show this group's tabs" : "Show all tabs";
}

let knownTabs = null;

/** The tab this render is the first to show, if just one is. The first render opens nothing. */
function newlyOpenedTab() {
  const ids = state.ws.tabs.map((tab) => tab.id);
  const fresh = knownTabs ? ids.filter((id) => !knownTabs.has(id)) : [];
  knownTabs = new Set(ids);
  return fresh.length === 1 ? fresh[0] : null;
}

function tabRowNodes(group, showAll) {
  if (!group) return minimizedGroups().length ? [el("span", "tabsEmpty", "All groups are minimized.")] : [];
  if (!showAll) return barTabs().map((tab) => tabNode(tab, group));
  return barGroups().map(groupSection);
}

/** "Show all" mode: a box around a group's tabs and its own new tab button. */
function groupSection(group) {
  const isActive = group.id === state.ws.activeGroup;
  const add = el("button", "tb-btn groupAdd", "＋");
  add.dataset.slideKey = `add-${group.id}`;
  add.title = `New tab in ${groupLabel(group)}`;
  add.onclick = () => addTab(group.id);

  const box = el("div", `tabGroupBox${isActive ? " active" : ""}`);
  if (group.color) box.style.setProperty("--group-color", colorVar(group.color));
  box.dataset.slideKey = `box-${group.id}`;
  box.append(...visibleTabsIn(group.id).map((tab) => tabNode(tab, group)), add);
  acceptTabDrops(box, group);
  return box;
}

/** "Show all" mode: each group's tab starts where its box does. Whichever is narrower leaves the room. */
function alignColumns(scroll = $("groupTabs").scrollLeft) {
  const [groups, tabs] = [$("groupTabs"), $("tabs")];
  tabs.style.marginLeft = tabs.style.maxWidth = "";
  tabs.querySelector(".trayRoom")?.remove();
  if (!state.settings.showAllGroups) return;

  const heads = [...groups.querySelectorAll(".groupTab:not(.groupTray)")];
  const boxes = [...tabs.querySelectorAll(".tabGroupBox")];
  if (!boxes.length) return;
  boxes.forEach((box, i) => {
    const head = heads[i];
    head.style.marginRight = box.style.marginRight = "";
    const [headWidth, boxWidth] = [head, box].map((node) => node.getBoundingClientRect().width);
    head.style.marginRight = `${Math.max(0, boxWidth - headWidth)}px`;
    box.style.marginRight = `${Math.max(0, headWidth - boxWidth)}px`;
  });

  const tray = groups.querySelector(".groupTray");
  if (tray) { // keeps both rows the same length to scroll
    const room = el("span", "trayRoom");
    room.style.width = `${tray.getBoundingClientRect().width}px`;
    tabs.append(room);
  }
  tabs.style.marginLeft = `${groups.getBoundingClientRect().left - tabs.getBoundingClientRect().left}px`;
  tabs.style.maxWidth = `${groups.clientWidth}px`;
  groups.scrollLeft = tabs.scrollLeft = scroll; // measuring above clamped both to the unaligned width
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
  const node = el("div", `groupTab${group.id === state.ws.activeGroup ? " active" : ""}${group.name ? "" : " unnamed"}`);
  node.dataset.slideKey = group.id;
  if (group.color) node.style.borderTopColor = colorVar(group.color);

  if (groupHasRunning(group.id)) node.append(spinner()); // hidden while selected, keeping its room
  node.append(nameLabel("group", group, "tabbar", "span", "chipName")); // unnamed: empty, and styled away
  if (group.name) node.append(el("span", "chipCount", String(tabs.length)));
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
