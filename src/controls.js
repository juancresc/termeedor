// Quick buttons on tabs and groups.
//   top bars: move left, minimize, move right, a gap, close (same for tabs and groups)
//   sidebar:  minimize and close on tab rows, minimize on group headers

import { el } from "./util.js";
import {
  activateTab, closeTab, moveTabBy, moveGroupBy, barTabs, barGroups,
  setTabCollapsed, setTabMinimized, setGroupMinimized,
} from "./store.js";
import { confirmRemoveGroup } from "./contextMenus.js";
import { slideNextRender } from "./slide.js";

function button(className, text, title, run) {
  const node = el("button", className, text);
  node.title = title;
  node.onclick = (e) => { e.stopPropagation(); run(); };
  return node;
}

/** `bar` is the list the item sits in, which decides whether it can move left or right. */
function barButtons(noun, item, bar, { move, minimize, close, closeTitle }) {
  const index = bar.indexOf(item);
  const moveBy = (delta) => { slideNextRender(); move(item, delta); };
  const left = button("x", "‹", `Move ${noun} left`, () => moveBy(-1));
  const right = button("x", "›", `Move ${noun} right`, () => moveBy(1));
  left.disabled = index === 0;
  right.disabled = index === bar.length - 1;

  const box = el("div", "itemBtns");
  box.append(
    left,
    button("x", "–", `Minimize ${noun}`, () => minimize(item)),
    right,
    button("x closeBtn", "×", closeTitle, () => close(item)),
  );
  return box;
}

export const tabBarButtons = (tab) => barButtons("tab", tab, barTabs(), {
  move: moveTabBy,
  minimize: (t) => setTabMinimized(t, true),
  close: closeTab,
  closeTitle: "Close tab (moves to Sessions)",
});

export const groupBarButtons = (group) => barButtons("group", group, barGroups(), {
  move: moveGroupBy,
  minimize: (g) => setGroupMinimized(g, true),
  close: confirmRemoveGroup,
  closeTitle: "Close group (its tabs move to Sessions)",
});

/** On a tab collapsed to a small chip (see the tab's right-click menu). */
export const expandTabButton = (tab) => button("x", "›", "Expand tab", () => setTabCollapsed(tab, false));

/** A sidebar row: [minimize or restore, close]. */
export function tabButtons(tab) {
  return [
    button("icon-btn", tab.minimized ? "▢" : "–", tab.minimized ? "Restore" : "Minimize tab", () => {
      if (tab.minimized) activateTab(tab.id);
      else setTabMinimized(tab, true);
    }),
    button("icon-btn", "×", "Close tab (moves to Sessions)", () => closeTab(tab)),
  ];
}

export function groupMinimizeButton(group) {
  const { minimized } = group;
  return button("icon-btn", minimized ? "▢" : "–", minimized ? "Restore group" : "Minimize group", () => setGroupMinimized(group, !minimized));
}
