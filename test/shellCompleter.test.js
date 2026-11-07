// Real zsh through a real PTY, with a throwaway home folder and rc files. Nothing reads the user's.

import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { after, before, describe, test } from "node:test";

const require = createRequire(import.meta.url);
const { createShellCompleter, isSafeToComplete } = require("../electron/shellCompleter.cjs");
const { createShellSessions } = require("../electron/shellSessions.cjs");
const { removeIntegrationFiles } = require("../electron/shellIntegration.cjs");

const ZSH = "/bin/zsh";
const hasGit = (() => {
  try {
    execFileSync("git", ["--version"]);
    return true;
  } catch {
    return false;
  }
})();
const COMPINIT = "autoload -Uz compinit; compinit -u -d ~/.zcompdump-test\n";
const SLOW = `${COMPINIT}
_zzslow() { sleep 0.4; compadd late }
_zzhang() { sleep 31.337; compadd never }
compdef _zzslow zzslow
compdef _zzhang zzhang
`;

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};
async function until(check, ms = 3000) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    if (check()) return true;
    await wait(20);
  }
  return check();
}
const running = (text) => {
  try {
    return execFileSync("pgrep", ["-f", text], { encoding: "utf8" }).trim().length > 0;
  } catch {
    return false;
  }
};

const roots = [];
/** A fresh home whose .zshrc is rc, with a project folder in it, and a completer for it. */
function setup(rc = COMPINIT, options = {}) {
  const home = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-completer-")));
  roots.push(home);
  fs.writeFileSync(path.join(home, ".zshrc"), rc);
  const cwd = path.join(home, "project");
  fs.mkdirSync(path.join(cwd, "src"), { recursive: true });
  fs.mkdirSync(path.join(cwd, "my dir"));
  fs.mkdirSync(path.join(cwd, "bin"));
  fs.writeFileSync(path.join(cwd, "bin", "zzrun"), "", { mode: 0o755 });
  fs.writeFileSync(path.join(cwd, "src", "main.js"), "");
  fs.writeFileSync(path.join(cwd, "my dir", "inner.txt"), "");
  fs.writeFileSync(path.join(cwd, "my file.txt"), "");
  fs.writeFileSync(path.join(cwd, "it's.txt"), "");
  fs.writeFileSync(path.join(cwd, "readme.md"), "");
  fs.writeFileSync(path.join(cwd, "ñandú.txt"), "");
  const env = { HOME: home, PATH: process.env.PATH, LANG: "en_US.UTF-8", TERMEEDOR_DATA_DIR: path.join(home, "data") };
  const completer = createShellCompleter({ shell: ZSH, env, answerMs: 8000, stuckMs: 12000, ...options });
  const pathVar = `${path.join(cwd, "bin")}:${process.env.PATH}`;
  const ask = (input, tab = "t") => completer.askShell(tab, input, cwd, pathVar);
  const values = async (input) => ((await ask(input)) ?? []).map((item) => item.value);
  return { home, cwd, env, completer, ask, values, pathVar };
}

describe("isSafeToComplete", () => {
  test("ordinary lines go to zsh", () => {
    for (const input of ["git che", "git log --one", "cd my\\ dir/", 'cat "my fi', "cat 'my fi", "ls | gr", "a && b; c ", "FOO=1 gi", "ls $HOME/x", "ls ${HOME}/x", 'cat "$HOME/x', "echo $HO", "echo $", "ls ~/Doc", "cat < fi", "it\\'s", "a\nb "]) {
      assert.equal(isSafeToComplete(input), true, input);
    }
  });

  test("whatever zsh's completion could evaluate stays out", () => {
    for (const input of ["ls $(x)/", "ls `x`/", "ls \"$(x)/", "ls '$(x)/", "cat <(x) ", "cat >(x) ", "cat =(x) ", "ls *(e:x:)/", "ls *(+f)", "ls $((1))/", "ls ${(e)x}/", "ls ${x:-y}/", "ls $x[1]/", "ls $'\\x24\\x28x\\x29'/", "ls $'a'/", "ls '$HOME/", "ls \\$x/", "a\\;b ", "a\\&b ", "a\\|b ", "a\\\nb ", 'cat "a;b ', "cat 'a&b ", 'cat "a|b ', "ls \x1b[A", "a\x00b"]) {
      assert.equal(isSafeToComplete(input), false, input);
    }
  });
});

describe("zsh completion", { skip: !fs.existsSync(ZSH) }, () => {
  after(() => {
    removeIntegrationFiles();
    for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
  });

  describe("answers", () => {
    let shell;
    before(() => {
      shell = setup();
    });
    after(() => shell.completer.stop());

    test("subcommands, flags and flag values come from zsh's own functions", { skip: !hasGit }, async () => {
      assert.ok((await shell.values("git che")).includes("git checkout "));
      assert.deepEqual(await shell.values("git log --one"), ["git log --oneline "]);
      // No git flag starts with this, which is all that was wrong in the prototype: zsh's own Tab only beeps.
      assert.deepEqual(await shell.values("git log --ona"), []);
      assert.ok((await shell.values("git log --format=")).includes("git log --format=fuller "));
    });

    test("descriptions and kinds are passed on", { skip: !hasGit }, async () => {
      const [oneline] = await shell.ask("git log --one");
      assert.equal(oneline.label, "--oneline");
      assert.equal(oneline.kind, "option");
      assert.match(oneline.description, /abbrev-commit/);
      assert.equal((await shell.ask("git checko")).find((item) => item.label === "checkout").kind, "command");
    });

    test("commands from the tab's PATH, in every command position", async () => {
      assert.deepEqual(await shell.values("zzr"), ["zzrun "]);
      assert.deepEqual(await shell.values("ls | zzr"), ["ls | zzrun "]);
      assert.deepEqual(await shell.values("ls; zzr"), ["ls; zzrun "]);
      assert.deepEqual(await shell.values("ls && zzr"), ["ls && zzrun "]);
    });

    test("folders get a slash and files a space", async () => {
      assert.deepEqual(await shell.values("cat rea"), ["cat readme.md "]);
      assert.deepEqual(await shell.values("cat sr"), ["cat src/"]);
      assert.deepEqual(await shell.values("cat src/m"), ["cat src/main.js "]);
      assert.deepEqual(await shell.values("cd sr"), ["cd src/"]);
      const [folder] = await shell.ask("cat sr");
      assert.deepEqual([folder.label, folder.kind], ["src/", "folder"]);
      const [file] = await shell.ask("cat rea");
      assert.deepEqual([file.label, file.kind], ["readme.md", "file"]);
    });

    test("special characters are escaped the way the word is already quoted", async () => {
      assert.deepEqual(await shell.values("cat my\\ f"), ["cat my\\ file.txt "]);
      assert.deepEqual(await shell.values("cat my\\ d"), ["cat my\\ dir/"]);
      assert.deepEqual(await shell.values("cat my\\ dir/in"), ["cat my\\ dir/inner.txt "]);
      assert.deepEqual(await shell.values('cat "my f'), ['cat "my file.txt" ']);
      assert.deepEqual(await shell.values('cat "my d'), ['cat "my dir/']);
      assert.deepEqual(await shell.values("cat 'my f"), ["cat 'my file.txt' "]);
      assert.deepEqual(await shell.values("cat it"), ["cat it\\'s.txt "]);
      assert.deepEqual(await shell.values("cat 'it"), ["cat 'it'\\''s.txt' "]);
      assert.deepEqual(await shell.values("cat ña"), ["cat ñandú.txt "]);
    });

    test("~ and parameters stay as typed", async () => {
      assert.deepEqual(await shell.values("ls ~/proj"), ["ls ~/project/"]);
      assert.deepEqual(await shell.values("ls ~/project/sr"), ["ls ~/project/src/"]);
      assert.deepEqual(await shell.values("ls $HOME/proj"), ["ls $HOME/project/"]);
      assert.deepEqual(await shell.values('ls "$HOME/proj'), ['ls "$HOME/project/']);
    });

    test("a request can follow itself, with the same answer", async () => {
      for (let i = 0; i < 3; i++) assert.deepEqual(await shell.values("cat rea"), ["cat readme.md "]);
    });

    test("the folder and PATH are those of the request", async () => {
      const other = path.join(shell.cwd, "src");
      assert.deepEqual((await shell.completer.askShell("t", "cat ma", other, shell.pathVar)).map((i) => i.value), ["cat main.js "]);
      assert.deepEqual((await shell.completer.askShell("t", "cat rea", shell.cwd, shell.pathVar)).map((i) => i.value), ["cat readme.md "]);
      assert.deepEqual(await shell.completer.askShell("t", "zzr", shell.cwd, "/nowhere"), []);
    });

    test("the list is capped, and a long one doesn't stop to ask", async () => {
      const many = path.join(shell.cwd, "many");
      fs.mkdirSync(many);
      for (let i = 0; i < 1500; i++) fs.writeFileSync(path.join(many, `f${i}`), "");
      const items = await shell.ask("cat many/");
      assert.equal(items.length, 200);
      assert.deepEqual(await shell.values("cat rea"), ["cat readme.md "]);
    });

    test("no results, or a line zsh mustn't see, fall back to the disk", async () => {
      assert.deepEqual(await shell.completer.complete("t", "cat $(echo)rea", shell.cwd, shell.pathVar), []);
      fs.writeFileSync(path.join(shell.cwd, "a;b.txt"), "");
      assert.equal(await shell.ask('cat "a;'), null);
      const fromDisk = await shell.completer.complete("t", "cat a\\;", shell.cwd, shell.pathVar);
      assert.deepEqual(fromDisk.map((item) => item.value), ["cat a\\;b.txt "]);
    });
  });

  describe("safety", () => {
    // Lines that zsh's completion doesn't evaluate by itself. The helper alone must not run them.
    const notEvaluated = (t) => [`echo $(${t}) `, `echo \`${t}\` `, `; ${t} `, `${t}; ls `, `${t}\nls `, `${t}\n`, `ls a;${t}\\`, `alias zz='${t}'; zz `, `${t} `, `FOO=$(${t}) ls `, `cat <(${t}) `, `$(${t}) --fl`];
    // Lines that zsh's own completion does evaluate. Only the gate stands in the way, so it is what's tested.
    const evaluated = (t) => [`ls $(${t})/x`, `ls "$(${t})/x`, `ls ~$(${t})/`, `echo \${(e):-'$(${t})'}/`, `ls $((a[$(${t})]))/`, `ls $'\\x24(${t})'/`];

    test("with no gate at all, the helper runs none of what zsh wouldn't evaluate", async () => {
      const shell = setup(COMPINIT, { isSafe: () => true });
      for (const line of notEvaluated("touch marker")) await shell.completer.askShell("t", line, shell.cwd);
      await wait(200);
      assert.equal(fs.existsSync(path.join(shell.cwd, "marker")), false);
      assert.ok((await shell.values("cat rea")).length, "the helper is still answering");
      shell.completer.stop();
    });

    test("zsh's completion really does evaluate these, so the gate is needed", async () => {
      const shell = setup(COMPINIT, { isSafe: () => true });
      await shell.completer.askShell("t", "ls $(touch marker)/x", shell.cwd);
      assert.ok(await until(() => fs.existsSync(path.join(shell.cwd, "marker"))));
      shell.completer.stop();
    });

    test("through the real path, nothing typed runs", async () => {
      const shell = setup();
      for (const line of [...notEvaluated("touch marker"), ...evaluated("touch marker")]) {
        await shell.completer.complete("t", line, shell.cwd, shell.pathVar);
      }
      assert.ok(shell.completer.helperPid() === null || (await shell.values("cat rea")).length);
      await wait(200);
      assert.equal(fs.existsSync(path.join(shell.cwd, "marker")), false);
      shell.completer.stop();
    });

    test("no history, no prompt hooks, no .zlogout, and the rc files' PATH until a tab has its own", async () => {
      const shell = setup(`${COMPINIT}
HISTFILE=~/hist; SAVEHIST=100; HISTSIZE=100; setopt INC_APPEND_HISTORY
precmd() { touch ~/precmd-ran }
chpwd() { touch ~/chpwd-ran }
zle-line-init() { touch ~/line-init-ran }; zle -N zle-line-init
PATH="$HOME/project/bin:$PATH"
`);
      fs.writeFileSync(path.join(shell.home, ".zlogout"), "touch ~/zlogout-ran\n");
      assert.deepEqual(((await shell.completer.askShell("t", "zzr", shell.cwd)) ?? []).map((i) => i.value), ["zzrun "]);
      assert.ok((await shell.completer.askShell("t", "cat ma", path.join(shell.cwd, "src"))).length);
      shell.completer.stop();
      await wait(300);
      for (const file of ["hist", "precmd-ran", "chpwd-ran", "line-init-ran", "zlogout-ran"]) {
        assert.equal(fs.existsSync(path.join(shell.home, file)), false, file);
      }
    });

    test("nothing reaches the tab's visible shell", async () => {
      const shell = setup();
      const seen = [];
      const finished = [];
      const sessions = createShellSessions((tabId, event) => {
        seen.push(event);
        if (event.type === "finish") finished.shift()?.();
      }, { shell: ZSH, env: shell.env });
      const done = new Promise((resolve) => finished.push(resolve));
      sessions.run("t", "echo hello", { cwd: shell.cwd });
      await done;
      seen.length = 0;
      await shell.ask("cat rea");
      await shell.ask("git che");
      await wait(100);
      assert.deepEqual(seen, []);
      sessions.killAll();
      shell.completer.stop();
    });

    test("a keymap and widgets from plugins change nothing", async () => {
      const shell = setup(`${COMPINIT}
grab() { touch ~/grab-ran; zle .accept-line }; zle -N grab
bindkey '^I' grab; bindkey '^M' grab; bindkey -v
autosuggest-like() { touch ~/redraw-ran }; zle -N zle-line-pre-redraw autosuggest-like
print "noise from an rc file"
`);
      assert.deepEqual(await shell.values("cat rea"), ["cat readme.md "]);
      await wait(100);
      assert.equal(fs.existsSync(path.join(shell.home, "grab-ran")), false);
      assert.equal(fs.existsSync(path.join(shell.home, "redraw-ran")), false);
      shell.completer.stop();
    });
  });

  describe("failures and order", () => {
    test("a stuck completion answers from the disk in time, then the shell and its child are killed", async () => {
      const shell = setup(SLOW, { answerMs: 300, stuckMs: 800 });
      await shell.ask("true ");
      const pid = shell.completer.helperPid();
      const start = Date.now();
      fs.writeFileSync(path.join(shell.cwd, "zzfile"), "");
      const items = await shell.completer.complete("t", "zzhang zzf", shell.cwd, shell.pathVar);
      assert.ok(Date.now() - start < 3000, `took ${Date.now() - start}ms`);
      assert.deepEqual(items.map((item) => item.value), ["zzhang zzfile "]);
      assert.ok(running("sleep 31.337"));
      assert.ok(await until(() => !alive(pid)));
      assert.ok(await until(() => !running("sleep 31.337")));
      shell.completer.stop();
    });

    test("a late answer never lands on a newer request", async () => {
      const shell = setup(SLOW);
      await shell.ask("true ");
      const older = shell.ask("zzslow ");
      const newer = shell.ask("cat rea");
      assert.equal(await older, null, "the same tab's newer request ends it");
      assert.deepEqual((await newer).map((item) => item.value), ["cat readme.md "]);

      const first = shell.ask("zzslow ", "a");
      const second = shell.ask("cat rea", "b");
      assert.deepEqual((await first).map((item) => item.value), ["zzslow late "]);
      assert.deepEqual((await second).map((item) => item.value), ["cat readme.md "]);
      shell.completer.stop();
    });

    test("a request that timed out while queued is never sent", async () => {
      const shell = setup(`${SLOW}\nzzcount() { touch ~/queued-ran }\n_zzc() { zzcount }\ncompdef _zzc zzc\n`, { answerMs: 100 });
      await shell.completer.askShell("t", "true ", shell.cwd);
      await wait(100);
      const busy = shell.ask("zzslow ", "a");
      assert.equal(await shell.ask("zzc ", "b"), null);
      assert.equal(await busy, null);
      await wait(600);
      assert.equal(fs.existsSync(path.join(shell.home, "queued-ran")), false);
      shell.completer.stop();
    });

    test("a crash answers from the disk, and the next request has a new shell", async () => {
      const shell = setup();
      await shell.ask("true ");
      const pid = shell.completer.helperPid();
      const pending = shell.completer.complete("t", "cat rea", shell.cwd, shell.pathVar);
      process.kill(pid, "SIGKILL");
      assert.deepEqual((await pending).map((item) => item.value), ["cat readme.md "]);
      assert.ok(await until(() => shell.completer.helperPid() !== pid));
      assert.deepEqual(await shell.values("cat rea"), ["cat readme.md "]);
      assert.notEqual(shell.completer.helperPid(), pid);
      shell.completer.stop();
    });

    test("another shell never starts a helper", async () => {
      const shell = setup(COMPINIT, { shell: "/bin/bash" });
      assert.equal(await shell.ask("cat rea"), null);
      assert.equal(shell.completer.helperPid(), null);
      assert.deepEqual((await shell.completer.complete("t", "cat rea", shell.cwd, shell.pathVar)).map((item) => item.value), ["cat readme.md "]);
    });

    test("no shell at all still answers", async () => {
      const shell = setup(COMPINIT, { shell: null });
      assert.deepEqual((await shell.completer.complete("t", "cat rea", shell.cwd, shell.pathVar)).map((item) => item.value), ["cat readme.md "]);
    });

    test("startup files that hang get killed, with a pause before trying again", async () => {
      const shell = setup("sleep 31.338\n", { answerMs: 100, startMs: 500, retryMs: 60000 });
      const start = Date.now();
      assert.deepEqual((await shell.completer.complete("t", "cat rea", shell.cwd, shell.pathVar)).map((item) => item.value), ["cat readme.md "]);
      assert.ok(Date.now() - start < 3000, `took ${Date.now() - start}ms`);
      const pid = shell.completer.helperPid();
      assert.ok(running("sleep 31.338"));
      assert.ok(await until(() => !alive(pid)));
      assert.ok(await until(() => !running("sleep 31.338")));
      assert.equal(await shell.ask("cat rea"), null);
      assert.equal(shell.completer.helperPid(), null, "not started again yet");
    });

    test("startup files that wait for an answer or end the shell count as failures too", async () => {
      for (const rc of ['read -k 1 "?Update? "\n', "exit 0\n", "exec /bin/sleep 0.1\n"]) {
        const shell = setup(rc, { answerMs: 100, startMs: 300, retryMs: 60000 });
        assert.equal(await shell.ask("cat rea"), null);
        const pid = shell.completer.helperPid();
        if (pid) assert.ok(await until(() => !alive(pid)));
        assert.equal(await shell.ask("cat rea"), null);
        assert.equal(shell.completer.helperPid(), null, rc);
      }
    });

    test("startup files with no compinit still get completion", async () => {
      const shell = setup("");
      assert.deepEqual(await shell.values("cat rea"), ["cat readme.md "]);
      shell.completer.stop();
    });
  });

  describe("no orphans", () => {
    test("closing the last tab that used it ends the shell, and another tab keeps it", async () => {
      const shell = setup();
      await shell.ask("cat rea", "a");
      await shell.ask("cat rea", "b");
      const pid = shell.completer.helperPid();
      shell.completer.closeTab("a");
      assert.equal(shell.completer.helperPid(), pid);
      assert.ok(alive(pid));
      shell.completer.closeTab("b");
      assert.equal(shell.completer.helperPid(), null);
      assert.ok(await until(() => !alive(pid)));
    });

    test("a closed tab's request ends at once", async () => {
      const shell = setup(SLOW);
      await shell.ask("true ", "a");
      await shell.ask("true ", "b");
      const pending = shell.ask("zzslow ", "a");
      shell.completer.closeTab("a");
      assert.equal(await pending, null);
      shell.completer.stop();
    });

    test("stop ends a shell, even one busy with a child", async () => {
      const shell = setup(SLOW);
      await shell.ask("true ");
      const pid = shell.completer.helperPid();
      const pending = shell.ask("zzhang ");
      assert.ok(await until(() => running("sleep 31.337")));
      shell.completer.stop();
      assert.equal(await pending, null);
      assert.ok(await until(() => !alive(pid)));
      assert.ok(await until(() => !running("sleep 31.337")));
    });

    test("an idle shell ends by itself", async () => {
      const shell = setup(COMPINIT, { idleMs: 200 });
      await shell.ask("true ");
      const pid = shell.completer.helperPid();
      assert.ok(await until(() => shell.completer.helperPid() === null));
      assert.ok(await until(() => !alive(pid)));
    });

    test("the shell dies with the app, however the app ends", async () => {
      const { env, home } = setup();
      const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "t")); // this run's hook files can't be removed by a killed app
      roots.push(tmp);
      const script = path.join(home, "app.cjs");
      fs.writeFileSync(script, `
        const { createShellCompleter } = require(${JSON.stringify(require.resolve("../electron/shellCompleter.cjs"))});
        const completer = createShellCompleter({ shell: ${JSON.stringify(ZSH)}, env: ${JSON.stringify(env)}, answerMs: 8000 });
        completer.askShell("t", "true ", ${JSON.stringify(home)}).then(() => console.log(completer.helperPid()));
      `);
      const app = spawn(process.execPath, [script], { stdio: ["ignore", "pipe", "inherit"], env: { ...process.env, TMPDIR: tmp } });
      const pid = await new Promise((resolve) => app.stdout.once("data", (data) => resolve(Number(data))));
      assert.ok(alive(pid));
      app.kill("SIGKILL");
      assert.ok(await until(() => !alive(pid)));
    });
  });
});
