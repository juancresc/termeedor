// Runs real shells through a real PTY, with a throwaway home folder and rc files.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const require = createRequire(import.meta.url);
const { createShellSessions } = require("../electron/shellSessions.cjs");
const { removeIntegrationFiles } = require("../electron/shellIntegration.cjs");

const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-home-")));
after(() => {
  removeIntegrationFiles();
  fs.rmSync(home, { recursive: true, force: true });
});

const strip = (text) => text.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");

function harness(shell, rc) {
  const env = { HOME: home, PATH: process.env.PATH, ZDOTDIR: undefined };
  delete env.ZDOTDIR;
  fs.writeFileSync(path.join(home, ".zshrc"), rc);
  fs.writeFileSync(path.join(home, ".bash_profile"), rc);
  const events = [];
  const waiters = [];
  const sessions = createShellSessions((tabId, event) => {
    events.push({ tabId, ...event });
    if (event.type === "finish") waiters.shift()?.(event);
  }, { shell, env });

  const run = async (command, tabId = "t") => {
    const from = events.length;
    const finished = new Promise((resolve) => waiters.push(resolve));
    sessions.run(tabId, command, { cwd: home });
    const finish = await finished;
    const text = strip(events.slice(from).filter((e) => e.type === "output").map((e) => e.data).join(""));
    return { text, finish, events: events.slice(from) };
  };
  return { sessions, run, events, waitFinish: () => new Promise((resolve) => waiters.push(resolve)) };
}

const shells = [["zsh", "/bin/zsh"]];
for (const candidate of ["/opt/homebrew/bin/bash", "/usr/local/bin/bash", "/usr/bin/bash", "/bin/bash"]) {
  if (!fs.existsSync(candidate)) continue;
  const { spawnSync } = require("node:child_process");
  const { stdout } = spawnSync(candidate, ["-c", "echo ${BASH_VERSINFO[0]}"], { encoding: "utf8" });
  if (Number(stdout) >= 5) { shells.push(["bash", candidate]); break; }
}

for (const [name, file] of shells) {
  describe(name, () => {
    test("output is exactly what the command printed, with the exit code", async () => {
      const { sessions, run } = harness(file, "");
      const { text, finish } = await run("echo hello; (exit 7)");
      assert.equal(text, "hello\n");
      assert.equal(finish.exit, 7);
      sessions.killAll();
    });

    test("cd, exports and aliases from rc files carry over; cwd is reported", async () => {
      const { sessions, run } = harness(file, "export FROM_RC=yes\nalias hi='echo aliased'\nshopt -s expand_aliases 2>/dev/null\n");
      fs.mkdirSync(path.join(home, "sub dir"), { recursive: true });
      const moved = await run('cd "sub dir"');
      assert.equal(moved.finish.cwd, "~/sub dir".replace("~", "~"));
      assert.equal((await run("pwd")).text.trim(), path.join(home, "sub dir"));
      await run("export LATER=1");
      assert.equal((await run('echo "$LATER $FROM_RC"')).text, "1 yes\n");
      assert.equal((await run("hi")).text, "aliased\n");
      sessions.killAll();
    });

    test("an rc file that prints a banner doesn't leak into output", async () => {
      const { sessions, run } = harness(file, "echo WELCOME BANNER\n");
      assert.equal((await run("echo clean")).text, "clean\n");
      sessions.killAll();
    });

    test("a syntax error shows the shell's message and finishes", async () => {
      const { sessions, run } = harness(file, "");
      const { text, finish } = await run("echo )");
      assert.match(text, /(parse|syntax) error/);
      assert.ok(!text.includes("echo )\necho"));
      assert.notEqual(finish.exit, 0);
      sessions.killAll();
    });

    test("Ctrl+C interrupts and the session keeps working", async () => {
      const { sessions, run, waitFinish, events } = harness(file, "");
      const finished = waitFinish();
      sessions.run("t", "sleep 30", { cwd: home });
      while (!events.some((e) => e.type === "start" || e.type === "output")) await new Promise((r) => setTimeout(r, 20));
      await new Promise((r) => setTimeout(r, 200));
      sessions.write("t", "\x03");
      const finish = await finished;
      assert.equal(finish.exit, 130);
      assert.equal((await run("echo alive")).text, "alive\n");
      sessions.killAll();
    });

    test("a running program can read typed input", async () => {
      const { sessions, waitFinish, events } = harness(file, "");
      const finished = waitFinish();
      sessions.run("t", 'read answer; echo "got $answer"', { cwd: home });
      await new Promise((r) => setTimeout(r, 1500));
      sessions.write("t", "yes\r");
      await finished;
      const text = strip(events.filter((e) => e.type === "output").map((e) => e.data).join(""));
      assert.match(text, /got yes/);
      sessions.killAll();
    });

    test("typing exit ends the command and the next command starts a new shell", async () => {
      const { sessions, run } = harness(file, "");
      const { finish } = await run("exit");
      assert.equal(finish.shellExited, true);
      assert.equal(sessions.info("t"), null);
      assert.equal((await run("echo back")).text, "back\n");
      sessions.killAll();
    });

    test("tabs have separate shells, and a tab's folder is used at start", async () => {
      const { sessions, run } = harness(file, "");
      await run("cd /tmp", "a");
      assert.equal((await run("pwd", "b")).text.trim(), home);
      assert.equal(fs.realpathSync((await run("pwd", "a")).text.trim()), fs.realpathSync("/tmp"));
      sessions.killAll();
    });

    test("full-screen programs are reported", async () => {
      const { sessions, run } = harness(file, "");
      const { events } = await run("printf '\\033[?1049hscreen\\033[?1049l'");
      assert.deepEqual(events.filter((e) => e.type === "alt").map((e) => e.on), [true, false]);
      sessions.killAll();
    });
  });
}
