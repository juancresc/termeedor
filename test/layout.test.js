import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const read = (path) => fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("the prompt sits right after the output and scrolls with it", () => {
  const page = read("index.html");
  const [scroller, output, input, closes] = ['id="termScroll"', 'id="output"', 'id="inputRow"', 'id="fullTerms"'].map((part) => page.indexOf(part));
  assert.ok(scroller !== -1 && scroller < output && output < input && input < closes);

  const css = read("styles/base.css");
  assert.match(css, /^\.termScroll \{[^}]*overflow: hidden auto/m);
  assert.doesNotMatch(css.match(/^\.output \{[^}]*\}/m)[0], /flex|overflow:/);
});

const rule = (css, selector) => css.match(new RegExp(`^${selector.replace(/[.()]/g, "\\$&")} \\{[^}]*\\}`, "m"))?.[0] ?? "";

test("pressing Enter leaves the typed line where it was and looking the same", () => {
  const css = read("styles/base.css");
  const color = (selector) => rule(css, selector).match(/(?:^|[ {;])color: ([^;]+);/)?.[1];
  assert.equal(color(".promptMark"), color(".commandPrompt"));

  // the line numbers take no room, so the prompt stays put when a second line brings them in
  assert.match(rule(css, ".inputLines"), /position: absolute/);
  // a single line has no line number beside it, as a command line in the output has none
  assert.match(rule(css, ".inputRow:not(.multiline) .inputLines"), /display: none/);
  // the line between commands comes from the theme, and the default theme has none
  assert.match(rule(css, ".block.isCommand"), /var\(--command-divider\)/);
  assert.match(read("themes/default.css"), /--command-divider: transparent;/);
  // a command's separator takes no room, or the text would shift by its width
  assert.doesNotMatch(rule(css, ".block.isCommand"), /border/);
});

test("the space under the prompt stays while a command runs", () => {
  const css = read("styles/base.css");
  assert.match(rule(css, ".inputRow"), /padding: 0 16px 0 1\.25em;/);
  assert.match(rule(css, ".termScroll"), /padding-bottom: 10px/);
});
