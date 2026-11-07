// Just enough DOM to run the tab bar and sidebar in Node, and to count what a render really changes.
// `mutations` counts changes to what is on the page: nodes added, removed or moved, and classes,
// titles, styles or text set to a new value. Nodes still being built don't count. Removing the
// focused element fires `blur` at once, as Chromium does. Layout, hover and real focus rules need
// the real app.

export const dom = { mutations: 0, created: 0 };

const changed = (node) => { if (node.isConnected) dom.mutations++; };

class MiniNode {
  parentNode = null;
  get nextSibling() {
    const list = this.parentNode?.childNodes;
    return list ? list[list.indexOf(this) + 1] ?? null : null;
  }
  get isConnected() {
    return this.parentNode ? this.parentNode.isConnected : false;
  }
  remove() { this.parentNode?.removeChild(this); }
}

class MiniText extends MiniNode {
  nodeType = 3;
  #data;
  constructor(data) {
    super();
    this.#data = data;
  }
  get data() { return this.#data; }
  set data(value) {
    if (value !== this.#data) changed(this);
    this.#data = value;
  }
  get textContent() { return this.#data; }
}

const RULES = /--[\w-]+|[a-z-]+/;
const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

/** Inline style: named properties and setProperty read from and write to one ordered cssText. */
function miniStyle(owner) {
  const rules = new Map();
  const set = (name, value) => {
    const before = rules.get(name) ?? "";
    if (before === value) return;
    changed(owner);
    if (value) rules.set(name, value);
    else rules.delete(name);
  };
  const api = {
    setProperty: set,
    get cssText() { return [...rules].map(([name, value]) => `${name}: ${value};`).join(" "); },
    set cssText(text) {
      if (text === api.cssText) return;
      changed(owner);
      rules.clear();
      for (const rule of text.split(";")) {
        const [name, value] = rule.split(/:(.*)/);
        if (RULES.test(name ?? "") && value) rules.set(name.trim(), value.trim());
      }
    },
  };
  return new Proxy(api, {
    get: (target, name) => (name in target ? target[name] : rules.get(kebab(String(name))) ?? ""),
    set(target, name, value) {
      if (name === "cssText") target.cssText = value;
      else set(kebab(String(name)), value);
      return true;
    },
  });
}

export class MiniElement extends MiniNode {
  nodeType = 1;
  childNodes = [];
  dataset = {};
  listeners = {};
  attributes = {};
  animations = [];
  clientWidth = 0;
  offsetLeft = 0;
  style = miniStyle(this);
  #className = "";
  #title = "";
  constructor(tag = "div") {
    super();
    this.tagName = tag.toUpperCase();
    dom.created++;
    const owner = this;
    this.classList = {
      add(name) { owner.setClass(name, true); },
      remove(name) { owner.setClass(name, false); },
      toggle(name, on) { owner.setClass(name, on); },
      contains: (name) => owner.has(name),
    };
  }
  get className() { return this.#className; }
  set className(value) {
    if (value !== this.#className) changed(this);
    this.#className = value;
  }
  get title() { return this.#title; }
  set title(value) {
    if (value !== this.#title) changed(this);
    this.#title = value;
  }
  has(name) { return this.#className.split(" ").includes(name); }
  setClass(name, on) {
    const names = this.#className.split(" ").filter((c) => c && c !== name);
    this.className = (on ? [...names, name] : names).join(" ");
  }
  get children() { return this.childNodes.filter((node) => node.nodeType === 1); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get isConnected() { return this.isRoot || super.isConnected; }
  get textContent() { return this.childNodes.map((node) => node.textContent).join(""); }
  set textContent(text) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    if (text !== "") this.append(new MiniText(String(text)));
  }
  append(...nodes) { for (const node of nodes) this.insertBefore(node, null); }
  insertBefore(node, before) {
    node.parentNode?.detach(node);
    node.parentNode = this;
    this.childNodes.splice(before ? this.childNodes.indexOf(before) : this.childNodes.length, 0, node);
    changed(this);
    return node;
  }
  /** Out of the list, without the blur a removal fires: for a node about to go somewhere else too. */
  detach(node) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
  }
  removeChild(node) {
    const focused = node.nodeType === 1 && node.contains(document.activeElement) ? document.activeElement : null;
    this.detach(node);
    changed(this);
    if (focused) focused.blur();
    return node;
  }
  replaceChildren(...nodes) {
    for (const child of [...this.childNodes]) this.removeChild(child);
    this.append(...nodes);
  }
  contains(node) { return node === this || this.children.some((child) => child.contains(node)); }
  addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); }
  fire(type, event = {}) { (this.listeners[type] ?? []).forEach((fn) => fn({ target: this, stopPropagation() {}, ...event })); }
  setAttribute(name, value) { this.attributes[name] = value; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0, right: 0, bottom: 0 }; }
  getAnimations() { return []; }
  animate(...args) { this.animations.push(args); }
  focus() {
    if (!this.isConnected) return;
    document.activeElement = this;
  }
  blur() {
    if (document.activeElement !== this) return;
    document.activeElement = document.body;
    this.fire("blur");
  }
  select() {}
  matches(selector) {
    if (selector === ":focus-visible") return !!this.focusVisible;
    return matcher(selector)(this);
  }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) { return this.all().filter(matcher(selector)); }
}

/** ".a", ".a:not(.b)" and "[data-slide-key]". */
const matcher = (selector) => {
  const data = selector.match(/^\[data-([\w-]+)\]$/);
  if (data) {
    const key = data[1].replace(/-(\w)/g, (_, c) => c.toUpperCase());
    return (node) => node.dataset[key] !== undefined;
  }
  const [, name, not] = selector.match(/^\.([\w-]+)(?::not\(\.([\w-]+)\))?$/);
  return (node) => node.has(name) && !(not && node.has(not));
};

/** Puts a stub `document` and the other page globals in place. `element` and `byId` can add layout. */
export function installDom({ element = MiniElement, byId = () => new element() } = {}) {
  const nodes = new Map();
  const root = (node) => Object.assign(node, { isRoot: true });
  const body = root(new element("body"));
  globalThis.document = {
    body,
    head: root(new element("head")),
    documentElement: root(new element("html")),
    activeElement: body,
    listeners: {},
    createElement: (tag) => Object.assign(new element(tag), { getContext: () => ({ measureText: () => ({ width: 8 }) }) }),
    createTextNode: (data) => new MiniText(data),
    getElementById(id) {
      if (!nodes.has(id)) nodes.set(id, root(byId(id)));
      return nodes.get(id);
    },
    querySelector: (selector) => body.querySelector(selector),
    querySelectorAll: (selector) => body.querySelectorAll(selector),
    addEventListener(type, fn) { (this.listeners[type] ??= []).push(fn); },
  };
  globalThis.window = { addEventListener() {} };
  globalThis.innerWidth = 1000;
  globalThis.innerHeight = 800;
  globalThis.localStorage = { getItem: () => null, setItem() {} };
  globalThis.matchMedia = () => ({ matches: true }); // no slides unless a test asks
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.getComputedStyle = () => ({ font: "", lineHeight: "20px", paddingTop: "0", paddingLeft: "0", paddingRight: "0", textOverflow: "clip" });
  globalThis.getSelection = () => ({ isCollapsed: true });
  return document;
}

/** How many DOM changes `fn` makes. */
export function mutationsDuring(fn) {
  const before = dom.mutations;
  fn();
  return dom.mutations - before;
}
