// Slides items to their new places when a row of tabs is reordered, and brings a new tab in.
// A group's box moves as one: what is inside it measures from the box (position: relative).
// Rows are rebuilt on every render, so nodes are matched by data-slide-key.

const DURATION_MS = 180;
let slideNext = false;

/** Call right before changing the order: the render that follows animates. */
export function slideNextRender() {
  slideNext = true;
  queueMicrotask(() => { slideNext = false; }); // renders run synchronously inside commit()
}

const items = (row) => [...row.querySelectorAll("[data-slide-key]")]; // may sit inside a group's box

/** offsetLeft ignores a slide still running, so it says whether a node really moved. */
const positions = (row) => new Map(items(row).map((node) => [
  node.dataset.slideKey,
  { place: node.offsetLeft, seen: node.getBoundingClientRect().left },
]));

const motion = { duration: DURATION_MS, easing: "ease-out" };
const fadeIn = [{ opacity: 0 }, { opacity: 1 }];

/**
 * Rebuilds rows that are laid out together: { row, nodes, enteringKey? }, where enteringKey is the
 * item that just opened. It comes in, and the items it pushes aside slide. `arrange` runs once the
 * nodes are in, before their new places are read.
 */
export function renderRows(rows, arrange = () => {}) {
  const animates = slideNext || rows.some((r) => r.enteringKey);
  const before = rows.map(({ row }) => (animates ? positions(row) : null));
  rows.forEach(({ row, nodes }) => row.replaceChildren(...nodes));
  arrange();
  if (!animates || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  rows.forEach(({ row, enteringKey = null }, i) => animateRow(row, before[i], enteringKey));
}

function animateRow(row, before, enteringKey) {
  for (const node of items(row)) {
    const key = node.dataset.slideKey;
    const was = before.get(key);
    if (key === enteringKey) {
      node.animate([{ opacity: 0, transform: "translateY(8px)" }, { opacity: 1, transform: "none" }], motion);
    } else if (!was) {
      if (slideNext) node.animate(fadeIn, motion); // shown by the change that slides the rest
    } else if (was.place !== node.offsetLeft) {
      node.animate([{ transform: `translateX(${was.seen - node.getBoundingClientRect().left}px)` }, { transform: "none" }], motion);
    }
  }
}
