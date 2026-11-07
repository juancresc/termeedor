// Quick buttons on tabs and groups. Both get the same four actions, in the same order, everywhere:
//   new tab, minimize, close, more actions
// The top bars put move left and move right before them.

import { el } from "./util.js";
import {
  activateTab, addTab, closeTab, moveTabBy, moveGroupBy, visibleTabsIn, barGroups,
  setTabCollapsed, setTabMinimized, setGroupMinimized,
} from "./store.js";
import { confirmRemoveGroup, tabMenu, groupMenu } from "./contextMenus.js";
import { slideNextRender } from "./slide.js";

function button(className, text, title, run) {
  const node = el("button", className, text);
  node.title = title;
  node.onclick = (e) => { e.stopPropagation(); run(e); };
  return node;
}

function actions(className, noun, { add, addTitle, minimized, toggleMinimized, close, closeTitle, more }) {
  return [
    button(className, "＋", addTitle, add),
    button(className, minimized ? "▢" : "–", `${minimized ? "Restore" : "Minimize"} ${noun}`, toggleMinimized),
    button(`${className} closeBtn`, "×", closeTitle, close),
    button(className, "⋯", "More actions", more),
  ];
}

const tabActions = (tab, className, where) => actions(className, "tab", {
  add: () => addTab(tab.groupId, tab),
  addTitle: "New tab next to this one",
  minimized: tab.minimized,
  toggleMinimized: () => (tab.minimized ? activateTab(tab.id) : setTabMinimized(tab, true)),
  close: () => closeTab(tab),
  closeTitle: "Close tab (moves to Sessions)",
  more: (e) => tabMenu(tab, e, where),
});

const groupActions = (group, className, where) => actions(className, "group", {
  add: () => addTab(group.id),
  addTitle: "New tab in group",
  minimized: group.minimized,
  toggleMinimized: () => setGroupMinimized(group, !group.minimized),
  close: () => confirmRemoveGroup(group),
  closeTitle: "Close group (its tabs move to Sessions)",
  more: (e) => groupMenu(group, e, where),
});

function buttonBox(...buttons) {
  const box = el("div", "itemBtns");
  box.append(...buttons);
  return box;
}

/** `bar` is the list the item sits in, which decides whether it can move left or right. */
function moveButtons(noun, item, bar, move) {
  const index = bar.indexOf(item);
  const moveBy = (delta) => { slideNextRender(); move(item, delta); };
  const left = button("x", "‹", `Move ${noun} left`, () => moveBy(-1));
  const right = button("x", "›", `Move ${noun} right`, () => moveBy(1));
  left.disabled = index === 0;
  right.disabled = index === bar.length - 1;
  return [left, right];
}

export const tabBarButtons = (tab) => buttonBox(
  ...moveButtons("tab", tab, visibleTabsIn(tab.groupId), moveTabBy),
  ...tabActions(tab, "x", "tabbar"),
);

export const groupBarButtons = (group) => buttonBox(
  ...moveButtons("group", group, barGroups(), moveGroupBy),
  ...groupActions(group, "x", "tabbar"),
);

export const tabRowButtons = (tab) => buttonBox(...tabActions(tab, "icon-btn", "sidebar"));
export const groupRowButtons = (group) => buttonBox(...groupActions(group, "icon-btn", "sidebar"));

/** On a tab collapsed to a small chip (see the tab's right-click menu). */
export const expandTabButton = (tab) => button("x", "›", "Expand tab", () => setTabCollapsed(tab, false));
