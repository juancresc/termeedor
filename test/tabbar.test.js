import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { MiniElement, installDom } from "./support/miniDom.js";

// Just enough layout to run the tab bar in Node. Items are 100px wide, a group's box as wide as what
// is in it. Measuring anything clamps both rows' scroll to what fits, as a browser's reflow does.
const ROW_WIDTH = 150;
const rows = new Set();
const reflow = () => { for (const node of rows) node.clamp(); };

class FakeNode extends MiniElement {
  get ownWidth() { return this.has("tabGroupBox") ? this.children.reduce((sum, child) => sum + child.ownWidth, 0) : 100; }
  getBoundingClientRect() { reflow(); return { left: 0, width: this.ownWidth }; }
}

class FakeRow extends FakeNode {
  scroll = 0;
  clientWidth = ROW_WIDTH;
  getBoundingClientRect() { reflow(); return { left: 0, width: ROW_WIDTH }; }
  contentWidth() { return this.children.reduce((sum, child) => sum + child.ownWidth + (parseFloat(child.style.marginRight) || 0), 0); }
  clamp() { this.scroll = Math.max(0, Math.min(this.scroll, this.contentWidth() - ROW_WIDTH)); }
  get scrollLeft() { this.clamp(); return this.scroll; }
  set scrollLeft(value) { this.scroll = value; this.clamp(); }
}

installDom({
  element: FakeNode,
  byId(id) {
    if (id !== "groupTabs" && id !== "tabs") return new FakeNode();
    const row = new FakeRow();
    rows.add(row);
    return row;
  },
});

const { state, addGroup, addTab, activateTab, setGroupMinimized, tabsIn } = await import("../src/store.js");
const { refreshTabbarRuns, renderTabbar } = await import("../src/tabbar.js");
const { runs } = await import("../src/core/runState.js");

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

test("a minimized group leaves the group row, with nothing standing in for it", () => {
  const [kept, minimized] = [addGroup(), addGroup()];
  renderTabbar();
  assert.equal(row("groupTabs").children.length, 2);
  setGroupMinimized(minimized, true);
  renderTabbar();
  assert.equal(row("groupTabs").children.length, 1);
  assert.equal(state.ws.groups.includes(kept), true);
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

test("a spinner comes and goes without rebuilding the bars", () => {
  const [group] = [addGroup(), addGroup()];
  const tab = tabsIn(group.id)[0];
  activateTab(tab.id);
  renderTabbar();
  const heading = row("groupTabs").children.find((node) => node.dataset.slideKey === group.id);
  const tabNodes = () => row("tabs").querySelectorAll(".tab");
  const tabNode = tabNodes().find((node) => node.dataset.slideKey === tab.id);
  assert.equal(heading.querySelector(".spinner"), null);
  assert.equal(tabNode.querySelector(".spinner"), null);

  runs.start(tab.id);
  refreshTabbarRuns();
  assert.ok(heading.querySelector(".spinner"));
  assert.ok(tabNode.querySelector(".spinner"));

  runs.finish(tab.id);
  refreshTabbarRuns();
  assert.equal(heading.querySelector(".spinner"), null);
  assert.equal(tabNode.querySelector(".spinner"), null);
  assert.ok(tabNodes().includes(tabNode));
});

test("an unnamed group's tab is just its buttons; a named one keeps its name and count", () => {
  const [group] = [addGroup(), addGroup()];
  renderTabbar();
  const heading = () => row("groupTabs").children[0];
  assert.ok(heading().has("unnamed"));
  assert.equal(heading().querySelector(".chipName").textContent, "");
  assert.equal(heading().querySelector(".chipCount"), null);
  assert.ok(heading().querySelector(".itemBtns"));

  // no hint in its empty name; a double-click renames
  heading().ondblclick({ stopPropagation() {} });
  renderTabbar();
  assert.ok(heading().querySelector(".inlineInput"));
  const input = heading().querySelector(".inlineInput");
  for (const fn of input.listeners.keydown) fn({ key: "Escape", stopPropagation() {}, preventDefault() {} });

  group.name = "Work";
  renderTabbar();
  assert.ok(!heading().has("unnamed"));
  assert.equal(heading().querySelector(".chipName").textContent, "Work");
  assert.ok(heading().querySelector(".chipCount"));
});

test("dragging a tab: the group under it stays highlighted through a render, and clears on leaving", () => {
  const groups = [addGroup(), addGroup()];
  renderTabbar();
  const chip = () => row("groupTabs").children[1];
  const transfer = { types: ["text/tab"], dropEffect: "" };
  const event = (extra) => ({ dataTransfer: transfer, currentTarget: chip(), preventDefault() {}, stopPropagation() {}, ...extra });

  chip().ondragover(event());
  assert.ok(chip().classList.contains("dragover"));
  assert.equal(transfer.dropEffect, "move");

  renderTabbar();
  assert.ok(chip().classList.contains("dragover"));

  chip().ondragleave(event({ relatedTarget: chip().children[0] })); // onto its own name: still over it
  assert.ok(chip().classList.contains("dragover"));
  chip().ondragleave(event({ relatedTarget: null }));
  assert.ok(!chip().classList.contains("dragover"));
  assert.equal(groups.length, 2);
});

test("Cmd+number badges: tabs and groups numbered the way the keys count, and they follow a move", () => {
  const groups = [addGroup(), addGroup()];
  addTab(groups[0].id);
  setGroupMinimized(addGroup(), true); // not in the bar: no number
  renderTabbar();
  const hints = (id) => row(id).querySelectorAll(id === "tabs" ? ".tab" : ".groupTab").map((node) => node.dataset.hint);
  assert.deepEqual(hints("groupTabs"), ["⇧1", "⇧2"]);
  assert.deepEqual(hints("tabs"), ["1", "2", "3"]); // show all: across every group

  state.settings.showAllGroups = false;
  activateTab(tabsIn(groups[1].id)[0].id);
  renderTabbar();
  assert.deepEqual(hints("tabs"), ["1"]);
});

test("Cmd+number badges stop at 9", () => {
  const group = addGroup();
  for (let i = 0; i < 10; i++) addTab(group.id);
  renderTabbar();
  const hints = row("tabs").querySelectorAll(".tab").map((node) => node.dataset.hint);
  assert.equal(hints.length, 11);
  assert.equal(hints[8], "9");
  assert.deepEqual(hints.slice(9), [undefined, undefined]);
});
