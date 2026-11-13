// Output arriving must not re-render the app: the real editor and runner with a fake shell host.

import assert from "node:assert/strict";
import { test } from "node:test";
import { noop, textarea } from "./support/editorDom.js";

let sendEvent;
globalThis.termeedorHost = {
  shell: { prepare: async () => {}, run: async () => {}, write: noop, resize: noop, kill: noop, onEvent: (fn) => { sendEvent = fn; }, complete: async () => [] },
};

const { initEditor, renderEditor } = await import("../src/editor.js");
const { initRunner } = await import("../src/terminal/runner.js");
const { chooseBackend } = await import("../src/adapters/index.js");
const store = await import("../src/store.js");
initRunner(chooseBackend(undefined, { getTab: store.getTab }));
initEditor();
renderEditor();

const FLUSH_WAIT = 80; // longer than the runner's output flush
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

test("output chunks reach the block without a single commit", async () => {
  const tab = store.activeTab();
  let renders = 0;
  store.subscribe(() => { renders++; renderEditor(); });

  textarea.setRangeText("yes", 0, textarea.value.length);
  textarea.listeners.input();
  textarea.listeners.keydown({ key: "Enter", code: "", shiftKey: false, metaKey: false, altKey: false, ctrlKey: false, preventDefault: noop });

  for (let chunk = 0; chunk < 5; chunk++) {
    sendEvent({ tabId: tab.id, event: { type: "output", data: `line ${chunk}\r\n` } });
    await pause(FLUSH_WAIT);
    assert.match(tab.blocks.at(-1).output, new RegExp(`line ${chunk}`));
  }

  sendEvent({ tabId: tab.id, event: { type: "finish", exit: 0, cwd: "~" } });
  await pause(FLUSH_WAIT);
  assert.equal(renders, 0);
});
