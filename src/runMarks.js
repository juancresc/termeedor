// Spinners that come and go as commands run. A command only changes these, so the bars keep a
// slot for each one and fill it directly instead of being rebuilt. An empty slot takes no room.

import { el, spinner } from "./util.js";

export function createRunMarks() {
  let marks = [];

  function show(mark) {
    const on = mark.isOn();
    if (on === mark.on) return;
    mark.on = on;
    mark.node.replaceChildren(...(on ? [spinner()] : []));
  }

  return {
    /** Call when the rows are rebuilt: the old slots have gone with them. */
    clear() { marks = []; },
    /** A new slot, showing a spinner whenever isOn() says so. */
    slot(isOn) {
      const mark = { node: el("span", "runMark"), isOn, on: false };
      show(mark);
      marks.push(mark);
      return mark.node;
    },
    refresh() { marks.forEach(show); },
  };
}
