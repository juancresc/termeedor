// The object every plugin's activate(api) receives. This is the supported surface
// (docs/plugins.md); internal modules can change at any time, this can't without a new apiVersion.
// Everything added through it is tracked by the plugin's scope and undone when it is turned off.
// Tabs and groups leave here as copies, and come back as a copy or an id, so state only changes
// through what this offers. Actions are referred to by id.

import { LIMITS } from "../constants.js";
import { hasAction, runAction } from "../core/actions.js";
import { host as desktop } from "../platform.js";
import { load, save } from "../storage.js";
import {
  state, activeTab, addTab, activateTab, closeTab, getGroup, getTab, renameItem, setTabColor,
} from "../store.js";
import { printToTab } from "../editor.js";
import * as registry from "./registry.js";

const storageKey = (pluginId, key) => `termeedor.plugin.${pluginId}.${key}`;

const copy = (value) => (typeof value === "object" && value !== null ? structuredClone(value) : value);
const copyPayload = (payload) => ({ ...payload, ...(payload.tab && { tab: copy(payload.tab) }) });

/** The app's own tab or group that a copy or an id stands for. Anything else stays as it is. */
function live(target) {
  const id = target?.id ?? target;
  return getTab(id) ?? getGroup(id) ?? target;
}

/** For calls on a tab: nothing happens if it has closed. */
const onTab = (fn) => (target, ...args) => {
  const tab = getTab(target?.id ?? target);
  return tab ? fn(tab, ...args) : undefined;
};

function addStylesheet(plugin, path) {
  const href = new URL(path, new URL(plugin.entry, location.origin)).href;
  const link = document.createElement("link");
  link.rel = "stylesheet";
  link.href = href;
  document.head.append(link);
  return () => link.remove();
}

export function createApi(plugin, scope) {
  if (plugin.hostFile) scope.track(() => desktop.stopPluginHost(plugin.id));
  const { id } = plugin;
  /** A plugin's own actions go by their short id. Everything else by its full id. */
  const actionId = (ref) => (hasAction(`${id}.${ref}`) ? `${id}.${ref}` : ref);
  return Object.freeze({
    apiVersion: 2,
    plugin: Object.freeze({ id, name: plugin.name, version: plugin.version }),

    actions: {
      register({ run, enabled = null, ...action }) {
        if (typeof run !== "function") throw new TypeError("Action run must be a function");
        const { id: fullId, remove } = registry.registerAction(id, {
          ...action,
          run: (...args) => run(...args.map(copy)),
          enabled: enabled && ((...args) => enabled(...args.map(copy))),
        });
        return { ...scope.track(remove), id: fullId };
      },
      run: (ref, target, ...args) => runAction(actionId(ref), live(target), ...args),
    },
    shortcuts: {
      register: (combo, action) => scope.track(registry.registerShortcut(id, combo, actionId(action))),
    },
    menus: {
      addTabItem: (action) => scope.track(registry.addMenuItem(id, "tab", actionId(action))),
      addGroupItem: (action) => scope.track(registry.addMenuItem(id, "group", actionId(action))),
    },
    statusBar: {
      add({ action = null, ...item }) {
        const { remove, update } = registry.addStatusItem(id, { ...item, action: action && actionId(action) });
        return { ...scope.track(remove), update };
      },
    },
    events: {
      on(name, handler) {
        if (typeof handler !== "function") throw new TypeError("Event handler must be a function");
        return scope.track(registry.on(id, name, (payload) => handler(copyPayload(payload))));
      },
    },
    styles: {
      /** path is relative to the plugin's entry file. */
      add: (path) => scope.track(addStylesheet(plugin, path)),
    },
    workspace: {
      activeTab: () => copy(activeTab()),
      tabs: () => copy(state.ws.tabs),
      groups: () => copy(state.ws.groups),
      openTab: (groupId) => copy(addTab(groupId)),
      activateTab: onTab((tab) => activateTab(tab.id)),
      closeTab: onTab(closeTab),
      renameTab: onTab((tab, name) => renameItem("tab", tab, name)),
      setTabColor: onTab(setTabColor),
      /** Prints a line of output to a tab, keeping a prompt at the bottom. */
      print: onTab(printToTab),
    },
    host: {
      /** Calls a function exported by the plugin's OS-side file ("host" in plugin.json). */
      call(method, ...args) {
        if (!plugin.hostFile) return Promise.reject(new Error('This plugin has no "host" file in plugin.json'));
        return desktop.callPluginHost(id, method, args);
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
