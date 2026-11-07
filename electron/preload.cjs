// The only OS-side features the page can reach. Absent in the browser build,
// so window.termeedorHost also tells the app whether it is running on the desktop.

const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("termeedorHost", {
  platform: process.platform,
  listPlugins: () => ipcRenderer.invoke("plugins:list"),
  openPluginsFolder: () => ipcRenderer.invoke("plugins:open-folder"),
  callPluginHost: (id, method, args) => ipcRenderer.invoke("plugins:host-call", id, method, args),
  stopPluginHost: (id) => ipcRenderer.invoke("plugins:host-stop", id),
  shell: {
    run: (tabId, command, options) => ipcRenderer.invoke("shell:run", tabId, command, options),
    write: (tabId, data) => ipcRenderer.invoke("shell:write", tabId, data),
    resize: (tabId, cols, rows) => ipcRenderer.invoke("shell:resize", tabId, cols, rows),
    kill: (tabId) => ipcRenderer.invoke("shell:kill", tabId),
    complete: (tabId, input, cwd) => ipcRenderer.invoke("shell:complete", tabId, input, cwd),
    onEvent: (listener) => ipcRenderer.on("shell:event", (_event, message) => listener(message)),
  },
});
