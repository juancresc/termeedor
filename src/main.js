// Entry point: wires the modules together and re-renders on every state change.
//
//   store.js        state + actions (the only place state changes)
//   storage.js      localStorage + validation
//   shell.js        mock command runner (swap for a real backend later)
//   editor.js       terminal text area
//   tabbar.js       top tabs        sidebar.js   groups, past sessions
//   rename.js       inline rename   contextMenus.js / menu.js   right-click menus
//   settings.js     settings dialog themeImport.js  .css theme files
//   shortcuts.js    keyboard shortcuts

import { subscribe, saveNow } from "./store.js";
import { initMenu } from "./menu.js";
import { initEditor, renderEditor } from "./editor.js";
import { initTabbar, renderTabbar } from "./tabbar.js";
import { initSidebar, renderSidebar } from "./sidebar.js";
import { initSettings, applySettings, renderSettings } from "./settings.js";
import { initShortcuts } from "./shortcuts.js";

function render() {
  applySettings();
  renderTabbar();
  renderSidebar();
  renderEditor();
  renderSettings();
}

initMenu();
initEditor();
initTabbar();
initSidebar();
initSettings();
initShortcuts();

subscribe(render);
window.addEventListener("beforeunload", saveNow);
render();
