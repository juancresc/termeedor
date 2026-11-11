// Dragging tabs onto groups. The group under the pointer is highlighted (.dragover) until the drag
// leaves it, drops or ends. The highlight is remembered by key, so a render during the drag (a
// spinner, output arriving) builds it back in instead of wiping it, and moving over a group's own
// children doesn't make it flicker.

import { keptNode } from "./patch.js";

let hovered = null; // key of the highlighted drop target
let hoveredNode = null;

function setHovered(key, node) {
  const shown = hoveredNode && keptNode(hoveredNode); // a render may have kept the older node instead
  if (shown && shown !== node) shown.classList.remove("dragover");
  hovered = key;
  hoveredNode = node;
  node?.classList.add("dragover");
}

/** For a draggable tab node. */
export function dragTab(node, tab) {
  node.ondragstart = (e) => {
    e.dataTransfer.setData("text/tab", tab.id);
    e.dataTransfer.effectAllowed = "move";
  };
}

/** Makes `node` take dropped tabs; `key` names it across renders. Call after setting its className. */
export function acceptTabDrops(node, key, onDropTab) {
  if (hovered === key) {
    node.classList.add("dragover");
    hoveredNode = node; // or the node on the page it is patched into: see setHovered
  }
  node.ondragover = (e) => {
    if (!e.dataTransfer.types.includes("text/tab")) return;
    e.preventDefault();
    e.stopPropagation(); // the innermost target wins
    e.dataTransfer.dropEffect = "move";
    if (hovered !== key || keptNode(hoveredNode) !== e.currentTarget) setHovered(key, e.currentTarget);
  };
  node.ondragleave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget) && hovered === key) setHovered(null, null);
  };
  node.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setHovered(null, null);
    const id = e.dataTransfer.getData("text/tab");
    if (id) onDropTab(id);
  };
}

/** Clears the highlight however a drag ends (Esc, dropped outside). Called once at startup. */
export function initDropTargets() {
  document.addEventListener("dragend", () => setHovered(null, null));
  document.addEventListener("drop", () => setHovered(null, null));
}
