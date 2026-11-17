// The shell's history file, read for Up. Real files in a throwaway folder.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const require = createRequire(import.meta.url);
const { createShellHistory, historyFile, parseHistory } = require("../electron/shellHistory.cjs");

const home = fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-history-"));
after(() => fs.rmSync(home, { recursive: true, force: true }));

test("each shell's usual file is used, unless the environment names another", () => {
  assert.equal(historyFile("/bin/zsh", { HOME: "/h" }), "/h/.zsh_history");
  assert.equal(historyFile("/bin/zsh", { HOME: "/h", ZDOTDIR: "/z" }), "/z/.zsh_history");
  assert.equal(historyFile("/bin/bash", { HOME: "/h" }), "/h/.bash_history");
  assert.equal(historyFile("/bin/zsh", { HOME: "/h", HISTFILE: "/else/hist" }), "/else/hist");
  assert.equal(historyFile("/bin/zsh", { HOME: "/h", HISTFILE: "relative" }), "/h/.zsh_history");
  assert.equal(historyFile(null, { HOME: "/h" }), null);
});

test("zsh history reads with or without timestamps, oldest first", () => {
  const file = Buffer.from(": 1700000000:0;git status\nls -la\n: 1700000005:12;npm test\n");
  assert.deepEqual(parseHistory("/bin/zsh", file), ["git status", "ls -la", "npm test"]);
});

test("a zsh command of several lines comes back as one", () => {
  const file = Buffer.from(": 1700000000:0;for f in *; do\\\n  echo $f\\\ndone\n: 1700000001:0;pwd\n");
  assert.deepEqual(parseHistory("/bin/zsh", file), ["for f in *; do\n  echo $f\ndone", "pwd"]);
});

test("zsh's own encoding of non-ASCII text is undone", () => {
  const metafied = [];
  for (const byte of Buffer.from("echo ñandú")) {
    if (byte >= 0x83 && byte <= 0xa2) metafied.push(0x83, byte ^ 32); // what zsh writes for these bytes
    else metafied.push(byte);
  }
  assert.deepEqual(parseHistory("/bin/zsh", Buffer.from([...metafied, 0x0a])), ["echo ñandú"]);
});

test("bash history skips its timestamp lines", () => {
  const file = Buffer.from("#1700000000\ngit pull\n#1700000001\nmake\n");
  assert.deepEqual(parseHistory("/bin/bash", file), ["git pull", "make"]);
});

test("blank lines and absurdly long commands are left out", () => {
  const file = Buffer.from(`ls\n\n   \n${"x".repeat(10_001)}\npwd\n`);
  assert.deepEqual(parseHistory("/bin/bash", file), ["ls", "pwd"]);
});

test("the file is read from disk, and again once it changes", async () => {
  const env = { HOME: home };
  const history = createShellHistory({ shell: "/bin/zsh", env });
  assert.deepEqual(await history.read(), []); // no file yet
  fs.writeFileSync(history.file, ": 1700000000:0;first\n");
  assert.deepEqual(await history.read(), ["first"]);
  fs.appendFileSync(history.file, ": 1700000001:0;second\n");
  assert.deepEqual(await history.read(), ["first", "second"]);
});

test("only the newest part of a huge file is read, starting at a whole command", async () => {
  const dir = fs.mkdtempSync(path.join(home, "big-"));
  const history = createShellHistory({ shell: "/bin/bash", env: { HOME: dir } });
  const line = `echo ${"y".repeat(1000)}\n`;
  fs.writeFileSync(history.file, `${line.repeat(3000)}last\n`); // about 3 MB
  const commands = await history.read();
  assert.equal(commands.at(-1), "last");
  assert.ok(commands.length < 3000);
  assert.ok(commands.every((command) => command === "last" || command === line.trim()));
});

test("without a shell there is no history", async () => {
  assert.deepEqual(await createShellHistory({ shell: null }).read(), []);
});
