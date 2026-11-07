import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

// Just enough layout to run the tab bar in Node. Items are 100px wide, a group's box as wide as what
// is in it. Measuring anything clamps both rows' scroll to what fits, as a browser's reflow does.
const ROW_WIDTH = 150;
const ids = new Map();
const reflow = () => { for (const node of ids.values()) if (node instanceof FakeRow) node.clamp(); };

class FakeNode {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = { setProperty() {}, marginRight: "" };
    this.className = "";
    this.textContent = "";
    this.classList = {
      add: (name) => { this.className += ` ${name}`; },
      toggle() {},
    };
  }
  append(...nodes) { this.children.push(...nodes); }
  addEventListener() {}
  setAttribute() {}
  remove() {}
  getContext() { return {}; } // editor.js measures text with a canvas
  get ownWidth() { return this.has("tabGroupBox") ? this.children.reduce((sum, child) => sum + child.ownWidth, 0) : 100; }
  getBoundingClientRect() { reflow(); return { left: 0, width: this.ownWidth }; }
  has(name) { return this.className.split(" ").includes(name); }
  all() { return this.children.flatMap((child) => [child, ...child.all()]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
  querySelectorAll(selector) {
    const name = selector.match(/\.([\w-]+)/)[1];
    return this.all().filter((node) => node.has(name) && !(selector.includes(":not") && node.has("groupTray")));
  }
}

class FakeRow extends FakeNode {
  scroll = 0;
  clientWidth = ROW_WIDTH;
  replaceChildren(...nodes) { this.children = nodes; }
  getBoundingClientRect() { reflow(); return { left: 0, width: ROW_WIDTH }; }
  contentWidth() { return this.children.reduce((sum, child) => sum + child.ownWidth + (parseFloat(child.style.marginRight) || 0), 0); }
  clamp() { this.scroll = Math.max(0, Math.min(this.scroll, this.contentWidth() - ROW_WIDTH)); }
  get scrollLeft() { this.clamp(); return this.scroll; }
  set scrollLeft(value) { this.scroll = value; this.clamp(); }
}

globalThis.localStorage = { getItem: () => null, setItem() {} };
globalThis.window = { addEventListener() {} };
globalThis.matchMedia = () => ({ matches: false });
globalThis.document = {
  createElement: (tag) => new FakeNode(tag),
  getElementById(id) {
    if (!ids.has(id)) ids.set(id, id === "groupTabs" || id === "tabs" ? new FakeRow() : new FakeNode());
    return ids.get(id);
  },
  addEventListener() {},
  querySelector: () => null,
};

const { state, addGroup, addTab, activateTab, tabsIn } = await import("../src/store.js");
const { renderTabbar } = await import("../src/tabbar.js");
const { runs } = await import("../src/terminal/runState.js");

const row = (id) => document.getElementById(id);

beforeEach(() => {
  state.ws.groups = [];
  state.ws.tabs = [];
  state.ws.activeTab = null;
  state.ws.activeGroup = null;
  state.settings.showAllGroups = true;
  row("groupTabs").scroll = row("tabs").scroll = 0;
});

test("show all: changing tabs keeps both rows where they were scrolled", () => {
  const groups = [addGroup(), addGroup(), addGroup()];
  addTab(groups[2].id);
  renderTabbar();
  row("groupTabs").scrollLeft = row("tabs").scrollLeft = 500;

  activateTab(tabsIn(groups[0].id)[0].id);
  renderTabbar();

  assert.equal(row("groupTabs").scrollLeft, 500);
  assert.equal(row("tabs").scrollLeft, 500);
});

test("show all: the rows stay lined up when the row they were scrolled in shrinks", () => {
  const groups = [addGroup(), addGroup(), addGroup()];
  renderTabbar();
  row("groupTabs").scrollLeft = row("tabs").scrollLeft = 500;

  groups.slice(1).forEach((group) => { state.ws.groups = state.ws.groups.filter((g) => g !== group); });
  renderTabbar();

  assert.equal(row("groupTabs").scrollLeft, row("tabs").scrollLeft);
});

test("a group running a command takes the same room selected or not", () => {
  const [running, other] = [addGroup(), addGroup()];
  const heading = () => row("groupTabs").children[0];
  const tab = tabsIn(running.id)[0];
  runs.start(tab.id);
  try {
    activateTab(tabsIn(other.id)[0].id);
    renderTabbar();
    assert.ok(heading().querySelector(".spinner"));

    activateTab(tab.id);
    renderTabbar();
    assert.ok(heading().querySelector(".spinner")); // hidden by styles/base.css, but still there
  } finally {
    runs.finish(tab.id);
  }
});
