// Theme CSS dialog, opened from a theme card in Settings.
// Any theme's text can be changed and saved as a new theme; built-in themes can't be overwritten.

import { $ } from "./util.js";
import { state, addCustomTheme, updateCustomTheme } from "./store.js";
import { parseThemeFile } from "./themeImport.js";
import { findTheme, isBuiltin, themeSource, newThemeName, newThemeSource } from "./themes.js";

const dialog = $("themeEditor");
const box = $("themeCss");
let theme = null;
let savedText = "";
let pressedBackdrop = false;

const isDirty = () => !box.disabled && box.value !== savedText;

export function initThemeEditor() {
  box.addEventListener("input", onInput);
  dialog.addEventListener("keydown", onKeyDown);
  dialog.addEventListener("cancel", (event) => { event.preventDefault(); requestClose(); }); // Esc
  // only a press and release on the backdrop closes it: dragging a text selection past the edge must not
  dialog.addEventListener("pointerdown", (event) => { pressedBackdrop = event.target === dialog; });
  dialog.addEventListener("click", (event) => { if (pressedBackdrop && event.target === dialog) requestClose(); });
  $("closeThemeEditor").onclick = requestClose;
  $("saveTheme").onclick = saveTheme;
  $("copyTheme").onclick = copyText;
  $("saveAsNew").onclick = saveAsNew;
}

export async function openThemeEditor(id) {
  const requested = findTheme(state.settings, id);
  theme = requested;
  box.value = "";
  box.disabled = true;
  $("copyTheme").disabled = $("saveAsNew").disabled = $("saveTheme").disabled = true;
  $("themeName").textContent = requested.name;
  $("themeKind").textContent = "";
  $("saveTheme").hidden = isBuiltin(id);
  say("");
  dialog.showModal();
  try {
    const text = await themeSource(requested);
    if (theme === requested) show(requested, text); // ignore it if another theme was opened meanwhile
  } catch (err) {
    say(err.message, true);
  }
}

function requestClose() {
  if (!isDirty() || confirm("Discard your changes to this theme?")) dialog.close();
}

function say(text, isError = false) {
  $("themeMsg").textContent = text;
  $("themeMsg").classList.toggle("error", isError);
}

function show(nextTheme, text) {
  theme = nextTheme;
  savedText = text;
  box.value = text;
  box.disabled = false;
  $("copyTheme").disabled = $("saveAsNew").disabled = false;
  $("saveTheme").hidden = isBuiltin(theme.id);
  $("saveTheme").disabled = true;
  $("themeName").textContent = theme.name;
  $("themeKind").textContent = isBuiltin(theme.id) ? "Built-in. Your changes can only be saved as a new theme." : "Your theme";
  box.focus();
  box.setSelectionRange(0, 0);
  box.scrollTop = 0;
}

// ---------- actions ----------
function saveAsNew() {
  if (box.disabled) return;
  try {
    const name = newThemeName(box.value, theme, state.settings);
    const source = newThemeSource(box.value, name);
    const created = parseThemeFile(name, source);
    addCustomTheme(created);
    show(created, source);
    say(`Created "${created.name}" and selected it.`);
  } catch (err) {
    say(`Not saved: ${err.message}`, true);
  }
}

function saveTheme() {
  if (!isDirty()) return;
  if (isBuiltin(theme.id)) return saveAsNew();
  try {
    const updated = parseThemeFile(theme.name, box.value, theme.id);
    updateCustomTheme(updated);
    show(updated, box.value);
    say("Saved and selected.");
  } catch (err) {
    say(`Not saved: ${err.message}`, true);
  }
}

async function copyText() {
  try {
    await navigator.clipboard.writeText(box.value);
    say("Copied.");
  } catch {
    say("Could not copy. Select the text and copy it yourself.", true);
  }
}

// ---------- typing ----------
function onKeyDown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key === "s") {
    event.preventDefault();
    saveTheme();
  } else if (event.key === "Tab" && event.target === box) {
    event.preventDefault();
    box.setRangeText("  ", box.selectionStart, box.selectionEnd, "end");
    onInput();
  }
}

function onInput() {
  say("");
  $("saveTheme").disabled = !isDirty();
}
