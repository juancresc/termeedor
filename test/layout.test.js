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
