// What styled output looks like once it has left the terminal. No DOM or storage.
//
// The terminal (textModel.js) does all the parsing. A style read from its cells is saved as a
// short "code": SGR numbers in one fixed order, such as "1;31" or "38;2;255;0;0". A block's styles
// are [[start, end, code], ...] over its plain output, in order and not overlapping. Saved styles
// are untrusted, so a code only counts if it is exactly what styleCode would write, and a color
// only ever reaches the page as a theme variable or as checked numbers.

import { LIMITS } from "../constants.js";

const MAX_CODE = 60;
const FLAGS = { 1: "bold", 2: "dim", 3: "italic", 4: "underline", 7: "inverse" };

export const NO_STYLE = Object.freeze({ fg: null, bg: null, bold: false, dim: false, italic: false, underline: false, inverse: false });

// ---------- codes ----------
// A color is a palette index (0-255) or "r;g;b".
function colorCode(color, base) {
  if (typeof color === "string") return `${base + 8};2;${color}`;
  if (color < 8) return `${base + color}`;
  if (color < 16) return `${base + 60 + color - 8}`;
  return `${base + 8};5;${color}`;
}

/** The style's code, "" for no styling. */
export function styleCode(style) {
  const parts = [];
  if (style.bold) parts.push("1");
  if (style.dim) parts.push("2");
  if (style.italic) parts.push("3");
  if (style.underline) parts.push("4");
  if (style.inverse) parts.push("7");
  if (style.fg !== null) parts.push(colorCode(style.fg, 30));
  if (style.bg !== null) parts.push(colorCode(style.bg, 40));
  return parts.join(";");
}

const isByte = (v) => Number.isInteger(v) && v >= 0 && v <= 255;

/** "5;n" or "2;r;g;b" at this position. Returns the color and how many tokens it took, or null. */
function readColor(tokens, at) {
  if (tokens[at] === "5" && isByte(Number(tokens[at + 1]))) return { color: Number(tokens[at + 1]), used: 2 };
  const rgb = tokens.slice(at + 1, at + 4).map(Number);
  if (tokens[at] === "2" && rgb.length === 3 && rgb.every(isByte)) return { color: rgb.join(";"), used: 4 };
  return null;
}

function readSimpleColor(style, n) {
  if (n >= 30 && n <= 37) style.fg = n - 30;
  else if (n >= 90 && n <= 97) style.fg = n - 90 + 8;
  else if (n >= 40 && n <= 47) style.bg = n - 40;
  else if (n >= 100 && n <= 107) style.bg = n - 100 + 8;
  else return false;
  return true;
}

function readTokens(tokens) {
  const style = { ...NO_STYLE };
  for (let i = 0; i < tokens.length; i++) {
    const n = Number(tokens[i]);
    if (n === 38 || n === 48) {
      const read = readColor(tokens, i + 1);
      if (!read) return null;
      style[n === 38 ? "fg" : "bg"] = read.color;
      i += read.used;
    } else if (FLAGS[n]) {
      style[FLAGS[n]] = true;
    } else if (!readSimpleColor(style, n)) {
      return null;
    }
  }
  return style;
}

/** The style a saved code stands for, or null if it isn't one we would have written. */
export function parseStyleCode(code) {
  if (typeof code !== "string" || code.length > MAX_CODE || !/^\d+(;\d+)*$/.test(code)) return null;
  const style = readTokens(code.split(";"));
  return style && styleCode(style) === code ? style : null;
}

// ---------- colors for the page ----------
const CUBE = [0, 95, 135, 175, 215, 255];

function paletteColor(n) {
  if (n < 16) return `var(--ansi-${n})`; // the theme decides these
  if (n >= 232) {
    const gray = 8 + (n - 232) * 10;
    return `rgb(${gray}, ${gray}, ${gray})`;
  }
  const i = n - 16;
  return `rgb(${CUBE[Math.floor(i / 36)]}, ${CUBE[Math.floor(i / 6) % 6]}, ${CUBE[i % 6]})`;
}

function cssColor(color) {
  if (color === null) return null;
  if (typeof color === "number") return paletteColor(color);
  return `rgb(${color.split(";").join(", ")})`;
}

function cssFor(style) {
  let color = cssColor(style.fg);
  let background = cssColor(style.bg);
  if (style.inverse) [color, background] = [background ?? "var(--term)", color ?? "var(--text)"];
  const classes = [style.bold && "ansiBold", style.dim && "ansiDim", style.italic && "ansiItalic", style.underline && "ansiUnderline"];
  return { className: classes.filter(Boolean).join(" "), color, background };
}

const cssCache = new Map();

/** What a code looks like: { className, color, background }, or null if the code isn't valid. */
export function styleCss(code) {
  if (!cssCache.has(code)) {
    if (cssCache.size >= LIMITS.styleCache) cssCache.clear();
    const style = parseStyleCode(code);
    cssCache.set(code, style && cssFor(style));
  }
  return cssCache.get(code);
}

// ---------- ranges ----------
/** The ranges of a saved block that can be trusted, over a text of this length. The newest are kept. */
export function validStyleRanges(raw, length, max = LIMITS.styleRanges) {
  if (!Array.isArray(raw)) return [];
  const valid = [];
  let last = 0;
  for (const range of raw.slice(-max)) {
    if (!Array.isArray(range) || range.length !== 3) continue;
    const [start, end, code] = range;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < last || end <= start || end > length) continue;
    if (!parseStyleCode(code)) continue;
    valid.push([start, end, code]);
    last = end;
  }
  return valid;
}

/** Ranges for the same text with its first `cut` characters gone. Returns a new list: lists are shared between copies of a block. */
export function shiftStyleRanges(ranges, cut) {
  const shifted = [];
  for (const [start, end, code] of ranges) {
    if (end > cut) shifted.push([Math.max(0, start - cut), end - cut, code]);
  }
  return shifted;
}

/** Where the first range ending after `offset` is. Ranges are in order, so this needn't read them all. */
function firstRangeAfter(ranges, offset) {
  let low = 0;
  let high = ranges.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (ranges[middle][1] > offset) high = middle;
    else low = middle + 1;
  }
  return low;
}

/** The part of the text from `from` to `to` cut into what to draw: [{ text, code }], with a null code for plain text. */
export function styledSegments(text, ranges = [], from = 0, to = text.length) {
  const segments = [];
  let at = from;
  const add = (end, code) => {
    if (end > at) segments.push({ text: text.slice(at, end), code });
    at = Math.max(at, end);
  };
  for (let i = firstRangeAfter(ranges, from); i < ranges.length && ranges[i][0] < to; i++) {
    const [start, end, code] = ranges[i];
    add(Math.min(start, to), null);
    add(Math.min(end, to), code);
  }
  add(to, null);
  return segments;
}
