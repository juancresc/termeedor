// Settings dialog: theme picker (built-in + imported .css files) and display options.

import { BUILTIN_THEMES, TAB_COLORS, colorVar } from "./constants.js";
import { $, el } from "./util.js";
import { state, updateSettings, addCustomTheme, removeCustomTheme, setSidebarOpen } from "./store.js";
import { parseThemeFile } from "./themeImport.js";
import { applyTheme } from "./themes.js";
import { initThemeEditor, openThemeEditor } from "./themeEditor.js";
import { focusEditor } from "./editor.js";
import { renderPluginSettings } from "./plugins/ui.js";

const dialog = $("settings");

export function initSettings() {
  $("settingsBtn").onclick = openSettings;
  $("closeSettings").onclick = () => dialog.close();
  dialog.addEventListener("click", (e) => { if (e.target === dialog) dialog.close(); }); // backdrop click
  dialog.addEventListener("close", focusEditor);

  $("fontSize").oninput = (e) => updateSettings({ fontSize: Number(e.target.value) });
  $("lineNumbers").onchange = (e) => updateSettings({ lineNumbers: e.target.checked });
  $("showSidebar").onchange = (e) => setSidebarOpen(e.target.checked);

  $("importTheme").onclick = () => $("themeFile").click();
  $("themeFile").onchange = importThemeFile;
  initThemeEditor();
}

export function openSettings() {
  dialog.showModal();
  renderSettings();
}

/** Applies theme, font size, etc. to the page. Runs on every render. */
export function applySettings() {
  applyTheme(state.settings);
  $("app").classList.toggle("nolines", !state.settings.lineNumbers);
}

export function renderSettings() {
  if (!dialog.open) return;
  const { fontSize, lineNumbers } = state.settings;
  $("fontSize").value = fontSize;
  $("fontSizeOut").textContent = `${fontSize}px`;
  $("lineNumbers").checked = lineNumbers;
  $("showSidebar").checked = state.ws.sidebarOpen;
  renderDefaultTabColor();
  renderThemeGrid();
  renderPluginSettings();
}

function renderDefaultTabColor() {
  const current = state.settings.defaultTabColor;
  const option = (value, className, title) => {
    const button = el("button", `${className}${current === value ? " on" : ""}`);
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
  $("defaultTabColor").replaceChildren(none, group, ...colors);
}

function renderThemeGrid() {
  const cards = [
    ...BUILTIN_THEMES.map((t) => themeCard(t, false)),
    ...state.settings.customThemes.map((t) => themeCard(t, true)),
  ];
  $("themes").replaceChildren(...cards);
}

function themeCard({ id, name, preview }, removable) {
  const card = el("div", `themeCard${state.settings.theme === id ? " on" : ""}`);

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
      if (confirm(`Remove theme "${name}"?`)) removeCustomTheme(id);
    };
    card.append(remove);
  }
  return card;
}

async function importThemeFile(event) {
  const file = event.target.files[0];
  event.target.value = ""; // allow picking the same file again
  if (!file) return;
  if (!/\.css$/i.test(file.name)) return alert("Please pick a .css file.");
  try {
    addCustomTheme(parseThemeFile(file.name, await file.text()));
  } catch (err) {
    alert(`Could not import theme: ${err.message}`);
  }
}
