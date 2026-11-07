// The real store.js on the file adapter, with the real data store over a temp folder standing in
// for the main process. Only IPC and Electron's own unload behavior are left out.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import dataStore from "../electron/dataStore.cjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-store-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));
const data = dataStore.createDataStore(dir);

// Saved before the store loads: a corrupt tab must not stop it, and an orphan must not be lost.
data.write({
  settings: { theme: "dark", fontSize: 15 },
  workspace: { groups: [{ id: "g1", name: "Saved" }], tabs: [{ id: "t1", groupId: "g1", name: "first" }, { id: "t2", groupId: "g1", name: "second" }, { id: "t3", groupId: "g1", name: "broken" }], activeTab: "t1" },
  tabs: [
    { id: "t1", blocks: [{ command: "ls", output: "one", exit: 0, cwd: "~" }], draft: "", cwd: "/a", history: ["ls"] },
    { id: "t2", blocks: [{ command: null, output: "two", exit: null, cwd: null }], draft: "", cwd: "/b", history: [] },
    { id: "lost", blocks: [{ command: null, output: "orphaned", exit: null, cwd: null }], draft: "", cwd: "/c", history: [] },
  ],
  past: [],
  removeTabs: [],
  removePast: [],
});
fs.writeFileSync(path.join(dir, "tabs", "t3.json"), "{ corrupt");

globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} }; // nothing to migrate

let hostWrites = 0;
let syncWrites = 0;
let failWrites = false;
const refuse = { ok: false, error: "disk full" };
globalThis.termeedorHost = {
  data: {
    load: async () => data.load(),
    write: async (changes) => { hostWrites++; return failWrites ? refuse : data.write(changes); },
    writeSync: (changes) => { syncWrites++; return failWrites ? refuse : data.write(changes); },
  },
};

const { warn } = console;
console.warn = () => {};
const store = await import("../src/store.js");
console.warn = warn;

const settled = () => new Promise(setImmediate);
const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(dir, ...parts), "utf8"));
const file = (...parts) => path.join(dir, ...parts);
const stamp = (name, when = 1000) => fs.utimesSync(file(name), when, when);
const changed = (name) => fs.statSync(file(name)).mtimeMs !== 1000 * 1000;

test("loading finished before the import did, past a corrupt file", () => {
  assert.equal(store.state.settings.theme, "dark");
  assert.deepEqual(store.state.ws.tabs.map((t) => t.name), ["first", "second", "broken"]);
  assert.equal(store.state.ws.tabs[0].blocks[0].output, "one");
  assert.deepEqual(store.state.ws.tabs[2].blocks, []);
  assert.equal(store.activeTab().id, "t1");
  assert.ok(fs.readdirSync(file("tabs")).some((name) => name.startsWith("t3.json.corrupt-")));
  assert.equal(store.hasSaveFailed(), false);
});

test("a tab file no layout mentions came back as a past session", async () => {
  assert.equal(store.state.past[0].tab.blocks[0].output, "orphaned");
  store.commit();
  await settled();
  assert.equal(fs.existsSync(file("tabs", "lost.json")), false);
  assert.equal(readJson("past", "lost.json").tab.cwd, "/c");
});

test("a command's output rewrites only that tab's file", async () => {
  await settled();
  for (const name of ["workspace.json", "settings.json", "tabs/t1.json", "tabs/t2.json"]) {
    if (fs.existsSync(file(name))) stamp(name);
  }
  const before = hostWrites;
  store.getTab("t2").blocks[0].output += "\nmore";
  store.commit();
  await settled();
  assert.equal(hostWrites, before + 1);
  assert.equal(changed("tabs/t2.json"), true);
  assert.equal(changed("tabs/t1.json"), false);
  assert.equal(changed("workspace.json"), false);
  assert.equal(readJson("tabs", "t2.json").blocks[0].output, "two\nmore");
});

test("a rename rewrites only workspace.json, which holds no scrollback", async () => {
  stamp("tabs/t1.json");
  stamp("tabs/t2.json");
  store.renameItem("tab", store.getTab("t1"), "renamed");
  await settled();
  assert.equal(changed("tabs/t1.json"), false);
  assert.equal(changed("tabs/t2.json"), false);
  const layout = readJson("workspace.json");
  assert.equal(layout.tabs[0].name, "renamed");
  assert.ok(!JSON.stringify(layout).includes("two"));
});

test("closing moves a tab to past, removing its file, and deleting removes the past file", async () => {
  store.closeTab(store.getTab("t2"));
  await settled();
  assert.equal(fs.existsSync(file("tabs", "t2.json")), false);
  const entry = store.state.past[0];
  assert.equal(readJson("past", `${entry.id}.json`).tab.blocks[0].output, "two\nmore");
  store.deletePast(entry);
  await settled();
  assert.equal(fs.existsSync(file("past", `${entry.id}.json`)), false);
});

test("the final save of typing that was still waiting is written before it returns", async () => {
  store.getTab("t1").draft = "unsaved typing";
  store.saveSoon();
  const before = syncWrites;
  assert.equal(store.saveNow({ type: "beforeunload" }), true);
  assert.equal(syncWrites, before + 1);
  assert.equal(readJson("tabs", "t1.json").draft, "unsaved typing"); // read straight away
});

test("the final save also wins over a batch still on its way", async () => {
  store.getTab("t1").draft = "first";
  store.commit();
  store.getTab("t1").draft = "second";
  store.saveNow();
  assert.equal(readJson("tabs", "t1.json").draft, "second");
  await settled();
  assert.equal(readJson("tabs", "t1.json").draft, "second");
});

test("a later window's load sees all of it", () => {
  const loaded = dataStore.createDataStore(dir).load();
  assert.equal(loaded.tabs.find((t) => t.id === "t1").draft, "second");
  assert.ok(!loaded.tabs.some((t) => t.id === "t2"));
});

test("failed saves show through hasSaveFailed, then clear", async () => {
  console.warn = () => {};
  try {
    failWrites = true;
    store.getTab("t1").draft = "x";
    store.commit();
    await settled();
    assert.equal(store.hasSaveFailed(), true);

    failWrites = false;
    store.commit();
    await settled();
    assert.equal(store.hasSaveFailed(), false);
    assert.equal(readJson("tabs", "t1.json").draft, "x");
  } finally {
    console.warn = warn;
  }
});

test("a theme is saved before the action returns, and undone with an error if that failed", () => {
  const theme = { id: "c-mine", name: "Mine", css: "", source: null, preview: ["#000", "#000", "#000"] };
  store.addCustomTheme(theme);
  assert.equal(readJson("settings.json").theme, "c-mine");

  console.warn = () => {};
  try {
    failWrites = true;
    assert.throws(() => store.updateCustomTheme({ ...theme, name: "Changed" }), /not saved/);
    assert.equal(store.state.settings.customThemes[0].name, "Mine");
  } finally {
    failWrites = false;
    console.warn = warn;
  }
  assert.equal(readJson("settings.json").customThemes[0].name, "Mine");
});

test("everything stored is private", () => {
  const walk = (folder) => fs.readdirSync(folder, { withFileTypes: true }).flatMap((item) => {
    const full = path.join(folder, item.name);
    return item.isDirectory() ? [full, ...walk(full)] : [full];
  });
  for (const item of walk(dir)) {
    const expected = fs.statSync(item).isDirectory() ? 0o700 : 0o600;
    if (item.includes(".corrupt-")) continue; // written by this test, not by the app
    assert.equal(fs.statSync(item).mode & 0o777, expected, item);
  }
});
