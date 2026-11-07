import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { before, test } from "node:test";

const { complete } = createRequire(import.meta.url)("../electron/completions.cjs");

let cwd, bin;
before(() => {
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-complete-"));
  bin = path.join(cwd, "bin");
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, "zzrun"), "", { mode: 0o755 });
  fs.writeFileSync(path.join(bin, "zznotexec"), "", { mode: 0o644 });
  fs.mkdirSync(path.join(cwd, "src"));
  fs.mkdirSync(path.join(cwd, "my dir"));
  fs.writeFileSync(path.join(cwd, "src", "main.js"), "");
  fs.writeFileSync(path.join(cwd, "readme.md"), "");
  fs.writeFileSync(path.join(cwd, ".hidden"), "");
});

const values = (input) => complete(input, cwd, bin).map((item) => item.value);

test("the first word completes from executables on PATH", () => {
  assert.deepEqual(values("zz"), ["zzrun "]);
  assert.deepEqual(values("ls | zz"), ["ls | zzrun "]);
});

test("later words complete paths, folders with a slash and files with a space", () => {
  assert.deepEqual(values("cat rea"), ["cat readme.md "]);
  assert.deepEqual(values("cat sr"), ["cat src/"]);
  assert.deepEqual(values("cat src/m"), ["cat src/main.js "]);
});

test("cd only offers folders", () => {
  assert.ok(values("cd ").every((value) => value.endsWith("/")));
  assert.ok(values("cd ").includes("cd src/"));
});

test("hidden files need a leading dot", () => {
  assert.ok(!values("cat ").includes("cat .hidden "));
  assert.deepEqual(values("cat .h"), ["cat .hidden "]);
});

test("names with spaces are escaped, and an escaped word keeps completing", () => {
  assert.deepEqual(values("cd my"), ["cd my\\ dir/"]);
  assert.deepEqual(values("cd my\\ "), ["cd my\\ dir/"]);
});

test("every value starts with the input", () => {
  for (const input of ["cat ", "cat s", "cd my\\ ", "zz", "cat src/"]) {
    for (const value of values(input)) assert.ok(value.startsWith(input), `${value} from ${input}`);
  }
});

test("a missing folder gives no completions rather than an error", () => {
  assert.deepEqual(values("cat nope/x"), []);
});
