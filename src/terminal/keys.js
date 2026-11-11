// What a key press sends to a running program, or null if the app should handle it
// (Cmd shortcuts other than line editing, and Shift+arrows for selecting text).

const SPECIAL = {
  Enter: "\r",
  Backspace: "\x7f",
  Tab: "\t",
  Escape: "\x1b",
  ArrowUp: "\x1b[A",
  ArrowDown: "\x1b[B",
  ArrowRight: "\x1b[C",
  ArrowLeft: "\x1b[D",
  Home: "\x1b[H",
  End: "\x1b[F",
  Delete: "\x1b[3~",
  PageUp: "\x1b[5~",
  PageDown: "\x1b[6~",
};

// Ctrl+key for keys that aren't letters, as xterm sends them.
const CTRL = {
  BracketLeft: "\x1b",
  Backslash: "\x1c",
  BracketRight: "\x1d",
  Minus: "\x1f", // Ctrl+_ : undo in readline and Claude Code
  Slash: "\x1f",
  Space: "\x00",
};

// Option+key the way macOS terminals send it: ESC first, or the word-motion keys for arrows.
const ALT = {
  Enter: "\x1b\r",
  Backspace: "\x1b\x7f",
  ArrowLeft: "\x1bb",
  ArrowRight: "\x1bf",
  Delete: "\x1bd", // fn+Option+Delete: delete the next word
};

// Cmd+key the way macOS terminals send it: line start, line end, delete to line start.
// Every other Cmd key is the app's.
const META = {
  ArrowLeft: "\x01",
  ArrowRight: "\x05",
  Backspace: "\x15",
};

export function keyToBytes(event) {
  if (event.metaKey) {
    const plain = !event.shiftKey && !event.ctrlKey && !event.altKey;
    return plain && Object.hasOwn(META, event.key) ? META[event.key] : null;
  }
  if (event.shiftKey && event.key.startsWith("Arrow")) return null;

  if (event.ctrlKey && !event.altKey) {
    const letter = event.code.match(/^Key([A-Z])$/);
    if (letter) return String.fromCharCode(letter[1].charCodeAt(0) - 64);
    return CTRL[event.code] ?? null;
  }
  if (event.altKey && Object.hasOwn(ALT, event.key)) return ALT[event.key];
  // Shift+Enter: ESC + CR, what other terminals send so programs like Claude Code insert a newline
  if (event.shiftKey && event.key === "Enter") return "\x1b\r";
  if (event.shiftKey && event.key === "Tab") return "\x1b[Z";
  if (Object.hasOwn(SPECIAL, event.key)) return SPECIAL[event.key];
  return event.key.length === 1 ? event.key : null; // on a Mac, Option+key has already made its character
}
