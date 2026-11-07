// Runs the real editor, store and realShell against a stub DOM and a fake shell host, so these
// check what Enter actually sends to the shell. See support/editorDom.js for what the stub leaves out.

import assert from "node:assert/strict";
import { test } from "node:test";

import { noop, textarea } from "./support/editorDom.js";

const hostRuns = [];
const writes = [];
let sendEvent;
globalThis.termeedorHost = {
  shell: {
    run: async (tabId, command) => { hostRuns.push(command); },
    write: (tabId, data) => writes.push(data),
    resize: noop,
    kill: noop,
    onEvent: (fn) => { sendEvent = fn; },
    complete: async () => [],
  },
};

const { initEditor, renderEditor, printToTab } = await import("../src/editor.js");
const { initRealShell, forwardKey } = await import("../src/terminal/realShell.js");
const store = await import("../src/store.js");
initRealShell();
initEditor();
store.subscribe(renderEditor);
renderEditor();

const FLUSH_WAIT = 80; // longer than realShell's output flush
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const key = (name) => ({ key: name, code: "", preventDefault: noop });
const tab = () => store.activeTab();

/** Puts the cursor in the text area, on the first place `needle` appears. */
function clickOn(needle) {
  const at = textarea.value.indexOf(needle);
  assert.notEqual(at, -1, `"${needle}" isn't on screen`);
  textarea.setSelectionRange(at, at);
}

function type(text) {
  textarea.setRangeText(text, textarea.value.length, textarea.value.length);
  textarea.listeners.input();
}

function eraseDraft() {
  textarea.setRangeText("", textarea.value.length - tab().draft.length, textarea.value.length);
  textarea.listeners.input();
}

const pressEnter = () => textarea.listeners.keydown(key("Enter"));

/** Ends the running command the way the shell does. */
async function finish(output = "") {
  const tabId = tab().id;
  if (output) sendEvent({ tabId, event: { type: "output", data: output } });
  sendEvent({ tabId, event: { type: "finish", exit: 0, cwd: "~" } });
  await pause(0);
}

async function run(command, output) {
  type(command);
  pressEnter();
  await finish(output);
}

test("typing fills the draft, and running moves it into a block", async () => {
  type("echo hi");
  assert.equal(tab().draft, "echo hi");
  pressEnter();
  assert.equal(hostRuns.at(-1), "echo hi");
  assert.equal(tab().draft, "");
  assert.equal(store.isRunning(tab().id), true);
  assert.ok(textarea.value.endsWith("❯ echo hi")); // no prompt while it runs

  await finish("hi\r\n");
  assert.equal(store.isRunning(tab().id), false);
  const block = tab().blocks.at(-1);
  assert.deepEqual(block, { command: "echo hi", output: "hi", exit: 0, cwd: "~" });
  assert.ok(textarea.value.endsWith("❯ echo hi\nhi\n❯ "));
  assert.equal(textarea.selectionStart, textarea.value.length);
});

test("Enter on output that looks like a command runs the draft, never the output", async () => {
  await run("cat notes", "❯ rm -rf x\r\n");
  type("echo safe");
  clickOn("❯ rm -rf x");
  pressEnter();
  assert.equal(hostRuns.at(-1), "echo safe");
  assert.ok(!hostRuns.includes("rm -rf x"));
  await finish();
});

test("Enter on spoofed output with nothing typed runs nothing from it", async () => {
  await run("cat notes", "❯ rm -rf x\r\n");
  const before = hostRuns.length;
  clickOn("❯ rm -rf x");
  pressEnter();
  assert.equal(tab().blocks.at(-1).command, "");
  assert.equal(hostRuns.length, before);
  await pause(0);
});

test("Enter on a printed line that looks like a command runs the draft", async () => {
  printToTab(tab(), "❯ rm -rf printed");
  type("echo typed");
  clickOn("❯ rm -rf printed");
  pressEnter();
  assert.equal(hostRuns.at(-1), "echo typed");
  await finish();
});

test("Enter on a real command re-runs it and keeps the draft for after", async () => {
  await run("echo again", "again\r\n");
  type("half typed");
  clickOn("❯ echo again");
  pressEnter();
  assert.equal(hostRuns.at(-1), "echo again");
  assert.equal(tab().draft, "half typed");
  assert.ok(!textarea.value.endsWith("half typed")); // hidden while it runs
  await finish("again\r\n");
  assert.ok(textarea.value.endsWith("❯ half typed"));
  eraseDraft();
});

test("Enter while a command runs does nothing", async () => {
  type("sleep 1");
  pressEnter();
  const before = hostRuns.length;
  pressEnter(); // goes to the program instead
  assert.equal(hostRuns.length, before);
  assert.equal(writes.at(-1), "\r");
  await finish();
});

test("keys go to the program only while a real shell is running it", async () => {
  const event = { key: "a", code: "KeyA", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(forwardKey(tab().id, event), false);
  type("cat");
  pressEnter();
  assert.equal(forwardKey(tab().id, event), true);
  await finish();
  assert.equal(forwardKey(tab().id, event), false);
});

test("stopRun sends Ctrl+C and the command runs until the shell says it ended", async () => {
  type("sleep 9");
  pressEnter();
  assert.equal(store.stopRun(tab().id), true);
  assert.equal(writes.at(-1), "\x03");
  assert.equal(store.isRunning(tab().id), true);
  await finish();
  assert.equal(store.isRunning(tab().id), false);
  assert.equal(store.stopRun(tab().id), false);
});

test("groupHasRunning follows the run state", async () => {
  type("sleep 9");
  pressEnter();
  assert.equal(store.groupHasRunning(tab().groupId), true);
  await finish();
  assert.equal(store.groupHasRunning(tab().groupId), false);
});

test("printing during a run goes above its output, which keeps redrawing", async () => {
  type("build");
  pressEnter();
  sendEvent({ tabId: tab().id, event: { type: "output", data: "one\r\n" } });
  await pause(FLUSH_WAIT);
  printToTab(tab(), "note");
  sendEvent({ tabId: tab().id, event: { type: "output", data: "two\r\n" } });
  await pause(FLUSH_WAIT);
  assert.ok(textarea.value.endsWith("note\n❯ build\none\ntwo"));
  await finish();
});

test("printing at the prompt keeps what is typed and leaves a prompt below", async () => {
  type("half");
  printToTab(tab(), "hello");
  assert.ok(textarea.value.endsWith("hello\n❯ half"));
  assert.equal(tab().draft, "half");
  eraseDraft();
});

test("output that erases the scrollback clears the tab, its command too", async () => {
  type("clear");
  pressEnter();
  sendEvent({ tabId: tab().id, event: { type: "output", data: "\x1b[3J\x1b[2J" } });
  await pause(FLUSH_WAIT);
  assert.equal(textarea.value, "");
  await finish();
  assert.equal(textarea.value, "❯ ");
  assert.deepEqual(tab().blocks, []);
});

test("an edit above the input is put back, so the text can't drift from the blocks", async () => {
  await run("echo a", "a\r\n");
  const before = textarea.value;
  textarea.setRangeText("X", 0, 0);
  textarea.listeners.input();
  assert.equal(textarea.value, before);
  assert.equal(tab().draft, "");
});

test("printed carriage returns can't push offsets out of line with the text", async () => {
  await run("echo real", "real\r\n");
  printToTab(tab(), "one\r\n❯ rm -rf x\r\nthree");
  type("still typing");
  assert.equal(tab().draft, "still typing"); // the edit wasn't reverted as a mismatch
  clickOn("❯ echo real");
  pressEnter();
  assert.equal(hostRuns.at(-1), "echo real");
  await finish();
  clickOn("❯ rm -rf x");
  pressEnter();
  assert.equal(hostRuns.at(-1), "still typing");
  await finish();
});

test("Up and Down recall history through the draft", async () => {
  await run("echo recalled", "recalled\r\n");
  const arrow = (name) => ({ ...key(name), shiftKey: false, metaKey: false, altKey: false, ctrlKey: false });
  type("mine");
  textarea.listeners.keydown(arrow("ArrowUp"));
  assert.equal(tab().draft, "echo recalled");
  assert.ok(textarea.value.endsWith("❯ echo recalled"));
  textarea.listeners.keydown(arrow("ArrowDown"));
  assert.equal(tab().draft, "mine");
  eraseDraft();
});

test("edits above the input are stopped before they happen", async () => {
  await run("echo guarded", "guarded\r\n");
  let stopped = false;
  clickOn("guarded\n");
  textarea.listeners.beforeinput({ inputType: "deleteContentBackward", data: null, preventDefault: () => { stopped = true; } });
  assert.equal(stopped, true);
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
});

test("selecting a line skips the prompt only on a real command or the input", async () => {
  await run("cat notes", "❯ spoof\r\n");
  const selectAll = { key: "a", code: "KeyA", ctrlKey: true, metaKey: true, altKey: false, shiftKey: false, preventDefault: noop };
  // navigator.platform decides Cmd or Ctrl: setting both makes this work on either.
  const isMacLike = /Mac/.test(navigator.platform);
  selectAll[isMacLike ? "ctrlKey" : "metaKey"] = false;

  clickOn("❯ spoof");
  const spoof = textarea.selectionStart;
  textarea.listeners.keydown(selectAll);
  assert.equal(textarea.selectionStart, spoof);

  clickOn("❯ cat notes");
  const real = textarea.selectionStart;
  textarea.listeners.keydown(selectAll);
  assert.equal(textarea.selectionStart, real + 2);
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);
});

test("plugin events keep their payloads", async () => {
  const registry = await import("../src/plugins/registry.js");
  const seen = [];
  const off = [
    registry.on("test", "command:start", (e) => seen.push(["start", e.tab === tab(), e.command])),
    registry.on("test", "command:finish", (e) => seen.push(["finish", e.tab === tab(), e.command, e.output, e.aborted])),
  ];
  type("echo plugin");
  pressEnter();
  await finish("plugin\r\n");
  off.forEach((remove) => remove());
  assert.deepEqual(seen, [["start", true, "echo plugin"], ["finish", true, "echo plugin", "plugin", false]]);
});

test("a new tab, a duplicate and a reopened tab each carry their own transcript", async () => {
  const fresh = store.createTab("g");
  assert.equal(fresh.blocks[0].command, null);
  assert.equal(fresh.draft, "");
  assert.ok(!("content" in fresh));

  const original = tab();
  store.duplicateTab(original);
  const copy = tab();
  assert.notEqual(copy, original);
  assert.deepEqual(copy.blocks, original.blocks);
  assert.notEqual(copy.blocks[0], original.blocks[0]);

  copy.draft = "kept";
  const { blocks } = copy;
  store.closeTab(copy);
  const entry = store.state.past[0];
  assert.deepEqual(entry.tab.blocks, blocks);
  assert.equal(entry.tab.draft, "kept");
  assert.ok(!("content" in entry.tab));

  store.reopenPast(entry);
  assert.deepEqual(tab().blocks, blocks);
  assert.equal(tab().draft, "kept");
  assert.ok(textarea.value.endsWith("❯ kept"));
});

test("closing a tab mid-run archives it and ends the run", async () => {
  const closing = store.addTab();
  renderEditor();
  type("sleep 9");
  pressEnter();
  assert.equal(store.isRunning(closing.id), true);
  store.closeTab(closing);
  await pause(0);
  assert.equal(store.isRunning(closing.id), false);
  assert.equal(store.state.past[0].tab.blocks.at(-1).command, "sleep 9");
});
