// Makes what is on the page match freshly built nodes, changing only what differs. Views keep
// building their whole list, simply, and what didn't change stays the same node: it keeps its
// hover, its focus, a click in progress, a drag and a running animation.
//
// Children count as the same if they have the same data-slide-key, or else the same tag and class.
// Handlers move over, since the new ones are the current ones. Listeners from addEventListener don't.

const HANDLERS = ["onclick", "ondblclick", "oncontextmenu", "ondragstart", "ondragover", "ondragleave", "ondrop", "onchange"];
const PROPS = ["className", "draggable", "disabled", "checked"];

const identity = (node) => (node.nodeType === 1 ? node.dataset.slideKey ?? `${node.tagName}.${node.className}` : "#text");

const kept = new WeakMap(); // a freshly built node -> the one on the page it was matched with

/** For a view that keeps a node it built, to change later: the node that is really on the page. */
export const keptNode = (node) => kept.get(node) ?? node;

export function patchChildren(parent, nodes) {
  dropMouseFocus(parent);
  sync(parent, nodes);
}

/** A clicked button lets go of focus on the next change, so keys go back to the terminal. Tabbing to one isn't affected. */
function dropMouseFocus(parent) {
  const active = document.activeElement;
  if (active?.tagName === "BUTTON" && parent.contains(active) && !active.matches(":focus-visible")) active.blur();
}

function sync(parent, nodes) {
  const unused = new Map();
  for (const node of parent.childNodes) {
    const key = identity(node);
    if (unused.has(key)) unused.get(key).push(node);
    else unused.set(key, [node]);
  }
  const pairs = nodes.map((next) => [next, unused.get(identity(next))?.shift()]);
  // Removed first, so that what stays never has to move just because something above it went.
  for (const list of unused.values()) for (const node of list) node.remove();

  let cursor = parent.firstChild;
  for (const [next, old] of pairs) {
    if (!old) {
      parent.insertBefore(next, cursor);
      continue;
    }
    if (old === cursor) cursor = cursor.nextSibling;
    else parent.insertBefore(old, cursor);
    kept.set(next, old);
    update(old, next);
  }
}

function update(old, next) {
  if (old.nodeType !== 1) {
    if (old.data !== next.data) old.data = next.data;
    return;
  }
  if (old.classList.contains("inlineInput")) return; // the person is typing in it
  for (const prop of PROPS) if (old[prop] !== next[prop]) old[prop] = next[prop];
  if (old.style.cssText !== next.style.cssText) old.style.cssText = next.style.cssText;
  for (const handler of HANDLERS) old[handler] = next[handler];
  sync(old, [...next.childNodes]);
  updateTitle(old, next);
}

/**
 * tooltip.js moves `title` to data-tip, and gives text cut off with an ellipsis a data-tip equal to
 * that text. So this runs after the text is updated. An empty title clears a tip, through tooltip.js.
 */
function updateTitle(old, next) {
  const tip = old.dataset.tip;
  if (next.title) {
    if (next.title !== (old.title || tip)) old.title = next.title;
  } else if (old.title || (tip !== undefined && tip !== old.textContent)) {
    old.title = "";
  }
}
