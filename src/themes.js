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
 *   Output colors (black, red, green, yellow, blue, magenta, cyan, white, then the bright ones)
 *              --ansi-0 --ansi-1 --ansi-2 --ansi-3 --ansi-4 --ansi-5 --ansi-6 --ansi-7
 *              --ansi-8 --ansi-9 --ansi-10 --ansi-11 --ansi-12 --ansi-13 --ansi-14 --ansi-15
 *   Details    --command-divider --light-close --light-min --light-max --menu-shadow --tooltip-shadow
 *              --backdrop --badge-bg --badge-text
 *   Also       color-scheme: dark or light (scrollbars and form controls)
 *   Set by the app, to read but not override: --font-size --group-color --sbw
 *   --panel, --term and --accent also color this theme's card in Settings.
 *
 * Selectors
 *   Page       body .app .app.nosidebar .app.nolines .app.resizing .desktop .platform-darwin
 *   Title bar  .titlebar .lights .tb-btn
 *   Groups     .groupTabs .groupTab .groupTab.active .groupTab.dragover .groupTab.unnamed .chipName .chipCount
 *   Tabs       .tabStrip .tabs .tabs.showAll .tab .tab.active .tab.dragover .tab .name
 *              .tab.collapsed .tab.collapsed .initial .tabsEmpty
 *              .showHints .tab::after  (on <html> while Cmd is held: the 1–9 badge, also on .groupTab)
 *              .tabGroupBox .tabGroupBox.active .tabGroupBox.dragover .groupAdd
 *   Buttons    .itemBtns .x .x.closeBtn
 *   Sidebar    .sidebar .rail .rail .arrow .rail .vlabel .resizer .sec .secBtns .secClear .empty
 *              .group .group.collapsed .group.minimized .group.dragover .ghead .ghead.unnamed .gchevron .ghead .dot .ghead .gname .glist
 *              .item .item.active .item.minimized .item .iname .tdot .icon-btn .icon-btn.shown
 *   History    .pastSearch .session .session .sname
 *   Output     .main .termScroll .output .output.running .output ::selection .block .block.isCommand
 *              .commandLine .commandPrompt .commandText .blockOutput .outputChunk .outputTail .rerun
 *              .ansiBold .ansiDim .ansiItalic .ansiUnderline
 *   Input      .inputRow .inputRow.running .inputRow.multiline .inputLines .promptMark .editor .editor::selection
 *   Full screen .fullTerm (vim, top and friends)
 *   Completion .completions .completions div
 *   Status bar .status .status .sp #stTab #stCwd #stRunning #stPos #stPlugins .stPlugin .zoomBtns #zoomIn #zoomOut
 *   Menus      .menu .menu button .menu hr .menu .lbl .menu .swatches .menu .sw .menu .sw.none .menu .danger
 *   Tooltips   .tooltip .tooltip kbd
 *   Settings   dialog dialog::backdrop .setHead .setSearch ::highlight(settingsMatch) .searchHidden .topicHidden .setMain .setBody .setNav .setTopics .setTopics button .setRow .setText .setSub .shortcutRow .stepBtn .hint .btn
 *              .colorPick .colorPick .sw .colorPick .sw.none .colorPick .sw.groupOpt
 *              .themes .themeActions .themePick .themeCard .themeCard.on .themeCard .pv .themeCard .label
 *              .themeCard .remove .themeLink
 *              .pluginRow .pluginInfo .pluginMeta .pluginError .pluginsHint
 *   Editing    .inlineInput .spinner .runMark
 *   Confirm    .askDialog .askDialog h3 .askDialog p .askActions .btn.primary .btn.danger
 *   CSS dialog #themeEditor .themeBar .themeKind .themeMsg .themeMsg.error .themeCss
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
