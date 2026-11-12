// The app menu: Electron's default without Reload and Force Reload. Reloading ends every running
// shell, and on Windows and Linux Ctrl+R belongs to the shell (history search).
//
// No page zoom in or out: it scaled the whole window with no limit. Cmd/Ctrl + and − are the app's
// text size instead (keymap.js), which stays between FONT_SIZE.min and max. Actual Size stays, to
// undo a page zoom left from before.
//
// Cmd/Ctrl+W is the app's "close tab". A menu item only gets a key the page didn't take, and a
// dialog, Settings or a rename doesn't take it, so a "Close Window" on that key would close the
// window and end every shell. Closing the window takes Shift as well.

const closeWindow = (isMac) => ({ role: "close", accelerator: isMac ? "Shift+Cmd+W" : "Shift+Ctrl+W" });

const menuTemplate = (isMac) => [
  ...(isMac ? [{ role: "appMenu" }] : []),
  isMac ? { label: "File", submenu: [closeWindow(true)] } : { role: "fileMenu" },
  { role: "editMenu" },
  {
    label: "View",
    submenu: [
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  },
  // macOS's Window menu has no Close; elsewhere it does
  isMac ? { role: "windowMenu" } : { label: "Window", submenu: [{ role: "minimize" }, { role: "zoom" }, closeWindow(false)] },
];

module.exports = { menuTemplate };
