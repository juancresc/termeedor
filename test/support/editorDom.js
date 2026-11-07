// Just enough DOM to run src/editor.js in Node. Import it before editor.js. It only models a
// textarea's text and selection: layout, focus, real key handling and undo need the real app.

export const noop = () => {};

const stubNode = () => ({
  style: { setProperty: noop },
  dataset: {},
  listeners: {},
  addEventListener(type, fn) { this.listeners[type] = fn; },
  replaceChildren: noop,
  append: noop,
  getBoundingClientRect: () => ({ height: 100, top: 0, bottom: 100, left: 0 }),
  focus: noop,
  remove: noop,
  scrollTop: 0,
  scrollHeight: 0,
  clientHeight: 100,
  clientWidth: 100,
  textContent: "",
});

export const textarea = Object.assign(stubNode(), {
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

globalThis.document = {
  getElementById: nodeFor,
  createElement: () => Object.assign(stubNode(), { getContext: () => ({ measureText: () => ({ width: 8 }) }) }),
  querySelector: () => null,
  addEventListener: noop,
  activeElement: textarea,
};
globalThis.window = { addEventListener: noop };
globalThis.getComputedStyle = () => ({ font: "", paddingTop: "0", paddingLeft: "0", paddingRight: "0" });
globalThis.localStorage = { getItem: () => null, setItem: noop };
