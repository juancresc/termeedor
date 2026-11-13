// Runs the real editor, store and runner against a stub DOM and a fake shell host, so these
// check what Enter actually sends to the shell. See support/editorDom.js for what the stub leaves out.

import assert from "node:assert/strict";
import { test } from "node:test";

import { nodeFor, noop, selection, textarea } from "./support/editorDom.js";

const hostRuns = [];
const writes = [];
let sendEvent;
globalThis.termeedorHost = {
  shell: {
    run: async (tabId, command) => { hostRuns.push(command); },
    write: (tabId, data) => writes.push(data),
    prepare: async () => {},
    resize: noop,
    kill: noop,
    onEvent: (fn) => { sendEvent = fn; },
    complete: async (tabId, input) => completionsFor(input),
  },
};
let completionsFor = () => [];

const { initEditor, renderEditor, printToTab, focusEditor } = await import("../src/editor.js");
const { initRunner, forwardKey } = await import("../src/terminal/runner.js");
const { chooseBackend } = await import("../src/adapters/index.js");
const { closeMenu, isMenuOpen, selectedItem } = await import("../src/completionMenu.js");
const store = await import("../src/store.js");
initRunner(chooseBackend(undefined, { getTab: store.getTab }));
initEditor();
store.subscribe(renderEditor);
renderEditor();

const FLUSH_WAIT = 80; // longer than the runner's output flush
const SETTLE_MS = 10; // long enough for the terminal behind the text to parse what it was given
const pause = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const key = (name, extra = {}) => ({ key: name, code: "", shiftKey: false, metaKey: false, altKey: false, ctrlKey: false, preventDefault: noop, ...extra });
const tab = () => store.activeTab();
const output = nodeFor("output");
const inputRow = nodeFor("inputRow");
const scroller = nodeFor("termScroll");

const caretToEnd = () => textarea.setSelectionRange(textarea.value.length, textarea.value.length);

function type(text) {
  textarea.setRangeText(text, textarea.selectionStart, textarea.selectionEnd);
  textarea.listeners.input();
}

function eraseDraft() {
  textarea.value = "";
  textarea.listeners.input();
}

const press = (name, extra) => textarea.listeners.keydown(key(name, extra));
const pressEnter = () => press("Enter");
const blockNodes = () => output.children;
const lastBlock = () => blockNodes().at(-1);
const rerunButtons = () => output.allWithClass("rerun");
const bodyOf = (node) => node.allWithClass("blockOutput")[0];
const tailOf = (node) => node.allWithClass("outputTail")[0];

/** The output as it reads on screen: each block on its own lines. */
const shownText = () => blockNodes().map((node) => node.children.map((part) => part.textContent).filter(Boolean).join("\n")).join("\n");

const emit = (data) => sendEvent({ tabId: tab().id, event: { type: "output", data } });

/** Ends the running command the way the shell does. */
async function finish(data = "") {
  if (data) emit(data);
  sendEvent({ tabId: tab().id, event: { type: "finish", exit: 0, cwd: "~" } });
  await pause(SETTLE_MS);
}

async function run(command, data) {
  type(command);
  pressEnter();
  await finish(data);
}

test("with a host, the keymap is the desktop's", async () => {
  const { withShortcut } = await import("../src/keymap.js");
  assert.match(withShortcut("New tab", "newTab"), /^New tab \((⌘|Ctrl\+)T\)$/);
});

// ---------- the input ----------
test("typing fills the draft, and running moves it into a block", async () => {
  type("echo hi");
  assert.equal(tab().draft, "echo hi");
  pressEnter();
  assert.equal(hostRuns.at(-1), "echo hi");
  assert.equal(tab().draft, "");
  assert.equal(textarea.value, "");
  assert.equal(store.isRunning(tab().id), true);
  assert.ok(shownText().endsWith("❯ echo hi"));
  assert.equal(inputRow.classList.contains("running"), true); // no prompt while it runs

  await finish("hi\r\n");
  assert.equal(store.isRunning(tab().id), false);
  const block = tab().blocks.at(-1);
  assert.deepEqual(block, { command: "echo hi", output: "hi", exit: 0, cwd: "~" });
  assert.ok(shownText().endsWith("❯ echo hi\nhi"));
  assert.equal(inputRow.classList.contains("running"), false);
});

test("Shift+Enter adds a line, Enter runs all of it as one command", async () => {
  type("for i in 1 2; do");
  press("Enter", { shiftKey: true });
  type("  echo $i");
  press("Enter", { shiftKey: true });
  type("done");
  assert.equal(tab().draft, "for i in 1 2; do\n  echo $i\ndone");
  assert.equal(textarea.rows, 3);
  assert.equal(nodeFor("inputLines").textContent, "1\n2\n3");
  assert.equal(store.isRunning(tab().id), false);

  pressEnter();
  assert.equal(hostRuns.at(-1), "for i in 1 2; do\n  echo $i\ndone");
  assert.equal(tab().blocks.at(-1).command, "for i in 1 2; do\n  echo $i\ndone");
  assert.equal(tab().history.at(-1), "for i in 1 2; do\n  echo $i\ndone");
  assert.equal(textarea.rows, 1);
  await finish();
});

test("line numbers only show once the input has more than one line", async () => {
  const hasNumbers = () => nodeFor("inputRow").classList.contains("multiline");
  type("echo hi");
  assert.equal(hasNumbers(), false);
  press("Enter", { shiftKey: true });
  assert.equal(hasNumbers(), true);
  pressEnter();
  assert.equal(hasNumbers(), false);
  await finish();
});

test("the input stops growing, and scrolls instead", () => {
  store.addTab();
  type("\n".repeat(40));
  assert.equal(textarea.rows, 12);
  assert.equal(nodeFor("inputLines").textContent.split("\n").length, 41);
  eraseDraft();
});

test("a pasted multi-line draft keeps its line breaks", () => {
  store.addTab();
  type("a\nb\nc");
  assert.equal(tab().draft, "a\nb\nc");
  eraseDraft();
});

test("each tab keeps its own draft", () => {
  const first = store.addTab();
  type("first\ndraft");
  store.addTab();
  assert.equal(textarea.value, "");
  type("second");
  store.activateTab(first.id);
  assert.equal(textarea.value, "first\ndraft");
  assert.equal(tab().draft, "first\ndraft");
  eraseDraft();
});

test("Up and Down recall history through the draft", async () => {
  await run("echo recalled", "recalled\r\n");
  type("ec");
  press("ArrowUp");
  assert.equal(tab().draft, "echo recalled");
  assert.equal(textarea.value, "echo recalled");
  press("ArrowDown");
  assert.equal(tab().draft, "ec");
  eraseDraft();
});

test("Up and Down only recall past commands that start with what was typed", async () => {
  store.addTab();
  await run("bash one");
  await run("ls");
  await run("bash two");
  await run("echo bash");
  type("bas");
  press("ArrowUp");
  assert.equal(tab().draft, "bash two");
  press("ArrowUp");
  assert.equal(tab().draft, "bash one");
  press("ArrowUp"); // no older match: stays put
  assert.equal(tab().draft, "bash one");
  press("ArrowDown");
  assert.equal(tab().draft, "bash two");
  press("ArrowDown");
  assert.equal(tab().draft, "bas");
  eraseDraft();
});

test("Up reaches commands run in other tabs, after this tab's own", async () => {
  store.addTab();
  await run("npm run build");
  store.addTab();
  await run("npm test");
  type("np");
  press("ArrowUp");
  assert.equal(tab().draft, "npm test");
  press("ArrowUp");
  assert.equal(tab().draft, "npm run build");
  press("ArrowDown");
  assert.equal(tab().draft, "npm test");
  press("ArrowDown");
  assert.equal(tab().draft, "np");
  eraseDraft();
});

test("Up reaches commands from closed tabs", async () => {
  store.addTab();
  await run("make deploy");
  store.closeTab(tab());
  store.addTab();
  type("make");
  press("ArrowUp");
  assert.equal(tab().draft, "make deploy");
  eraseDraft();
});

test("with shared history off, Up only browses this tab's commands", async () => {
  store.addTab();
  await run("yarn build");
  store.addTab();
  store.state.settings.sharedHistory = false;
  type("yarn");
  press("ArrowUp");
  assert.equal(tab().draft, "yarn");
  store.state.settings.sharedHistory = true;
  eraseDraft();
});

test("Up and Down only browse history from the input's first and last lines", async () => {
  store.addTab();
  await run("one\ntwo\nthree; echo old");
  type("one\ntwo\nthree");

  let stopped = false;
  const arrow = (name) => textarea.listeners.keydown(key(name, { preventDefault: () => { stopped = true; } }));

  textarea.setSelectionRange(5, 5); // on "two"
  arrow("ArrowUp");
  arrow("ArrowDown");
  assert.equal(stopped, false); // the browser moves the caret between the lines
  assert.equal(tab().draft, "one\ntwo\nthree");

  caretToEnd(); // on "three": Up stays in the input, Down has no more history to show
  arrow("ArrowUp");
  assert.equal(stopped, false);
  assert.equal(tab().draft, "one\ntwo\nthree");

  textarea.setSelectionRange(2, 2); // on "one": Down moves within the input, Up leaves it
  arrow("ArrowDown");
  assert.equal(stopped, false);
  arrow("ArrowUp");
  assert.equal(stopped, true);
  assert.equal(tab().draft, "one\ntwo\nthree; echo old");

  press("ArrowDown");
  assert.equal(tab().draft, "one\ntwo\nthree");
  eraseDraft();
});

test("a recalled multi-line command comes back with its lines", async () => {
  store.addTab();
  type("a\nb");
  pressEnter();
  await finish();
  press("ArrowUp");
  assert.equal(tab().draft, "a\nb");
  eraseDraft();
});

test("the status bar's position is the input's", () => {
  store.addTab();
  type("ab\ncd");
  textarea.listeners.keyup();
  assert.equal(nodeFor("stPos").textContent, "Ln 2, Col 3");
  eraseDraft();
});

test("changing directory changes the prompt, and past commands keep theirs", async () => {
  store.addTab();
  type("cd project");
  pressEnter();
  sendEvent({ tabId: tab().id, event: { type: "finish", exit: 0, cwd: "~/dev/project" } });
  await pause(SETTLE_MS);
  assert.equal(nodeFor("promptMark").textContent, "project ❯ ");
  assert.equal(lastBlock().allWithClass("commandPrompt")[0].textContent, "~ ❯ ");
  assert.equal(lastBlock().allWithClass("commandText")[0].textContent, "cd project");

  type("ls");
  assert.equal(tab().draft, "ls"); // the prompt isn't part of what can be edited
  eraseDraft();
});

test("Enter with the cursor inside the line still runs the whole line", async () => {
  store.addTab();
  type("code .");
  textarea.setSelectionRange(5, 5);
  pressEnter();
  assert.equal(tab().blocks.at(-1).command, "code .");
  assert.equal(textarea.value, "");
  await finish();
});

test("a trailing space isn't part of the command", async () => {
  store.addTab();
  type("code . ");
  pressEnter();
  assert.equal(tab().blocks.at(-1).command, "code .");
  assert.equal(hostRuns.at(-1), "code .");
  await finish();
});

test("Ctrl+W deletes the input's last word and stops at the prompt", { skip: !/Mac/.test(navigator.platform) }, () => {
  const ctrlW = key("w", { code: "KeyW", ctrlKey: true });
  eraseDraft();
  type("git commit  ");
  caretToEnd();

  textarea.listeners.keydown(ctrlW);
  assert.equal(tab().draft, "git ");
  textarea.listeners.keydown(ctrlW);
  assert.equal(tab().draft, "");
  textarea.listeners.keydown(ctrlW);
  assert.equal(textarea.value, "");
});

const ctrl = (code) => press(code.at(-1).toLowerCase(), { code, ctrlKey: true });

test("Ctrl+U deletes back to the prompt and keeps what is after the cursor", () => {
  store.addTab();
  type("git status");
  textarea.setSelectionRange(4, 4);
  ctrl("KeyU");
  assert.equal(tab().draft, "status");
  eraseDraft();
});

test("on a multi-line input, Ctrl+U only deletes back to the start of the line", () => {
  store.addTab();
  type("first\nsecond");
  caretToEnd();
  ctrl("KeyU");
  assert.equal(tab().draft, "first\n");
  eraseDraft();
});

test("Ctrl+C with nothing running drops the typed line, unless text is selected to copy", () => {
  store.addTab();
  const blocks = tab().blocks.length;
  ctrl("KeyC"); // nothing typed: still a fresh line
  assert.equal(tab().blocks.length, blocks + 1);
  assert.equal(tab().blocks.at(-1).output, "~ ❯ ^C");

  type("oops");
  textarea.setSelectionRange(0, 3);
  ctrl("KeyC");
  assert.equal(tab().draft, "oops");

  caretToEnd();
  ctrl("KeyC");
  assert.equal(tab().draft, "");
  assert.equal(tab().blocks.at(-1).output, "~ ❯ oops^C");
  assert.equal(tab().blocks.at(-1).command, null);
  assert.ok(shownText().endsWith("^C"));
  assert.equal(textarea.value, "");
});

test("Ctrl+L clears the screen and keeps what is being typed", async () => {
  store.addTab();
  await run("echo hi", "hi\r\n");
  type("next");
  ctrl("KeyL");
  assert.deepEqual(tab().blocks, []);
  assert.equal(tab().draft, "next");
  assert.equal(textarea.value, "next");
  assert.equal(blockNodes().length, 0);
  assert.equal(tab().history.length, 1);
  eraseDraft();
});

test("Ctrl+P and Ctrl+N walk through past commands and back to the draft", async () => {
  store.addTab();
  await run("echo one", "one\r\n");
  type("echo");
  caretToEnd();
  ctrl("KeyP");
  assert.equal(tab().draft, "echo one");
  ctrl("KeyN");
  assert.equal(tab().draft, "echo");
  eraseDraft();
});

test("select all selects the input", () => {
  store.addTab();
  type("one\ntwo");
  caretToEnd();
  press("a", { code: "KeyA", ...(/Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true }) });
  assert.deepEqual([textarea.selectionStart, textarea.selectionEnd], [0, 7]);
  caretToEnd();
  eraseDraft();
});

// ---------- completion ----------
test("Tab completes the current line and leaves the other lines alone", async () => {
  store.addTab();
  completionsFor = (input) => (input === "gi" ? [{ value: "git ", label: "git", kind: "command" }] : []);
  type("first line\ngi");
  caretToEnd();
  press("Tab");
  await pause(0);
  assert.equal(tab().draft, "first line\ngit ");
  completionsFor = () => [];
  eraseDraft();
});

test("several completions open the menu, and Enter takes one without running anything", async () => {
  store.addTab();
  const before = hostRuns.length;
  completionsFor = () => [{ value: "git add", label: "git add", kind: "command" }, { value: "git am", label: "git am", kind: "command" }];
  type("git a");
  press("Tab");
  await pause(0);
  assert.equal(isMenuOpen(), true);
  assert.equal(selectedItem().value, "git add");
  pressEnter();
  assert.equal(isMenuOpen(), false);
  assert.equal(tab().draft, "git add");
  assert.equal(hostRuns.length, before);
  completionsFor = () => [];
  closeMenu();
  eraseDraft();
});

test("matches that share less than what is typed leave the line as it is, and the menu shows descriptions", async () => {
  store.addTab();
  completionsFor = () => [{ value: "cat readme.md ", label: "readme.md", kind: "file", description: "the readme" }, { value: "cat some.md ", label: "some.md", kind: "file" }];
  type("cat me");
  press("Tab");
  await pause(0);
  assert.equal(tab().draft, "cat me");
  const [menu] = document.body.allWithClass("completions");
  assert.deepEqual(menu.children.map((row) => row.children[1].textContent), ["the readme", "file"]);
  completionsFor = () => [];
  closeMenu();
  eraseDraft();
});

// ---------- the blocks ----------
test("a command's own output that looks like a command gets no button and can't run", async () => {
  store.addTab();
  await run("cat notes", "❯ rm -rf x\r\n");
  const before = hostRuns.length;
  assert.equal(rerunButtons().length, 1);
  assert.equal(lastBlock().allWithClass("commandText")[0].textContent, "cat notes");
  assert.equal(bodyOf(lastBlock()).textContent, "❯ rm -rf x");

  scroller.listeners.mouseup({ button: 0 }); // clicking anywhere in the output
  assert.equal(hostRuns.length, before);
  pressEnter(); // Enter runs only the (empty) input
  assert.equal(tab().blocks.at(-1).command, "");
  assert.equal(hostRuns.length, before);
  await pause(SETTLE_MS);
  assert.ok(!hostRuns.includes("rm -rf x"));
});

test("printed text and migrated-looking text have no button", () => {
  store.addTab();
  printToTab(tab(), "❯ rm -rf printed");
  assert.equal(rerunButtons().length, 0);
  assert.equal(lastBlock().classList.contains("isCommand"), false);
  assert.equal(lastBlock().textContent, "❯ rm -rf printed");
});

test("the button re-runs its own command and keeps the draft for after", async () => {
  store.addTab();
  await run("echo again", "again\r\n");
  type("half typed");
  rerunButtons()[0].listeners.click();
  assert.equal(hostRuns.at(-1), "echo again");
  assert.equal(tab().draft, "half typed");
  assert.equal(inputRow.classList.contains("running"), true); // hidden while it runs
  assert.equal(document.activeElement, textarea);
  await finish("again\r\n");
  assert.equal(inputRow.classList.contains("running"), false);
  assert.equal(textarea.value, "half typed");
  eraseDraft();
});

test("the button does nothing while a command runs", async () => {
  store.addTab();
  await run("echo first");
  type("sleep 1");
  pressEnter();
  const before = hostRuns.length;
  rerunButtons()[0].listeners.click();
  assert.equal(hostRuns.length, before);
  await finish();
});

test("a re-run multi-line command is sent whole", async () => {
  store.addTab();
  await run("echo a\necho b");
  rerunButtons()[0].listeners.click();
  assert.equal(hostRuns.at(-1), "echo a\necho b");
  await finish();
});

test("an empty command has no button", async () => {
  store.addTab();
  pressEnter();
  await pause(SETTLE_MS);
  assert.equal(tab().blocks.at(-1).command, "");
  assert.equal(rerunButtons().length, 0);
});

test("output streaming into a running block leaves the other blocks alone", async () => {
  store.addTab();
  await run("echo before", "before\r\n");
  type("build");
  pressEnter();
  const [banner, before, running] = blockNodes();
  const beforeNodes = [...bodyOf(before).children];

  emit("one\r\n");
  await pause(FLUSH_WAIT);
  const firstText = tailOf(running).children[0];
  emit("two\r\n");
  await pause(FLUSH_WAIT);

  assert.deepEqual(blockNodes(), [banner, before, running]);
  assert.deepEqual(bodyOf(before).children, beforeNodes);
  assert.equal(tailOf(running).children[0], firstText); // added to, not replaced
  assert.equal(bodyOf(running).textContent, "one\ntwo");
  await finish();
});

test("printing during a run goes above its output, which keeps redrawing", async () => {
  store.addTab();
  type("build");
  pressEnter();
  emit("one\r\n");
  await pause(FLUSH_WAIT);
  printToTab(tab(), "note");
  emit("two\r\n");
  await pause(FLUSH_WAIT);
  assert.ok(shownText().endsWith("note\n~ ❯ build\none\ntwo"));
  await finish();
});

test("printing at the prompt keeps what is typed", () => {
  store.addTab();
  type("half");
  printToTab(tab(), "hello");
  assert.ok(shownText().endsWith("hello"));
  assert.equal(tab().draft, "half");
  assert.equal(textarea.value, "half");
  eraseDraft();
});

test("printed carriage returns become plain line breaks, and spoofed lines in them stay text", () => {
  store.addTab();
  printToTab(tab(), "one\r\n❯ rm -rf x\rthree");
  assert.equal(tab().blocks.at(-1).output, "one\n❯ rm -rf x\nthree");
  assert.equal(tab().blocks.at(-1).command, null);
  assert.equal(rerunButtons().length, 0);
});

test("output that erases the scrollback clears the tab, its command too", async () => {
  store.addTab();
  type("clear");
  pressEnter();
  emit("\x1b[3J\x1b[2J");
  await pause(FLUSH_WAIT);
  assert.equal(shownText(), "");
  assert.equal(rerunButtons().length, 0);
  await finish();
  assert.equal(shownText(), "");
  assert.equal(textarea.value, "");
  assert.deepEqual(tab().blocks, []);
});

test("a long running output only ever adds to what it drew, and still reads right", async () => {
  store.addTab();
  type("build");
  pressEnter();
  const lines = Array.from({ length: 200 }, (_, i) => `\x1b[${31 + (i % 6)}mline ${i}\x1b[0m`);
  emit(`${lines.slice(0, 100).join("\r\n")}\r\n`);
  await pause(FLUSH_WAIT);
  const body = bodyOf(lastBlock());
  const firstChunk = lastBlock().allWithClass("outputChunk")[0];
  assert.ok(firstChunk, "lines that scrolled off the screen are kept apart");
  emit(`${lines.slice(100).join("\r\n")}\r\n`);
  await pause(FLUSH_WAIT);
  assert.equal(lastBlock().allWithClass("outputChunk")[0], firstChunk);
  assert.equal(body.textContent, tab().blocks.at(-1).output);
  assert.ok(body.textContent.endsWith("line 199"));
  await finish();
  assert.equal(body.textContent, tab().blocks.at(-1).output);
});

test("a redraw of the screen after the screen was cleared still reads right", async () => {
  store.addTab();
  type("build");
  pressEnter();
  emit(`${"line\r\n".repeat(60)}`);
  await pause(FLUSH_WAIT);
  emit("\x1b[2J\x1b[H"); // only blank lines are left on the screen: the text ends earlier than what was frozen
  await pause(FLUSH_WAIT);
  assert.equal(bodyOf(lastBlock()).textContent, tab().blocks.at(-1).output);
  emit("back\r\n");
  await pause(FLUSH_WAIT);
  assert.equal(bodyOf(lastBlock()).textContent, tab().blocks.at(-1).output);
  assert.ok(tab().blocks.at(-1).output.endsWith("back"));
  await finish();
});

// ---------- color ----------
const allPieces = (node) => bodyOf(node).children.flatMap((part) => part.children);

test("color reaches the block as ranges and the page as spans, and output stays plain", async () => {
  store.addTab();
  const seen = [];
  const registry = await import("../src/plugins/registry.js");
  const off = registry.on("test-color", "command:finish", (e) => seen.push(e.output));
  await run("ls", "\x1b[1;31mred\x1b[0m and \x1b[38;2;1;2;3mdeep\x1b[0m\r\n");
  off();
  const block = tab().blocks.at(-1);
  assert.equal(block.output, "red and deep");
  assert.deepEqual(block.styles, [[0, 3, "1;31"], [8, 12, "38;2;1;2;3"]]);
  assert.deepEqual(seen, ["red and deep"]);

  assert.equal(bodyOf(lastBlock()).textContent, "red and deep");
  const [red, plain, deep] = allPieces(lastBlock());
  assert.equal(red.className, "ansiBold");
  assert.equal(red.style.color, "var(--ansi-1)");
  assert.equal(plain.tagName, "#text");
  assert.equal(deep.style.color, "rgb(1, 2, 3)");
});

test("a code that isn't valid draws plain text, whatever put it there", () => {
  store.addTab();
  printToTab(tab(), "<b>text</b>");
  const block = tab().blocks.at(-1);
  block.styles = [[0, 3, "</span><img src=x>"]];
  block.output = "<b>text</b>!";
  renderEditor();
  assert.equal(bodyOf(lastBlock()).textContent, "<b>text</b>!");
  assert.ok(allPieces(lastBlock()).every((node) => node.tagName === "#text"));
});

test("text only ever reaches the output as text", async () => {
  const fs = await import("node:fs");
  for (const name of ["outputView.js", "inputEditor.js"]) {
    assert.doesNotMatch(fs.readFileSync(new URL(`../src/terminal/${name}`, import.meta.url), "utf8"), /innerHTML|outerHTML|insertAdjacentHTML/, name);
  }
});

test("a progress bar redraw still lands on one line, in its latest color", async () => {
  store.addTab();
  await run("pull", "\x1b[32m 10%\x1b[0m\r\x1b[K\x1b[33m100%\x1b[0m\r\ndone\r\n");
  const block = tab().blocks.at(-1);
  assert.equal(block.output, "100%\ndone");
  assert.deepEqual(block.styles, [[0, 4, "33"]]);
});

// ---------- while a command runs ----------
test("Enter while a command runs does nothing", async () => {
  store.addTab();
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

test("an interactive program's prompt shows with no line break, and typing reaches it", async () => {
  store.addTab();
  type("python3");
  pressEnter();
  emit("Python 3\r\n>>> ");
  await pause(FLUSH_WAIT);
  assert.equal(bodyOf(lastBlock()).textContent, "Python 3\n>>> ");
  assert.equal(output.classList.contains("running"), true);

  assert.equal(document.activeElement, textarea);
  press("1", { code: "Digit1" });
  pressEnter();
  assert.deepEqual(writes.slice(-2), ["1", "\r"]);
  emit("1\r\n1\r\n>>> ");
  await pause(FLUSH_WAIT);
  assert.equal(bodyOf(lastBlock()).textContent, "Python 3\n>>> 1\n1\n>>> ");
  assert.equal(tab().draft, ""); // none of it went into the draft
  await finish();
  assert.equal(output.classList.contains("running"), false);
});

test("while a command runs, a paste goes to it and nothing can change the hidden draft", async () => {
  store.addTab();
  type("cat");
  pressEnter();
  let stopped = 0;
  const preventDefault = () => { stopped++; };
  textarea.listeners.beforeinput({ inputType: "insertFromPaste", data: "pasted\ntext", preventDefault });
  assert.equal(writes.at(-1), "pasted\rtext"); // line breaks go out as Enter, like a terminal pastes them
  textarea.listeners.beforeinput({ inputType: "historyUndo", data: null, preventDefault });
  assert.equal(stopped, 2);

  textarea.value = "composed"; // what composing text does, which can't be stopped in advance
  textarea.listeners.input();
  assert.equal(textarea.value, "");
  assert.equal(tab().draft, "");

  await finish();
  stopped = 0;
  textarea.listeners.beforeinput({ inputType: "insertText", data: "x", preventDefault });
  assert.equal(stopped, 0); // the input is a plain text box again
});

test("Ctrl+C goes to the running program", async () => {
  store.addTab();
  type("sleep 9");
  pressEnter();
  ctrl("KeyC");
  assert.equal(writes.at(-1), "\x03");
  await finish();
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

// ---------- focus and scrolling ----------
function withFocusOnPage(fn) {
  const before = document.activeElement;
  document.activeElement = document.body;
  try {
    return fn();
  } finally {
    document.activeElement = before;
  }
}

test("clicking the output focuses the input, unless text was selected", () => {
  withFocusOnPage(() => {
    selection.isCollapsed = false;
    scroller.listeners.mouseup({ button: 0 });
    assert.equal(document.activeElement, document.body);
    selection.isCollapsed = true;
    scroller.listeners.mouseup({ button: 2 });
    assert.equal(document.activeElement, document.body);
    scroller.listeners.mouseup({ button: 0 });
    assert.equal(document.activeElement, textarea);
  });
});

test("typing with focus elsewhere in the area goes to the input", () => {
  store.addTab();
  withFocusOnPage(() => {
    document.listeners.keydown({ ...key("x", { code: "KeyX" }), target: document.body });
    assert.equal(document.activeElement, textarea);
  });
  withFocusOnPage(() => {
    document.listeners.keydown({ ...key("Shift"), target: document.body });
    assert.equal(document.activeElement, document.body); // a modifier alone isn't typing
    document.listeners.keydown({ ...key("c", { code: "KeyC", metaKey: true }), target: document.body });
    assert.equal(document.activeElement, document.body); // Cmd+C copies what is selected
  });
});

test("while a command runs, typing with focus elsewhere still goes to the program", async () => {
  store.addTab();
  type("cat");
  pressEnter();
  withFocusOnPage(() => {
    document.listeners.keydown({ ...key("y", { code: "KeyY" }), target: document.body });
    assert.equal(writes.at(-1), "y");
    assert.equal(document.activeElement, textarea);
  });
  await finish();
});

test("a paste with focus elsewhere goes to the input", () => {
  store.addTab();
  withFocusOnPage(() => {
    document.listeners.paste({ target: document.body, preventDefault: noop, clipboardData: { getData: () => "pasted\r\nlines" } });
  });
  assert.equal(tab().draft, "pasted\nlines");
  eraseDraft();
});

test("focusEditor focuses the input", () => {
  withFocusOnPage(() => {
    focusEditor();
    assert.equal(document.activeElement, textarea);
  });
});

test("output follows the bottom unless the user scrolled up, per tab", async () => {
  const first = store.addTab();
  scroller.scrollHeight = 1000;
  scroller.clientHeight = 100;
  renderEditor();
  assert.equal(scroller.scrollTop, 1000);

  // The user scrolls up: new output doesn't move the view.
  scroller.scrollTop = 200;
  scroller.listeners.scroll();
  printToTab(first, "more");
  assert.equal(scroller.scrollTop, 200);

  // Another tab follows its own bottom, and coming back restores the place.
  store.addTab();
  assert.equal(scroller.scrollTop, 1000);
  store.activateTab(first.id);
  assert.equal(scroller.scrollTop, 200);

  // A new command means following again.
  type("echo x");
  pressEnter();
  assert.equal(scroller.scrollTop, 1000);
  await finish();
  scroller.scrollHeight = 0;
  scroller.scrollTop = 0;
});

// ---------- plugins and tabs ----------
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
  assert.equal(textarea.value, "kept");
  eraseDraft();
});

test("a reopened tab keeps its colors on screen", async () => {
  store.addTab();
  await run("ls", "\x1b[31mred\x1b[0m\r\n");
  store.closeTab(tab());
  store.reopenPast(store.state.past[0]);
  assert.deepEqual(tab().blocks.at(-1).styles, [[0, 3, "31"]]);
  assert.equal(allPieces(lastBlock())[0].style.color, "var(--ansi-1)");
});

test("closing a tab mid-run archives it and ends the run", async () => {
  const closing = store.addTab();
  renderEditor();
  type("sleep 9");
  pressEnter();
  assert.equal(store.isRunning(closing.id), true);
  store.closeTab(closing);
  await pause(SETTLE_MS);
  assert.equal(store.isRunning(closing.id), false);
  assert.equal(store.state.past[0].tab.blocks.at(-1).command, "sleep 9");
});

test("running a command doesn't redraw the app, and the status bar still follows it", async () => {
  let redraws = 0;
  let counting = true;
  store.subscribe(() => { if (counting) redraws++; });
  try {
    type("cd /elsewhere");
    pressEnter();
    assert.equal(store.isRunning(tab().id), true);

    sendEvent({ tabId: tab().id, event: { type: "finish", exit: 0, cwd: "/elsewhere" } });
    await pause(FLUSH_WAIT);
    assert.equal(store.isRunning(tab().id), false);
    assert.equal(nodeFor("stRunning").textContent, "");
    assert.equal(nodeFor("stCwd").textContent, "/elsewhere");
    assert.equal(nodeFor("promptMark").textContent, "elsewhere ❯ ");
    assert.equal(redraws, 0);
  } finally {
    counting = false;
  }
});
