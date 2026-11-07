// The browser build: no shell host, so commands go to the mock in shell.js.

import assert from "node:assert/strict";
import { test } from "node:test";
import { noop, textarea } from "./support/editorDom.js";

const { initEditor, renderEditor } = await import("../src/editor.js");
const store = await import("../src/store.js");
initEditor();
store.subscribe(renderEditor);
renderEditor();

const tab = () => store.activeTab();
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function enter(command) {
  textarea.setRangeText(command, textarea.value.length, textarea.value.length);
  textarea.listeners.input();
  textarea.listeners.keydown({ key: "Enter", code: "", preventDefault: noop });
}

test("a mock command's returned output lands in its block", async () => {
  enter("echo hello");
  await pause(0);
  assert.equal(store.isRunning(tab().id), false);
  assert.deepEqual(tab().blocks.at(-1), { command: "echo hello", output: "hello", exit: null, cwd: "~" });
  assert.ok(textarea.value.endsWith("❯ echo hello\nhello\n❯ "));
});

test("Enter on mock output that looks like a command runs the draft", async () => {
  enter("echo ❯ whoami");
  await pause(0);
  // The last "❯ whoami" is the output line; the command's own line says "❯ echo ❯ whoami".
  const output = textarea.value.lastIndexOf("❯ whoami");
  textarea.setSelectionRange(output, output);
  textarea.listeners.keydown({ key: "Enter", code: "", preventDefault: noop });
  await pause(0);
  assert.equal(tab().blocks.at(-1).command, "");
});

test("Ctrl+C stops a mock command and shows ^C", async () => {
  enter("sleep 60");
  assert.equal(store.isRunning(tab().id), true);
  textarea.listeners.keydown({ key: "c", code: "KeyC", ctrlKey: true, metaKey: false, preventDefault: noop });
  await pause(0);
  assert.equal(store.isRunning(tab().id), false);
  assert.equal(tab().blocks.at(-1).output, "^C");
});

test("the mock's clear leaves only a prompt", async () => {
  enter("clear");
  await pause(0);
  assert.deepEqual(tab().blocks, []);
  assert.equal(textarea.value, "❯ ");
});
