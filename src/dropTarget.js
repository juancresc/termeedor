// Dragging tabs and groups. A tab dropped on a group goes to it; dropped on another tab, or a group
// on another group, it takes the place before or after it, whichever half the pointer is over.
// What a drop would do is marked on the target (.dragover, or .dropBefore / .dropAfter for a place)
// until the drag leaves it, drops or ends. The mark is remembered by key, so a render during the
// drag (a spinner, output arriving) builds it back in instead of wiping it, and moving over a
// target's own children doesn't make it flicker.

import { keptNode } from "./patch.js";

const MARKS = { before: "dropBefore", after: "dropAfter", null: "dragover" };
const KINDS = ["tab", "group"];

let dragging = null; // id of what is being dragged: a drag's data can't be read until it drops
let hovered = null; // key of the marked drop target
let hoveredSide = null; // "before" | "after", or null when the drop goes into the target
let hoveredNode = null;

function setHovered(key, node, side = null) {
  const shown = hoveredNode && keptNode(hoveredNode); // a render may have kept the older node instead
  if (shown) for (const mark of Object.values(MARKS)) shown.classList.remove(mark);
  hovered = key;
  hoveredSide = side;
  hoveredNode = node;
  node?.classList.add(MARKS[side]);
}

/** Makes `node` draggable as this tab or group. kind: "tab" | "group" */
export function dragItem(node, kind, item) {
  node.ondragstart = (e) => {
    e.stopPropagation();
    dragging = item.id;
    e.dataTransfer.setData(`text/${kind}`, item.id);
    e.dataTransfer.effectAllowed = "move";
  };
}

const kindOf = (e) => KINDS.find((kind) => e.dataTransfer.types.includes(`text/${kind}`));

/** Which half of the target the pointer is over, along the way its row runs. */
function sideOf(e, axis) {
  if (!axis) return null;
  const box = e.currentTarget.getBoundingClientRect();
  const past = axis === "x" ? e.clientX - box.left > box.width / 2 : e.clientY - box.top > box.height / 2;
  return past ? "after" : "before";
}

/**
 * Makes `node` take drops; `key` names it across renders. Call after setting its className.
 * `accepts` says what to do by kind of item dragged: { tab: { drop(id, after), axis, self }, group: … }.
 * With an `axis` ("x" | "y") the drop is a place before or after the node, and `after` says which.
 * `self` is the id of the item the node shows, which can't be dropped on itself.
 */
export function acceptDrops(node, key, accepts) {
  if (hovered === key) {
    node.classList.add(MARKS[hoveredSide]);
    hoveredNode = node; // or the node on the page it is patched into: see setHovered
  }
  node.ondragover = (e) => {
    const accept = accepts[kindOf(e)];
    if (!accept) return; // a target around this one may take it
    e.stopPropagation(); // the innermost target wins
    if (accept.self && accept.self === dragging) return setHovered(null, null);
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const side = sideOf(e, accept.axis);
    if (hovered !== key || hoveredSide !== side || keptNode(hoveredNode) !== e.currentTarget) setHovered(key, e.currentTarget, side);
  };
  node.ondragleave = (e) => {
    if (!e.currentTarget.contains(e.relatedTarget) && hovered === key) setHovered(null, null);
  };
  node.ondrop = (e) => {
    const kind = kindOf(e);
    const accept = accepts[kind];
    if (!accept) return;
    e.preventDefault();
    e.stopPropagation();
    setHovered(null, null);
    const id = e.dataTransfer.getData(`text/${kind}`);
    if (id && id !== accept.self) accept.drop(id, sideOf(e, accept.axis) === "after");
  };
}

/** Clears the mark however a drag ends (Esc, dropped outside). Called once at startup. */
export function initDropTargets() {
  const end = () => { dragging = null; setHovered(null, null); };
  document.addEventListener("dragend", end);
  document.addEventListener("drop", end);
}
