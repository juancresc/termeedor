// Styled tooltips. Set `title` on any element as usual: it is swapped for `data-tip`
// before the browser can show its native tooltip, then shown here after a hover delay.
// The UI re-renders constantly (often replacing the hovered node), so the tooltip
// follows whatever now sits under the pointer instead of resetting.

import { el } from "./util.js";

const DELAY_MS = 500;
const GAP = 6;  // between tooltip and element
const EDGE = 6; // between tooltip and window edge
const TALL = 60; // elements taller than this (rail, resizer) get the tooltip at their side
const SHORTCUT = /^(.*) \(((?:Alt|Ctrl)\+\S+|⇧?⌘\S+|Esc)\)$/; // "New tab (⌘T)" → label + key

let tooltip = null;
let anchor = null; // element under the pointer that has a tooltip
let timer = null;
const pointer = { x: 0, y: 0 };

export function initTooltips() {
  tooltip = el("div", "tooltip");
  tooltip.popover = "manual"; // top layer, so it also shows above the settings dialog
  tooltip.setAttribute("role", "tooltip");
  document.body.append(tooltip);

  adoptAll(document.body);
  new MutationObserver(onMutations).observe(document.body, {
    subtree: true, childList: true, attributes: true, attributeFilter: ["title"],
  });

  document.addEventListener("pointerover", onPointerOver);
  document.addEventListener("pointerout", (e) => { if (!e.relatedTarget) setAnchor(null); }); // left the window
  // stays dismissed until the pointer moves to another element
  for (const type of ["pointerdown", "keydown", "dragstart"]) document.addEventListener(type, dismiss, true);
  window.addEventListener("blur", dismiss);
  // only if the element itself moved: terminal output scrolling elsewhere must not close it
  document.addEventListener("scroll", (e) => { if (e.target.contains(anchor)) dismiss(); }, true);
}

function onPointerOver(event) {
  if (event.pointerType === "touch") return;
  pointer.x = event.clientX;
  pointer.y = event.clientY;
  const next = anchorFor(event.target);
  if (next !== anchor) setAnchor(next);
}

function anchorFor(target) {
  syncTruncationTip(target);
  return target.closest("[data-tip]");
}

/** Text cut off with an ellipsis gets its full text as a tooltip, ahead of its parent's. */
function syncTruncationTip(node) {
  if (getComputedStyle(node).textOverflow !== "ellipsis") return;
  const text = node.textContent;
  if (node.dataset.tip && node.dataset.tip !== text) return; // has its own tooltip
  if (text && node.scrollWidth > node.clientWidth) node.dataset.tip = text;
  else delete node.dataset.tip;
}

function setAnchor(next) {
  dismiss();
  anchor = next;
  if (anchor) timer = setTimeout(show, DELAY_MS);
}

function dismiss() {
  clearTimeout(timer);
  if (isOpen()) tooltip.hidePopover();
}

const isOpen = () => tooltip.matches(":popover-open");

function show() {
  if (!anchor?.isConnected || !anchor.dataset.tip) return;
  fill(anchor.dataset.tip);
  tooltip.showPopover();
  place();
}

function fill(text) {
  tooltip.dataset.text = text;
  const [, label, key] = text.match(SHORTCUT) ?? [];
  if (key) tooltip.replaceChildren(el("span", null, label), el("kbd", null, key));
  else tooltip.replaceChildren(el("span", null, text));
}

function place() {
  const box = anchor.getBoundingClientRect();
  const { width, height } = tooltip.getBoundingClientRect();
  let left, top;
  if (box.height > TALL) {
    left = box.right + GAP;
    top = pointer.y - height / 2;
  } else {
    left = box.left + box.width / 2 - width / 2;
    top = box.bottom + GAP;
    if (top + height > innerHeight - EDGE) top = box.top - height - GAP;
  }
  tooltip.style.left = `${Math.max(EDGE, Math.min(left, innerWidth - width - EDGE))}px`;
  tooltip.style.top = `${Math.max(EDGE, Math.min(top, innerHeight - height - EDGE))}px`;
}

// ---------- keeping up with the DOM ----------
function onMutations(records) {
  for (const { type, target, addedNodes } of records) {
    if (type === "attributes") adopt(target);
    else for (const node of addedNodes) if (node.nodeType === Node.ELEMENT_NODE) adoptAll(node);
  }
  if (anchor && !anchor.isConnected) followRerender();
  if (anchor && isOpen()) syncOpenTooltip();
}

function adoptAll(root) {
  if (root.hasAttribute("title")) adopt(root);
  for (const node of root.querySelectorAll("[title]")) adopt(node);
}

/** Moves `title` to `data-tip`, keeping the text available to screen readers. */
function adopt(node) {
  if (!node.hasAttribute("title")) return; // our own removal also lands here
  const text = node.getAttribute("title");
  node.removeAttribute("title");
  const attribute = node.matches("button, a") ? "aria-label" : "aria-description";
  if (text) {
    node.dataset.tip = text;
    node.setAttribute(attribute, text);
  } else {
    delete node.dataset.tip;
    node.removeAttribute(attribute);
  }
}

/** The hovered node was replaced by a re-render: same tooltip under the pointer → carry on. */
function followRerender() {
  const tip = anchor.dataset.tip;
  const under = document.elementFromPoint(pointer.x, pointer.y);
  const next = under ? anchorFor(under) : null;
  if (next?.dataset.tip === tip) anchor = next;
  else setAnchor(next);
}

function syncOpenTooltip() {
  const text = anchor.dataset.tip;
  if (!text) return dismiss();
  if (text !== tooltip.dataset.text) fill(text);
  place();
}
