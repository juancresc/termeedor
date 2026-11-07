// The browser build: no shell host, so commands go to the mock backend.

import assert from "node:assert/strict";
import { test } from "node:test";
import { nodeFor, noop, textarea } from "./support/editorDom.js";

const { initEditor, renderEditor } = await import("../src/editor.js");
const { forwardKey, forwardPaste, initRunner } = await import("../src/terminal/runner.js");
const store = await import("../src/store.js");
initRunner();
initEditor();
store.subscribe(renderEditor);
renderEditor();

const tab = () => store.activeTab();
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const SETTLE_MS = 10; // long enough for the terminal behind the text to parse what it was given

function enter(command) {
  textarea.setRangeText(command, textarea.value.length, textarea.value.length);
  textarea.listeners.input();
  textarea.listeners.keydown({ key: "Enter", code: "", preventDefault: noop });
}

test("a mock command's returned output lands in its block", async () => {
  enter("echo hello");
  await pause(SETTLE_MS);
  assert.equal(store.isRunning(tab().id), false);
  assert.deepEqual(tab().blocks.at(-1), { command: "echo hello", output: "hello", exit: null, cwd: "~" });
  assert.ok(textarea.value.endsWith("❯ echo hello\nhello\n~ ❯ "));
});

test("Enter on mock output that looks like a command runs the draft", async () => {
  enter("echo ❯ whoami");
  await pause(SETTLE_MS);
  // The last "❯ whoami" is the output line; the command's own line says "❯ echo ❯ whoami".
  const output = textarea.value.lastIndexOf("❯ whoami");
  textarea.setSelectionRange(output, output);
  textarea.listeners.keydown({ key: "Enter", code: "", preventDefault: noop });
  await pause(SETTLE_MS);
  assert.equal(tab().blocks.at(-1).command, "");
});

test("Ctrl+C stops a mock command and shows ^C", async () => {
  enter("sleep 60");
  assert.equal(store.isRunning(tab().id), true);
  textarea.listeners.keydown({ key: "c", code: "KeyC", ctrlKey: true, metaKey: false, preventDefault: noop });
  await pause(SETTLE_MS);
  assert.equal(store.isRunning(tab().id), false);
  assert.equal(tab().blocks.at(-1).output, "^C");
});

test("the mock's clear leaves only a prompt", async () => {
  enter("clear");
  await pause(SETTLE_MS);
  assert.deepEqual(tab().blocks, []);
  assert.equal(textarea.value, "~ ❯ ");
});

test("keys and pastes stay with the editor while a mock command runs", async () => {
  enter("sleep 60");
  const key = { key: "a", code: "KeyA", ctrlKey: false, metaKey: false, altKey: false, shiftKey: false };
  assert.equal(forwardKey(tab().id, key), false);
  assert.equal(forwardPaste(tab().id, "text"), false);
  store.stopRun(tab().id);
  await pause(SETTLE_MS);
});

test("a mock command can change the tab, and the status bar's cwd follows", async () => {
  enter("cd projects");
  await pause(SETTLE_MS);
  assert.equal(tab().cwd, "~/projects");
  assert.equal(nodeFor("stCwd").textContent, "~/projects");
  enter("rename renamed");
  await pause(SETTLE_MS);
  assert.equal(tab().name, "renamed");
  assert.equal(tab().blocks.at(-1).output, "renamed tab to 'renamed'");
  enter("cd");
  await pause(SETTLE_MS);
});

test("closing a tab mid-run ends a mock command, and nothing lands in the closed tab", async () => {
  const closing = store.addTab();
  renderEditor();
  enter("sleep 60");
  assert.equal(store.isRunning(closing.id), true);
  store.closeTab(closing);
  await pause(SETTLE_MS);
  assert.equal(store.isRunning(closing.id), false);
  const block = store.state.past[0].tab.blocks.at(-1);
  assert.equal(block.command, "sleep 60");
  assert.equal(block.output, "");
});
