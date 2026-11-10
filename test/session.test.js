// A tab's session (src/terminal/session.js) against a fake backend, with no DOM at all.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

import { createSession } from "../src/terminal/session.js";
import { createRunState } from "../src/core/runState.js";

const FLUSH_MS = 5;
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const SIZE = { cols: 80, rows: 24 };

function fakeBackend({ takesInput = true, fail = null } = {}) {
  let listener = () => {};
  const backend = {
    takesInput,
    runs: [], writes: [], resizes: [], kills: [],
    async run(tabId, command, options) {
      backend.runs.push({ tabId, command, options });
      if (fail) throw new Error(fail);
    },
    write: (tabId, data) => backend.writes.push([tabId, data]),
    resize: (tabId, cols, rows) => backend.resizes.push([tabId, cols, rows]),
    kill: (tabId) => backend.kills.push(tabId),
    complete: async () => [],
    onEvent(fn) { listener = fn; return () => {}; },
    send: (tabId, event) => listener({ tabId, event }),
  };
  return backend;
}

function setup(options) {
  const backend = fakeBackend(options);
  const tab = { id: "t1", cwd: "~", blocks: [], draft: "", history: [] };
  const plugin = [];
  const runs = createRunState();
  const session = createSession({ tab, backend, runs, flushMs: FLUSH_MS, emitPlugin: (name, data) => plugin.push([name, data]) });
  const events = [];
  for (const type of ["start", "output", "data", "fullscreen", "finish"]) session.on(type, (payload) => events.push([type, payload]));
  const send = (event) => session.handle(event);
  const typesOf = () => events.map(([type]) => type);
  return { backend, tab, plugin, runs, session, events, send, typesOf };
}

test("a command's life: start, output, finish, cwd and the finished block", async () => {
  const { backend, tab, plugin, session, events, send, typesOf } = setup();
  const done = session.run("ls", SIZE);
  assert.equal(session.phase, "running");
  assert.equal(session.running, true);
  assert.deepEqual(tab.blocks, [{ command: "ls", output: "", exit: null, cwd: "~" }]);
  assert.equal(session.block, tab.blocks[0]);
  assert.deepEqual(typesOf(), ["start"]);
  assert.deepEqual(plugin.map(([name]) => name), ["command:start"]);
  await pause(0);
  assert.deepEqual(backend.runs, [{ tabId: "t1", command: "ls", options: { cwd: "~", cols: 80, rows: 24 } }]);

  send({ type: "output", data: "one\r\n" });
  send({ type: "output", data: "two\r\n" });
  await pause(FLUSH_MS * 6);
  const outputs = events.filter(([type]) => type === "output");
  assert.equal(outputs.length, 1); // flushed once, not per chunk
  assert.equal(outputs[0][1].block, tab.blocks[0]);
  assert.match(outputs[0][1].snapshot.text, /one\ntwo/);
  assert.equal(outputs[0][1].erased, false);

  send({ type: "finish", exit: 0, cwd: "~/src" });
  await done;
  assert.equal(tab.cwd, "~/src");
  assert.equal(tab.blocks[0].exit, 0);
  assert.equal(tab.blocks[0].cwd, "~"); // where it ran
  assert.equal(session.phase, "idle");
  assert.equal(session.block, null);
  assert.deepEqual(events.at(-1), ["finish", { block: tab.blocks[0], exit: 0, closed: false }]);
  assert.deepEqual(plugin.at(-1), ["command:finish", { tab, command: "ls", output: "one\ntwo", aborted: false }]);
  assert.equal(events.filter(([type]) => type === "data").length, 2);
});

test("one command at a time, and an empty one finishes at once without a shell", async () => {
  const { backend, tab, session } = setup();
  await session.run("", SIZE);
  assert.equal(backend.runs.length, 0);
  assert.deepEqual(tab.blocks, [{ command: "", output: "", exit: null, cwd: "~" }]);
  session.run("sleep 1", SIZE);
  session.run("second", SIZE);
  assert.equal(tab.blocks.length, 2);
  session.resize(100, 30);
  assert.deepEqual(backend.resizes, [["t1", 100, 30]]); // only a tab with a shell
});

test("a backend that can't run the command leaves its message in the block", async () => {
  const { tab, session } = setup({ fail: "no shell" });
  await session.run("ls", SIZE);
  assert.equal(tab.blocks[0].output, "no shell");
  assert.equal(tab.blocks[0].exit, 1);
  assert.equal(session.running, false);
});

test("stop sends Ctrl+C, and the command is stopping until the shell says it ended", async () => {
  const { backend, plugin, session, send } = setup();
  const done = session.run("sleep 60", SIZE);
  assert.equal(session.stop(), true);
  assert.deepEqual(backend.writes, [["t1", "\x03"]]);
  assert.equal(session.phase, "stopping");
  assert.equal(session.stop(), true); // again changes nothing
  assert.equal(backend.writes.length, 1);
  await pause(FLUSH_MS * 4);
  assert.equal(session.running, true);
  send({ type: "finish", exit: 130, cwd: "~" });
  await done;
  assert.equal(session.phase, "idle");
  assert.equal(session.stop(), false);
  assert.equal(plugin.at(-1)[1].aborted, true);
});

test("keys and pastes reach the program only while it runs, and only if the backend takes input", async () => {
  const key = { key: "a", code: "KeyA", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  const { backend, session, send } = setup();
  assert.equal(session.forwardKey(key), false);
  const done = session.run("cat", SIZE);
  assert.equal(session.forwardKey(key), true);
  assert.equal(session.forwardKey({ ...key, key: "c", metaKey: true }), false); // the app's shortcut
  assert.equal(session.forwardPaste("pasted"), true);
  assert.deepEqual(backend.writes.map(([, data]) => data), ["a", "pasted"]);
  send({ type: "finish", exit: 0, cwd: "~" });
  await done;
  assert.equal(session.forwardPaste("late"), false);

  const mock = setup({ takesInput: false });
  mock.session.run("sleep 1", SIZE);
  assert.equal(mock.session.forwardKey(key), false);
  assert.equal(mock.session.forwardPaste("x"), false);
});

test("fullscreen: bytes go out raw instead of into the block, and the size belongs to that view", async () => {
  const { backend, session, events, send, typesOf } = setup();
  const done = session.run("vim", SIZE);
  send({ type: "alt", on: true });
  assert.equal(session.fullscreen, true);
  assert.deepEqual(events.at(-1), ["fullscreen", { on: true, closing: false }]);
  send({ type: "alt", on: true }); // no change, no event
  assert.equal(typesOf().filter((type) => type === "fullscreen").length, 1);

  send({ type: "output", data: "\x1b[Hscreen" });
  await pause(FLUSH_MS * 6);
  assert.deepEqual(events.at(-1), ["data", { data: "\x1b[Hscreen" }]);
  assert.equal(typesOf().includes("output"), false);

  session.resize(100, 30); // the block view's size: not while fullscreen
  session.resizePty(120, 40);
  session.write(":q\r");
  assert.deepEqual(backend.resizes, [["t1", 120, 40]]);
  assert.deepEqual(backend.writes, [["t1", ":q\r"]]);

  send({ type: "alt", on: false });
  assert.equal(session.fullscreen, false);
  assert.deepEqual(events.at(-1), ["fullscreen", { on: false, closing: false }]);
  session.resize(100, 30);
  assert.deepEqual(backend.resizes.at(-1), ["t1", 100, 30]);

  send({ type: "alt", on: true });
  send({ type: "finish", exit: 0, cwd: "~" }); // ending leaves fullscreen too
  assert.equal(session.fullscreen, false);
  await done;
});

test("ESC[3J in the output says the tab's earlier content goes", async () => {
  const { session, events, send } = setup();
  const done = session.run("clear", SIZE);
  send({ type: "output", data: "\x1b[3J\x1b[2Jfresh" });
  send({ type: "finish", exit: 0, cwd: "~" });
  await done;
  const outputs = events.filter(([type]) => type === "output");
  assert.equal(outputs.some(([, payload]) => payload.erased), true);
});

test("closing ends the command with 130, kills the shell, and nothing lands in the tab", async () => {
  const { backend, tab, plugin, session, events, send } = setup();
  const done = session.run("vim", SIZE);
  send({ type: "alt", on: true });
  session.close();
  assert.deepEqual(backend.writes, [["t1", "\x03"]]);
  assert.deepEqual(backend.kills, ["t1"]);
  assert.deepEqual(events.find(([type, payload]) => type === "fullscreen" && !payload.on), ["fullscreen", { on: false, closing: true }]);
  await done;
  assert.deepEqual(events.at(-1), ["finish", { block: tab.blocks[0], exit: 130, closed: true }]);
  assert.equal(tab.blocks[0].exit, null); // not finished: the tab is gone
  assert.equal(plugin.at(-1)[1].aborted, true);
  assert.equal(session.running, false);

  send({ type: "output", data: "late" });
  session.close();
  assert.deepEqual(backend.kills, ["t1"]);
  await session.run("ls", SIZE);
  assert.equal(tab.blocks.length, 1);
});

test("a tab whose shell already ended, or never started, kills nothing on close", async () => {
  const idle = setup();
  idle.session.close();
  assert.deepEqual(idle.backend.kills, []);

  const { backend, session, send } = setup();
  const done = session.run("exit", SIZE);
  send({ type: "finish", exit: 0, cwd: "~" });
  await done;
  send({ type: "exit" });
  session.close();
  assert.deepEqual(backend.kills, []);
});

test("session code never touches the DOM or the store", () => {
  assert.equal(typeof globalThis.document, "undefined"); // everything above ran without one
  assert.equal(typeof globalThis.window, "undefined");
  for (const file of ["../src/terminal/session.js", "../src/terminal/runner.js"]) {
    const source = fs.readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /\b(document|window|getComputedStyle|addEventListener\("resize")\b|\$\(|util\.js|fullscreen\.js|size\.js/, file);
  }
  const session = fs.readFileSync(new URL("../src/terminal/session.js", import.meta.url), "utf8");
  assert.doesNotMatch(session, /store\.js/);
});

// ---------- one session per tab (runner.js), wired to the store ----------
globalThis.localStorage = { getItem: () => null, setItem() {} };
const store = await import("../src/store.js");
const runner = await import("../src/terminal/runner.js");
const backend = fakeBackend();
runner.initRunner(backend);

test("output for a tab that isn't the active one reaches that tab's block only", async () => {
  const background = store.addTab();
  const active = store.addTab();
  assert.equal(store.activeTab(), active);
  const seen = [];
  runner.onSessionEvent("output", (session, { block }) => seen.push([session.tab.id, block]));
  const finished = [];
  runner.onSessionEvent("finish", (session) => finished.push(session.tab.id));
  const done = runner.runCommand(background, "build", SIZE);
  backend.send(background.id, { type: "output", data: "step\r\n" });
  backend.send(active.id, { type: "output", data: "stray\r\n" }); // nothing runs there
  await pause(80);
  assert.deepEqual(seen, [[background.id, background.blocks.at(-1)]]);
  assert.equal(store.isRunning(background.id), true);
  assert.equal(store.isRunning(active.id), false);
  backend.send(background.id, { type: "finish", exit: 0, cwd: "~" });
  await done;
  assert.match(background.blocks.at(-1).output, /step/);
  assert.deepEqual(finished, [background.id]);
});

test("closing a tab ends its session through the store, and its reopened copy gets a new shell", async () => {
  const tab = store.addTab();
  const done = runner.runCommand(tab, "sleep 60", SIZE);
  store.closeTab(tab);
  assert.ok(backend.kills.includes(tab.id));
  await done;
  assert.equal(store.isRunning(tab.id), false);
  assert.equal(runner.forwardPaste(tab.id, "x"), false);

  store.reopenPast(store.state.past[0]);
  const reopened = store.activeTab();
  assert.notEqual(reopened.id, tab.id);
  const again = runner.runCommand(reopened, "ls", SIZE);
  await pause(0);
  assert.equal(backend.runs.at(-1).tabId, reopened.id);
  backend.send(reopened.id, { type: "finish", exit: 0, cwd: "~" });
  await again;

  const group = store.addGroup();
  const inGroup = store.activeTab();
  runner.runCommand(inGroup, "top", SIZE);
  store.closeGroup(group);
  assert.ok(backend.kills.includes(inGroup.id));
});
