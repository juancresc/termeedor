// Left sidebar: groups with their tabs, past sessions,
// plus show/hide and drag-to-resize.

import { SIDEBAR } from "./constants.js";
import { $, el, colorDot, timeAgo } from "./util.js";
import {
  state, getTab, getGroup, tabsIn, isBusy, groupIsBusy,
  activateTab, moveTab, selectGroup, setGroupMinimized,
  reopenPast, deletePast, setSidebarOpen, setSidebarWidth,
} from "./store.js";
import { runAction } from "./core/actions.js";
import { keptNode, patchChildren } from "./patch.js";
import { renderTranscript } from "./core/transcript.js";
import { nameLabel, groupName, startRename, isEditing } from "./rename.js";
import { tabMenu, groupMenu, pastMenu, reopenLabel } from "./contextMenus.js";
import { tabRowButtons, groupRowButtons, groupCollapseButton } from "./controls.js";
import { createRunMarks } from "./runMarks.js";
import { acceptTabDrops, dragTab } from "./dropTarget.js";

const runMarks = createRunMarks();

let pastQuery = "";
let pastTimes = []; // { node, lines, closedAt } for each row on screen

export function initSidebar() {
  $("newGroupBtn").onclick = () => runAction("newGroup");
  $("hideSidebar").onclick = () => runAction("toggleSidebar");
  $("rail").onclick = () => runAction("toggleSidebar");
  $("pastSearch").oninput = (e) => { pastQuery = e.target.value; renderPast(); };
  $("clearPast").onclick = () => runAction("clearSessions");
  initResize();
  setInterval(refreshPastTimes, 1000); // so "5m ago" changes on time, and not when something else redraws the list
}

/** A command started or ended. */
export const refreshSidebarRuns = () => runMarks.refresh();

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
  runMarks.clear();
  patchChildren($("groups"), state.ws.groups.map(groupNode));
}

function groupNode(group) {
  const tabs = tabsIn(group.id);
  const box = el("div", `group${group.collapsed ? " collapsed" : ""}${group.minimized ? " minimized" : ""}`);
  box.dataset.slideKey = group.id;

  const head = el("div", `ghead${group.name ? "" : " unnamed"}`);
  head.append(
    groupCollapseButton(group),
    colorDot(group.color, "dot"),
    groupName(group, "sidebar", "gname"),
    // its tabs are hidden while collapsed, so show here that something is running
    runMarks.slot(() => group.collapsed && groupIsBusy(group.id)),
    groupRowButtons(group),
  );
  head.onclick = () => (group.minimized ? setGroupMinimized(group, false) : selectGroup(group));
  head.ondblclick = (e) => { e.stopPropagation(); startRename("group", group); };
  head.oncontextmenu = (e) => groupMenu(group, e);

  // drop a tab (from the sidebar or the tab bar) onto a group to move it
  acceptTabDrops(box, `group-${group.id}`, (id) => {
    const tab = getTab(id);
    if (tab) moveTab(tab, group.id);
  });

  const list = el("div", "glist");
  list.append(...tabs.map(tabRow));

  box.append(head, list);
  return box;
}

function tabRow(tab) {
  const row = el("div", `item${tab.id === state.ws.activeTab ? " active" : ""}${tab.minimized ? " minimized" : ""}`);
  row.dataset.slideKey = tab.id;
  row.title = tab.minimized ? "Minimized — click to restore" : "";

  row.append(
    runMarks.slot(() => isBusy(tab.id)),
    colorDot(tab.color),
    nameLabel("tab", tab, "sidebar", "span", "iname"),
    tabRowButtons(tab),
  );
  row.onclick = () => activateTab(tab.id);
  row.ondblclick = () => startRename("tab", tab, "sidebar");
  row.oncontextmenu = (e) => tabMenu(tab, e, "sidebar");
  row.draggable = !isEditing("tab", tab.id, "sidebar");
  dragTab(row, tab);
  return row;
}

// ---------- past sessions ----------
// A closed tab's text never changes and can be long, so nothing reads it twice.
const lineCounts = new WeakMap(); // entry.tab -> lines
let search = { key: null, matches: [] };

function lineCount(tab) {
  if (!lineCounts.has(tab)) lineCounts.set(tab, renderTranscript(tab).split("\n").length);
  return lineCounts.get(tab);
}

function pastMatches(all, query) {
  if (!query) return all;
  const key = JSON.stringify([query, all.map((p) => [p.id, p.name])]);
  if (key !== search.key) search = { key, matches: all.filter((p) => `${p.name} ${renderTranscript(p.tab)}`.toLowerCase().includes(query)) };
  return search.matches;
}

function renderPast() {
  pastTimes = [];
  const all = state.past;
  const matches = pastMatches(all, pastQuery.trim().toLowerCase());

  $("pastSearch").style.display = all.length > 5 ? "" : "none";
  $("clearPast").style.display = all.length ? "" : "none";
  const root = $("pastSessions");
  if (!all.length) return patchChildren(root, [el("div", "empty", "Closed tabs show up here.")]);
  if (!matches.length) return patchChildren(root, [el("div", "empty", "No matches.")]);
  patchChildren(root, matches.map(pastRow));
}

const pastDetail = (lines, closedAt) => `${lines} lines · ${timeAgo(closedAt)}`;

/** Only touches the text that changed, so it is cheap and can't disturb a rename or a hover. */
function refreshPastTimes() {
  for (const { node, lines, closedAt } of pastTimes) {
    const text = pastDetail(lines, closedAt);
    const shown = keptNode(node);
    if (shown.textContent !== text) shown.textContent = text;
  }
}

function pastRow(entry) {
  const row = el("div", "session");
  row.dataset.slideKey = entry.id;
  row.title = reopenLabel();

  const info = el("div", "sname");
  const lines = lineCount(entry.tab);
  const time = el("small", null, pastDetail(lines, entry.closedAt));
  pastTimes.push({ node: time, lines, closedAt: entry.closedAt });
  info.append(nameLabel("past", entry, "sidebar", "b"), time);

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
