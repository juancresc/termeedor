// Slides items to their new places when a row of tabs is reordered.
// Rows are rebuilt on every render, so nodes are matched by data-slide-key.

const DURATION_MS = 180;
let slideNext = false;

/** Call right before changing the order: the render that follows animates. */
export function slideNextRender() {
  slideNext = true;
  queueMicrotask(() => { slideNext = false; }); // renders run synchronously inside commit()
}

const items = (row) => [...row.querySelectorAll("[data-slide-key]")]; // may sit inside a group's box
const positions = (row) => new Map(items(row).map((node) => [node.dataset.slideKey, node.getBoundingClientRect().left]));

export function renderRow(row, nodes) {
  const before = slideNext ? positions(row) : null;
  row.replaceChildren(...nodes);
  if (!before || matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  for (const node of items(row)) {
    const offset = before.get(node.dataset.slideKey) - node.getBoundingClientRect().left;
    if (offset) node.animate([{ transform: `translateX(${offset}px)` }, { transform: "none" }], { duration: DURATION_MS, easing: "ease-out" });
  }
}
