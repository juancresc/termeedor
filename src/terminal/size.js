// How big the text area is, in characters.

import { $ } from "../util.js";

/** The tab's size in characters, so programs format their output to fit. */
export function textAreaSize() {
  const editor = $("editor");
  const probe = $("lineProbe");
  const box = probe.getBoundingClientRect();
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = getComputedStyle(editor).font;
  const charWidth = measure.measureText("x").width || 8;
  const lineHeight = box.height / 100 || 20;
  const style = getComputedStyle(editor);
  const usableWidth = editor.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return {
    cols: Math.max(20, Math.floor(usableWidth / charWidth)),
    rows: Math.max(5, Math.floor(editor.clientHeight / lineHeight)),
  };
}
