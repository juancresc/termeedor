// Inline rename: the name turns into a text box right where you started
// (top tab bar, sidebar tab list, group header, or past sessions).
// Enter saves, Esc cancels, clicking away saves.

import { el } from "./util.js";
import { LIMITS } from "./constants.js";
import { state, commit, renameItem } from "./store.js";
import { focusEditor } from "./editor.js";

/** @type {{ kind: "tab"|"group"|"past", id: string, where: "tabbar"|"sidebar" } | null} */
let editing = null;

export const isEditing = (kind, id, where) => editing?.kind === kind && editing.id === id && editing.where === where;

export function startRename(kind, item, where = "sidebar") {
  if (where === "sidebar") state.ws.sidebarOpen = true;
  if (kind === "tab" && where === "tabbar") state.ws.activeTab = item.id; // must be in the visible bar
  editing = { kind, id: item.id, where };
  commit();
}

/** Returns a label element, or an input if this item is being renamed at this location. */
export function nameLabel(kind, item, where, tag = "span", className = "") {
  const label = el(tag, className);
  if (!isEditing(kind, item.id, where)) {
    label.textContent = item.name;
    return label;
  }

  const input = el("input", "inlineInput");
  input.value = item.name;
  input.maxLength = LIMITS.name;
  input.spellcheck = false;

  const finish = (keep) => {
    if (!isEditing(kind, item.id, where)) return;
    editing = null;
    const name = input.value.trim();
    if (keep && name) renameItem(kind, item, name);
    else commit();
    focusEditor();
  };

  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
  });
  input.addEventListener("blur", () => finish(true));
  // don't let clicks inside the box trigger the row's own click/drag handlers
  for (const type of ["click", "dblclick", "mousedown", "contextmenu"]) input.addEventListener(type, (e) => e.stopPropagation());

  label.append(input);
  requestAnimationFrame(() => { input.focus(); input.select(); });
  return label;
}
