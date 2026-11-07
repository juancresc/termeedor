// Turns a program's terminal output into plain text for the text area. A real terminal
// (xterm's, with no display) keeps the screen: whatever the program does with the cursor, the
// text is what you would see, scrollback included, without styling.
// Full-screen programs don't come through here; they get a terminal you can see (fullscreen.js).

import { Terminal } from "../../node_modules/@xterm/headless/lib-headless/xterm-headless.mjs";

const SCROLLBACK = 20000;

export function createTextModel({ cols = 80, rows = 24 } = {}) {
  const term = new Terminal({ cols, rows, scrollback: SCROLLBACK, allowProposedApi: true });
  let erasedScrollback = false; // ESC[3J, which `clear` sends: everything above goes too

  term.parser.registerCsiHandler({ final: "J" }, (params) => {
    if (params[0] === 3) erasedScrollback = true;
    return false; // the terminal still does it
  });

  return {
    /** Terminals parse later. `parsed` is called once this chunk shows in text(). */
    write: (chunk, parsed) => term.write(chunk, parsed),
    /** Resolves once everything written so far shows in text(). */
    settled: () => new Promise((resolve) => { term.write("", resolve); }),
    resize: (newCols, newRows) => term.resize(newCols, newRows),
    dispose: () => term.dispose(),
    /** True once for each time the program erased the scrollback. */
    takeErasedScrollback() {
      const erased = erasedScrollback;
      erasedScrollback = false;
      return erased;
    },
    text() {
      const buffer = term.buffer.normal;
      const output = [];
      for (let i = 0; i < buffer.length; i++) {
        const line = buffer.getLine(i);
        const continues = buffer.getLine(i + 1)?.isWrapped; // a long line's spaces at the wrap are real
        const text = line.translateToString(!continues);
        if (line.isWrapped && output.length) output[output.length - 1] += text;
        else output.push(text);
      }
      while (output.length && !output.at(-1)) output.pop();
      return output.join("\n");
    },
  };
}
