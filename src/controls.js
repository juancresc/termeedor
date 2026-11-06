// Quick buttons shared by the tab bar and the sidebar.
//   tabs:   collapse (shrink to a small chip in place) + minimize (fold into the group label)
//           + close (moves to Past sessions)
//   groups: minimize only (fold all its tabs into the label)

import { el } from "./util.js";
import { activateTab, closeTab, setTabCollapsed, setTabMinimized, setGroupCollapsed } from "./store.js";

export function tabButtons(tab, className = "icon-btn") {
  const collapse = el("button", className, tab.collapsed ? "›" : "‹");
  collapse.title = tab.collapsed ? "Expand tab" : "Collapse tab to a small chip";
  collapse.onclick = (e) => { e.stopPropagation(); setTabCollapsed(tab, !tab.collapsed); };

  const minimize = el("button", className, tab.minimized ? "▢" : "–");
  minimize.title = tab.minimized ? "Restore" : "Minimize into group label";
  minimize.onclick = (e) => {
    e.stopPropagation();
    if (tab.minimized) activateTab(tab.id);
    else setTabMinimized(tab, true);
  };

  const close = el("button", className, "×");
  close.title = "Close (moves to Past sessions)";
  close.onclick = (e) => { e.stopPropagation(); closeTab(tab); };

  return [collapse, minimize, close];
}

export function groupMinimizeButton(group, className = "icon-btn") {
  const button = el("button", className, group.collapsed ? "▢" : "–");
  button.title = group.collapsed ? "Restore group" : "Minimize group into its label";
  button.onclick = (e) => { e.stopPropagation(); setGroupCollapsed(group, !group.collapsed); };
  return button;
}
