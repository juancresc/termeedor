// Turns a program's terminal output into plain text for the text area: carriage returns
// overwrite, progress bars redraw in place, and colors and other styling are dropped.
// Full-screen programs don't come through here; they get a real terminal (fullscreen.js).

const MAX_LINES = 20000;
const MAX_LINE = 10000;
const TAB_WIDTH = 8;

export function createTextModel() {
  let lines = [[]]; // each line is an array of characters, so overwriting is simple
  let row = 0;
  let col = 0;
  let pending = ""; // the start of an escape sequence cut off at the end of a chunk
  let erasedScrollback = false; // ESC[3J, which `clear` sends: everything above goes too

  function put(char) {
    const line = lines[row];
    if (col >= MAX_LINE) return;
    while (line.length < col) line.push(" ");
    line[col] = char;
    col++;
  }

  function moveTo(newRow, newCol) {
    row = Math.max(0, newRow);
    col = Math.max(0, newCol);
    while (lines.length <= row) lines.push([]);
    trim();
  }

  function trim() {
    if (lines.length <= MAX_LINES) return;
    const extra = lines.length - MAX_LINES;
    lines = lines.slice(extra);
    row = Math.max(0, row - extra);
  }

  function eraseInLine(mode) {
    const line = lines[row];
    if (mode === 0) line.length = Math.min(line.length, col);
    else if (mode === 1) line.fill(" ", 0, Math.min(col + 1, line.length));
    else line.length = 0;
  }

  function eraseInDisplay(mode) {
    if (mode === 0) {
      eraseInLine(0);
      lines.length = row + 1;
    } else if (mode === 1) {
      for (let i = 0; i < row; i++) lines[i] = [];
      eraseInLine(1);
    } else {
      // A clear screen starts this command's output over. Earlier commands stay above it,
      // as a real terminal keeps its scrollback, unless the scrollback was erased as well.
      if (mode === 3) erasedScrollback = true;
      lines = [[]];
      row = 0;
      col = 0;
    }
  }

  function csi(params, final) {
    const numbers = params.replace(/[?>=]/g, "").split(";").map((n) => Number.parseInt(n, 10));
    const first = numbers[0] || 0;
    const count = first || 1;
    switch (final) {
      case "A": moveTo(row - count, col); break;
      case "B": moveTo(row + count, col); break;
      case "C": col += count; break;
      case "D": col = Math.max(0, col - count); break;
      case "E": moveTo(row + count, 0); break;
      case "F": moveTo(row - count, 0); break;
      case "G": col = count - 1; break;
      case "H": case "f": moveTo((numbers[0] || 1) - 1, (numbers[1] || 1) - 1); break;
      case "J": eraseInDisplay(first); break;
      case "K": eraseInLine(first); break;
      default: break; // colors, modes and everything else have no meaning in plain text
    }
  }

  return {
    write(chunk) {
      const text = pending + chunk;
      pending = "";
      for (let i = 0; i < text.length; i++) {
        const char = text[i];
        if (char === "\x1b") {
          const end = skipEscape(text, i);
          if (end === -1) { pending = text.slice(i); return; }
          if (text[i + 1] === "[") csi(text.slice(i + 2, end), text[end]);
          i = end;
        } else if (char === "\n") {
          moveTo(row + 1, 0);
        } else if (char === "\r") {
          col = 0;
        } else if (char === "\b") {
          col = Math.max(0, col - 1);
        } else if (char === "\t") {
          const stop = col + TAB_WIDTH - (col % TAB_WIDTH);
          while (col < stop) put(" ");
        } else if (char >= " " && char !== "\x7f") {
          put(char);
        }
      }
    },
    /** True once for each time the program erased the scrollback. */
    takeErasedScrollback() {
      const erased = erasedScrollback;
      erasedScrollback = false;
      return erased;
    },
    text() {
      const output = lines.map((line) => line.join("").trimEnd());
      while (output.length && !output.at(-1)) output.pop();
      return output.join("\n");
    },
  };
}

/** Index of the last character of the escape sequence at `start`, or -1 if it isn't complete yet. */
function skipEscape(text, start) {
  const kind = text[start + 1];
  if (kind === undefined) return -1;
  if (kind === "[") {
    for (let i = start + 2; i < text.length; i++) {
      const code = text.charCodeAt(i);
      if (code >= 0x40 && code <= 0x7e) return i;
    }
    return -1;
  }
  if (kind === "]" || kind === "P" || kind === "_" || kind === "^") { // OSC and other strings
    for (let i = start + 2; i < text.length; i++) {
      if (text[i] === "\x07") return i;
      if (text[i] === "\x1b" && text[i + 1] === "\\") return i + 1;
    }
    return -1;
  }
  if (kind === "(" || kind === ")" || kind === "#") return start + 2 < text.length ? start + 2 : -1; // charset selection
  return start + 1;
}
