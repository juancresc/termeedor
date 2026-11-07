// The backend port: the chooser, the mock through the port, and the Electron adapter against a fake host.

import assert from "node:assert/strict";
import { test } from "node:test";
import { chooseBackend } from "../src/adapters/index.js";
import { createElectronBackend } from "../src/adapters/electronBackend.js";
import { createMockBackend } from "../src/adapters/mockBackend.js";
import { TAB_COLORS } from "../src/constants.js";
import { assertBackend } from "../src/ports/backend.js";
import { createTextModel } from "../src/terminal/textModel.js";

const newTab = () => ({ id: "t1", name: "tab", color: null, cwd: "~", history: [] });

/** A mock backend over one tab (or more), recording every event. */
function mock(tabs = { t1: newTab() }, options = {}) {
  const backend = createMockBackend({ getTab: (id) => tabs[id], stepMs: () => 1, ...options });
  const events = [];
  backend.onEvent((message) => events.push(message));
  return { backend, events, tab: tabs.t1 };
}

const ofType = (events, type) => events.filter(({ event }) => event.type === type);
const outputOf = (events) => ofType(events, "output").map(({ event }) => event.data).join("");

/** Waits until a condition holds: events arrive on their own time. */
async function until(condition) {
  for (let i = 0; i < 200 && !condition(); i++) await new Promise((resolve) => { setTimeout(resolve, 2); });
  assert.ok(condition(), "timed out waiting");
}

function fakeShell(overrides = {}) {
  const calls = [];
  let send;
  const shell = {
    run: async (...args) => { calls.push(["run", ...args]); },
    write: (...args) => { calls.push(["write", ...args]); return "wrote"; },
    resize: (...args) => { calls.push(["resize", ...args]); },
    kill: (...args) => { calls.push(["kill", ...args]); },
    complete: async (...args) => { calls.push(["complete", ...args]); return []; },
    onEvent: (fn) => { send = fn; },
    ...overrides,
  };
  return { shell, calls, send: (message) => send(message) };
}

// ---------- chooser ----------
test("the chooser takes Electron when there is a shell host, and the mock otherwise", async () => {
  const { shell, calls } = fakeShell();
  const desktop = chooseBackend(shell);
  assert.equal(desktop.takesInput, true);
  await desktop.run("t1", "ls", { cwd: "~", cols: 80, rows: 24 });
  assert.deepEqual(calls, [["run", "t1", "ls", { cwd: "~", cols: 80, rows: 24 }]]);

  // No termeedorHost in this process, so this is the browser build's default.
  const browser = chooseBackend(undefined, { getTab: newTab });
  assert.equal(browser.takesInput, false);
  const events = [];
  browser.onEvent((message) => events.push(message));
  await browser.run("t1", "whoami");
  assert.equal(outputOf(events), "you\r\n");
});

test("an adapter missing part of the port is refused", () => {
  assert.throws(() => assertBackend({ takesInput: true }), /no run\(\)/);
  const { takesInput, ...rest } = createMockBackend();
  assert.equal(takesInput, false);
  assert.throws(() => assertBackend(rest), /no takesInput/);
});

// ---------- mock through the port ----------
test("mock: output comes as events and then a finish, never as a returned value", async () => {
  const { backend, events } = mock();
  assert.equal(await backend.run("t1", "echo hello  there"), undefined);
  assert.deepEqual(events, [
    { tabId: "t1", event: { type: "output", data: "hello there\r\n" } },
    { tabId: "t1", event: { type: "finish", cwd: "~" } },
  ]);
});

test("mock: an unknown command says so, like the shell it pretends to be", async () => {
  const { backend, events } = mock();
  await backend.run("t1", "nope --flag");
  assert.equal(outputOf(events), "zsh: command not found: nope\r\n");
  assert.equal(ofType(events, "finish").length, 1);
});

test("mock: names on Object.prototype are not commands", async () => {
  const { backend, events } = mock();
  await backend.run("t1", "constructor");
  assert.equal(outputOf(events), "zsh: command not found: constructor\r\n");
});

test("mock: cd moves the tab and the finish event carries the new cwd", async () => {
  const { backend, events, tab } = mock();
  await backend.run("t1", "cd projects/");
  assert.equal(tab.cwd, "~/projects");
  assert.deepEqual(events.at(-1).event, { type: "finish", cwd: "~/projects" });

  await backend.run("t1", "cd nowhere");
  assert.equal(tab.cwd, "~/projects");
  assert.match(outputOf(events), /cd: no such file or directory: nowhere/);

  await backend.run("t1", "cd ..");
  assert.equal(tab.cwd, "~");
});

test("mock: pwd, ls and history read the tab", async () => {
  const { backend, events, tab } = mock();
  tab.history.push("ls", "pwd");
  await backend.run("t1", "pwd");
  await backend.run("t1", "ls");
  await backend.run("t1", "history");
  assert.equal(outputOf(events), "/Users/you\r\nprojects/  notes.md  .zshrc\r\n   1  ls\r\n   2  pwd\r\n");
});

test("mock: rename and color change the tab", async () => {
  const { backend, events, tab } = mock();
  await backend.run("t1", "rename my tab");
  assert.equal(tab.name, "my tab");
  await backend.run("t1", "color 2");
  assert.equal(tab.color, TAB_COLORS[1]);
  await backend.run("t1", "color none");
  assert.equal(tab.color, null);
  await backend.run("t1", "color 99");
  assert.equal(tab.color, null);
  assert.match(outputOf(events), /renamed tab to 'my tab'/);
  assert.match(outputOf(events), /usage: color <1-8\|none>/);
});

test("mock: help's lines reach the text model unchanged", async () => {
  const { backend, events } = mock();
  await backend.run("t1", "help");
  const model = createTextModel();
  model.write(outputOf(events));
  await model.settled();
  assert.ok(model.text().startsWith("Commands:\n  help, clear,"));
  assert.ok(model.text().includes("\n\nTab completes"));
});

test("mock: clear erases the scrollback the way the real clear does", async () => {
  const { backend, events } = mock();
  await backend.run("t1", "clear");
  const model = createTextModel();
  model.write(outputOf(events));
  await model.settled();
  assert.equal(model.takeErasedScrollback(), true);
  assert.equal(model.text(), "");
});

test("mock: build streams each step before it finishes", async () => {
  const { backend, events } = mock();
  const running = backend.run("t1", "build");
  assert.equal(events.length, 0); // nothing yet: the first step takes time
  await until(() => ofType(events, "output").length === 1);
  assert.equal(events[0].event.data, "  ✓ Resolving dependencies\r\n");
  assert.equal(ofType(events, "finish").length, 0);

  await running;
  const lines = ofType(events, "output").map(({ event }) => event.data);
  assert.equal(lines.length, 6);
  assert.match(lines[5], /^Build finished in \d+\.\ds\r\n$/);
  assert.equal(events.at(-1).event.type, "finish");
});

test("mock: Ctrl+C stops a command, and the finish event still comes", async () => {
  const { backend, events } = mock();
  const running = backend.run("t1", "sleep 60");
  backend.write("t1", "x"); // anything else is ignored
  assert.equal(events.length, 0);
  backend.write("t1", "\x03");
  await running;
  assert.equal(outputOf(events), "^C\r\n");
  assert.equal(events.at(-1).event.type, "finish");

  // And the tab can run again.
  await backend.run("t1", "whoami");
  assert.match(outputOf(events), /you\r\n$/);
});

test("mock: Ctrl+C during a stream keeps what it showed and adds nothing after", async () => {
  const { backend, events } = mock(undefined, { stepMs: () => 5 });
  const running = backend.run("t1", "build");
  await until(() => ofType(events, "output").length === 2);
  backend.write("t1", "\x03");
  await running;
  assert.equal(outputOf(events), "  ✓ Resolving dependencies\r\n  ✓ Compiling 42 modules\r\n^C\r\n");
  assert.equal(ofType(events, "finish").length, 1);
});

test("mock: kill ends the shell with an exit event and nothing else", async () => {
  const { backend, events } = mock();
  const running = backend.run("t1", "sleep 60");
  backend.kill("t1");
  await running;
  assert.deepEqual(events, [{ tabId: "t1", event: { type: "exit" } }]);
});

test("mock: a tab runs one command at a time, and tabs don't affect each other", async () => {
  const tabs = { t1: newTab(), t2: { ...newTab(), id: "t2" } };
  const { backend, events } = mock(tabs);
  const first = backend.run("t1", "sleep 60");
  await assert.rejects(backend.run("t1", "ls"), /already running/);

  const second = backend.run("t2", "sleep 0.001");
  backend.write("t1", "\x03");
  await Promise.all([first, second]);
  assert.deepEqual(ofType(events, "output").map(({ tabId }) => tabId), ["t1"]);
  assert.deepEqual(ofType(events, "finish").map(({ tabId }) => tabId).sort(), ["t1", "t2"]);
});

test("mock: a listener stops hearing once it unsubscribes", async () => {
  const backend = createMockBackend({ getTab: newTab });
  const heard = [];
  const stop = backend.onEvent((message) => heard.push(message));
  await backend.run("t1", "whoami");
  const count = heard.length;
  stop();
  await backend.run("t1", "whoami");
  assert.equal(heard.length, count);
});

test("mock: completes commands, paths and history", async () => {
  const { backend } = mock();
  const options = (over = {}) => ({ cwd: "~", history: [], ...over });
  const values = async (input, over) => (await backend.complete("t1", input, options(over))).map((item) => item.value);

  assert.deepEqual(await values("wh"), ["whoami "]);
  assert.deepEqual(await values("  ec"), ["  echo "]);
  assert.deepEqual(await values("cd "), ["cd projects/"]);
  assert.deepEqual(await values("ls n"), ["ls notes.md "]);
  assert.deepEqual(await values("cd projects/a", { cwd: "~" }), ["cd projects/api/"]);
  assert.deepEqual(await values("ca", { history: ["cat a", "cat a", "cat b"] }), ["cat b", "cat a"]);
  assert.deepEqual(await values("ec", { history: ["echo", "echo hi"] }), ["echo ", "echo hi"]);
  const [first] = await backend.complete("t1", "wh", options());
  assert.deepEqual(first, { value: "whoami ", label: "whoami", kind: "command" });
  assert.equal((await values("")).length, 13); // every command
});

// ---------- Electron adapter over a fake host ----------
test("electron: calls reach the host as they came, and input goes to the program", async () => {
  const { shell, calls } = fakeShell();
  const backend = createElectronBackend(shell);
  assert.equal(backend.takesInput, true);
  await backend.run("t1", "ls -la", { cwd: "/a", cols: 80, rows: 24 });
  assert.equal(backend.write("t1", "\x03"), "wrote");
  backend.resize("t1", 100, 40);
  backend.kill("t1");
  assert.deepEqual(calls, [
    ["run", "t1", "ls -la", { cwd: "/a", cols: 80, rows: 24 }],
    ["write", "t1", "\x03"],
    ["resize", "t1", 100, 40],
    ["kill", "t1"],
  ]);
});

test("electron: run never returns output, which comes as events", async () => {
  const { shell, send } = fakeShell({ run: async () => "ignored" });
  const backend = createElectronBackend(shell);
  const events = [];
  backend.onEvent((message) => events.push(message));
  assert.equal(await backend.run("t1", "ls", {}), undefined);
  send({ tabId: "t1", event: { type: "output", data: "a\r\n" } });
  send({ tabId: "t1", event: { type: "alt", on: true } });
  send({ tabId: "t1", event: { type: "finish", exit: 2, cwd: "/a" } });
  assert.deepEqual(events.map(({ event }) => event), [
    { type: "output", data: "a\r\n" },
    { type: "alt", on: true },
    { type: "finish", exit: 2, cwd: "/a" },
  ]);
});

test("electron: a shell that ended becomes a finish and then an exit", () => {
  const { shell, send } = fakeShell();
  const backend = createElectronBackend(shell);
  const events = [];
  backend.onEvent((message) => events.push(message));
  send({ tabId: "t1", event: { type: "finish", exit: 0, cwd: "/a", shellExited: true } });
  assert.deepEqual(events, [
    { tabId: "t1", event: { type: "finish", exit: 0, cwd: "/a" } },
    { tabId: "t1", event: { type: "exit" } },
  ]);
});

test("electron: a failed run rejects without Electron's wrapping", async () => {
  const { shell } = fakeShell({
    run: async () => { throw new Error("Error invoking remote method 'shell:run': Error: A command is already running in this tab."); },
  });
  await assert.rejects(createElectronBackend(shell).run("t1", "ls", {}), { message: "A command is already running in this tab." });
});

test("electron: completion is the shell's list, then history without repeats", async () => {
  const fromShell = [{ value: "git status ", label: "status", kind: "command" }];
  const { shell, calls } = fakeShell({ complete: async (...args) => { calls.push(args); return fromShell; } });
  const backend = createElectronBackend(shell);
  const items = await backend.complete("t1", "  git s", { cwd: "/a", history: ["git stash", "git status", "git stash"] });
  assert.deepEqual(calls.at(-1), ["t1", "  git s", "/a"]);
  assert.deepEqual(items.map((item) => [item.value, item.kind]), [
    ["git status ", "command"],
    ["  git stash", "history"], // "git status" is already there, however it's spaced
  ]);
});

test("electron: nothing typed offers only what the shell does", async () => {
  const fromShell = [{ value: "ls ", label: "ls", kind: "command" }];
  const { shell } = fakeShell({ complete: async () => fromShell });
  const items = await createElectronBackend(shell).complete("t1", "", { cwd: "~", history: ["ls -la"] });
  assert.deepEqual(items, fromShell);
});
