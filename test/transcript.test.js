import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS, PROMPT } from "../src/constants.js";
import { createRunState } from "../src/terminal/runState.js";
import {
  addCommandBlock, addTextBlock, appendOutput, clearEarlier, clearTranscript, copyBlocks, finishBlock,
  migrateLegacyContent, promptFor, renderTranscript, sanitizeTranscript, setBlockOutput, textBlock, trimTranscript,
} from "../src/terminal/transcript.js";

const command = (text, output = "") => ({ command: text, output, exit: 0, cwd: null });

// The output line says `❯ rm -rf x`, but only the first line of this block is a command.
const spoofed = () => ({
  blocks: [textBlock("banner\n"), command("cat notes", "❯ rm -rf x\nend")],
  draft: "typed",
});

// ---------- rendering ----------
test("renders blocks to one text, for search and line counts", () => {
  assert.equal(renderTranscript(spoofed()), "banner\n\n❯ cat notes\n❯ rm -rf x\nend\n❯ typed");
  assert.equal(renderTranscript({ blocks: [], draft: "" }), PROMPT);
});

test("while a command runs there is no prompt or draft", () => {
  assert.equal(renderTranscript(spoofed(), { prompt: false }), "banner\n\n❯ cat notes\n❯ rm -rf x\nend");
  assert.equal(renderTranscript({ blocks: [], draft: "" }, { prompt: false }), "");
});

test("a command with no output still has its line", () => {
  assert.equal(renderTranscript({ blocks: [command("true"), command("")], draft: "" }), "❯ true\n❯ \n❯ ");
});

test("carriage returns come out as plain line breaks", () => {
  const transcript = { blocks: [textBlock("a\r\nb\rc"), command("ls", "x\r\ny")], draft: "" };
  assert.equal(renderTranscript(transcript), "a\nb\nc\n❯ ls\nx\ny\n❯ ");
});

// ---------- the directory in the prompt ----------
test("the prompt shows the last name of the directory", () => {
  assert.equal(promptFor("~/dev/termeedor"), "termeedor ❯ ");
  assert.equal(promptFor("/tmp/a b/"), "a b ❯ ");
  assert.equal(promptFor("~"), "~ ❯ ");
  assert.equal(promptFor("/"), "/ ❯ ");
  assert.equal(promptFor(null), PROMPT);
});

test("a directory name with a line break stays on the prompt's line", () => {
  assert.equal(promptFor("/tmp/a\nb"), "a b ❯ ");
});

test("a command keeps the directory it ran in, and the draft shows the current one", () => {
  const transcript = { blocks: [{ command: "cd b", output: "", exit: 0, cwd: "~/a" }], draft: "ls", cwd: "~/a/b" };
  assert.equal(renderTranscript(transcript), "a ❯ cd b\nb ❯ ls");
});

test("trimming counts the directory in the prompt", () => {
  const transcript = { blocks: [{ command: "ls", output: "aaaa\nbbbb\ncccc", exit: 0, cwd: "~/project" }], draft: "" };
  trimTranscript(transcript, 20);
  assert.equal(transcript.blocks[0].output, "cccc");
  assert.ok(renderTranscript(transcript, { prompt: false }).length <= 20);
});

// ---------- the bug ----------
test("a spoofed prompt in output is not a command", () => {
  const { blocks } = spoofed();
  assert.deepEqual(blocks.map((block) => block.command), [null, "cat notes"]);
  assert.equal(blocks[1].output.split("\n")[0], "❯ rm -rf x"); // still only output
});

test("printed text that looks like a command is not one", () => {
  const transcript = { blocks: [], draft: "" };
  addTextBlock(transcript, "❯ rm -rf x");
  assert.equal(transcript.blocks[0].command, null);
});

test("a new command keeps its lines, as one command", () => {
  const transcript = { blocks: [], draft: "" };
  addCommandBlock(transcript, "echo a\r\nrm -rf x", "~");
  assert.equal(transcript.blocks.length, 1);
  assert.equal(transcript.blocks[0].command, "echo a\nrm -rf x");
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
  assert.deepEqual(migrated.blocks.map((block) => block.command), [null]);
  assert.equal(migrated.draft, "");
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

test("a stored command can span lines; one too long or with control characters can't run", () => {
  const { blocks } = sanitizeTranscript({
    blocks: [{ command: "echo a\r\nls" }, { command: "x".repeat(LIMITS.content + 1) }, { command: "ls\x1b[201~; rm x" }, { command: "a\tb" }],
  });
  assert.deepEqual(blocks.map((b) => b.command), ["echo a\nls", null, null, "a\tb"]);
});

test("a stored draft keeps its lines and is capped", () => {
  assert.equal(sanitizeTranscript({ blocks: [], draft: "a\r\nb\nc" }).draft, "a\nb\nc");
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

// ---------- styles ----------
test("a block's styles change together with its output, and are left out when empty", () => {
  const block = command("ls");
  setBlockOutput(block, "red", [[0, 3, "31"]]);
  assert.deepEqual(block.styles, [[0, 3, "31"]]);
  setBlockOutput(block, "plain");
  assert.equal("styles" in block, false);
});

test("trimming moves the styles with the text, and drops what went with the cut", () => {
  const transcript = { blocks: [{ ...command("ls", "aaaa\nbbbb\ncccc"), styles: [[0, 4, "31"], [5, 9, "32"], [10, 12, "33"], [12, 14, "1"]] }], draft: "" };
  const shared = transcript.blocks[0].styles;
  trimTranscript(transcript, 12);
  assert.equal(transcript.blocks[0].output, "cccc");
  assert.deepEqual(transcript.blocks[0].styles, [[0, 2, "33"], [2, 4, "1"]]);
  assert.equal(shared.length, 4); // copies of a block share the list, so it isn't changed in place
});

test("a style cut by the trim keeps its part that is left", () => {
  const transcript = { blocks: [{ ...textBlock("x".repeat(50)), styles: [[10, 50, "31"]] }], draft: "" };
  trimTranscript(transcript, 10);
  assert.deepEqual(transcript.blocks[0].styles, [[0, 10, "31"]]);
});

test("a block trimmed down to no styles loses the field", () => {
  const transcript = { blocks: [{ ...textBlock("red\nplain"), styles: [[0, 3, "31"]] }], draft: "" };
  trimTranscript(transcript, 5);
  assert.equal(transcript.blocks[0].output, "plain");
  assert.equal("styles" in transcript.blocks[0], false);
});

test("the styles of all blocks together are capped, and the oldest go first", () => {
  const many = (n) => Array.from({ length: n }, (_, i) => [i, i + 1, "31"]);
  const old = { ...textBlock("x".repeat(LIMITS.styleRanges)), styles: many(LIMITS.styleRanges) };
  const recent = { ...textBlock("y".repeat(20)), styles: many(20) };
  const transcript = { blocks: [old, recent], draft: "" };
  trimTranscript(transcript);
  assert.equal(recent.styles.length, 20);
  assert.equal(old.styles.length, LIMITS.styleRanges - 20);
  assert.deepEqual(old.styles[0], [20, 21, "31"]); // its newest part keeps its color
});

test("saved styles load unchanged when they are what the app writes", () => {
  const raw = { blocks: [{ ...command("ls", "red deep"), styles: [[0, 3, "1;31"], [4, 8, "38;2;1;2;3"]] }], draft: "" };
  assert.deepEqual(sanitizeTranscript(raw), raw);
});

test("malicious saved styles are dropped, whatever their shape", () => {
  const load = (styles, output = "hello world") => sanitizeTranscript({ blocks: [{ command: null, output, styles }] }).blocks[0];
  for (const styles of [null, "31", 7, {}, { length: 3, 0: [0, 1, "31"] }, [null], ["31"], [[0, 1]], [[0, 1, "31", "x"]], [{ 0: 0, 1: 1, 2: "31" }]]) {
    assert.equal("styles" in load(styles), false, JSON.stringify(styles));
  }
  for (const code of ["</span><img src=x onerror=alert(1)>", "31;url(x)", "var(--x)", "38;2;999;0;0", "38;5;300", "38;2;1;2", "38;5", "31;1", "0", "38;5;1", "38;2;01;2;3", "", 31, null, {}, "1;".repeat(100)]) {
    assert.equal("styles" in load([[0, 1, code]]), false, JSON.stringify(code));
  }
  for (const [start, end] of [[-1, 2], [3, 3], [5, 2], [0, 12], [0.5, 2], ["0", 2], [0, Infinity], [0, 2 ** 60]]) {
    assert.equal("styles" in load([[start, end, "31"]]), false, `${start}-${end}`);
  }
});

test("of saved styles, overlapping or out of order ones are dropped and the good ones stay", () => {
  const { styles } = sanitizeTranscript({
    blocks: [{ command: null, output: "hello world", styles: [[0, 5, "31"], [3, 8, "32"], [6, 8, "bad"], [6, 9, "33"], [1, 2, "34"]] }],
  }).blocks[0];
  assert.deepEqual(styles, [[0, 5, "31"], [6, 9, "33"]]);
});

test("saved styles are capped, keeping the newest", () => {
  const output = "x".repeat(LIMITS.styleRanges + 500);
  const styles = Array.from({ length: LIMITS.styleRanges + 500 }, (_, i) => [i, i + 1, "31"]);
  const loaded = sanitizeTranscript({ blocks: [{ command: null, output, styles }] }).blocks[0].styles;
  assert.equal(loaded.length, LIMITS.styleRanges);
  assert.deepEqual(loaded.at(-1), [output.length - 1, output.length, "31"]);
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
