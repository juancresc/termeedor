// Turns a program's terminal output into text and styling for its block. A real terminal
// (xterm's, with no display) keeps the screen: whatever the program does with the cursor, the
// result is what you would see, scrollback included. Styling is read back from the terminal's
// cells, so nothing here parses escape sequences. Full-screen programs don't come through here;
// they get a terminal you can see (fullscreen.js).
//
// A program can only change what is on the screen, so lines that scrolled off it are read once
// and kept. Each snapshot reads only the screen and whatever newly scrolled off, and its `stable`
// tells the view how much of the text can't change until the next `since: null`.

import { Terminal } from "../../node_modules/@xterm/headless/lib-headless/xterm-headless.mjs";
import { LIMITS } from "../constants.js";
import { NO_STYLE, styleCode } from "../core/styles.js";

const SCROLLBACK = 20000;
const COMPACT_AT = 4096; // how many dead entries to let pile up before copying a list to free them

// ---------- reading cells ----------
const color = (isDefault, isRgb, value) => {
  if (isDefault) return null;
  return isRgb ? `${value >> 16};${(value >> 8) & 255};${value & 255}` : value;
};

function codeOf(cell) {
  if (cell.isAttributeDefault()) return "";
  return styleCode({
    ...NO_STYLE,
    fg: color(cell.isFgDefault(), cell.isFgRGB(), cell.getFgColor()),
    bg: color(cell.isBgDefault(), cell.isBgRGB(), cell.getBgColor()),
    bold: !!cell.isBold(),
    dim: !!cell.isDim(),
    italic: !!cell.isItalic(),
    underline: !!cell.isUnderline(),
    inverse: !!cell.isInverse(),
  });
}

function addRange(ranges, start, end, code) {
  const last = ranges.at(-1);
  if (last?.[1] === start && last[2] === code) last[1] = end;
  else ranges.push([start, end, code]);
}

/** Appends one row to `into` ({ text, ranges }). Cells nothing was written to only count if text follows them. */
function readRow(row, keepBlanks, cell, into) {
  const start = into.text.length;
  let text = "";
  let written = 0;
  for (let x = 0; x < row.length;) {
    row.getCell(x, cell);
    const chars = cell.getChars();
    const piece = chars || " ";
    const code = codeOf(cell);
    if (code) addRange(into.ranges, start + text.length, start + text.length + piece.length, code);
    text += piece;
    if (chars) written = text.length;
    x += cell.getWidth() || 1;
  }
  const kept = keepBlanks ? text.length : written;
  into.text += text.slice(0, kept);
  clipRanges(into.ranges, start + kept);
}

function clipRanges(ranges, end) {
  while (ranges.length && ranges.at(-1)[0] >= end) ranges.pop();
  if (ranges.length && ranges.at(-1)[1] > end) ranges.at(-1)[1] = end;
}

/** Reads whole lines from the rows in [from, to): a long line is one line however many rows it wrapped onto. */
function readLines(buffer, from, to, cell) {
  const lines = [];
  for (let at = from; at < to;) {
    const line = { text: "", ranges: [], rows: 0 };
    do {
      const continues = at + 1 < buffer.length && buffer.getLine(at + 1).isWrapped; // a long line's spaces at the wrap are real
      readRow(buffer.getLine(at), continues, cell, line);
      at++;
      line.rows++;
    } while (at < to && buffer.getLine(at).isWrapped);
    lines.push(line);
  }
  return lines;
}

/** The first row of the line that the row belongs to. */
function lineStart(buffer, row) {
  let at = row;
  while (at > 0 && buffer.getLine(at).isWrapped) at--;
  return at;
}

function withoutBlankEnd(text) {
  let end = text.length;
  while (end > 0 && text[end - 1] === "\n") end--;
  return end === text.length ? text : text.slice(0, end);
}

/** Lines that have scrolled off the screen. The stored ranges count from the start of everything ever kept. */
function createKeptLines() {
  const kept = {
    text: "", // every kept line, each ending in a line break
    base: 0, // how many characters have gone from the front of `text`
    lines: [], // { rows, chars }, oldest first, from `firstLine` on
    firstLine: 0,
    ranges: [],
    firstRange: 0,
    cut: 0, // characters gone from the front since the last snapshot
  };

  const compact = () => {
    if (kept.firstLine > COMPACT_AT) { kept.lines = kept.lines.slice(kept.firstLine); kept.firstLine = 0; }
    if (kept.firstRange > COMPACT_AT) { kept.ranges = kept.ranges.slice(kept.firstRange); kept.firstRange = 0; }
  };

  kept.add = (line) => {
    const start = kept.base + kept.text.length;
    for (const [from, to, code] of line.ranges) kept.ranges.push([start + from, start + to, code]);
    kept.lines.push({ rows: line.rows, chars: line.text.length });
    kept.text += `${line.text}\n`;
    kept.firstRange = Math.max(kept.firstRange, kept.ranges.length - LIMITS.styleRanges);
    compact();
  };

  /** The terminal dropped its oldest rows. readRest(rows) reads what is left of a line cut in half, which starts the buffer now. */
  kept.dropRows = (count, readRest) => {
    let rows = count;
    let cut = 0;
    while (rows > 0 && kept.firstLine < kept.lines.length) {
      const line = kept.lines[kept.firstLine];
      if (line.rows <= rows) {
        rows -= line.rows;
        cut += line.chars + 1;
        kept.firstLine++;
      } else {
        const rest = readRest(line.rows - rows).length;
        cut += line.chars - rest;
        line.chars = rest;
        line.rows -= rows;
        rows = 0;
      }
    }
    kept.text = kept.text.slice(cut);
    kept.base += cut;
    kept.cut += cut;
    while (kept.firstRange < kept.ranges.length && kept.ranges[kept.firstRange][1] <= kept.base) kept.firstRange++;
    compact();
  };

  /** At most `room` of the newest ranges, counted from the start of `text`. */
  kept.rangesFor = (room) => {
    const from = Math.max(kept.firstRange, kept.ranges.length - room);
    const list = kept.ranges.slice(from);
    if (!kept.base) return list; // the stored ones can be shared: nothing changes them
    return list.map(([start, end, code]) => [Math.max(0, start - kept.base), end - kept.base, code]);
  };

  return kept;
}

// ---------- the model ----------
export function createTextModel({ cols = 80, rows = 24, scrollback = SCROLLBACK } = {}) {
  const term = new Terminal({ cols, rows, scrollback, allowProposedApi: true });
  const cell = term.buffer.normal.getNullCell();
  let erasedScrollback = false; // ESC[3J, which `clear` sends: everything above goes too
  let kept = createKeptLines();
  let marker = null; // on the last kept row: how the terminal shows how many rows it dropped
  let keptEnd = 0; // the row after the last kept one
  let published = null; // the text of the last snapshot
  let rowsRead = 0;

  /** Everything read so far no longer holds, so the next snapshot starts over. */
  function forget() {
    marker?.dispose();
    marker = null;
    kept = createKeptLines();
    keptEnd = 0;
    published = null;
  }

  term.parser.registerCsiHandler({ final: "J" }, (params) => {
    if (params[0] === 3) {
      erasedScrollback = true;
      forget();
    }
    return false; // the terminal still does it
  });
  term.parser.registerEscHandler({ final: "c" }, () => { // a full reset wipes the scrollback too
    forget();
    return false;
  });

  function followTrim(buffer) {
    if (!marker) return;
    if (marker.isDisposed) {
      forget(); // more scrolled by since last time than the scrollback holds
      return;
    }
    const dropped = keptEnd - 1 - marker.line;
    if (dropped <= 0) return;
    kept.dropRows(dropped, (rest) => {
      const [line] = readLines(buffer, 0, rest, cell);
      rowsRead += rest;
      return line.text;
    });
    keptEnd -= dropped;
  }

  function keepScrolledOff(buffer, firmEnd) {
    if (firmEnd <= keptEnd) return;
    readLines(buffer, keptEnd, firmEnd, cell).forEach(kept.add);
    rowsRead += firmEnd - keptEnd;
    keptEnd = firmEnd;
    marker?.dispose();
    marker = term.registerMarker(keptEnd - 1 - buffer.baseY - buffer.cursorY);
  }

  /** The kept lines, brought up to date, and the lines still on the screen. */
  function read() {
    const buffer = term.buffer.normal;
    followTrim(buffer);
    const firmEnd = lineStart(buffer, buffer.baseY);
    keepScrolledOff(buffer, firmEnd);
    const screen = readLines(buffer, keptEnd, buffer.length, cell);
    rowsRead += buffer.length - keptEnd;
    while (screen.length && !screen.at(-1).text) screen.pop();
    return screen;
  }

  function joinScreen(screen) {
    const joined = { text: "", ranges: [] };
    screen.forEach((line, i) => {
      if (i) joined.text += "\n";
      const start = joined.text.length;
      for (const [from, to, code] of line.ranges) joined.ranges.push([start + from, start + to, code]);
      joined.text += line.text;
    });
    return joined;
  }

  /** The whole text as it stands. Blank lines at the very end aren't part of it. */
  function compose() {
    const lines = read();
    const screen = joinScreen(lines);
    const start = kept.text.length;
    return { screen, start, hasScreen: lines.length > 0, text: lines.length ? kept.text + screen.text : withoutBlankEnd(kept.text) };
  }

  return {
    /** Terminals parse later. `parsed` is called once this chunk shows in text(). */
    write: (chunk, parsed) => term.write(chunk, parsed),
    /** Resolves once everything written so far shows in text(). */
    settled: () => new Promise((resolve) => { term.write("", resolve); }),
    resize(newCols, newRows) {
      term.resize(newCols, newRows);
      forget(); // long lines wrap differently now
    },
    dispose() {
      forget();
      term.dispose();
    },
    /** True once for each time the program erased the scrollback. */
    takeErasedScrollback() {
      const erased = erasedScrollback;
      erasedScrollback = false;
      return erased;
    },
    text: () => compose().text,
    /**
     * { text, styles, stable, cut, since }. The first `stable` characters won't change. `since`
     * is the text of the snapshot before this one, null if this one has no relation to it, and
     * `cut` is how many characters have gone from the front of it.
     */
    styled() {
      const { screen, start, hasScreen, text } = compose();
      const ownRanges = screen.ranges.slice(-LIMITS.styleRanges).map(([from, to, code]) => [start + from, start + to, code]);
      const snapshot = {
        text,
        styles: [...kept.rangesFor(LIMITS.styleRanges - ownRanges.length), ...ownRanges],
        stable: hasScreen ? start : text.lastIndexOf("\n") + 1,
        cut: kept.cut,
        since: published,
      };
      kept.cut = 0;
      published = text;
      return snapshot;
    },
    /** How many rows have been read from the terminal, to measure that scrollback isn't read again. */
    rowsRead: () => rowsRead,
  };
}
