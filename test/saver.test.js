import assert from "node:assert/strict";
import { test } from "node:test";
import { createSaver } from "../src/core/saver.js";

const tab = (id, output = "text") => ({
  id, groupId: "g", name: id, color: null, collapsed: false, minimized: false,
  blocks: [{ command: null, output, exit: null, cwd: null }], draft: "", cwd: "~", history: [],
});
const entry = (id) => ({ id, name: id, closedAt: 1, tab: { color: null, ...tab(id) } });

function setup({ onDisk = false } = {}) {
  const state = {
    ws: { groups: [{ id: "g", name: "G" }], tabs: [tab("a"), tab("b")], activeTab: "a", activeGroup: "g", sidebarOpen: true, sidebarWidth: 240 },
    past: [],
    settings: { theme: "default" },
  };
  const writes = [];
  const adapter = {
    result: true,
    write(changes) { writes.push(changes); return adapter.result; },
    writeSync(changes) { writes.push({ ...changes, sync: true }); return adapter.result; },
  };
  let statusChanges = 0;
  const saver = createSaver({ adapter, read: () => state, onStatus: () => { statusChanges++; } });
  if (onDisk) saver.seed({ files: { settings: true, workspace: true, tabs: ["a", "b"], past: [] } });
  return { state, writes, adapter, saver, statusChanges: () => statusChanges };
}
const ids = (files) => files.map((f) => f.id);

test("nothing is written when nothing changed since loading", () => {
  const { saver, writes } = setup({ onDisk: true });
  saver.save(["workspace", "past", "settings"]);
  assert.deepEqual(writes, []);
});

test("one tab's new output writes only that tab, and not the layout", () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.ws.tabs[1].blocks[0].output += "\nmore";
  saver.save(["workspace"]);
  assert.equal(writes.length, 1);
  assert.deepEqual(ids(writes[0].tabs), ["b"]);
  assert.equal(writes[0].workspace, undefined);
  saver.save(["workspace"]);
  assert.equal(writes.length, 1); // and it isn't written again
});

test("output replaced by the same length of other text counts as a change", () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.ws.tabs[0].blocks[0].output = "TEXT";
  saver.save(["workspace"]);
  assert.deepEqual(ids(writes[0].tabs), ["a"]);
});

test("a draft, cwd or history change is a change to that tab", () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.ws.tabs[0].draft = "x";
  saver.save(["workspace"]);
  state.ws.tabs[1].cwd = "/y";
  saver.save(["workspace"]);
  state.ws.tabs[0].history.push("ls");
  saver.save(["workspace"]);
  assert.deepEqual(writes.map((w) => ids(w.tabs)), [["a"], ["b"], ["a"]]);
});

test("a layout change writes the layout, with no scrollback in it, and no tab", () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.ws.tabs[0].name = "renamed";
  saver.save(["workspace"]);
  assert.deepEqual(writes[0].tabs, []);
  assert.equal(writes[0].workspace.tabs[0].name, "renamed");
  for (const saved of writes[0].workspace.tabs) {
    for (const field of ["blocks", "draft", "history", "cwd"]) assert.ok(!(field in saved), field);
  }
});

test("closing a tab removes its file and writes one past entry", () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.ws.tabs.shift();
  state.past.unshift(entry("p1"));
  saver.save(["workspace", "past"]);
  assert.deepEqual(writes[0].removeTabs, ["a"]);
  assert.deepEqual(ids(writes[0].past), ["p1"]);
  assert.deepEqual(writes[0].tabs, []);

  state.past = [];
  saver.save(["past"]);
  assert.deepEqual(writes[1].removePast, ["p1"]);
});

test("a tab with no file yet is written, even if nothing about it changed", () => {
  const { saver, writes } = setup();
  saver.seed({ files: { workspace: true, tabs: ["a"] } });
  saver.save(["workspace"]);
  assert.deepEqual(ids(writes[0].tabs), ["b"]);
});

test("settings are only looked at when asked for, and written alone", () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.settings.theme = "dark";
  saver.save(["workspace"]);
  assert.deepEqual(writes, []);
  saver.save(["settings"]);
  assert.equal(writes[0].settings.theme, "dark");
  assert.deepEqual(writes[0].tabs, []);
});

test("`unsaved` writes everything at the next save and removes stale files", () => {
  const { state, saver, writes } = setup();
  state.past = [entry("p1")];
  saver.seed({ unsaved: true, files: { tabs: ["a", "stale"], past: [] } });
  saver.save(["workspace"]);
  assert.ok(writes[0].settings);
  assert.ok(writes[0].workspace);
  assert.deepEqual(ids(writes[0].tabs), ["a", "b"]);
  assert.deepEqual(ids(writes[0].past), ["p1"]);
  assert.deepEqual(writes[0].removeTabs, ["stale"]);
});

test("recovered files are saved and removed by the next save, whichever part it is", () => {
  const { state, saver, writes } = setup();
  state.past = [entry("orphan")];
  saver.seed({ files: { settings: true, workspace: true, tabs: ["a", "b", "orphan"], past: [] } }, true);
  saver.saveNow();
  assert.deepEqual(ids(writes[0].past), ["orphan"]);
  assert.deepEqual(writes[0].removeTabs, ["orphan"]);
});

test("a failure is reported once, kept for the next save, and clears when that works", () => {
  const { state, saver, writes, adapter, statusChanges } = setup({ onDisk: true });
  adapter.result = false;
  state.ws.tabs[0].draft = "x";
  state.settings.theme = "dark";
  saver.save(["workspace", "settings"]);
  assert.equal(saver.hasFailed(), true);
  assert.equal(statusChanges(), 1);
  assert.equal(writes.length, 1); // it doesn't spin

  saver.save(["workspace"]);
  assert.equal(statusChanges(), 1);

  adapter.result = true;
  saver.save(["workspace"]);
  assert.equal(saver.hasFailed(), false);
  assert.equal(statusChanges(), 2);
  assert.equal(writes.at(-1).settings.theme, "dark"); // the failed settings went too
  assert.deepEqual(ids(writes.at(-1).tabs), ["a"]);
});

test("a thrown or rejected save counts as a failed one", async () => {
  const { state, saver, adapter } = setup({ onDisk: true });
  const { warn } = console;
  console.warn = () => {};
  try {
    adapter.write = () => { throw new Error("no"); };
    state.ws.tabs[0].draft = "x";
    saver.save(["workspace"]);
    assert.equal(saver.hasFailed(), true);

    adapter.write = () => Promise.reject(new Error("no"));
    saver.save(["workspace"]);
    await new Promise(setImmediate);
    assert.equal(saver.hasFailed(), true);

    adapter.write = () => Promise.resolve(true);
    saver.save(["workspace"]);
    await new Promise(setImmediate);
    assert.equal(saver.hasFailed(), false);
  } finally {
    console.warn = warn;
  }
});

/** An adapter whose async writes finish when the test says so. */
function slowSetup() {
  const context = setup({ onDisk: true });
  const finish = [];
  context.adapter.write = (changes) => {
    context.writes.push(changes);
    return new Promise((resolve) => { finish.push(resolve); });
  };
  return { ...context, finish };
}

test("one write at a time: saves that arrive meanwhile become one later batch", async () => {
  const { state, saver, writes, finish } = slowSetup();
  state.ws.tabs[0].draft = "1";
  saver.save(["workspace"]);
  state.ws.tabs[0].draft = "2";
  saver.save(["workspace"]);
  state.ws.tabs[1].draft = "3";
  saver.save(["workspace"]);
  assert.equal(writes.length, 1);

  finish.shift()(true);
  await new Promise(setImmediate);
  assert.equal(writes.length, 2);
  assert.deepEqual(ids(writes[1].tabs), ["a", "b"]);
  assert.equal(writes[1].tabs[0].draft, "2");
  assert.ok(writes[1].seq > writes[0].seq);
});

test("saveNow writes synchronously and carries what is pending and what is in flight", async () => {
  const { state, saver, writes, finish } = slowSetup();
  state.ws.tabs[0].draft = "in flight";
  state.past.unshift(entry("p1"));
  saver.save(["workspace", "past"]);

  state.ws.tabs[1].draft = "typed since";
  saver.saveSoon();
  assert.equal(saver.saveNow(), true);

  const final = writes.at(-1);
  assert.equal(final.sync, true);
  assert.deepEqual(ids(final.tabs), ["a", "b"]);
  assert.deepEqual(ids(final.past), ["p1"]);

  // The older batch finishing, or being refused as stale, changes nothing.
  finish.shift()(false);
  await new Promise(setImmediate);
  assert.equal(saver.hasFailed(), false);
  const count = writes.length;
  saver.save(["workspace", "past"]);
  assert.equal(writes.length, count);
});

test("saveNow cancels the debounced save", async () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.ws.tabs[0].draft = "x";
  saver.saveSoon();
  saver.saveNow();
  assert.equal(writes.length, 1);
  await new Promise((resolve) => { setTimeout(resolve, 350); });
  assert.equal(writes.length, 1);
});

test("saveSoon waits for a pause, then saves", async () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.ws.tabs[0].draft = "x";
  saver.saveSoon();
  assert.equal(writes.length, 0);
  await new Promise((resolve) => { setTimeout(resolve, 350); });
  assert.deepEqual(ids(writes[0].tabs), ["a"]);
});

test("saveNow reports failure, and what it carried is sent again", () => {
  const { state, saver, writes, adapter } = setup({ onDisk: true });
  adapter.result = false;
  state.ws.tabs[0].draft = "x";
  assert.equal(saver.saveNow(), false);
  assert.equal(saver.hasFailed(), true);
  adapter.result = true;
  assert.equal(saver.saveNow(), true);
  assert.deepEqual(ids(writes.at(-1).tabs), ["a"]);
});

test("saveNow can be asked for settings too, as saving a theme does", () => {
  const { state, saver, writes } = setup({ onDisk: true });
  state.settings.theme = "c-mine";
  assert.equal(saver.saveNow(["settings"]), true);
  assert.equal(writes[0].settings.theme, "c-mine");
});
