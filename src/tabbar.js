// Top bar: every group at once, each as a colored label followed by its tabs.
// Clicking a label folds the group's tabs into it (and back). One button folds/unfolds all.
// A label's minimize button takes the whole group off the bar; a tray at the end restores it.
// Drag a tab onto a label to send it to that group.

import { $, el, spinner } from "./util.js";
import { colorVar } from "./constants.js";
import {
  state, getTab, tabsIn, isRunning, groupHasRunning, minimizedGroups, allGroupsCollapsed,
  activateTab, addTab, moveTab, toggleGroupCollapsed, restoreMinimized, setAllGroupsCollapsed, setSidebarOpen,
} from "./store.js";
import { nameLabel, startRename, isEditing } from "./rename.js";
import { tabMenu, groupMenu, minimizedGroupsMenu } from "./contextMenus.js";
import { tabButtons, groupMinimizeButton } from "./controls.js";
import { withShortcut } from "./keymap.js";

export function initTabbar() {
  $("newTabBtn").onclick = () => addTab();
  $("toggleSidebar").onclick = () => setSidebarOpen(!state.ws.sidebarOpen);
  $("toggleAllGroups").onclick = () => setAllGroupsCollapsed(!allGroupsCollapsed());
}

export function renderTabbar() {
  const folded = allGroupsCollapsed();
  const toggleAll = $("toggleAllGroups");
  toggleAll.textContent = folded ? "⊞" : "⊟";
  toggleAll.title = withShortcut(folded ? "Unfold all groups" : "Fold all groups into their labels", "toggleAllGroups");

  const nodes = [];
  for (const group of state.ws.groups) {
    if (group.minimized) continue;
    nodes.push(groupLabel(group));
    if (!group.collapsed) nodes.push(...tabsIn(group.id).filter((t) => !t.minimized).map((tab) => tabNode(tab, group)));
  }
  if (minimizedGroups().length) nodes.push(minimizedTray());
  $("tabs").replaceChildren(...nodes);
}

function minimizedTray() {
  const hidden = minimizedGroups();
  const tray = el("div", "groupChip groupTray");
  tray.title = `${hidden.length} minimized group${hidden.length === 1 ? "" : "s"} — click to restore`;
  if (hidden.some((g) => groupHasRunning(g.id))) tray.append(spinner());
  tray.append(el("span", "chipName", "▢"), el("span", "chipCount", String(hidden.length)));
  tray.onclick = minimizedGroupsMenu;
  return tray;
}

function groupLabel(group) {
  const tabs = tabsIn(group.id);
  const minimizedCount = tabs.filter((t) => t.minimized).length;
  const label = el("div", `groupChip${group.collapsed ? " folded" : ""}${group.color ? " colored" : ""}`);
  if (group.color) label.style.background = colorVar(group.color);
  label.title = group.collapsed ? "Click to expand" : "Click to collapse the group into its label";

  label.append(nameLabel("group", group, "tabbar", "span", "chipName"));
  if (group.collapsed) {
    if (groupHasRunning(group.id)) label.append(spinner());
    label.append(el("span", "chipCount", String(tabs.length)));
  } else {
    if (minimizedCount) {
      // tabs minimized individually are folded into the label; click the badge to bring them back
      const badge = el("button", "chipCount", `+${minimizedCount}`);
      badge.title = "Restore minimized tabs";
      badge.onclick = (e) => { e.stopPropagation(); restoreMinimized(group); };
      label.append(badge);
    }
  }
  label.append(groupMinimizeButton(group, "chipBtn"));

  label.onclick = () => toggleGroupCollapsed(group);
  label.ondblclick = (e) => { e.stopPropagation(); startRename("group", group, "tabbar"); };
  label.oncontextmenu = (e) => groupMenu(group, e, "tabbar");
  acceptTabDrops(label, group);
  return label;
}

function tabNode(tab, group) {
  const isActive = tab.id === state.ws.activeTab;
  const node = el("div", `tab${isActive ? " active" : ""}${tab.collapsed ? " collapsed" : ""}`);
  if (group.color) node.style.setProperty("--group-color", colorVar(group.color));
  if (tab.color) node.style.borderTopColor = colorVar(tab.color);

  if (tab.collapsed) {
    // small chip: first letter (or spinner) + expand button on hover
    node.title = tab.name;
    const [expand] = tabButtons(tab, "x");
    node.append(isRunning(tab.id) ? spinner() : el("span", "initial", tab.name.slice(0, 1).toUpperCase()), expand);
  } else {
    if (isRunning(tab.id)) node.append(spinner());
    node.append(nameLabel("tab", tab, "tabbar", "span", "name"), ...tabButtons(tab, "x"));
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
