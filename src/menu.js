// Generic context menu.
// items: "-" (separator)
//      | { label, onSelect, danger? }
//      | { swatches: { label, colors, current, allowNone?, onPick(color|null) } }

import { el } from "./util.js";
import { colorVar } from "./constants.js";

let menuNode = null;

export function initMenu() {
  document.addEventListener("click", closeMenu);
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeMenu(); });
  window.addEventListener("blur", closeMenu);
}

export function closeMenu() {
  menuNode?.remove();
  menuNode = null;
}

export function openMenu(event, items) {
  event.preventDefault();
  event.stopPropagation();
  closeMenu();

  menuNode = el("div", "menu");
  menuNode.addEventListener("click", (e) => e.stopPropagation());
  for (const item of items) menuNode.append(renderItem(item));
  document.body.append(menuNode);

  // keep inside the window
  const { width, height } = menuNode.getBoundingClientRect();
  menuNode.style.left = `${Math.min(event.clientX, innerWidth - width - 8)}px`;
  menuNode.style.top = `${Math.min(event.clientY, innerHeight - height - 8)}px`;
}

function renderItem(item) {
  if (item === "-") return el("hr");
  if (item.swatches) return renderSwatches(item.swatches);
  const button = el("button", item.danger ? "danger" : null, item.label);
  button.onclick = () => { closeMenu(); item.onSelect(); };
  return button;
}

function renderSwatches({ label, colors, current, allowNone, onPick }) {
  const wrap = el("div");
  const row = el("div", "swatches");
  const pick = (color) => { closeMenu(); onPick(color); };

  if (allowNone) {
    const none = el("button", `sw none${current ? "" : " on"}`);
    none.title = "No color";
    none.onclick = () => pick(null);
    row.append(none);
  }
  for (const [index, color] of colors.entries()) {
    const swatch = el("button", `sw${color === current ? " on" : ""}`);
    swatch.title = `Color ${index + 1}`;
    swatch.style.background = colorVar(color);
    swatch.onclick = () => pick(color);
    row.append(swatch);
  }
  wrap.append(el("div", "lbl", label), row);
  return wrap;
}
