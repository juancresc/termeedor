// Holding a shortcut key a moment shows which number jumps where. On a Mac, Cmd puts "1"–"9" on
// the tabs and Ctrl puts "⌃1"–"⌃9" on the groups; elsewhere Ctrl shows both ("⇧1"–"⇧9" on groups).
// tabbar.js puts the text in data-hint; CSS shows it while <html> has the class "showHints" (tabs)
// or "showGroupHints" (groups). A quick shortcut like Cmd+C starts and ends before the delay,
// so nothing flashes. Letting go, or the window losing focus (Cmd+Tab never sends the key-up), hides them.

import { hintModifiers } from "./keymap.js";

export const HINT_DELAY = 400;

/** Returns the function that removes it. `target` is the window, `root` gets the classes. */
export function initKeyHints({ target = globalThis.window, root = globalThis.document?.documentElement, modifiers = hintModifiers, delay = HINT_DELAY } = {}) {
  if (!modifiers || !target || !root) return () => {};
  const allClasses = [...new Set(Object.values(modifiers).flat())];
  let timer = null;
  let pending = null; // the hint key waiting out the delay

  const cancel = () => {
    clearTimeout(timer);
    timer = null;
    pending = null;
  };
  const hide = () => {
    cancel();
    for (const name of allClasses) root.classList.remove(name);
  };
  const shown = () => allClasses.some((name) => root.classList.contains(name));
  const onKeyDown = (e) => {
    if (Object.hasOwn(modifiers, e.key)) {
      if (pending && pending !== e.key) cancel(); // two hint keys together (Cmd+Ctrl) make a shortcut, not a hint
      else if (!e.repeat && !pending && !shown()) {
        const key = e.key;
        pending = key;
        timer = setTimeout(() => {
          for (const name of modifiers[key]) root.classList.add(name);
          timer = null;
          pending = null;
        }, delay);
      }
    } else if (e.key !== "Shift" && e.key !== "Alt") {
      cancel(); // a shortcut is under way: no badges for it. Ones already shown stay.
    }
  };
  const onKeyUp = (e) => { if (Object.hasOwn(modifiers, e.key)) hide(); };

  const listeners = [["keydown", onKeyDown], ["keyup", onKeyUp], ["blur", hide]];
  for (const [type, fn] of listeners) target.addEventListener(type, fn, true); // capture: the terminal can't swallow it
  return () => {
    hide();
    for (const [type, fn] of listeners) target.removeEventListener(type, fn, true);
  };
}
