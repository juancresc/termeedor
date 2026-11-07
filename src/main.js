// Entry point: wires the modules together and re-renders on every state change.
//
//   store.js        state + actions (the only place state changes); loads saved data on import
//   core/           workspace.js  state, actions    saved.js, saver.js  what gets saved, and when
//   platform.js     desktop or browser, Mac or not, and the desktop host
//   ports/          what the app needs from a data store and from a backend
//   adapters/       files on the desktop, localStorage in the browser
//                   the real shell on the desktop, a mock in the browser
//   storage.js      localStorage helpers
//   terminal/       runner.js     runs commands, shows results   textModel.js  output → styled text
//                   outputView.js command blocks                 inputEditor.js  the input and completion
//                   fullscreen.js vim, top and friends           keys.js       key press → bytes
//   editor.js       the terminal area: connects the output and the input, and runs commands
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
// The desktop app (electron/) loads this same page; platform.js is how it differs.

import { host, isDesktop } from "./platform.js";
import { initRunner } from "./terminal/runner.js";
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

if (isDesktop) {
  document.documentElement.classList.add("desktop", `platform-${host.platform}`);
}

initTooltips();
initMenu();
initEditor();
initTabbar();
initSidebar();
initSettings();
initShortcuts();
initPluginUi();
initRunner();

subscribe(render);
window.addEventListener("beforeunload", saveNow);
render();
initPlugins();
