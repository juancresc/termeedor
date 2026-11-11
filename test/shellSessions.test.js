// Runs real shells through a real PTY, with a throwaway home folder and rc files.

import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";

const require = createRequire(import.meta.url);
const { commandBytes, createShellSessions } = require("../electron/shellSessions.cjs");
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

test("a one-line command is typed; anything a line editor would act on goes as one paste", () => {
  assert.equal(commandBytes("echo hi"), "echo hi\r");
  assert.equal(commandBytes("a\nb"), "\x1b[200~a\nb\x1b[201~\r");
  assert.equal(commandBytes("a\r\nb\rc"), "\x1b[200~a\nb\nc\x1b[201~\r");
  assert.equal(commandBytes("a\tb"), "\x1b[200~a\tb\x1b[201~\r");
});

test("a command can't end its own paste, even by leaving pieces that join up", () => {
  assert.equal(commandBytes("a\n\x1b[201~rm -rf x"), "\x1b[200~a\nrm -rf x\x1b[201~\r");
  assert.equal(commandBytes("a\n\x1b[20\x1b[201~1~rm -rf x"), "\x1b[200~a\nrm -rf x\x1b[201~\r");
  assert.equal(commandBytes("a\n\x1b[200~b"), "\x1b[200~a\nb\x1b[201~\r");
});

const shells = fs.existsSync("/bin/zsh") ? [["zsh", "/bin/zsh"]] : [];
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
      assert.equal(moved.finish.cwd, path.join(home, "sub dir"));
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
      const { sessions, run, waitFinish } = harness(file, "");
      const finished = waitFinish();
      sessions.run("t", "sleep 30", { cwd: home });
      await new Promise((r) => setTimeout(r, 1500));
      sessions.write("t", "\x03");
      const finish = await finished;
      assert.equal(finish.exit, 130);
      assert.equal((await run("echo alive")).text, "alive\n");
      sessions.killAll();
    });

    test("Ctrl+C while the shell starts cancels the waiting command", { timeout: 15000 }, async () => {
      const { sessions, run, waitFinish, events } = harness(file, "sleep 1\nexport TM_RC_DONE=yes\n");
      const finished = waitFinish();
      sessions.run("t", "echo should-not-run; sleep 30", { cwd: home });
      sessions.write("t", "\x03");
      const finish = await finished;
      assert.equal(finish.exit, 130);
      assert.equal((await run("echo $TM_RC_DONE")).text, "yes\n"); // the rc files weren't interrupted
      assert.ok(!events.some((e) => e.type === "output" && e.data.includes("should-not-run")));
      sessions.killAll();
    });

    test("keys typed while the shell starts follow the waiting command, not precede it", { timeout: 15000 }, async () => {
      const { sessions, waitFinish, events } = harness(file, "sleep 1\n");
      const finished = waitFinish();
      sessions.run("t", 'read answer; echo "got [$answer]"', { cwd: home });
      sessions.write("t", "g"); // the next command's first key, typed before the shell was ready
      sessions.write("t", "o\r");
      const finish = await finished;
      const text = strip(events.filter((e) => e.type === "output").map((e) => e.data).join(""));
      assert.match(text, /got \[go\]/);
      assert.equal(finish.exit, 0);
      sessions.killAll();
    });

    test("keys a command never read come back with its finish, and the next command runs clean", { timeout: 15000 }, async () => {
      const { sessions, run, waitFinish } = harness(file, "");
      const finished = waitFinish();
      sessions.run("t", "sleep 1", { cwd: home });
      await new Promise((r) => setTimeout(r, 300));
      sessions.write("t", "sh pro");
      const finish = await finished;
      assert.equal(finish.typeahead, "sh pro");
      assert.equal((await run("echo clean")).text, "clean\n");
      sessions.killAll();
    });

    test("a key landing just as a command ends can't join the front of the next one", { timeout: 20000 }, async () => {
      const { sessions, run, waitFinish } = harness(file, "");
      await run("true");
      for (let i = 0; i < 5; i++) {
        let finished = false;
        const done = waitFinish().then(() => { finished = true; });
        sessions.run("t", "sleep 0.05", { cwd: home });
        const type = () => { if (!finished) { sessions.write("t", "g"); setTimeout(type, 2); } };
        type(); // some arrive after the shell collected the unread keys, and before its finish marker
        await done;
        const { text, finish } = await run("echo clean");
        assert.equal(text, "clean\n");
        assert.equal(finish.exit, 0);
      }
      sessions.killAll();
    });

    test("keys written once the command has finished go back as typeahead", async () => {
      const { sessions, run, events } = harness(file, "");
      await run("true");
      sessions.write("t", "g");
      assert.deepEqual(events.at(-1), { tabId: "t", type: "typeahead", data: "g" });
      assert.equal((await run("echo clean")).text, "clean\n");
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

    test("a program's prompt with no line break arrives before it reads anything", async () => {
      const { sessions, waitFinish, events } = harness(file, "");
      const finished = waitFinish();
      sessions.run("t", "printf '>>> '; read answer; echo \"got $answer\"", { cwd: home });
      await new Promise((r) => setTimeout(r, 1500));
      assert.ok(strip(events.filter((e) => e.type === "output").map((e) => e.data).join("")).endsWith(">>> "));
      assert.equal(events.some((e) => e.type === "finish"), false);
      sessions.write("t", "yes\r");
      await finished;
      assert.match(strip(events.filter((e) => e.type === "output").map((e) => e.data).join("")), /^>>> yes\ngot yes\n$/);
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

    test("a multi-line for loop runs as one command", async () => {
      const { sessions, run } = harness(file, "");
      const { text, finish } = await run("for i in 1 2 3; do\n  echo \"got $i\"\ndone");
      assert.equal(text, "got 1\ngot 2\ngot 3\n");
      assert.equal(finish.exit, 0);
      assert.equal((await run("echo after")).text, "after\n");
      sessions.killAll();
    });

    test("a heredoc reaches its program, line breaks and tabs included", async () => {
      const { sessions, run } = harness(file, "");
      assert.equal((await run("cat <<'EOF'\nfirst $HOME\n\ttabbed\n\nlast\nEOF")).text, "first $HOME\n\ttabbed\n\nlast\n");
      const piped = await run("cat <<EOF | tr a-z A-Z\nshout\nEOF");
      assert.equal(piped.text, "SHOUT\n");
      sessions.killAll();
    });

    test("several lines run in order and keep the shell's state; the last one's exit code counts", async () => {
      const { sessions, run } = harness(file, "");
      fs.mkdirSync(path.join(home, "multi"), { recursive: true });
      const { text, finish } = await run("cd multi\nFOO=bar\npwd\necho $FOO\n(exit 3)");
      assert.equal(text, `${path.join(home, "multi")}\nbar\n`);
      assert.equal(finish.exit, 3);
      assert.equal(finish.cwd, path.join(home, "multi"));
      sessions.killAll();
    });

    test("multi-line works as the session's first command, and as the next one right after", async () => {
      const { sessions, run } = harness(file, "");
      assert.equal((await run("echo a\necho b")).text, "a\nb\n");
      assert.equal((await run("echo c\necho d")).text, "c\nd\n");
      sessions.killAll();
    });

    test("a long multi-line command gets through whole, even as the first command", async () => {
      const { sessions, run } = harness(file, "");
      const lines = Array.from({ length: 300 }, (_, i) => `echo line-${i}`);
      const { text } = await run(lines.join("\n"));
      assert.equal(text, `${lines.map((_, i) => `line-${i}`).join("\n")}\n`);
      const wide = "x".repeat(4000);
      assert.equal((await run(`cat <<EOF\n${wide}\nEOF`)).text, `${wide}\n`);
      sessions.killAll();
    });

    test("a very long first line gets through as the session's first command", async () => {
      const { sessions, run } = harness(file, "");
      const wide = "y".repeat(4000);
      assert.equal((await run(`cat <<EOF\n${wide}\nEOF`)).text, `${wide}\n`);
      sessions.killAll();
    });

    test("a very long one-line command gets through as the session's first command", async () => {
      const { sessions, run } = harness(file, "");
      const wide = "z".repeat(4000);
      assert.equal((await run(`echo ${wide}`)).text, `${wide}\n`);
      sessions.killAll();
    });

    test("a multi-line command works with bracketed paste turned off, or in vi mode", async () => {
      for (const rc of ["unset zle_bracketed_paste 2>/dev/null\nbind 'set enable-bracketed-paste off' 2>/dev/null\n", "set -o vi\n"]) {
        const { sessions, run } = harness(file, rc);
        assert.equal((await run("for i in 1 2; do\n  echo $i\ndone")).text, "1\n2\n");
        assert.equal((await run("cat <<EOF\nhello\nEOF")).text, "hello\n");
        assert.equal((await run("echo one")).text, "one\n");
        sessions.killAll();
      }
    });

    test("a multi-line command with a syntax error shows only the shell's message", async () => {
      const { sessions, run } = harness(file, "");
      const { text, finish } = await run("if true; then\n  echo )\nfi");
      assert.match(text, /(parse|syntax) error/);
      assert.ok(!text.includes("if true"), text);
      assert.notEqual(finish.exit, 0);
      assert.equal((await run("echo alive")).text, "alive\n");
      sessions.killAll();
    });

    test("a syntax error on a first line shows the shell's message, and the shell carries on", async () => {
      const { sessions, run } = harness(file, "");
      const { text } = await run("echo )\necho next");
      assert.match(text, /(parse|syntax) error/);
      assert.ok(!text.includes("echo )\n"), text);
      assert.equal((await run("echo alive")).text, "alive\n");
      sessions.killAll();
    });

    // Bash runs each finished line as it reads it, so after `echo first` it is already showing
    // output, and its continuation prompt shows too. Zsh reads everything first and runs nothing.
    for (const [label, command, leftovers] of [
      ["quote", 'echo "open', ""],
      ["multi-line quote", 'echo first\necho "open\nstill', name === "bash" ? "first\n> ^C\n" : ""],
      ["heredoc", "cat <<EOF\nno end", ""],
    ]) {
      test(`an unterminated ${label}: Ctrl+C recovers`, async () => {
        const { sessions, run, waitFinish, events } = harness(file, "");
        const finished = waitFinish();
        const from = events.length;
        sessions.run("t", command, { cwd: home });
        await new Promise((r) => setTimeout(r, 1200));
        assert.equal(events.slice(from).some((e) => e.type === "finish"), false); // the shell is waiting for more
        sessions.write("t", "\x03");
        const finish = await finished;
        assert.notEqual(finish.exit, 0);
        const text = strip(events.slice(from).filter((e) => e.type === "output").map((e) => e.data).join(""));
        assert.equal(text, leftovers);
        assert.equal((await run("echo alive")).text, "alive\n");
        sessions.killAll();
      });
    }

    test("typing completes an unterminated quote, because keys are forwarded to the shell", async () => {
      const { sessions, run, waitFinish, events } = harness(file, "");
      const finished = waitFinish();
      const from = events.length;
      sessions.run("t", 'echo "one\ntwo', { cwd: home });
      await new Promise((r) => setTimeout(r, 1200));
      sessions.write("t", 'three"\r');
      await finished;
      const text = strip(events.slice(from).filter((e) => e.type === "output").map((e) => e.data).join(""));
      assert.equal(text, "one\ntwo\nthree\n");
      assert.equal((await run("echo alive")).text, "alive\n");
      sessions.killAll();
    });

    test("a command can't break out of its own paste", async () => {
      const { sessions, run } = harness(file, "");
      const marker = path.join(home, "escaped");
      const { text } = await run(`echo a\n\x1b[201~echo b; touch ${marker}\necho c`);
      assert.equal(fs.existsSync(marker), true); // it runs, but only as part of the same command
      assert.equal(text, "a\nb\nc\n");
      fs.rmSync(marker);
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
