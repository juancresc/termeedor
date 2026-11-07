// The object every plugin's activate(api) receives. This is the supported surface
// (docs/plugins.md); internal modules can change at any time, this can't without a new apiVersion.
// Everything added through it is tracked by the plugin's scope and undone when it is turned off.

import { LIMITS } from "../constants.js";
import { load, save } from "../storage.js";
import {
  state, activeTab, addTab, activateTab, closeTab, renameItem, setTabColor,
} from "../store.js";
import { printToTab } from "../editor.js";
import * as registry from "./registry.js";

const storageKey = (pluginId, key) => `termeedor.plugin.${pluginId}.${key}`;

function addStylesheet(plugin, path) {
  const href = new URL(path, new URL(plugin.entry, location.origin)).href;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
  return () => link.remove();
}

export function createApi(plugin, scope) {
  if (plugin.hostFile) scope.track(() => window.termeedorHost.stopPluginHost(plugin.id));
  const { id } = plugin;
  return Object.freeze({
    apiVersion: 1,
    plugin: Object.freeze({ id, name: plugin.name, version: plugin.version }),

    commands: {
      register: (name, handler, { description = "" } = {}) => scope.track(registry.registerCommand(id, name, handler, description)),
    },
    shortcuts: {
      register: (combo, handler) => scope.track(registry.registerShortcut(id, combo, handler)),
    },
    menus: {
      addTabItem: (item) => scope.track(registry.addMenuItem(id, "tab", item)),
      addGroupItem: (item) => scope.track(registry.addMenuItem(id, "group", item)),
    },
    statusBar: {
      add(item) {
        const { remove, update } = registry.addStatusItem(id, item);
        return { ...scope.track(remove), update };
      },
    },
    events: {
      on: (name, handler) => scope.track(registry.on(id, name, handler)),
    },
    styles: {
      /** path is relative to the plugin's entry file. */
      add: (path) => scope.track(addStylesheet(plugin, path)),
    },
    workspace: {
      activeTab,
      tabs: () => [...state.ws.tabs],
      groups: () => [...state.ws.groups],
      openTab: (groupId) => addTab(groupId),
      activateTab: (tab) => activateTab(tab.id),
      closeTab,
      renameTab: (tab, name) => renameItem("tab", tab, name),
      setTabColor,
      /** Prints a line of output to a tab, keeping a prompt at the bottom. */
      print: printToTab,
    },
    host: {
      /** Calls a function exported by the plugin's OS-side file ("host" in plugin.json). */
      call(method, ...args) {
        if (!plugin.hostFile) return Promise.reject(new Error('This plugin has no "host" file in plugin.json'));
        return window.termeedorHost.callPluginHost(id, method, args);
      },
    },
    storage: {
      get: (key, fallback = null) => load(storageKey(id, key)) ?? fallback,
      set: (key, value) => {
        const json = JSON.stringify(value);
        if (json.length > LIMITS.pluginStorage) throw new Error(`Stored value is over ${LIMITS.pluginStorage} characters`);
        return save(storageKey(id, key), value);
      },
    },
  });
}
