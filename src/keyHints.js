// Holding the shortcut key (Cmd on a Mac, Ctrl elsewhere) a moment shows which number jumps where:
// "1"–"9" on tabs, "⇧1"–"⇧9" on groups. tabbar.js puts the text in data-hint; CSS shows it while
// <html> has the class "showHints". A quick shortcut like Cmd+C starts and ends before the delay,
// so nothing flashes. Letting go, or the window losing focus (Cmd+Tab never sends the key-up), hides them.

import { hintModifier } from "./keymap.js";

export const HINT_DELAY = 400;

/** Returns the function that removes it. `target` is the window, `root` gets the class. */
export function initKeyHints({ target = globalThis.window, root = globalThis.document?.documentElement, modifier = hintModifier, delay = HINT_DELAY } = {}) {
  if (!modifier || !target || !root) return () => {};
  let timer = null;

  const hide = () => {
    clearTimeout(timer);
    timer = null;
    root.classList.remove("showHints");
  };
  const onKeyDown = (e) => {
    if (e.key === modifier) {
      if (!e.repeat && !root.classList.contains("showHints")) {
        clearTimeout(timer);
        timer = setTimeout(() => root.classList.add("showHints"), delay);
      }
    } else if (e.key !== "Shift") {
      clearTimeout(timer); // a shortcut is under way: no badges for it. Ones already shown stay.
      timer = null;
    }
  };
  const onKeyUp = (e) => { if (e.key === modifier) hide(); };

  const listeners = [["keydown", onKeyDown], ["keyup", onKeyUp], ["blur", hide]];
  for (const [type, fn] of listeners) target.addEventListener(type, fn, true); // capture: the terminal can't swallow it
  return () => {
    hide();
    for (const [type, fn] of listeners) target.removeEventListener(type, fn, true);
  };
}
