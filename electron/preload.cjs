// The only OS-side features the page can reach. Absent in the browser build,
// so window.termeedorHost also tells the app whether it is running on the desktop.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("termeedorHost", {
  platform: process.platform,
  listPlugins: () => ipcRenderer.invoke("plugins:list"),
  openPluginsFolder: () => ipcRenderer.invoke("plugins:open-folder"),
});
