// Entry point: wires the modules together and re-renders on every state change.
//
//   store.js        state + actions (the only place state changes)
//   storage.js      localStorage + validation
//   shell.js        decides what runs a command; holds the browser build's mock
//   terminal/       realShell.js  the tab's real shell   textModel.js  output → plain text
//                   fullscreen.js vim, top and friends   keys.js       key press → bytes
//   editor.js       terminal text area
//   tabbar.js       top tabs        sidebar.js   groups, past sessions
//   rename.js       inline rename   contextMenus.js / menu.js   right-click menus
//   settings.js     settings dialog themeImport.js  .css theme files
//   themes.js       theme helpers   themeEditor.js  theme CSS dialog
//   keymap.js       which keys do what (browser vs Electron)
//   shortcuts.js    runs those actions from the keyboard
//   tooltip.js      styled tooltips for every `title` attribute
//   plugins/        registry.js  what plugins added     host.js  plugin lifecycle
//                   api.js       the plugin API         index.js wiring    ui.js  settings, status bar
//
// The desktop app (electron/) loads this same page; window.termeedorHost is how it differs.

import { initRealShell } from "./terminal/realShell.js";
import { initPlugins } from "./plugins/index.js";
import { initPluginUi } from "./plugins/ui.js";
import { subscribe, saveNow } from "./store.js";
import { initTooltips } from "./tooltip.js";
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

if (window.termeedorHost) {
  document.documentElement.classList.add("desktop", `platform-${window.termeedorHost.platform}`);
}

initTooltips();
initMenu();
initEditor();
initTabbar();
initSidebar();
initSettings();
initShortcuts();
initPluginUi();
initRealShell();

subscribe(render);
window.addEventListener("beforeunload", saveNow);
render();
initPlugins();
