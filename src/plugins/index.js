// Connects the plugin host to the app: which plugins exist (asked of the Electron main
// process), which are turned on (settings), and the workspace events plugins can listen to.

import { state, subscribe, updateSettings } from "../store.js";
import { createApi } from "./api.js";
import { createPluginHost } from "./host.js";
import { emit } from "./registry.js";

const desktop = window.termeedorHost; // undefined in the browser build
const changeListeners = new Set();
let plugins = [];
let userDir = null;

const host = createPluginHost({
  // Same origin as the app, so the page's CSP allows it (see fileForPath in electron/main.cjs).
  importModule: (plugin) => import(new URL(plugin.entry, location.origin).href),
  createApi,
  onChange: () => changeListeners.forEach((fn) => fn()),
});

export const pluginsSupported = () => !!desktop;
export const pluginsDir = () => userDir;
export const onPluginsChange = (fn) => changeListeners.add(fn);
export const openPluginsFolder = () => desktop?.openPluginsFolder();

const isEnabled = (id) => state.settings.enabledPlugins.includes(id);

/** For the settings panel: each plugin with its on/off state and any error. */
export const pluginList = () => plugins.map((plugin) => ({
  ...plugin,
  enabled: isEnabled(plugin.id),
  status: host.status(plugin.id),
}));

export async function initPlugins() {
  if (!desktop) return;
  watchWorkspace();
  ({ plugins, userDir } = await desktop.listPlugins());
  changeListeners.forEach((fn) => fn());
  // One at a time, in id order, so a name conflict between two plugins always resolves the same way.
  for (const plugin of plugins) {
    if (!plugin.error && isEnabled(plugin.id)) await host.activate(plugin);
  }
}

export function setPluginEnabled(id, enabled) {
  const plugin = plugins.find((p) => p.id === id);
  if (!plugin || plugin.error) return;
  updateSettings({
    enabledPlugins: enabled ? [...new Set([...state.settings.enabledPlugins, id])] : state.settings.enabledPlugins.filter((p) => p !== id),
  });
  if (enabled) host.activate(plugin);
  else host.deactivate(id);
}

/** Turns store changes into tab events. Runs after the current commit, so a listener can safely change state. */
function watchWorkspace() {
  let known = new Map(state.ws.tabs.map((tab) => [tab.id, tab]));
  let active = state.ws.activeTab;
  subscribe(() => {
    const current = new Map(state.ws.tabs.map((tab) => [tab.id, tab]));
    const opened = state.ws.tabs.filter((tab) => !known.has(tab.id));
    const closed = [...known.values()].filter((tab) => !current.has(tab.id));
    const activated = state.ws.activeTab !== active ? current.get(state.ws.activeTab) : null;
    known = current;
    active = state.ws.activeTab;
    if (!opened.length && !closed.length && !activated) return;
    queueMicrotask(() => {
      opened.forEach((tab) => emit("tab:open", { tab }));
      closed.forEach((tab) => emit("tab:close", { tab }));
      if (activated) emit("tab:activate", { tab: activated });
    });
  });
}
