// The real adapters, with the real data store over a temp folder standing in for the main process.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, test } from "node:test";
import dataStore from "../electron/dataStore.cjs";
import { STORAGE_KEYS } from "../src/constants.js";
import { chooseAdapter } from "../src/adapters/index.js";
import { createFileAdapter } from "../src/adapters/fileStore.js";
import { createLocalStorageAdapter } from "../src/adapters/localStorageStore.js";
import { readSnapshot } from "../src/core/saved.js";
import { createSaver } from "../src/core/saver.js";

let dir;
let store;
const hostFor = (data) => ({
  load: async () => data.load(),
  write: async (changes) => data.write(changes),
  writeSync: (changes) => data.write(changes),
});

function fakeLocalStorage(initial = {}) {
  const items = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]));
  globalThis.localStorage = {
    items,
    getItem: (key) => items.get(key) ?? null,
    setItem: (key, value) => { items.set(key, value); },
    removeItem: (key) => { items.delete(key); },
  };
  return items;
}

const { warn } = console;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-adapters-"));
  store = dataStore.createDataStore(dir);
  console.warn = () => {};
});
afterEach(() => {
  console.warn = warn;
  fs.rmSync(dir, { recursive: true, force: true });
  delete globalThis.localStorage;
});

const readJson = (...parts) => JSON.parse(fs.readFileSync(path.join(dir, ...parts), "utf8"));

const legacyData = () => ({
  [STORAGE_KEYS.workspace]: {
    groups: [{ id: "g1", name: "Group" }],
    activeTab: "t1",
    tabs: [
      { id: "t1", groupId: "g1", name: "new", color: "c2", blocks: [{ command: "ls", output: "file", exit: 0, cwd: "~" }], draft: "typed", cwd: "/x", history: ["ls"] },
      { id: "t2", groupId: "g1", name: "old", content: "❯ ls\nfile\n❯ half" },
    ],
  },
  [STORAGE_KEYS.past]: [{ id: "p1", name: "closed", closedAt: 9, tab: { content: "bye" } }, { id: "p2", name: "older", closedAt: 9, tab: {} }],
  [STORAGE_KEYS.settings]: { theme: "dark", fontSize: 15 },
});

// ---------- choosing ----------
test("the desktop host chooses files, and its absence chooses localStorage", async () => {
  const items = fakeLocalStorage({ [STORAGE_KEYS.settings]: { theme: "paper" } });
  const browser = await chooseAdapter(undefined).load();
  assert.equal(browser.settings.theme, "paper");
  assert.equal(items.size, 1);

  store.write({ settings: { theme: "ocean" }, tabs: [], past: [], removeTabs: [], removePast: [] });
  fakeLocalStorage();
  const desktop = await chooseAdapter(hostFor(store)).load();
  assert.equal(desktop.settings.theme, "ocean");
});

// ---------- migration ----------
test("first run: everything moves to files, old content migrates, and the old keys go", async () => {
  const items = fakeLocalStorage(legacyData());
  const pluginKey = "termeedor.plugin.demo.value";
  items.set(pluginKey, "1");

  const snapshot = await createFileAdapter(hostFor(store)).load();

  assert.deepEqual([...items.keys()], [pluginKey]); // plugins' api.storage stays
  assert.equal(readJson("settings.json").theme, "dark");
  const layout = readJson("workspace.json");
  assert.deepEqual(layout.tabs.map((t) => t.id), ["t1", "t2"]);
  assert.equal(layout.tabs[0].color, "c2");
  assert.ok(!("blocks" in layout.tabs[0]));
  assert.equal(readJson("tabs", "t1.json").blocks[0].command, "ls");
  assert.equal(readJson("tabs", "t1.json").cwd, "/x");
  assert.deepEqual(readJson("tabs", "t2.json").blocks.map((b) => b.output), ["❯ ls\nfile"]);
  assert.equal(readJson("tabs", "t2.json").draft, "half");
  assert.equal(readJson("past", "p1.json").tab.blocks[0].output, "bye");

  const { ws, past } = readSnapshot(snapshot);
  assert.deepEqual(ws.tabs.map((t) => t.name), ["new", "old"]);
  assert.deepEqual(past.map((p) => p.id), ["p1", "p2"]); // tied times keep their order
  assert.deepEqual(snapshot.files.tabs.sort(), ["t1", "t2"]);
  assert.equal(snapshot.unsaved, undefined);
});

test("the second run reads the files and doesn't migrate again", async () => {
  fakeLocalStorage(legacyData());
  await createFileAdapter(hostFor(store)).load();
  let writes = 0;
  const host = hostFor(store);
  const counted = { ...host, write: (changes) => { writes++; return host.write(changes); } };
  const snapshot = await createFileAdapter(counted).load();
  assert.equal(writes, 0);
  assert.equal(readSnapshot(snapshot).ws.tabs.length, 2);
});

test("a failed migration leaves the old keys, runs from them, and reports it", async () => {
  const items = fakeLocalStorage(legacyData());
  const failing = { ...hostFor(store), write: async () => ({ ok: false, error: "disk full" }) };
  const snapshot = await createFileAdapter(failing).load();
  assert.equal(items.size, 3);
  assert.equal(snapshot.saveFailed, true);
  assert.equal(snapshot.unsaved, true);
  assert.equal(readSnapshot(snapshot).ws.tabs[1].draft, "half");
});

test("a migration that dies partway leaves the old keys, and a later run finishes it", async () => {
  const items = fakeLocalStorage(legacyData());
  const host = hostFor(store);
  const blocked = {
    ...host,
    write(changes) {
      fs.mkdirSync(path.join(dir, "tabs", "t2.json")); // renaming onto a folder fails
      return host.write(changes);
    },
  };

  const failed = await createFileAdapter(blocked).load();
  assert.equal(items.size, 3);
  assert.equal(failed.saveFailed, true);
  assert.equal(fs.existsSync(path.join(dir, "workspace.json")), false);

  fs.rmSync(path.join(dir, "tabs", "t2.json"), { recursive: true });
  const retried = await createFileAdapter(hostFor(store)).load();
  assert.equal(items.size, 0);
  assert.equal(readSnapshot(retried).ws.tabs.length, 2);
});

test("a host that rejects during migration also leaves the old keys", async () => {
  const items = fakeLocalStorage(legacyData());
  const failing = { ...hostFor(store), write: () => Promise.reject(new Error("gone")) };
  await createFileAdapter(failing).load();
  assert.equal(items.size, 3);
});

test("files that were written but can't be read back also leave the old keys", async () => {
  const items = fakeLocalStorage(legacyData());
  const host = hostFor(store);
  let writes = 0;
  const unreadable = {
    ...host,
    write: (changes) => { writes++; return host.write(changes); },
    load: async () => {
      const loaded = store.load();
      return writes ? { ...loaded, tabs: loaded.tabs.slice(1) } : loaded;
    },
  };
  const snapshot = await createFileAdapter(unreadable).load();
  assert.equal(items.size, 3);
  assert.equal(snapshot.saveFailed, true);
});

test("after a failed migration, the first save that works writes everything", async () => {
  fakeLocalStorage(legacyData());
  const host = hostFor(store);
  let fail = true;
  const adapter = createFileAdapter({ ...host, write: (changes) => (fail ? Promise.resolve({ ok: false }) : host.write(changes)) });
  const snapshot = await adapter.load();
  const data = readSnapshot(snapshot);
  const saver = createSaver({ adapter, read: () => data });
  saver.seed(snapshot);
  assert.equal(saver.hasFailed(), true);

  fail = false;
  saver.save(["workspace"]);
  await new Promise(setImmediate);
  assert.equal(saver.hasFailed(), false);
  assert.equal(readJson("workspace.json").tabs.length, 2);
  assert.equal(readJson("tabs", "t2.json").draft, "half");
  assert.equal(readJson("past", "p1.json").name, "closed");
  assert.equal(readJson("settings.json").theme, "dark");
});

test("old keys left over beside a saved workspace lose to it, and are removed", async () => {
  store.write({ workspace: { groups: [{ id: "g", name: "Files" }], tabs: [] }, tabs: [], past: [], removeTabs: [], removePast: [] });
  const items = fakeLocalStorage(legacyData());
  const snapshot = await createFileAdapter(hostFor(store)).load();
  assert.equal(snapshot.workspace.groups[0].name, "Files");
  assert.equal(items.size, 0);
});

test("if workspace.json is corrupt, old keys still there are used again", async () => {
  store.load();
  fs.writeFileSync(path.join(dir, "workspace.json"), "{");
  fakeLocalStorage(legacyData());
  const snapshot = await createFileAdapter(hostFor(store)).load();
  assert.equal(readSnapshot(snapshot).ws.tabs.length, 2);
});

test("an old key that can't be used is left alone and doesn't count as data", async () => {
  const items = fakeLocalStorage({ [STORAGE_KEYS.settings]: { theme: "dark" } });
  items.set(STORAGE_KEYS.workspace, "{ not json");
  const snapshot = await createFileAdapter(hostFor(store)).load();
  assert.equal(readSnapshot(snapshot).settings.theme, "dark");
  assert.deepEqual([...items.keys()], [STORAGE_KEYS.workspace]);
  assert.equal(snapshot.workspace, null);

  const again = await createFileAdapter(hostFor(store)).load();
  assert.equal(again.unsaved, undefined);
});

test("with no old data and no files, nothing is written and no keys are touched", async () => {
  fakeLocalStorage();
  const snapshot = await createFileAdapter(hostFor(store)).load();
  assert.deepEqual(readSnapshot(snapshot).past, []);
  assert.equal(readSnapshot(snapshot).ws, null);
  assert.deepEqual(fs.readdirSync(dir).sort(), ["past", "tabs"]);
});

test("a failed synchronous write reports false, and so does a stale one", () => {
  const adapter = createFileAdapter({ writeSync: () => ({ ok: false, error: "x" }) });
  assert.equal(adapter.writeSync({}), false);
  const stale = createFileAdapter({ writeSync: () => ({ ok: false, stale: true }) });
  assert.equal(stale.writeSync({}), false);
});

// ---------- localStorage ----------
test("browser build: tabs stay inside the workspace key, and past stays one list", async () => {
  const items = fakeLocalStorage(legacyData());
  const adapter = createLocalStorageAdapter();
  const snapshot = await adapter.load();
  const data = readSnapshot(snapshot);
  const saver = createSaver({ adapter, read: () => data });
  saver.seed(snapshot);

  data.ws.tabs[0].draft = "changed";
  saver.save(["workspace"]);

  const saved = JSON.parse(items.get(STORAGE_KEYS.workspace));
  assert.equal(saved.tabs[0].draft, "changed");
  assert.equal(saved.tabs[1].draft, "half");
  assert.equal(saved.tabs[0].blocks[0].command, "ls");
  assert.deepEqual(JSON.parse(items.get(STORAGE_KEYS.past)).map((p) => p.id), ["p1", "p2"]);

  // Later saves send only what changed, and the key still holds it all.
  data.ws.tabs[1].draft = "again";
  saver.save(["workspace"]);
  const later = JSON.parse(items.get(STORAGE_KEYS.workspace));
  assert.equal(later.tabs[0].draft, "changed");
  assert.equal(later.tabs[1].draft, "again");

  // It loads back.
  const reloaded = readSnapshot(await createLocalStorageAdapter().load());
  assert.equal(reloaded.ws.tabs[1].draft, "again");
});

test("browser build: a full localStorage reports failure", () => {
  fakeLocalStorage();
  globalThis.localStorage.setItem = () => { throw new Error("quota"); };
  const adapter = createLocalStorageAdapter();
  assert.equal(adapter.write({ settings: {}, tabs: [], past: [], removeTabs: [], removePast: [] }), false);
});
