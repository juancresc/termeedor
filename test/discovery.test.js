import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { beforeEach, test } from "node:test";

const { discoverPlugins, resolveInside } = createRequire(import.meta.url)("../electron/plugins.cjs");

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), "termeedor-"));
});

function addPlugin(base, id, files = { "plugin.js": "" }) {
  const dir = path.join(base, id);
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, content] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), content);
  return dir;
}
const scan = (dir = root, source = "user") => discoverPlugins([{ dir, source }]);

test("a folder with plugin.js is a plugin; the manifest is optional", () => {
  addPlugin(root, "bare");
  const [plugin] = scan();
  assert.equal(plugin.id, "bare");
  assert.equal(plugin.name, "bare");
  assert.equal(plugin.entry, "/plugins/bare/plugin.js");
  assert.equal(plugin.error, null);
});

test("manifest fields are read, including a custom entry file", () => {
  addPlugin(root, "full", {
    "plugin.json": JSON.stringify({ name: "Full", version: "2.0.0", description: "d", main: "start.js" }),
    "start.js": "",
  });
  const [plugin] = scan();
  assert.deepEqual([plugin.name, plugin.version, plugin.description, plugin.entry], ["Full", "2.0.0", "d", "/plugins/full/start.js"]);
});

test("broken plugins are listed with an error instead of disappearing", () => {
  addPlugin(root, "badjson", { "plugin.json": "{nope", "plugin.js": "" });
  addPlugin(root, "noentry", { "readme.md": "" });
  addPlugin(root, "future", { "plugin.json": '{"apiVersion": 99}', "plugin.js": "" });
  addPlugin(root, "bad name");
  const errors = Object.fromEntries(scan().map((p) => [p.id, p.error]));
  assert.match(errors.badjson, /plugin\.json/);
  assert.match(errors.noentry, /Entry file not found/);
  assert.match(errors.future, /API 99/);
  assert.match(errors["bad name"], /Folder name/);
  assert.ok(scan().every((p) => p.entry === null));
});

test("an entry file outside the plugin folder is refused", () => {
  fs.writeFileSync(path.join(root, "outside.js"), "");
  addPlugin(root, "escape", { "plugin.json": '{"main": "../outside.js"}' });
  assert.match(scan()[0].error, /Entry file not found/);
});

test("files and hidden folders are ignored; a missing root is fine", () => {
  fs.writeFileSync(path.join(root, "loose.js"), "");
  addPlugin(root, ".hidden");
  assert.deepEqual(scan(), []);
  assert.deepEqual(scan(path.join(root, "missing")), []);
});

test("a later root replaces an earlier plugin with the same id", () => {
  const bundled = path.join(root, "bundled");
  const user = path.join(root, "user");
  addPlugin(bundled, "same");
  addPlugin(bundled, "only-bundled");
  addPlugin(user, "same");
  const list = discoverPlugins([{ dir: bundled, source: "bundled" }, { dir: user, source: "user" }]);
  assert.deepEqual(list.map((p) => [p.id, p.source]), [["only-bundled", "bundled"], ["same", "user"]]);
});

test("a symlinked plugin folder works", () => {
  const real = addPlugin(path.join(root, "elsewhere"), "linked");
  const plugins = path.join(root, "plugins");
  fs.mkdirSync(plugins);
  fs.symlinkSync(real, path.join(plugins, "linked"));
  const [plugin] = scan(plugins);
  assert.equal(plugin.error, null);
  assert.ok(resolveInside(plugin.dir, "plugin.js"));
});

test("resolveInside blocks traversal and symlinks that leave the folder", () => {
  const dir = addPlugin(root, "p", { "plugin.js": "" });
  fs.writeFileSync(path.join(root, "secret.txt"), "");
  fs.symlinkSync(path.join(root, "secret.txt"), path.join(dir, "link.txt"));
  assert.ok(resolveInside(dir, "plugin.js"));
  assert.equal(resolveInside(dir, "../secret.txt"), null);
  assert.equal(resolveInside(dir, "link.txt"), null);
  assert.equal(resolveInside(dir, "missing.js"), null);
  assert.equal(resolveInside(dir, path.join(root, "secret.txt")), null);
  assert.equal(resolveInside(dir, "."), null);
});
