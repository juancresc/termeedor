// What a tab shows: { blocks: [{ command, output, exit, cwd, styles? }], draft }. A block with a
// null command is plain text (banner, migrated tabs, workspace.print). The output view only
// displays this, so what is a command comes from here and never from what a line of text says.
// `output` is always plain text; `styles` are its colors, left out when it has none (see styles.js).
// A block's styles list is never changed in place, because copies of a block share it.
// No DOM or storage. Functions that change a transcript change it in place, because a tab is one.

import { LIMITS, PROMPT } from "../constants.js";
import { shiftStyleRanges, validStyleRanges } from "./styles.js";

const isObject = (v) => v !== null && typeof v === "object";
const unixLines = (v) => v.replace(/\r\n?/g, "\n");
const hasControlChars = (v) => /[\x00-\x08\x0b-\x1f\x7f]/.test(v); // anything but a tab or a line break
const oneLine = (v) => v.replace(/\r?\n|\r/g, " ");

/** The prompt for a directory: its last name, so `~/dev/app` shows `app ❯ `. No directory, just the symbol. */
export function promptFor(cwd) {
  if (!cwd) return PROMPT;
  const name = oneLine(cwd).replace(/\/+$/, "").split("/").pop() || "/";
  return `${name} ${PROMPT}`;
}

export const textBlock = (output) => ({ command: null, output, exit: null, cwd: null });

export const copyBlocks = (blocks) => blocks.map((block) => ({ ...block }));

// ---------- changes ----------
export function addCommandBlock(transcript, command, cwd) {
  const block = { command: unixLines(command), output: "", exit: null, cwd };
  transcript.blocks.push(block);
  return block;
}

/** Plain text at the bottom, or above `before`, the running command whose output is still changing. */
export function addTextBlock(transcript, text, before = null) {
  const at = before ? transcript.blocks.indexOf(before) : -1;
  transcript.blocks.splice(at === -1 ? transcript.blocks.length : at, 0, textBlock(unixLines(text)));
}

export function appendOutput(block, text) {
  block.output += `${block.output ? "\n" : ""}${text}`;
}

function setStyles(block, styles) {
  if (styles.length) block.styles = styles;
  else delete block.styles;
}

/** Replaces a block's output and its colors together, so that they always match. */
export function setBlockOutput(block, text, styles = []) {
  block.output = text;
  setStyles(block, styles);
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
/** The whole transcript as one text, for search and line counts. `prompt` is false while a command runs. */
export function renderTranscript(transcript, { prompt = true } = {}) {
  const parts = [];
  for (const block of transcript.blocks) {
    if (block.command !== null) parts.push(promptFor(block.cwd) + block.command);
    if (block.output || block.command === null) parts.push(unixLines(block.output));
  }
  if (prompt) parts.push(promptFor(transcript.cwd) + transcript.draft);
  return parts.join("\n");
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
  return promptFor(block.cwd).length + block.command.length + (block.output ? 1 + block.output.length : 0);
};

/** Keeps the end of the block's output, and moves its colors to match. */
function keepNewestOutput(block, max) {
  const text = newestText(block.output, max);
  const cut = block.output.length - text.length;
  block.output = text;
  if (block.styles && cut) setStyles(block, shiftStyleRanges(block.styles, cut));
}

/** Fits the block into `room`. A command is kept whole or not at all: part of one must never run. */
function shrinkBlock(block, room) {
  const commandLine = block.command === null ? 0 : promptFor(block.cwd).length + block.command.length;
  if (block.command !== null && commandLine < room) {
    keepNewestOutput(block, room - commandLine - 1);
  } else {
    block.command = null;
    keepNewestOutput(block, room);
  }
}

/** Colors are capped apart from text: a screenful can hold thousands. The oldest output goes plain first. */
function trimStyles(blocks, max) {
  let room = max;
  for (let i = blocks.length - 1; i >= 0; i--) {
    const { styles } = blocks[i];
    if (!styles) continue;
    if (styles.length > room) setStyles(blocks[i], styles.slice(styles.length - room));
    room -= blocks[i].styles?.length ?? 0;
  }
}

/** The oldest text goes first once the blocks hold more than can be saved. The draft isn't counted. */
export function trimTranscript(transcript, max = LIMITS.content) {
  trimText(transcript, max);
  trimStyles(transcript.blocks, LIMITS.styleRanges);
}

function trimText(transcript, max) {
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
function savedCommand(raw) {
  if (typeof raw !== "string" || raw.length > LIMITS.content) return null;
  const command = unixLines(raw);
  return hasControlChars(command) ? null : command; // can't be typed, and a re-run must send what is shown
}

function sanitizeBlock(raw) {
  const output = typeof raw.output === "string" ? unixLines(raw.output) : "";
  const styles = validStyleRanges(raw.styles, output.length);
  return {
    command: savedCommand(raw.command),
    output,
    exit: Number.isInteger(raw.exit) ? raw.exit : null,
    cwd: typeof raw.cwd === "string" ? raw.cwd.slice(0, LIMITS.cwd) : null,
    ...(styles.length ? { styles } : {}),
  };
}

/**
 * Tabs saved as one string. The only place that reads the prompt out of text: with no record
 * of what ran, earlier `❯ ` lines stay plain text and can't be re-run. Only a prompt that
 * starts the last line is the input; anywhere else it is just output.
 */
export function migrateLegacyContent(content) {
  const text = typeof content === "string" ? unixLines(newestText(content, LIMITS.content)) : "";
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
    draft: typeof raw.draft === "string" ? unixLines(raw.draft).slice(0, LIMITS.content) : "",
  };
  trimTranscript(transcript);
  return transcript;
}
