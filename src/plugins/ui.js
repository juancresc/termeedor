// What plugins look like in the app: the Plugins section of Settings and status bar items.

import { $, el } from "../util.js";
import { onPluginsChange, openPluginsFolder, pluginList, pluginsDir, pluginsSupported, setPluginEnabled } from "./index.js";
import { onStatusChange, statusItems } from "./registry.js";

const SOURCE_LABEL = { bundled: "built in", install: "install folder", user: "your folder" };

export function initPluginUi() {
  $("openPluginsDir").onclick = openPluginsFolder;
  $("reloadPlugins").onclick = () => location.reload(); // also the only way to drop cached plugin code
  onPluginsChange(renderPluginSettings);
  onStatusChange(renderPluginStatus);
}

export function renderPluginSettings() {
  if (!$("settings").open) return;
  const supported = pluginsSupported();
  $("openPluginsDir").hidden = !supported;
  $("reloadPlugins").hidden = !supported;
  $("pluginsHint").textContent = supported
    ? `Add a plugin by putting its folder in ${pluginsDir() ?? "your plugins folder"}, then reload. Plugins can read and change everything in the app, so only turn on ones you trust.`
    : "Plugins are available in the desktop app.";

  const plugins = pluginList();
  $("pluginList").replaceChildren(...(plugins.length ? plugins.map(pluginRow) : (supported ? [el("div", "hint", "No plugins found.")] : [])));
}

function pluginRow(plugin) {
  const row = el("label", "setRow pluginRow");
  row.title = plugin.dir;

  const info = el("div", "pluginInfo");
  const heading = el("div");
  heading.append(el("b", null, plugin.name));
  if (plugin.version) heading.append(el("span", "pluginMeta", ` ${plugin.version}`));
  heading.append(el("span", "pluginMeta", ` · ${SOURCE_LABEL[plugin.source] ?? plugin.source}`));
  info.append(heading);
  if (plugin.description) info.append(el("div", "hint", plugin.description));
  const error = plugin.error ?? plugin.status?.error;
  if (error) info.append(el("div", "pluginError", error));

  const toggle = el("input");
  toggle.type = "checkbox";
  toggle.checked = plugin.enabled && !plugin.error;
  toggle.disabled = !!plugin.error;
  toggle.setAttribute("aria-label", `Turn on ${plugin.name}`);
  toggle.onchange = () => setPluginEnabled(plugin.id, toggle.checked);

  row.append(info, toggle);
  return row;
}

function renderPluginStatus() {
  $("stPlugins").replaceChildren(...statusItems().map((item) => {
    const node = el(item.onClick ? "button" : "span", "stPlugin", item.text);
    if (item.title) node.title = item.title;
    if (item.onClick) node.onclick = item.onClick;
    return node;
  }));
}
