import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";
import dataStore from "../electron/dataStore.cjs";

const { createDataStore, defaultDataDir } = dataStore;

const dirs = [];
function tempStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-data-"));
  dirs.push(dir);
  return createDataStore(path.join(dir, "data"));
}
afterEach(() => { dirs.splice(0).forEach((dir) => fs.rmSync(dir, { recursive: true, force: true })); });

const batch = (changes = {}) => ({ tabs: [], past: [], removeTabs: [], removePast: [], ...changes });
const layout = { groups: [], tabs: [] };
const modeOf = (file) => fs.statSync(file).mode & 0o777;
const quietly = (fn) => {
  const { warn } = console;
  console.warn = () => {};
  try { return fn(); } finally { console.warn = warn; }
};

test("the folder comes from the env override, and is otherwise next to the plugins", () => {
  assert.equal(defaultDataDir({ TERMEEDOR_DATA_DIR: "/somewhere" }), "/somewhere");
  assert.equal(defaultDataDir({}), path.join(os.homedir(), ".termeedor"));
});

test("an empty folder loads as nothing, and is created private", () => {
  const store = tempStore();
  assert.deepEqual(store.load(), { settings: null, workspace: null, tabs: [], past: [] });
  for (const folder of ["", "tabs", "past"]) assert.equal(modeOf(path.join(store.dir, folder)), 0o700);
});

test("a folder that already exists with wider permissions is tightened", () => {
  const store = tempStore();
  fs.mkdirSync(store.dir, { mode: 0o755 });
  fs.chmodSync(store.dir, 0o755);
  store.load();
  assert.equal(modeOf(store.dir), 0o700);
});

test("what is written loads back, each file private, with the file name as the id", () => {
  const store = tempStore();
  const result = store.write(batch({
    settings: { theme: "dark" },
    workspace: layout,
    tabs: [{ id: "t1", draft: "typed" }],
    past: [{ id: "p1", name: "old" }],
  }));
  assert.deepEqual(result, { ok: true });
  for (const file of ["settings.json", "workspace.json", "tabs/t1.json", "past/p1.json"]) {
    assert.equal(modeOf(path.join(store.dir, file)), 0o600, file);
  }
  assert.deepEqual(store.load(), {
    settings: { theme: "dark" },
    workspace: layout,
    tabs: [{ draft: "typed", id: "t1" }],
    past: [{ name: "old", id: "p1" }],
  });
});

test("removing files removes only those, and a missing one is fine", () => {
  const store = tempStore();
  store.write(batch({ tabs: [{ id: "a" }, { id: "b" }], past: [{ id: "c" }, { id: "d" }] }));
  assert.equal(store.write(batch({ removeTabs: ["a", "gone"], removePast: ["c"] })).ok, true);
  const loaded = store.load();
  assert.deepEqual(loaded.tabs.map((t) => t.id), ["b"]);
  assert.deepEqual(loaded.past.map((p) => p.id), ["d"]);
});

test("no id can leave the folder, and a bad batch changes nothing", () => {
  const store = tempStore();
  store.load();
  for (const id of ["../evil", "..", "a/b", "a\\b", "a.b", "", "x".repeat(21), "a\0b", 7, null]) {
    assert.equal(store.write(batch({ settings: { theme: "x" }, tabs: [{ id }] })).ok, false, `write ${id}`);
    assert.equal(store.write(batch({ removePast: [id] })).ok, false, `remove ${id}`);
  }
  assert.deepEqual(fs.readdirSync(path.dirname(store.dir)), ["data"]);
  assert.deepEqual(fs.readdirSync(store.dir).sort(), ["past", "tabs"]);
});

test("arguments that aren't the right shape are refused", () => {
  const store = tempStore();
  for (const bad of [null, "text", [], {}, batch({ settings: 1 }), batch({ workspace: { groups: [] } }), batch({ tabs: {} }), batch({ removeTabs: "a" }), batch({ seq: 1.5 })]) {
    assert.equal(store.write(bad).ok, false);
  }
});

test("a write leaves no temp file, and leftovers from a crash are cleaned up", () => {
  const store = tempStore();
  store.write(batch({ tabs: [{ id: "t1" }] }));
  assert.deepEqual(fs.readdirSync(path.join(store.dir, "tabs")), ["t1.json"]);
  fs.writeFileSync(path.join(store.dir, "tabs", "t2.json.123.tmp"), "half a fi");
  fs.writeFileSync(path.join(store.dir, "workspace.json.123.tmp"), "half a fi");
  assert.deepEqual(store.load().tabs.map((t) => t.id), ["t1"]);
  assert.deepEqual(fs.readdirSync(path.join(store.dir, "tabs")), ["t1.json"]);
  assert.deepEqual(fs.readdirSync(store.dir).sort(), ["past", "tabs"]);
});

test("a failed write keeps the old file and reports the error", () => {
  const store = tempStore();
  store.write(batch({ tabs: [{ id: "t1", draft: "old" }] }));
  const rename = fs.renameSync;
  fs.renameSync = () => { throw new Error("disk trouble"); };
  try {
    assert.deepEqual(store.write(batch({ tabs: [{ id: "t1", draft: "new" }] })), { ok: false, error: "disk trouble" });
  } finally {
    fs.renameSync = rename;
  }
  assert.equal(store.load().tabs[0].draft, "old");
  assert.deepEqual(fs.readdirSync(path.join(store.dir, "tabs")), ["t1.json"]);
});

test("a failure stops the batch before workspace.json and before anything is removed", () => {
  const store = tempStore();
  store.write(batch({ tabs: [{ id: "closing" }] }));
  fs.mkdirSync(path.join(store.dir, "tabs", "blocked.json")); // a rename onto a folder fails
  const result = store.write(batch({ workspace: layout, tabs: [{ id: "blocked" }], removeTabs: ["closing"] }));
  assert.equal(result.ok, false);
  assert.equal(fs.existsSync(path.join(store.dir, "workspace.json")), false);
  assert.equal(fs.existsSync(path.join(store.dir, "tabs", "closing.json")), true);
});

test("corrupt files are skipped and kept aside, and loading goes on", () => {
  const store = tempStore();
  store.write(batch({ settings: { theme: "dark" }, workspace: layout, tabs: [{ id: "good" }, { id: "bad" }], past: [{ id: "worse" }] }));
  fs.writeFileSync(path.join(store.dir, "workspace.json"), "{ not json");
  fs.writeFileSync(path.join(store.dir, "tabs", "bad.json"), "[1, 2]");
  fs.writeFileSync(path.join(store.dir, "past", "worse.json"), "");

  const loaded = quietly(() => store.load());
  assert.equal(loaded.workspace, null);
  assert.deepEqual(loaded.settings, { theme: "dark" });
  assert.deepEqual(loaded.tabs.map((t) => t.id), ["good"]);
  assert.deepEqual(loaded.past, []);

  const aside = fs.readdirSync(path.join(store.dir, "tabs")).find((name) => name.startsWith("bad.json.corrupt-"));
  assert.equal(fs.readFileSync(path.join(store.dir, "tabs", aside), "utf8"), "[1, 2]");
  assert.ok(fs.readdirSync(store.dir).some((name) => name.startsWith("workspace.json.corrupt-")));
  assert.ok(fs.readdirSync(path.join(store.dir, "past")).some((name) => name.startsWith("worse.json.corrupt-")));

  assert.deepEqual(store.load().tabs.map((t) => t.id), ["good"]); // and it isn't picked up again
});

test("a workspace of the wrong shape is kept aside too", () => {
  const store = tempStore();
  store.load();
  fs.writeFileSync(path.join(store.dir, "workspace.json"), '{"groups":1}');
  assert.equal(quietly(() => store.load()).workspace, null);
  assert.ok(fs.readdirSync(store.dir).some((name) => name.startsWith("workspace.json.corrupt-")));
});

test("a symlink in the folder is not followed", () => {
  const store = tempStore();
  store.load();
  const outside = path.join(path.dirname(store.dir), "secret.json");
  fs.writeFileSync(outside, '{"draft":"secret"}');
  fs.symlinkSync(outside, path.join(store.dir, "tabs", "link.json"));
  assert.deepEqual(quietly(() => store.load()).tabs, []);
  assert.equal(fs.readFileSync(outside, "utf8"), '{"draft":"secret"}');
});

test("an older batch arriving after a newer one is refused, and a new page starts over", () => {
  const store = tempStore();
  assert.equal(store.write(batch({ seq: 5, tabs: [{ id: "t", draft: "new" }] })).ok, true);
  assert.deepEqual(store.write(batch({ seq: 4, tabs: [{ id: "t", draft: "old" }] })), { ok: false, stale: true });
  assert.equal(store.load().tabs[0].draft, "new");
  assert.equal(store.write(batch({ seq: 1, tabs: [{ id: "t", draft: "after reload" }] })).ok, true);
});
