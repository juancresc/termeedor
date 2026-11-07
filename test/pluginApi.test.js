// The plugin API on the real store, in the browser build, so nothing here reaches a disk or a shell.

import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, mock, test } from "node:test";
import "./support/editorDom.js";

const store = await import("../src/store.js");
const { initEditor } = await import("../src/editor.js");
initEditor();
const { createApi } = await import("../src/plugins/api.js");
const { createScope } = await import("../src/plugins/host.js");
const registry = await import("../src/plugins/registry.js");
const { actionIds, hasAction } = await import("../src/core/actions.js");
await import("../src/appActions.js");

const { state } = store;
const quietly = () => mock.method(console, "error", () => {});

let scope;
let api;
const open = (id = "demo") => {
  scope = createScope();
  api = createApi({ id, name: id, version: "1.0.0" }, scope);
  return api;
};

let background;
beforeEach(() => {
  scope?.dispose();
  state.ws.groups = [];
  state.ws.tabs = [];
  state.ws.activeTab = null;
  state.ws.activeGroup = null;
  store.addGroup();
  background = store.addTab();
  store.activateTab(state.ws.tabs[0].id);
  open();
});

// ---------- copies ----------
test("what comes from the workspace is a copy: changing it changes nothing in the app", () => {
  const live = store.activeTab();
  const tab = api.workspace.activeTab();
  assert.notEqual(tab, live);
  assert.equal(tab.id, live.id);
  tab.name = "changed";
  tab.blocks.length = 0;
  tab.blocks.push("junk");
  tab.history.push("junk");
  assert.notEqual(live.name, "changed");
  assert.ok(live.blocks.length > 0 && !live.blocks.includes("junk"));
  assert.ok(!live.history.includes("junk"));

  const [first] = api.workspace.tabs();
  assert.notEqual(first, state.ws.tabs[0]);
  api.workspace.tabs().pop();
  assert.equal(state.ws.tabs.length, 2);

  const [group] = api.workspace.groups();
  group.name = "changed";
  assert.notEqual(state.ws.groups[0].name, "changed");

  const blocks = api.workspace.activeTab().blocks;
  blocks[0].output = "changed";
  assert.notEqual(live.blocks[0].output, "changed");
});

test("a new tab comes back as a copy", () => {
  const made = api.workspace.openTab();
  assert.notEqual(made, store.activeTab());
  assert.equal(made.id, store.activeTab().id);
});

test("event payloads hold a copy, a separate one for each listener", () => {
  const seen = [];
  api.events.on("tab:activate", ({ tab }) => { seen.push(tab); tab.name = "changed"; });
  api.events.on("tab:activate", ({ tab }) => { seen.push(tab); });
  const live = store.activeTab();
  registry.emit("tab:activate", { tab: live });
  assert.notEqual(seen[0], live);
  assert.notEqual(seen[1], seen[0]);
  assert.equal(seen[1].name, live.name);
  assert.notEqual(live.name, "changed");
});

test("other fields in a payload pass through", () => {
  const handler = mock.fn();
  api.events.on("command:finish", handler);
  registry.emit("command:finish", { tab: store.activeTab(), command: "ls", output: "x", aborted: false });
  const [payload] = handler.mock.calls[0].arguments;
  assert.equal(payload.command, "ls");
  assert.equal(payload.output, "x");
  assert.equal(payload.aborted, false);
});

test("a menu action gets a copy of the tab clicked, in `enabled` as well", () => {
  const run = mock.fn((tab) => { tab.name = "changed"; });
  const enabled = mock.fn((tab) => { tab.color = "c1"; return true; });
  api.actions.register({ id: "act", label: "Act", run, enabled });
  api.menus.addTabItem("act");
  const live = store.activeTab();
  registry.menuItemsFor("tab", live)[0].onSelect();
  assert.equal(run.mock.calls[0].arguments[0].id, live.id);
  assert.notEqual(run.mock.calls[0].arguments[0], live);
  assert.notEqual(live.name, "changed");
  assert.equal(live.color, null);
});

// ---------- calls take copies ----------
test("workspace calls take a copy or an id, and act on the app's own tab", () => {
  const live = background;
  api.workspace.renameTab({ ...api.workspace.tabs().find((t) => t.id === live.id) }, "by copy");
  assert.equal(live.name, "by copy");
  api.workspace.renameTab(live.id, "by id");
  assert.equal(live.name, "by id");
  api.workspace.setTabColor(api.workspace.tabs().find((t) => t.id === live.id), "c2");
  assert.equal(live.color, "c2");
  api.workspace.activateTab(api.workspace.tabs().find((t) => t.id === live.id));
  assert.equal(store.activeTab(), live);
});

test("print adds to the app's own tab", () => {
  const first = state.ws.tabs[0];
  const copy = api.workspace.tabs().find((t) => t.id === first.id);
  const count = first.blocks.length;
  store.activateTab(background.id);
  api.workspace.print(copy, "hello");
  assert.equal(first.blocks.length, count + 1);
  assert.equal(first.blocks.at(-1).output, "hello");
  assert.equal(copy.blocks.length, count);
});

test("a tab that has closed is left alone, and nothing else gets hit", () => {
  const stale = api.workspace.tabs().find((t) => t.id === background.id);
  store.closeTab(background);
  const count = state.ws.tabs.length;
  api.workspace.closeTab(stale);
  api.workspace.renameTab(stale, "x");
  api.workspace.setTabColor(stale, "c1");
  api.workspace.activateTab(stale);
  api.workspace.print(stale, "x");
  api.actions.run("tab.close", stale);
  assert.equal(state.ws.tabs.length, count);
});

// ---------- actions by id ----------
test("a plugin's action gets its plugin's id, and goes when the plugin is turned off", () => {
  const handle = api.actions.register({ id: "act", label: "Act", run() {} });
  assert.equal(handle.id, "demo.act");
  assert.ok(hasAction("demo.act"));
  scope.dispose();
  assert.equal(hasAction("demo.act"), false);
  open();
});

test("dispose removes one action", () => {
  const handle = api.actions.register({ id: "act", label: "Act", run() {} });
  handle.dispose();
  assert.equal(hasAction("demo.act"), false);
});

test("an action can't take a built-in's id or another's, and needs what it needs", () => {
  api.actions.register({ id: "act", label: "Act", run() {} });
  assert.throws(() => api.actions.register({ id: "act", label: "Act", run() {} }), /already exists/);
  assert.throws(() => api.actions.register({ id: "bad id", label: "Act", run() {} }), /Invalid action id/);
  assert.throws(() => api.actions.register({ id: "x", run() {} }), /needs a label/);
  assert.throws(() => api.actions.register({ id: "x", label: "X" }), /must be a function/);
  const other = createApi({ id: "tab", name: "tab" }, createScope());
  assert.throws(() => other.actions.register({ id: "close", label: "X", run() {} }), /already exists/);
});

test("shortcuts, menus and status items name an action, and functions are refused", () => {
  assert.throws(() => api.shortcuts.register("Mod+KeyJ", () => {}), /must be an action id/);
  assert.throws(() => api.menus.addTabItem({ label: "x", onSelect() {} }), /must be an action id/);
  assert.throws(() => api.statusBar.add({ text: "x", action: () => {} }), /must be an action id/);
  assert.throws(() => api.shortcuts.register("Mod+KeyJ", "nope"), /Unknown action/);
  assert.throws(() => api.menus.addGroupItem("nope"), /Unknown action/);
});

test("the same action works from a shortcut, a menu, a status item and api.actions.run", () => {
  const run = mock.fn();
  api.actions.register({ id: "act", label: "Act", run });
  api.shortcuts.register("Mod+KeyJ", "act");
  api.menus.addGroupItem("act");
  const status = api.statusBar.add({ text: "x", action: "act" });

  registry.getShortcut("KeyJ")();
  registry.menuItemsFor("group", state.ws.groups[0])[0].onSelect();
  registry.statusItems().at(-1).onClick();
  api.actions.run("act");
  api.actions.run("demo.act");
  assert.equal(run.mock.callCount(), 5);
  assert.equal(registry.menuItemsFor("group", state.ws.groups[0])[0].label, "Act");
  status.dispose();
});

test("a status item with no action isn't clickable, and an update still works", () => {
  const status = api.statusBar.add({ text: "x" });
  assert.equal(registry.statusItems().at(-1).onClick, null);
  status.update({ text: "y" });
  assert.equal(registry.statusItems().at(-1).text, "y");
});

test("a plugin can run a built-in action, by id, on a copy", () => {
  const count = state.ws.tabs.length;
  api.actions.run("tab.duplicate", api.workspace.activeTab());
  assert.equal(state.ws.tabs.length, count + 1);
  api.actions.run("newTab");
  assert.equal(state.ws.tabs.length, count + 2);
  api.menus.addTabItem("tab.duplicate");
  const items = registry.menuItemsFor("tab", store.activeTab());
  assert.equal(items.at(-1).label, "Duplicate");
  items.at(-1).onSelect();
  assert.equal(state.ws.tabs.length, count + 3);
});

test("an enabled check hides a plugin's item", () => {
  api.actions.register({ id: "act", label: "Act", run() {}, enabled: (tab) => tab.name === "yes" });
  api.menus.addTabItem("act");
  assert.deepEqual(registry.menuItemsFor("tab", store.activeTab()), []);
  store.activeTab().name = "yes";
  assert.equal(registry.menuItemsFor("tab", store.activeTab()).length, 1);
});

test("errors in a plugin's action stay in the plugin, and its menu item survives", () => {
  const log = quietly();
  const boom = () => { throw new Error("boom"); };
  api.actions.register({ id: "bad", label: "Bad", run: boom });
  api.actions.register({ id: "badCheck", label: "Bad check", run() {}, enabled: boom });
  api.menus.addTabItem("bad");
  api.menus.addTabItem("badCheck");
  api.shortcuts.register("Mod+KeyJ", "bad");
  registry.getShortcut("KeyJ")();
  const items = registry.menuItemsFor("tab", store.activeTab());
  assert.deepEqual(items.map((i) => i.label), ["Bad"]);
  items[0].onSelect();
  assert.ok(log.mock.callCount() >= 3);
  log.mock.restore();
});

test("an item naming another plugin's action goes once that plugin is off", () => {
  const log = quietly();
  const otherScope = createScope();
  const other = createApi({ id: "other", name: "other" }, otherScope);
  other.actions.register({ id: "act", label: "Act", run() {} });
  api.menus.addTabItem("other.act");
  api.shortcuts.register("Mod+KeyJ", "other.act");
  assert.equal(registry.menuItemsFor("tab", store.activeTab()).length, 1);
  otherScope.dispose();
  assert.deepEqual(registry.menuItemsFor("tab", store.activeTab()), []);
  registry.getShortcut("KeyJ")(); // reported, not thrown
  assert.equal(log.mock.callCount(), 1);
  log.mock.restore();
});

// ---------- bundled plugins and docs ----------
test("the hello plugin works through actions", async () => {
  const { activate } = await import("../plugins/hello/plugin.js");
  activate(open("hello"));

  const live = state.ws.tabs[0];
  store.activateTab(background.id);
  const [item] = registry.menuItemsFor("tab", live);
  assert.equal(item.label, "Say hello");
  item.onSelect();
  assert.equal(live.blocks.at(-1).output, `Hello, ${live.name}!`);

  const counter = registry.statusItems().at(-1);
  assert.match(counter.text, /^\d+ commands$/);
  registry.emit("command:finish", { tab: live, command: "ls", output: "", aborted: false });
  counter.onClick();
  assert.equal(counter.text, "0 commands");
  assert.equal(counter.title, "Commands run. Click to reset.");

  const before = background.blocks.length;
  store.activateTab(live.id);
  registry.getShortcut("Shift+KeyH")();
  assert.equal(live.blocks.at(-1).output, "Hello from a shortcut!");
  assert.equal(background.blocks.length, before);
});

test("the git-branch plugin shows what its host says", async () => {
  const { activate } = await import("../plugins/git-branch/plugin.js");
  const log = quietly();
  const plugin = open("git-branch");
  const calls = [];
  const withHost = { ...plugin, host: { call: async (method, cwd) => { calls.push([method, cwd]); return "main"; } } };
  activate(withHost);
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.deepEqual(calls, [["branch", store.activeTab().cwd]]);
  assert.equal(registry.statusItems().at(-1).text, "⎇ main");
  assert.equal(log.mock.callCount(), 0);
  log.mock.restore();
});

test("docs/plugins.md lists the built-in ids and no old form", () => {
  const docs = fs.readFileSync(new URL("../docs/plugins.md", import.meta.url), "utf8");
  for (const id of actionIds().filter((name) => !name.startsWith("past.") && !name.includes("demo") && !name.startsWith("hello."))) {
    assert.ok(docs.includes(`\`${id}\``), id);
  }
  assert.doesNotMatch(docs, /onSelect|onClick|handler\)$/m);
});
