// Theme helpers: applying a theme, reading its CSS, and starting a new theme from it.

import { BUILTIN_THEMES } from "./constants.js";
import { $ } from "./util.js";

/** Puts the selected theme on the page: variables, font size, and every imported theme's CSS. */
export function applyTheme(settings) {
  const root = document.documentElement;
  if (settings.theme === "default") delete root.dataset.theme;
  else root.dataset.theme = settings.theme;
  root.style.setProperty("--font-size", `${settings.fontSize}px`);

  // imported themes are already scoped CSS; set as text, never parsed as HTML
  const css = settings.customThemes.map((t) => t.css).join("\n");
  const styleTag = $("customThemes");
  if (styleTag.textContent !== css) styleTag.textContent = css;
}

export const isBuiltin = (id) => BUILTIN_THEMES.some((t) => t.id === id);

export const findTheme = (settings, id) =>
  BUILTIN_THEMES.find((t) => t.id === id) ?? settings.customThemes.find((t) => t.id === id);

/** The CSS a person reads and edits, with selectors written as plain :root. */
export async function themeSource(theme) {
  if (!isBuiltin(theme.id)) return theme.source ?? unscope(theme.css); // imported before sources were kept
  const response = await fetch(`themes/${theme.id}.css`);
  if (!response.ok) throw new Error(`Could not load themes/${theme.id}.css`);
  return unscope(await response.text());
}

const unscope = (css) => css.replace(/:root\[data-theme="[^"]*"\]/g, ":root");

/** "Ocean" → "Ocean copy"; "Ocean copy" → "Ocean copy 2"; never repeats an existing name. */
function copyName(name, settings) {
  const taken = new Set([...BUILTIN_THEMES, ...settings.customThemes].map((t) => t.name));
  const base = `${name.replace(/ copy( \d+)?$/, "").slice(0, 30)} copy`;
  if (!taken.has(base)) return base;
  let number = 2;
  while (taken.has(`${base} ${number}`)) number++;
  return `${base} ${number}`;
}

const REFERENCE_TITLE = "Termeedor theme reference";
const REFERENCE = `/*
 * ${REFERENCE_TITLE}
 *
 * Set variables on :root, or style any element with normal CSS. Rules only apply
 * while this theme is selected. @import and external files are blocked.
 *
 * Variables (anything left out comes from the Default theme)
 *   Surfaces   --bg --panel --panel2 --term --line --sel
 *   Text       --text --dim --gutter --accent --danger --on-color
 *   Fonts      --mono --ui
 *   Tab colors --c1 --c2 --c3 --c4 --c5 --c6 --c7 --c8
 *   Details    --light-close --light-min --light-max --menu-shadow --tooltip-shadow
 *              --backdrop --badge-bg --badge-text
 *   Also       color-scheme: dark or light (scrollbars and form controls)
 *   --panel, --term and --accent also color this theme's card in Settings.
 *
 * Selectors
 *   Page       body .app
 *   Title bar  .titlebar .lights .tb-btn .sbToggle
 *   Groups     .groupTabs .groupTab .groupTab.active .groupTray .chipName .chipCount
 *   Tabs       .tabStrip .tabs .tab .tab.active .tab.collapsed .tab .name .tabsEmpty
 *   Buttons    .itemBtns .x .x.closeBtn
 *   Sidebar    .sidebar .sbhead .hideBtn .rail .resizer .sec .empty
 *              .group .group.collapsed .group.minimized .ghead .ghead .gname .ghead .count .glist
 *              .item .item.active .item.minimized .tdot .icon-btn
 *   History    .pastSearch .session .session .sname
 *   Terminal   .main .colorbar .gutter .editor .editor::selection .cmdLines div
 *   Status bar .status #stTab #stCwd #stRunning #stPos #stPlugins .stPlugin
 *   Menus      .menu .menu button .menu hr .menu .lbl .menu .sw .menu .danger
 *   Tooltips   .tooltip .tooltip kbd
 *   Settings   dialog dialog::backdrop .setHead .setBody .setRow .hint .btn
 *              .themes .themeCard .themeCard.on .themeLink
 *              .pluginRow .pluginInfo .pluginMeta .pluginError
 *   Editing    .inlineInput .spinner
 *   CSS dialog #themeEditor .themeBar .themeKind .themeMsg .themeCss
 */`;

/** The name a new theme gets from its text: a new @name if one was typed, else "<original> copy". */
export function newThemeName(text, original, settings) {
  const typed = text.match(/@name\s+([^\n*]+)/)?.[1].trim();
  return typed && typed !== original.name ? typed : copyName(original.name, settings);
}

/** CSS for a new theme: named, and with the reference on top unless it already has it. */
export function newThemeSource(source, name) {
  const safeName = name.replace(/[*\n]/g, "");
  const tag = /@name\s+[^\n*]+/;
  const body = source.replace(/^\/\*[^\n]*built-in Termeedor theme[^\n]*\*\/\n+/, ""); // no longer true of a new theme
  const named = tag.test(body) ? body.replace(tag, () => `@name ${safeName}`) : `/* @name ${safeName} */\n\n${body}`;
  return named.includes(REFERENCE_TITLE) ? named : `${REFERENCE}\n\n${named}`;
}
