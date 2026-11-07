// Quick buttons shared by the tab bar and the sidebar.
//   tabs:   collapse (shrink to a small chip in place) + minimize (fold into the group label)
//           + close (moves to Past sessions)
//   groups: minimize (take the whole group out of the top bar, label included)

import { el } from "./util.js";
import { activateTab, closeTab, setTabCollapsed, setTabMinimized, setGroupMinimized } from "./store.js";

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
  close.title = "Close (moves to Sessions)";
  close.onclick = (e) => { e.stopPropagation(); closeTab(tab); };

  return [collapse, minimize, close];
}

export function groupMinimizeButton(group, className = "icon-btn") {
  const button = el("button", className, group.minimized ? "▢" : "–");
  button.title = group.minimized ? "Restore group to the top bar" : "Minimize group (removes it from the top bar)";
  button.onclick = (e) => { e.stopPropagation(); setGroupMinimized(group, !group.minimized); };
  return button;
}
