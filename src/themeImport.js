// Turns a user's .css file into a theme that only applies while it is selected.
// Every selector is scoped to :root[data-theme="<id>"], and the browser's CSS parser
// re-serializes the rules (this also drops @import).

import { LIMITS } from "./constants.js";
import { uid } from "./util.js";
import { cssColor } from "./storage.js";

export function parseThemeFile(fileName, cssText) {
  if (cssText.length > LIMITS.themeCss) throw new Error("Theme file is too large (max 100 KB).");

  const id = `c-${uid()}`;
  const scope = `:root[data-theme="${id}"]`;

  const sheet = new CSSStyleSheet();
  sheet.replaceSync(cssText);
  scopeRules(sheet.cssRules, scope);

  const css = [...sheet.cssRules].map((rule) => rule.cssText).join("\n");
  if (!css.trim()) throw new Error("No CSS rules found in this file.");

  const vars = readRootVars(sheet.cssRules, scope);
  return {
    id,
    name: themeName(fileName, cssText),
    css,
    preview: ["--panel", "--term", "--accent"].map((v) => cssColor(vars.getPropertyValue(v)) ?? "#888"),
  };
}

function scopeRules(rules, scope) {
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule) {
      rule.selectorText = rule.selectorText.split(",").map((s) => scopeSelector(s.trim(), scope)).join(", ");
    } else if (rule.cssRules) {
      scopeRules(rule.cssRules, scope); // @media, @supports, …
    }
  }
}

function scopeSelector(selector, scope) {
  // ":root", "html", ":root[...]" become the scope itself; anything else is nested under it
  if (/^(:root|html)\b/.test(selector)) return selector.replace(/^(:root|html)(\[[^\]]*\])*/, scope);
  return `${scope} ${selector}`;
}

/** Collects variables declared directly on the theme root, for the preview card. */
function readRootVars(rules, scope) {
  const style = document.createElement("div").style;
  for (const rule of rules) {
    if (rule instanceof CSSStyleRule && rule.selectorText === scope) {
      for (const prop of rule.style) if (prop.startsWith("--")) style.setProperty(prop, rule.style.getPropertyValue(prop));
    }
  }
  return style;
}

function themeName(fileName, cssText) {
  const tagged = cssText.match(/@name\s+([^\n*]+)/)?.[1];
  const name = (tagged ?? fileName.replace(/\.css$/i, "")).trim().slice(0, LIMITS.themeName);
  return name || "Custom";
}
