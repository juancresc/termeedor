// What a render touches, with the real store, tab bar and sidebar on a stub DOM.

import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";
import { installDom, mutationsDuring } from "./support/miniDom.js";

installDom();
const realSetInterval = globalThis.setInterval;
let clock = null; // the sidebar's: it would keep this process alive, and tests tick it by hand
globalThis.setInterval = (fn) => { clock = fn; return 0; };
const store = await import("../src/store.js");
const { refreshTabbarRuns, renderTabbar } = await import("../src/tabbar.js");
const { initSidebar, refreshSidebarRuns, renderSidebar } = await import("../src/sidebar.js");
const { startRename } = await import("../src/rename.js");
const { runs } = await import("../src/core/runState.js");
await import("../src/appActions.js");

const { state } = store;
const $ = (id) => document.getElementById(id);
const render = () => { renderTabbar(); renderSidebar(); };
store.subscribe(render);

const pastEntry = (id, onRead = () => {}) => ({
  id,
  name: id,
  closedAt: Date.now(),
  tab: { color: null, draft: "", cwd: "~", history: [], get blocks() { onRead(); return [{ command: null, output: "a\nb\nneedle\n", exit: null, cwd: null }]; } },
});

const allNodes = () => ["groups", "pastSessions", "groupTabs", "tabs"].flatMap((id) => $(id).all());

beforeEach(() => {
  state.ws.groups = [];
  state.ws.tabs = [];
  state.ws.activeTab = null;
  state.ws.activeGroup = null;
  state.past = [];
  state.settings.showAllGroups = false;
  store.addGroup();
  store.addTab();
  store.addGroup();
  render();
});

test("a commit that changes nothing visible changes nothing on the page", () => {
  const before = allNodes();
  assert.equal(mutationsDuring(() => store.commit()), 0);
  assert.deepEqual(allNodes(), before);
});

test("the same in show-all mode, whose columns are lined up on every render", () => {
  state.settings.showAllGroups = true;
  render();
  const before = allNodes();
  store.commit();
  assert.deepEqual(allNodes(), before);
});

test("a cwd change, a sidebar width or a font size leave the rows alone", () => {
  const before = allNodes();
  store.activeTab().cwd = "~/elsewhere";
  store.commit();
  store.setSidebarWidth(300);
  store.updateSettings({ fontSize: 15 });
  assert.deepEqual(allNodes(), before);
});

test("a background tab starting a command adds its spinners, and nothing else is rebuilt", () => {
  const background = state.ws.tabs[0];
  assert.notEqual(background, store.activeTab());
  const before = new Set(allNodes());
  runs.start(background.id);
  store.commit();
  const rowNow = $("groups").querySelector(".spinner").parentNode.parentNode; // spinner, its slot, the row
  assert.equal(rowNow.dataset.slideKey, background.id);
  const added = allNodes().filter((node) => !before.has(node));
  assert.ok(added.every((node) => node.has("spinner")), "only spinners are new");
  runs.finish(background.id);
  store.commit();
  assert.equal($("groups").querySelector(".spinner"), null);
});

test("a spinner's slot still works after a render kept the slot that was on the page", () => {
  const tab = store.activeTab();
  store.commit(); // the slots these built were matched with the ones already there
  const onPage = () => [$("groups").querySelector(".spinner"), $("tabs").querySelector(".spinner")];

  runs.start(tab.id);
  refreshSidebarRuns();
  refreshTabbarRuns();
  assert.ok(onPage().every(Boolean));

  const spinners = onPage();
  store.commit();
  assert.deepEqual(onPage(), spinners, "a commit doesn't restart them");

  runs.finish(tab.id);
  refreshSidebarRuns();
  refreshTabbarRuns();
  assert.deepEqual(onPage(), [null, null]);
});

test("a closed tab's time still changes after a render kept the row", () => {
  initSidebar();
  state.past = [pastEntry("p1")];
  renderSidebar();
  store.commit();
  assert.match($("pastSessions").textContent, /just now/);
  const later = Date.now() + 2 * 3600_000;
  const now = mock.method(Date, "now", () => later);
  clock();
  now.mock.restore();
  assert.match($("pastSessions").textContent, /2h ago/);
});

test("selecting a tab updates the rows in place", () => {
  const rowFor = (tab) => $("groups").children.flatMap((g) => g.querySelectorAll(".item")).find((r) => r.dataset.slideKey === tab.id);
  const [first, second] = state.ws.tabs;
  const [rowA, rowB] = [rowFor(first), rowFor(second)];
  store.activateTab(first.id);
  assert.ok(rowA.has("active"));
  store.activateTab(second.id);
  assert.ok(rowB.has("active"));
  assert.ok(!rowA.has("active"));
  assert.equal(rowFor(first), rowA);
});

test("a rename survives what happens in the background, with what was typed", () => {
  const tab = store.activeTab();
  startRename("tab", tab, "sidebar");
  const box = $("groups").querySelector(".inlineInput");
  box.value = "half typ";
  box.focus();

  const other = state.ws.tabs.find((t) => t !== tab);
  runs.start(other.id);
  store.commit();
  runs.finish(other.id);
  store.commit();

  assert.equal($("groups").querySelector(".inlineInput"), box);
  assert.equal(box.value, "half typ");
  assert.equal(document.activeElement, box);
  assert.notEqual(tab.name, "half typ");

  box.fire("keydown", { key: "Enter" });
  assert.equal(tab.name, "half typ");
  assert.equal($("groups").querySelector(".inlineInput"), null);
});

test("a rename survives its own tab's command starting, which adds a spinner beside it", () => {
  const tab = store.activeTab();
  startRename("tab", tab, "tabbar");
  const box = $("tabs").querySelector(".inlineInput");
  box.value = "typed";
  box.focus();
  runs.start(tab.id);
  store.commit();
  assert.equal($("tabs").querySelector(".inlineInput"), box);
  assert.equal(document.activeElement, box);
  assert.equal(box.value, "typed");
  runs.finish(tab.id);
  box.fire("keydown", { key: "Escape" });
});

test("a tab closing while it is being renamed takes the box away cleanly", () => {
  const tab = store.activeTab();
  startRename("tab", tab, "sidebar");
  const box = $("groups").querySelector(".inlineInput");
  box.focus();
  store.closeTab(tab);
  assert.equal($("groups").querySelector(".inlineInput"), null);
  assert.equal(state.ws.tabs.includes(tab), false);
});

test("a closed tab's text is read once, however many commits follow", () => {
  let reads = 0;
  state.past = [pastEntry("p1", () => { reads++; })];
  renderSidebar();
  const first = reads;
  assert.ok(first > 0);
  store.commit();
  store.commit();
  assert.equal(reads, first);
  assert.match($("pastSessions").textContent, /5 lines/);
});

test("searching closed tabs reads them when the search changes, not on every commit", () => {
  initSidebar();
  globalThis.setInterval = realSetInterval;
  let reads = 0;
  state.past = [pastEntry("p1", () => { reads++; }), pastEntry("p2")];
  $("pastSearch").oninput({ target: { value: "needle" } });
  assert.equal($("pastSessions").children.length, 2);
  const after = reads;
  store.commit();
  store.commit();
  assert.equal(reads, after);

  $("pastSearch").oninput({ target: { value: "nothing like it" } });
  assert.match($("pastSessions").textContent, /No matches/);
  $("pastSearch").oninput({ target: { value: "" } });
});

test("closed tabs update in place when one goes", () => {
  state.past = [pastEntry("p1"), pastEntry("p2")];
  renderSidebar();
  const kept = $("pastSessions").children[1];
  store.deletePast(state.past[0]);
  assert.deepEqual($("pastSessions").children, [kept]);
});

test("the page shows the same as a fresh build after a run of changes", () => {
  const snapshot = (id) => {
    const walk = (node) => (node.nodeType === 3 ? node.data : [node.tagName, node.className, node.title, ...node.childNodes.map(walk)]);
    return walk($(id));
  };
  const tab = store.activeTab();
  store.setTabColor(tab, "c1");
  store.setTabCollapsed(tab, true);
  store.setTabCollapsed(tab, false);
  store.renameItem("tab", tab, "renamed");
  store.setTabMinimized(state.ws.tabs[0], true);
  store.closeTab(store.activeTab());
  store.addTab();
  const patched = ["groups", "pastSessions", "groupTabs", "tabs"].map(snapshot);

  for (const id of ["groups", "pastSessions", "groupTabs", "tabs"]) $(id).replaceChildren();
  render();
  assert.deepEqual(["groups", "pastSessions", "groupTabs", "tabs"].map(snapshot), patched);
});
