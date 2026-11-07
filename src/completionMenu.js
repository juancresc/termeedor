// The dropdown shown by Tab completion. It only displays the list and tracks the
// selected row: focus stays in the editor, which forwards the keys (see editor.js).

import { el } from "./util.js";

let node = null;
let items = [];
let selected = 0;

export const isMenuOpen = () => node !== null;
export const selectedItem = () => items[selected];

export function closeMenu() {
  node?.remove();
  node = null;
  items = [];
}

/** Opens the menu, or updates it. The selected row stays selected if it is still listed. */
export function showMenu(nextItems, onPick) {
  const previous = selectedItem()?.value;
  items = nextItems;
  selected = Math.max(0, items.findIndex((item) => item.value === previous));

  if (!node) {
    node = el("div", "completions");
    node.setAttribute("role", "listbox");
    node.addEventListener("mousedown", (e) => e.preventDefault()); // keep focus in the editor
    document.body.append(node);
  }
  node.replaceChildren(...items.map((item) => {
    const row = el("div");
    row.setAttribute("role", "option");
    row.append(el("span", null, item.label), el("span", null, item.kind));
    row.addEventListener("click", () => onPick(item));
    return row;
  }));
  renderSelection();
}

export function moveSelection(delta) {
  selected = (selected + delta + items.length) % items.length;
  renderSelection();
}

function renderSelection() {
  for (const [index, row] of [...node.children].entries()) {
    row.classList.toggle("on", index === selected);
    row.setAttribute("aria-selected", index === selected);
  }
  node.children[selected].scrollIntoView({ block: "nearest" });
}

/** Places the menu below the caret, or above it when there is no room below. */
export function placeMenu({ left, top, bottom }) {
  const { width, height } = node.getBoundingClientRect();
  node.style.left = `${Math.max(8, Math.min(left, innerWidth - width - 8))}px`;
  node.style.top = `${bottom + height + 8 > innerHeight ? Math.max(8, top - height) : bottom}px`;
}
