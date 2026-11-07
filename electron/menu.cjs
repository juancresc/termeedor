// The app menu: Electron's default without Reload and Force Reload. Reloading ends every running
// shell, and on Windows and Linux Ctrl+R belongs to the shell (history search).

const menuTemplate = (isMac) => [
  ...(isMac ? [{ role: "appMenu" }] : []),
  { role: "fileMenu" },
  { role: "editMenu" },
  {
    label: "View",
    submenu: [
      { role: "toggleDevTools" },
      { type: "separator" },
      { role: "resetZoom" },
      { role: "zoomIn" },
      { role: "zoomOut" },
      { type: "separator" },
      { role: "togglefullscreen" },
    ],
  },
  { role: "windowMenu" },
];

module.exports = { menuTemplate };
