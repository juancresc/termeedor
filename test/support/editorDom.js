// Just enough DOM to run src/editor.js in Node. Import it before editor.js. It models a textarea's
// text and selection, and a tree of elements with their text: layout, real focus, real key
// handling, selection across nodes and undo need the real app.

export const noop = () => {};

class StubText {
  constructor(data) {
    this.data = data;
    this.parent = null;
    this.tagName = "#text";
  }
  appendData(more) { this.data += more; }
  remove() { this.parent?.removeChild(this); }
  get textContent() { return this.data; }
  get nextSibling() { return siblingAfter(this); }
}

const siblingAfter = (node) => {
  const list = node.parent?.children;
  return list ? list[list.indexOf(node) + 1] ?? null : null;
};

class StubElement {
  constructor(tagName = "DIV") {
    this.tagName = tagName;
    this.style = { setProperty: noop };
    this.dataset = {};
    this.listeners = {};
    this.attributes = {};
    this.children = [];
    this.parent = null;
    this.className = "";
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.scrollHeight = 0;
    this.clientHeight = 100;
    this.clientWidth = 100;
    const owner = this;
    this.classList = {
      toggle(name, on) { owner.setClass(name, on); },
      add(name) { owner.setClass(name, true); },
      contains: (name) => owner.className.split(" ").includes(name),
    };
  }
  setClass(name, on) {
    const names = this.className.split(" ").filter((c) => c && c !== name);
    this.className = (on ? [...names, name] : names).join(" ");
  }
  addEventListener(type, fn) { this.listeners[type] = fn; }
  setAttribute(name, value) { this.attributes[name] = value; }
  getBoundingClientRect() { return { height: 100, width: 0, top: 0, bottom: 100, left: 0 }; }
  focus() { document.activeElement = this; }
  blur() { if (document.activeElement === this) document.activeElement = document.body; }
  select() { this.setSelectionRange?.(0, this.value.length); }
  scrollIntoView() {}
  get firstChild() { return this.children[0] ?? null; }
  get nextSibling() { return siblingAfter(this); }
  contains(node) { return node === this || this.children.some((child) => child.contains?.(node)); }
  removeChild(node) {
    this.children.splice(this.children.indexOf(node), 1);
    node.parent = null;
  }
  remove() { this.parent?.removeChild(this); }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, before) {
    node.parent?.removeChild(node);
    node.parent = this;
    const at = before ? this.children.indexOf(before) : this.children.length;
    this.children.splice(at, 0, node);
  }
  replaceChildren(...nodes) {
    for (const child of [...this.children]) this.removeChild(child);
    this.append(...nodes);
  }
  get textContent() { return this.ownText ?? this.children.map((child) => child.textContent).join(""); }
  set textContent(text) {
    this.replaceChildren();
    this.ownText = text;
  }
  /** Every element under this one with the class. */
  allWithClass(name) {
    const below = this.children.flatMap((child) => child.allWithClass?.(name) ?? []);
    return this.classList.contains(name) ? [this, ...below] : below;
  }
}

const stubNode = (tagName) => new StubElement(tagName);

export const textarea = Object.assign(stubNode("TEXTAREA"), {
  selectionStart: 0,
  selectionEnd: 0,
  setSelectionRange(from, to) { this.selectionStart = from; this.selectionEnd = to; },
  setRangeText(text, from, to) {
    this.value = this.value.slice(0, from) + text + this.value.slice(to);
    this.selectionStart = this.selectionEnd = from + text.length;
  },
});

// As in a browser: line breaks are normalized, and a value set from code puts the caret at the end.
let value = "";
Object.defineProperty(textarea, "value", {
  get: () => value,
  set(next) {
    value = next.replace(/\r\n?/g, "\n");
    textarea.selectionStart = textarea.selectionEnd = value.length;
  },
});

const nodes = new Map([["editor", textarea]]);
export function nodeFor(id) {
  if (!nodes.has(id)) nodes.set(id, stubNode());
  return nodes.get(id);
}

/** The selection, for tests to change: a drag leaves it not collapsed. */
export const selection = { isCollapsed: true, selectAllChildren(node) { this.selected = node; this.isCollapsed = false; } };

const documentListeners = {};
const body = stubNode("BODY");

globalThis.document = {
  getElementById: nodeFor,
  createElement: (tag) => Object.assign(stubNode(tag.toUpperCase()), { getContext: () => ({ measureText: () => ({ width: 8 }) }) }),
  createTextNode: (data) => new StubText(data),
  querySelector: () => null,
  addEventListener(type, fn) { documentListeners[type] = fn; },
  listeners: documentListeners,
  body,
  head: stubNode("HEAD"),
  activeElement: textarea,
};
globalThis.window = { addEventListener: noop };
globalThis.innerWidth = 1000;
globalThis.innerHeight = 800;
globalThis.getSelection = () => selection;
globalThis.getComputedStyle = () => ({ font: "", lineHeight: "20px", paddingTop: "0", paddingLeft: "0", paddingRight: "0" });
globalThis.localStorage = { getItem: () => null, setItem: noop };
