// The reference at the top of a new theme is how people find out what they can style.

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const css = read("styles/base.css").replace(/\/\*[\s\S]*?\*\//g, "");
const reference = read("src/themes.js").match(/const REFERENCE = `([\s\S]*?)`;/)[1];
const missingFrom = (names) => [...new Set(names)].filter((name) => !new RegExp(`${name}(?![\\w-])`).test(reference));

const MEASURING_ONLY = [".lineProbe", ".lineProbeBox"]; // restyling these would break how the text is measured

test("the theme reference lists every class in the stylesheet", () => {
  const classes = (css.match(/\.[a-zA-Z][\w-]*/g) ?? []).filter((name) => !MEASURING_ONLY.includes(name));
  assert.deepEqual(missingFrom(classes), []);
});

test("the theme reference lists every variable", () => {
  const used = css.match(/--[a-z0-9-]+/g) ?? [];
  const defined = read("themes/default.css").match(/--[a-z0-9-]+/g) ?? [];
  assert.deepEqual(missingFrom([...used, ...defined]), []);
});
