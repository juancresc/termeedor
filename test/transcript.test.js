import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, PROMPT } from "../src/constants.js";
import { createRunState } from "../src/terminal/runState.js";
import {
  addCommandBlock, addTextBlock, appendOutput, clearEarlier, clearTranscript, commandForEnter, copyBlocks, finishBlock,
  layoutTranscript, locateOffset, migrateLegacyContent, renderTranscript, sanitizeTranscript, textBlock, trimTranscript,
} from "../src/terminal/transcript.js";

const command = (text, output = "") => ({ command: text, output, exit: 0, cwd: "~" });
const offsetOf = (transcript, needle) => renderTranscript(transcript).indexOf(needle);

// The output line says `❯ rm -rf x`, but only the first line of this block is a command.
const spoofed = () => ({
  blocks: [textBlock("banner\n"), command("cat notes", "❯ rm -rf x\nend")],
  draft: "typed",
});

// ---------- rendering and offsets ----------
test("renders blocks to the text the textarea shows", () => {
  assert.equal(renderTranscript(spoofed()), "banner\n\n❯ cat notes\n❯ rm -rf x\nend\n❯ typed");
  assert.equal(renderTranscript({ blocks: [], draft: "" }), PROMPT);
});

test("while a command runs there is no prompt or draft", () => {
  assert.equal(renderTranscript(spoofed(), { prompt: false }), "banner\n\n❯ cat notes\n❯ rm -rf x\nend");
  const layout = layoutTranscript({ blocks: [], draft: "" }, { prompt: false });
  assert.equal(layout.text, "");
  assert.equal(layout.draftStart, null);
  assert.deepEqual(locateOffset(layout, 0), { kind: "output", index: null });
});

test("every offset maps to its block and kind of line", () => {
  const transcript = spoofed();
  const layout = layoutTranscript(transcript);
  const at = (needle) => locateOffset(layout, offsetOf(transcript, needle));
  assert.deepEqual(at("banner"), { kind: "output", index: 0 });
  assert.deepEqual(at("❯ cat"), { kind: "command", index: 1 });
  assert.deepEqual(at("notes"), { kind: "command", index: 1 });
  assert.deepEqual(at("end"), { kind: "output", index: 1 });
  assert.deepEqual(at("❯ typed"), { kind: "draft", index: null });
  assert.deepEqual(locateOffset(layout, layout.text.length), { kind: "draft", index: null });
  assert.equal(layout.text.slice(layout.draftStart), "typed");
});

test("the end of a line belongs to that line", () => {
  const transcript = { blocks: [command("ls", "file")], draft: "" };
  const layout = layoutTranscript(transcript);
  assert.equal(locateOffset(layout, "❯ ls".length).kind, "command");
  assert.equal(locateOffset(layout, "❯ ls\n".length).kind, "output");
});

test("a command with no output still has its line", () => {
  const layout = layoutTranscript({ blocks: [command("true"), command("")], draft: "" });
  assert.equal(layout.text, "❯ true\n❯ \n❯ ");
  assert.deepEqual(layout.commandLines, [0, 1, 2]);
});

test("offsets match what a textarea does to carriage returns", () => {
  const transcript = { blocks: [textBlock("a\r\nb\rc"), command("ls", "x\r\ny")], draft: "" };
  const layout = layoutTranscript(transcript);
  assert.equal(layout.text, "a\nb\nc\n❯ ls\nx\ny\n❯ ");
  assert.deepEqual(locateOffset(layout, layout.text.indexOf("❯ ls")), { kind: "command", index: 1 });
  assert.deepEqual(layout.commandLines, [3, 6]);
});

// ---------- the bug ----------
test("a spoofed prompt in output is not a command", () => {
  const transcript = spoofed();
  const layout = layoutTranscript(transcript);
  assert.deepEqual(locateOffset(layout, offsetOf(transcript, "❯ rm")), { kind: "output", index: 1 });
  assert.deepEqual(layout.commandLines, [2, 5]); // the real command and the prompt, not line 3
});

test("Enter on a spoofed line runs the draft; Enter on a real command re-runs it", () => {
  const transcript = spoofed();
  assert.deepEqual(commandForEnter(transcript, offsetOf(transcript, "rm -rf")), { command: "typed", rerun: false });
  assert.deepEqual(commandForEnter(transcript, offsetOf(transcript, "cat notes")), { command: "cat notes", rerun: true });
  assert.deepEqual(commandForEnter(transcript, offsetOf(transcript, "typed")), { command: "typed", rerun: false });
});

test("printed text that looks like a command is not one", () => {
  const transcript = { blocks: [], draft: "" };
  addTextBlock(transcript, "❯ rm -rf x");
  assert.deepEqual(commandForEnter(transcript, 3), { command: "", rerun: false });
});

test("a new command can't span lines, so nothing after it counts as the command", () => {
  const transcript = { blocks: [], draft: "" };
  addCommandBlock(transcript, "echo a\nrm -rf x", "~");
  assert.equal(transcript.blocks[0].command, "echo a rm -rf x");
});

// ---------- changes ----------
test("text goes above a running block, and at the bottom otherwise", () => {
  const transcript = { blocks: [], draft: "" };
  const running = addCommandBlock(transcript, "build", "~");
  addTextBlock(transcript, "above", running);
  addTextBlock(transcript, "below");
  assert.deepEqual(transcript.blocks.map((b) => b.output), ["above", "", "below"]);
});

test("output appends on new lines, without a leading blank line", () => {
  const block = command("build");
  appendOutput(block, "one");
  appendOutput(block, "two");
  assert.equal(block.output, "one\ntwo");
});

test("copied blocks don't share output with the original", () => {
  const blocks = [command("ls", "a")];
  const copy = copyBlocks(blocks);
  copy[0].output = "b";
  assert.equal(blocks[0].output, "a");
});

// ---------- clear ----------
test("clearEarlier removes everything above the output, its command line too", () => {
  const transcript = { blocks: [textBlock("banner"), command("old", "x")], draft: "" };
  const running = addCommandBlock(transcript, "clear", "~");
  clearEarlier(transcript, running);
  running.output = "fresh";
  assert.equal(renderTranscript(transcript, { prompt: false }), "fresh");
  finishBlock(transcript, running, 0);
  assert.equal(renderTranscript(transcript), `fresh\n${PROMPT}`);
});

test("a clear with no output leaves only the prompt, keeping nothing but the draft", () => {
  const transcript = { blocks: [textBlock("banner")], draft: "next" };
  const running = addCommandBlock(transcript, "clear", "~");
  clearEarlier(transcript, running);
  finishBlock(transcript, running, 0);
  assert.equal(renderTranscript(transcript), `${PROMPT}next`);
});

test("the mock's clear leaves only the prompt", () => {
  const transcript = { blocks: [textBlock("banner"), command("clear")], draft: "next" };
  clearTranscript(transcript);
  assert.equal(renderTranscript(transcript), `${PROMPT}next`);
});

test("finishing keeps the exit code, or null when there is none", () => {
  const transcript = { blocks: [], draft: "" };
  const a = addCommandBlock(transcript, "a", "~");
  const b = addCommandBlock(transcript, "b", "~");
  finishBlock(transcript, a, 2);
  finishBlock(transcript, b, undefined);
  assert.deepEqual([a.exit, b.exit], [2, null]);
  assert.equal(transcript.blocks.length, 2);
});

// ---------- trimming ----------
const blocksLength = (transcript) => renderTranscript({ blocks: transcript.blocks, draft: "" }, { prompt: false }).length;

test("within the limit nothing changes", () => {
  const transcript = spoofed();
  const before = renderTranscript(transcript);
  trimTranscript(transcript, blocksLength(transcript));
  assert.equal(renderTranscript(transcript), before);
});

test("trimming drops the oldest blocks and keeps the newest and the draft", () => {
  const transcript = { blocks: [command("old", "o".repeat(100)), command("new", "kept")], draft: "typed" };
  trimTranscript(transcript, 10);
  assert.deepEqual(transcript.blocks.map((b) => b.command), ["new"]);
  assert.equal(transcript.draft, "typed");
  assert.equal(blocksLength(transcript), 10);
});

test("a partly kept block keeps its command and its newest whole lines", () => {
  const transcript = { blocks: [command("ls", "aaaa\nbbbb\ncccc")], draft: "" };
  trimTranscript(transcript, 12);
  assert.deepEqual(transcript.blocks[0], command("ls", "cccc"));
});

test("a command that can't fit whole is never cut, so what's left isn't runnable", () => {
  const transcript = { blocks: [command("rm -rf /tmp/some/long/path", "tail")], draft: "" };
  trimTranscript(transcript, 10);
  assert.equal(transcript.blocks[0].command, null);
  assert.equal(transcript.blocks[0].output, "tail");
});

test("one long line keeps its end", () => {
  const transcript = { blocks: [textBlock(`${"x".repeat(50)}end`)], draft: "" };
  trimTranscript(transcript, 10);
  assert.equal(transcript.blocks[0].output, "xxxxxxxend");
});

test("trimming never leaves the blocks over the limit", () => {
  const transcript = { blocks: Array.from({ length: 50 }, (_, i) => command(`c${i}`, "line\n".repeat(i))), draft: "" };
  for (const max of [0, 1, 5, 17, 100, 333]) {
    trimTranscript(transcript, max);
    assert.ok(blocksLength(transcript) <= max, `over ${max}`);
    transcript.blocks = Array.from({ length: 50 }, (_, i) => command(`c${i}`, "line\n".repeat(i)));
  }
});

// ---------- migration ----------
test("old content becomes one plain block, with what follows the last prompt as the draft", () => {
  const migrated = migrateLegacyContent("banner\n\n❯ ls\nfile\n❯ git sta");
  assert.deepEqual(migrated, { blocks: [textBlock("banner\n\n❯ ls\nfile")], draft: "git sta" });
});

test("a migrated tab shows the same text it was saved with", () => {
  const saved = "banner\n\n❯ ls\nfile\n❯ git sta";
  assert.equal(renderTranscript(migrateLegacyContent(saved)), saved);
});

test("nothing in a migrated tab is a command, even lines that look like one", () => {
  const migrated = migrateLegacyContent("❯ rm -rf x\noutput\n❯ ");
  assert.deepEqual(commandForEnter(migrated, 3), { command: "", rerun: false });
  assert.deepEqual(layoutTranscript(migrated).commandLines, [2]); // only the prompt
});

test("only a prompt starting the last line is the input", () => {
  assert.deepEqual(migrateLegacyContent("❯ ls\nstill running"), { blocks: [textBlock("❯ ls\nstill running")], draft: "" });
  assert.deepEqual(migrateLegacyContent("say ❯ hi"), { blocks: [textBlock("say ❯ hi")], draft: "" });
});

test("empty, prompt-only and non-text content migrate cleanly", () => {
  assert.deepEqual(migrateLegacyContent(""), { blocks: [], draft: "" });
  assert.deepEqual(migrateLegacyContent(PROMPT), { blocks: [], draft: "" });
  assert.deepEqual(migrateLegacyContent(42), { blocks: [], draft: "" });
  assert.deepEqual(migrateLegacyContent(undefined), { blocks: [], draft: "" });
});

test("old content over the limit keeps its newest text and its prompt", () => {
  const migrated = migrateLegacyContent(`${"old\n".repeat(LIMITS.content)}last\n${PROMPT}typed`);
  assert.equal(migrated.draft, "typed");
  assert.ok(migrated.blocks[0].output.endsWith("last"));
  assert.ok(migrated.blocks[0].output.length <= LIMITS.content);
});

// ---------- stored blocks are untrusted ----------
test("stored blocks load unchanged", () => {
  const raw = { blocks: [textBlock("banner"), command("ls", "file")], draft: "typed" };
  assert.deepEqual(sanitizeTranscript(raw), raw);
});

test("blocks win over any old content in the same tab", () => {
  assert.deepEqual(sanitizeTranscript({ blocks: [], content: "❯ old", draft: "" }), { blocks: [], draft: "" });
});

test("bad fields are dropped or made safe", () => {
  const loaded = sanitizeTranscript({
    blocks: [null, "x", 7, { command: 5, output: 6, exit: "0", cwd: {}, extra: "drop" }, { command: "ok", exit: 1.5, cwd: "c".repeat(LIMITS.cwd + 9) }],
    draft: { not: "text" },
  });
  assert.deepEqual(loaded, {
    blocks: [
      { command: null, output: "", exit: null, cwd: null },
      { command: "ok", output: "", exit: null, cwd: "c".repeat(LIMITS.cwd) },
    ],
    draft: "",
  });
});

test("a stored command with a line break, or too long to trust, can't run", () => {
  const { blocks } = sanitizeTranscript({
    blocks: [{ command: "echo\nrm -rf x" }, { command: "x".repeat(LIMITS.content + 1) }],
  });
  assert.deepEqual(blocks.map((b) => b.command), [null, null]);
});

test("a stored draft stays on one line and is capped", () => {
  assert.equal(sanitizeTranscript({ blocks: [], draft: "a\r\nb\nc" }).draft, "a b c");
  assert.equal(sanitizeTranscript({ blocks: [], draft: "x".repeat(LIMITS.content + 5) }).draft.length, LIMITS.content);
});

test("stored blocks over the limit keep the newest", () => {
  const output = `${"line\n".repeat(LIMITS.content)}newest`;
  const { blocks } = sanitizeTranscript({ blocks: [textBlock("first"), command("big", output), command("last", "end")] });
  assert.equal(blocks.at(-1).output, "end");
  assert.ok(blocks[0].output.endsWith("newest"));
  assert.ok(blocks.every((b) => b.output !== "first"));
  assert.ok(blocksLength({ blocks }) <= LIMITS.content);
});

// ---------- run state ----------
test("a run goes idle, running, idle", () => {
  const runs = createRunState();
  assert.equal(runs.phase("t"), "idle");
  assert.equal(runs.isRunning("t"), false);
  const signal = runs.start("t");
  assert.equal(runs.phase("t"), "running");
  assert.equal(runs.isRunning("t"), true);
  assert.equal(signal.aborted, false);
  runs.finish("t");
  assert.equal(runs.phase("t"), "idle");
  assert.equal(runs.isRunning("t"), false);
});

test("stopping aborts, and the command counts as running until it ends", () => {
  const runs = createRunState();
  const signal = runs.start("t");
  assert.equal(runs.stop("t"), true);
  assert.equal(signal.aborted, true);
  assert.equal(runs.phase("t"), "stopping");
  assert.equal(runs.isRunning("t"), true);
  assert.equal(runs.stop("t"), true); // stopping again changes nothing
  assert.equal(runs.phase("t"), "stopping");
  runs.finish("t");
  assert.equal(runs.phase("t"), "idle");
});

test("stopping or finishing with nothing running does nothing", () => {
  const runs = createRunState();
  assert.equal(runs.stop("t"), false);
  runs.finish("t");
  assert.equal(runs.phase("t"), "idle");
});

test("starting while running keeps the first run", () => {
  const runs = createRunState();
  const first = { command: "first" };
  const signal = runs.start("t", first);
  assert.equal(runs.start("t", { command: "second" }), signal);
  assert.equal(runs.block("t"), first);
});

test("a run after a stopped run starts fresh", () => {
  const runs = createRunState();
  runs.start("t");
  runs.stop("t");
  runs.finish("t");
  assert.equal(runs.start("t").aborted, false);
  assert.equal(runs.phase("t"), "running");
});

test("each tab has its own run", () => {
  const runs = createRunState();
  const a = runs.start("a");
  const b = runs.start("b");
  runs.stop("a");
  assert.equal(a.aborted, true);
  assert.equal(b.aborted, false);
  assert.equal(runs.phase("b"), "running");
});

test("the shell's part of a run ends before the run does", () => {
  const runs = createRunState();
  const shell = { fullscreen: false };
  runs.attachShell("t", shell); // nothing running: not attached
  assert.equal(runs.shell("t"), null);
  runs.start("t");
  assert.equal(runs.shell("t"), null); // the mock has no shell
  runs.attachShell("t", shell);
  assert.equal(runs.shell("t"), shell);
  runs.detachShell("t");
  assert.equal(runs.shell("t"), null);
  assert.equal(runs.isRunning("t"), true);
  runs.finish("t");
  assert.equal(runs.block("t"), null);
});
