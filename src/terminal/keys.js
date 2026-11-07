// What a key press sends to a running program, or null if the app should handle it
// (Cmd shortcuts, and Shift+arrows for selecting text).

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

export function keyToBytes(event) {
  if (event.metaKey) return null;
  if (event.shiftKey && event.key.startsWith("Arrow")) return null;

  if (event.ctrlKey && !event.altKey) {
    const letter = event.code.match(/^Key([A-Z])$/);
    if (letter) return String.fromCharCode(letter[1].charCodeAt(0) - 64);
    if (event.code === "BracketLeft") return "\x1b";
    if (event.code === "Backslash") return "\x1c";
    return null;
  }
  if (Object.hasOwn(SPECIAL, event.key)) return SPECIAL[event.key];
  return event.key.length === 1 ? event.key : null; // on a Mac, Option+key has already made its character
}
