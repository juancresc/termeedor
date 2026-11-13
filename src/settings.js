// Settings dialog: theme picker (built-in + imported .css files) and display options.

import { BUILTIN_THEMES, FONT_SIZE, TAB_COLORS, colorVar } from "./constants.js";
import { $, el } from "./util.js";
import { runAction } from "./core/actions.js";
import { patchChildren } from "./patch.js";
import { state, updateSettings, addCustomTheme, removeCustomTheme, setSidebarOpen } from "./store.js";
import { parseThemeFile } from "./themeImport.js";
import { applyTheme } from "./themes.js";
import { initThemeEditor, openThemeEditor } from "./themeEditor.js";
import { focusEditor } from "./editor.js";
import { askConfirm, showNotice } from "./dialogs.js";
import { renderPluginSettings } from "./plugins/ui.js";
import { applySettingsSearch, initSettingsTopics } from "./settingsSearch.js";

const dialog = $("settings");

export function initSettings() {
  $("settingsBtn").onclick = () => runAction("openSettings");
  $("closeSettings").onclick = () => dialog.close();
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // backdrop click
  dialog.addEventListener("close", focusEditor);

  $("fontSize").oninput = (e) => updateSettings({ fontSize: Number(e.target.value) });
  $("fontSizeDown").onclick = () => updateSettings({ fontSize: state.settings.fontSize - 1 });
  $("fontSizeUp").onclick = () => updateSettings({ fontSize: state.settings.fontSize + 1 });
  $("zoomOut").onclick = () => runAction("textSmaller");
  $("zoomIn").onclick = () => runAction("textLarger");
  for (const id of ["zoomOut", "zoomIn"]) $(id).onmousedown = (e) => e.preventDefault(); // keep focus in the input
  $("lineNumbers").onchange = (e) => updateSettings({ lineNumbers: e.target.checked });
  $("showAllGroups").onchange = (e) => updateSettings({ showAllGroups: e.target.checked });
  $("showSidebar").onchange = (e) => setSidebarOpen(e.target.checked);
  $("newTabInCurrentPath").onchange = (e) => updateSettings({ newTabInCurrentPath: e.target.checked });
  $("sharedHistory").onchange = (e) => updateSettings({ sharedHistory: e.target.checked });
  $("moveButtons").onchange = (e) => updateSettings({ moveButtons: e.target.checked });
  $("confirmCloseGroup").onchange = (e) => updateSettings({ confirmCloseGroup: e.target.checked });
  $("settingsSearch").oninput = applySettingsSearch;
  initSettingsTopics();

  $("importTheme").onclick = () => $("themeFile").click();
  $("themeFile").onchange = importThemeFile;
  initThemeEditor();
}

export function openSettings() {
  $("settingsSearch").value = "";
  dialog.showModal();
  renderSettings();
}

/** Applies theme, font size, etc. to the page. Runs on every render. */
export function applySettings() {
  applyTheme(state.settings);
  $("app").classList.toggle("nolines", !state.settings.lineNumbers);
  $("zoomOut").disabled = state.settings.fontSize <= FONT_SIZE.min;
  $("zoomIn").disabled = state.settings.fontSize >= FONT_SIZE.max;
}

export function renderSettings() {
  if (!dialog.open) return;
  const { fontSize, lineNumbers } = state.settings;
  $("fontSize").value = fontSize;
  $("fontSizeOut").textContent = `${fontSize}px`;
  $("fontSizeDown").disabled = fontSize <= FONT_SIZE.min;
  $("fontSizeUp").disabled = fontSize >= FONT_SIZE.max;
  $("lineNumbers").checked = lineNumbers;
  $("showAllGroups").checked = state.settings.showAllGroups;
  $("showSidebar").checked = state.ws.sidebarOpen;
  $("newTabInCurrentPath").checked = state.settings.newTabInCurrentPath;
  $("moveButtons").checked = state.settings.moveButtons;
  $("confirmCloseGroup").checked = state.settings.confirmCloseGroup;
  $("sharedHistory").checked = state.settings.sharedHistory;
  renderDefaultTabColor();
  renderThemeGrid();
  renderPluginSettings();
  applySettingsSearch();
}

function renderDefaultTabColor() {
  const current = state.settings.defaultTabColor;
  const option = (value, className, title) => {
    const button = el("button", `${className}${current === value ? " on" : ""}`);
    button.dataset.slideKey = value;
    button.title = title;
    button.onclick = () => updateSettings({ defaultTabColor: value });
    return button;
  };
  const none = option("none", "sw none", "No color");
  const group = option("group", "sw groupOpt", "Same as the group");
  group.textContent = "G";
  const colors = TAB_COLORS.map((c, index) => {
    const swatch = option(c, "sw", `Color ${index + 1}`);
    swatch.style.background = colorVar(c);
    return swatch;
  });
  patchChildren($("defaultTabColor"), [none, group, ...colors]);
}

function renderThemeGrid() {
  const cards = [
    ...BUILTIN_THEMES.map((t) => themeCard(t, false)),
    ...state.settings.customThemes.map((t) => themeCard(t, true)),
  ];
  patchChildren($("themes"), cards);
}

function themeCard({ id, name, preview }, removable) {
  const card = el("div", `themeCard${state.settings.theme === id ? " on" : ""}`);
  card.dataset.slideKey = id;

  const pick = el("button", "themePick");
  pick.title = name;
  pick.onclick = () => updateSettings({ theme: id });
  const swatches = el("div", "pv");
  for (const color of preview) {
    const swatch = el("i");
    swatch.style.background = color;
    swatches.append(swatch);
  }
  pick.append(swatches, el("span", "label", name));

  const cssButton = el("button", "themeLink", "CSS");
  cssButton.title = "Open this theme's CSS";
  cssButton.onclick = () => openThemeEditor(id);
  card.append(pick, cssButton);

  if (removable) {
    const remove = el("button", "remove", "✕");
    remove.title = "Remove theme";
    remove.onclick = () => {
      askConfirm({ title: `Remove the theme "${name}"?`, acceptLabel: "Remove", danger: true }).then((yes) => { if (yes) removeCustomTheme(id); });
    };
    card.append(remove);
  }
  return card;
}

async function importThemeFile(event) {
  const file = event.target.files[0];
  event.target.value = ""; // allow picking the same file again
  if (!file) return;
  if (!/\.css$/i.test(file.name)) return showNotice("That isn't a theme file", "Please pick a .css file.");
  try {
    addCustomTheme(parseThemeFile(file.name, await file.text()));
  } catch (err) {
    showNotice("Could not import the theme", err.message);
  }
}
