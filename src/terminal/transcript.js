// What a tab shows: { blocks: [{ command, output, exit, cwd }], draft }. A block with a null
// command is plain text (banner, migrated tabs, workspace.print). The text area only displays
// this, so whether a line is a command comes from here and never from what the line says.
// No DOM or storage. Functions that change a transcript change it in place, because a tab is one.

import { LIMITS, PROMPT } from "../constants.js";

const isObject = (v) => v !== null && typeof v === "object";
const hasLineBreak = (v) => /[\r\n]/.test(v);
export const oneLine = (v) => v.replace(/\r?\n|\r/g, " ");

export const textBlock = (output) => ({ command: null, output, exit: null, cwd: null });

export const copyBlocks = (blocks) => blocks.map((block) => ({ ...block }));

// ---------- changes ----------
export function addCommandBlock(transcript, command, cwd) {
  const block = { command: oneLine(command), output: "", exit: null, cwd };
  transcript.blocks.push(block);
  return block;
}

/** Plain text at the bottom, or above `before`, the running command whose output is still changing. */
export function addTextBlock(transcript, text, before = null) {
  const at = before ? transcript.blocks.indexOf(before) : -1;
  transcript.blocks.splice(at === -1 ? transcript.blocks.length : at, 0, textBlock(text));
}

export function appendOutput(block, text) {
  block.output += `${block.output ? "\n" : ""}${text}`;
}

/** The program erased the scrollback: everything above its output goes, its own command line too. */
export function clearEarlier(transcript, block) {
  transcript.blocks = [block];
  block.command = null;
}

/** Clearing leaves only the prompt and whatever is typed at it. */
export function clearTranscript(transcript) {
  transcript.blocks = [];
}

export function finishBlock(transcript, block, exit) {
  block.exit = exit ?? null;
  // A cleared command with no output left has nothing to show, not even a blank line.
  if (block.command === null && !block.output) transcript.blocks = transcript.blocks.filter((b) => b !== block);
}

// ---------- text ----------
/**
 * The text for the text area and what each part of it is. `prompt` is false while a command runs.
 * Each segment is { kind: "command" | "output" | "draft", index, start, end }, with `index`
 * the block's position (null for the draft) and start/end offsets in `text`.
 */
export function layoutTranscript(transcript, { prompt = true } = {}) {
  const parts = [];
  const segments = [];
  const commandLines = [];
  let offset = 0;
  let line = 0;

  const add = (raw, kind, index) => {
    const text = raw.replace(/\r\n?/g, "\n"); // a textarea does this to its value, and offsets must match it
    if (parts.length) { offset++; line++; }
    if (kind !== "output") commandLines.push(line);
    parts.push(text);
    segments.push({ kind, index, start: offset, end: offset + text.length });
    offset += text.length;
    if (kind === "output") line += countLineBreaks(text);
  };

  transcript.blocks.forEach((block, index) => {
    if (block.command !== null) add(PROMPT + block.command, "command", index);
    if (block.output || block.command === null) add(block.output, "output", index);
  });
  if (prompt) add(PROMPT + transcript.draft, "draft", null);

  const draftStart = prompt ? segments.at(-1).start + PROMPT.length : null;
  return { text: parts.join("\n"), segments, commandLines, draftStart };
}

function countLineBreaks(text) {
  let count = 0;
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) count++;
  return count;
}

export const renderTranscript = (transcript, options) => layoutTranscript(transcript, options).text;

/** Which block and kind of line an offset is on. A line's end belongs to that line. */
export function locateOffset(layout, offset) {
  const segment = layout.segments.find((s) => offset <= s.end) ?? layout.segments.at(-1);
  return segment ? { kind: segment.kind, index: segment.index } : { kind: "output", index: null };
}

/** What Enter runs at an offset: a real command line's own command, otherwise the draft. */
export function commandForEnter(transcript, offset) {
  const { kind, index } = locateOffset(layoutTranscript(transcript), offset);
  return kind === "command"
    ? { command: transcript.blocks[index].command, rerun: true }
    : { command: transcript.draft, rerun: false };
}

// ---------- size ----------
/** The end of a long text, starting on a whole line where possible: the newest output is what matters. */
export function newestText(v, max) {
  if (typeof v !== "string") return "";
  if (v.length <= max) return v;
  const newline = v.indexOf("\n", v.length - max);
  return v.slice(newline === -1 ? v.length - max : newline + 1);
}

const blockLength = (block) => {
  if (block.command === null) return block.output.length;
  return PROMPT.length + block.command.length + (block.output ? 1 + block.output.length : 0);
};

/** Fits the block into `room`. A command is kept whole or not at all: part of one must never run. */
function shrinkBlock(block, room) {
  const commandLine = block.command === null ? 0 : PROMPT.length + block.command.length;
  if (block.command !== null && commandLine < room) {
    block.output = newestText(block.output, room - commandLine - 1);
  } else {
    block.command = null;
    block.output = newestText(block.output, room);
  }
}

/** The oldest text goes first once the blocks hold more than can be saved. The draft isn't counted. */
export function trimTranscript(transcript, max = LIMITS.content) {
  const { blocks } = transcript;
  let room = max;
  let first = blocks.length;
  while (first > 0) {
    const size = blockLength(blocks[first - 1]) + (first < blocks.length ? 1 : 0);
    if (size > room) break;
    room -= size;
    first--;
  }
  if (first === 0) return;

  const partial = blocks[first - 1];
  shrinkBlock(partial, room - (first < blocks.length ? 1 : 0));
  const keepsPartial = partial.command !== null || partial.output;
  transcript.blocks = blocks.slice(keepsPartial ? first - 1 : first);
}

// ---------- saved data (untrusted) ----------
function sanitizeBlock(raw) {
  const runnable = typeof raw.command === "string" && raw.command.length <= LIMITS.content && !hasLineBreak(raw.command);
  return {
    command: runnable ? raw.command : null, // we never save a line break in one, so don't trust it
    output: typeof raw.output === "string" ? raw.output : "",
    exit: Number.isInteger(raw.exit) ? raw.exit : null,
    cwd: typeof raw.cwd === "string" ? raw.cwd.slice(0, LIMITS.cwd) : null,
  };
}

/**
 * Tabs saved as one string. The only place that reads the prompt out of text: with no record
 * of what ran, earlier `❯ ` lines stay plain text and can't be re-run. Only a prompt that
 * starts the last line is the input; anywhere else it is just output.
 */
export function migrateLegacyContent(content) {
  const text = newestText(content, LIMITS.content);
  const lastLine = text.lastIndexOf("\n") + 1;
  const hasPrompt = text.startsWith(PROMPT, lastLine);
  const output = hasPrompt ? text.slice(0, Math.max(0, lastLine - 1)) : text;
  return {
    blocks: output ? [textBlock(output)] : [],
    draft: hasPrompt ? text.slice(lastLine + PROMPT.length) : "",
  };
}

/** Reads a stored tab's transcript, in either the current or the old format. */
export function sanitizeTranscript(raw) {
  if (!Array.isArray(raw.blocks)) return migrateLegacyContent(raw.content);
  const transcript = {
    blocks: raw.blocks.slice(-LIMITS.content).filter(isObject).map(sanitizeBlock),
    draft: typeof raw.draft === "string" ? oneLine(raw.draft).slice(0, LIMITS.content) : "",
  };
  trimTranscript(transcript);
  return transcript;
}
