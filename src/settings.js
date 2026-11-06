// Settings dialog: theme picker (built-in + imported .css files) and display options.

import { BUILTIN_THEMES, TAB_COLORS, colorVar } from "./constants.js";
import { $, el } from "./util.js";
import { state, updateSettings, addCustomTheme, removeCustomTheme, setSidebarOpen } from "./store.js";
import { parseThemeFile } from "./themeImport.js";
import { focusEditor } from "./editor.js";

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
}

export function openSettings() {
  dialog.showModal();
  renderSettings();
}

/** Applies theme, font size, etc. to the page. Runs on every render. */
export function applySettings() {
  const { theme, fontSize, lineNumbers, customThemes } = state.settings;
  const root = document.documentElement;
  if (theme === "default") delete root.dataset.theme;
  else root.dataset.theme = theme;
  root.style.setProperty("--font-size", `${fontSize}px`);
  $("app").classList.toggle("nolines", !lineNumbers);

  // imported themes are already scoped CSS; set as text, never parsed as HTML
  const css = customThemes.map((t) => t.css).join("\n");
  const styleTag = $("customThemes");
  if (styleTag.textContent !== css) styleTag.textContent = css;
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
  const colors = TAB_COLORS.map((c) => {
    const swatch = option(c, "sw", "Theme color");
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
  const card = el("button", `themeCard${state.settings.theme === id ? " on" : ""}`);
  card.title = name;

  const swatches = el("div", "pv");
  for (const color of preview) {
    const swatch = el("i");
    swatch.style.background = color;
    swatches.append(swatch);
  }
  card.append(swatches, el("span", "label", name));
  card.onclick = () => updateSettings({ theme: id });

  if (removable) {
    const remove = el("span", "remove", "✕");
    remove.title = "Remove theme";
    remove.onclick = (e) => {
      e.stopPropagation();
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
