// Left sidebar: groups with their tabs, past sessions,
// plus show/hide and drag-to-resize.

import { SIDEBAR } from "./constants.js";
import { $, el, colorDot, spinner, timeAgo } from "./util.js";
import {
  state, getTab, getGroup, tabsIn, isRunning, groupHasRunning,
  activateTab, addGroup, moveTab, selectGroup, setGroupMinimized,
  reopenPast, deletePast, setSidebarOpen, setSidebarWidth,
} from "./store.js";
import { renderTranscript } from "./terminal/transcript.js";
import { nameLabel, startRename, isEditing, isRenaming } from "./rename.js";
import { tabMenu, groupMenu, pastMenu, reopenLabel } from "./contextMenus.js";
import { tabRowButtons, groupRowButtons, groupCollapseButton } from "./controls.js";

let pastQuery = "";

export function initSidebar() {
  $("newGroupBtn").onclick = () => startRename("group", addGroup());
  $("hideSidebar").onclick = () => setSidebarOpen(false);
  $("rail").onclick = () => setSidebarOpen(true);
  $("pastSearch").oninput = (e) => { pastQuery = e.target.value; renderPast(); };
  initResize();
  setInterval(() => { if (!isRenaming()) renderPast(); }, 60_000); // keeps "5m ago" fresh
}

export function renderSidebar() {
  renderLayout();
  renderGroups();
  renderPast();
}

function renderLayout() {
  const open = state.ws.sidebarOpen;
  const app = $("app");
  app.classList.toggle("nosidebar", !open);
  app.style.setProperty("--sbw", `${state.ws.sidebarWidth}px`);
}

// ---------- groups ----------
function renderGroups() {
  $("groups").replaceChildren(...state.ws.groups.map(groupNode));
}

function groupNode(group) {
  const tabs = tabsIn(group.id);
  const box = el("div", `group${group.collapsed ? " collapsed" : ""}${group.minimized ? " minimized" : ""}`);

  const head = el("div", "ghead");
  head.append(
    groupCollapseButton(group),
    colorDot(group.color, "dot"),
    nameLabel("group", group, "sidebar", "span", "gname"),
    // its tabs are hidden while collapsed, so show here that something is running
    ...(group.collapsed && groupHasRunning(group.id) ? [spinner()] : []),
    groupRowButtons(group),
  );
  head.onclick = () => (group.minimized ? setGroupMinimized(group, false) : selectGroup(group));
  head.ondblclick = (e) => { e.stopPropagation(); startRename("group", group); };
  head.oncontextmenu = (e) => groupMenu(group, e);

  // drop a tab (from the sidebar or the tab bar) onto a group to move it
  box.ondragover = (e) => { e.preventDefault(); box.classList.add("dragover"); };
  box.ondragleave = () => box.classList.remove("dragover");
  box.ondrop = (e) => {
    e.preventDefault();
    const tab = getTab(e.dataTransfer.getData("text/tab"));
    if (tab) moveTab(tab, group.id);
  };

  const list = el("div", "glist");
  list.append(...tabs.map(tabRow));

  box.append(head, list);
  return box;
}

function tabRow(tab) {
  const row = el("div", `item${tab.id === state.ws.activeTab ? " active" : ""}${tab.minimized ? " minimized" : ""}`);
  row.title = tab.minimized ? "Minimized — click to restore" : "";

  row.append(
    isRunning(tab.id) ? spinner() : colorDot(tab.color),
    nameLabel("tab", tab, "sidebar", "span", "iname"),
    tabRowButtons(tab),
  );
  row.onclick = () => activateTab(tab.id);
  row.ondblclick = () => startRename("tab", tab, "sidebar");
  row.oncontextmenu = (e) => tabMenu(tab, e, "sidebar");
  row.draggable = !isEditing("tab", tab.id, "sidebar");
  row.ondragstart = (e) => e.dataTransfer.setData("text/tab", tab.id);
  return row;
}

// ---------- past sessions ----------
function renderPast() {
  const all = state.past;
  const query = pastQuery.trim().toLowerCase();
  const matches = query
    ? all.filter((p) => `${p.name} ${renderTranscript(p.tab)}`.toLowerCase().includes(query))
    : all;

  $("pastSearch").style.display = all.length > 5 ? "" : "none";
  const root = $("pastSessions");
  if (!all.length) return root.replaceChildren(el("div", "empty", "Closed tabs show up here."));
  if (!matches.length) return root.replaceChildren(el("div", "empty", "No matches."));
  root.replaceChildren(...matches.map(pastRow));
}

function pastRow(entry) {
  const row = el("div", "session");
  row.title = reopenLabel();

  const info = el("div", "sname");
  const lines = renderTranscript(entry.tab).split("\n").length;
  info.append(
    nameLabel("past", entry, "sidebar", "b"),
    el("small", null, `${lines} lines · ${timeAgo(entry.closedAt)}`),
  );

  const reopen = el("button", "icon-btn", "↺");
  reopen.title = reopenLabel();
  reopen.onclick = (e) => { e.stopPropagation(); reopenPast(entry); };
  const close = el("button", "icon-btn", "×");
  close.title = "Delete forever";
  close.onclick = (e) => { e.stopPropagation(); deletePast(entry); };

  row.append(colorDot(entry.tab.color), info, reopen, close);
  row.onclick = () => reopenPast(entry);
  row.ondblclick = (e) => { e.stopPropagation(); startRename("past", entry); };
  row.oncontextmenu = (e) => pastMenu(entry, e);
  return row;
}

// ---------- resize: drag the edge; drag far left to hide; double-click to reset ----------
function initResize() {
  const handle = $("resizer");
  const app = $("app");

  handle.addEventListener("pointerdown", (down) => {
    down.preventDefault();
    handle.setPointerCapture(down.pointerId);
    app.classList.add("resizing");
    let width = state.ws.sidebarWidth;

    const onMove = (e) => {
      const collapse = e.clientX < SIDEBAR.collapseBelow;
      app.classList.toggle("nosidebar", collapse);
      if (collapse) return;
      width = Math.min(SIDEBAR.max, Math.max(SIDEBAR.min, e.clientX));
      app.style.setProperty("--sbw", `${width}px`);
    };
    const onUp = (e) => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      app.classList.remove("resizing");
      if (e.clientX < SIDEBAR.collapseBelow) setSidebarOpen(false);
      else setSidebarWidth(width);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
  });

  handle.addEventListener("dblclick", () => setSidebarWidth(SIDEBAR.default));
}
