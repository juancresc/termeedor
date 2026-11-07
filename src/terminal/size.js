// How big the output area is, in characters.

import { $ } from "../util.js";

/** The tab's size in characters, so programs format their output to fit. */
export function textAreaSize() {
  const output = $("output");
  const style = getComputedStyle(output);
  const measure = document.createElement("canvas").getContext("2d");
  measure.font = style.font;
  const charWidth = measure.measureText("x").width || 8;
  const lineHeight = parseFloat(style.lineHeight) || 20;
  const usableWidth = output.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
  return {
    cols: Math.max(20, Math.floor(usableWidth / charWidth)),
    rows: Math.max(5, Math.floor($("termScroll").clientHeight / lineHeight)),
  };
}
