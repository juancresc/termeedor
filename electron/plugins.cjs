// Finds plugin folders on disk. No Electron imports, so it can be tested with plain Node.
//
// A plugin is a folder, like a zsh plugin:   <root>/<id>/plugin.js
// plugin.json is optional:                   { name, version, description, main, host, apiVersion }

const fs = require("node:fs");
const path = require("node:path");

const API_VERSION = 1;
const VALID_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const text = (value, max, fallback) => (typeof value === "string" && value ? value.slice(0, max) : fallback);

/** Absolute real path of root/relative, or null if it is missing or escapes root (symlinks included). */
function resolveInside(root, relative) {
  try {
    const realRoot = fs.realpathSync(root);
    const real = fs.realpathSync(path.resolve(realRoot, relative));
    return real.startsWith(realRoot + path.sep) ? real : null;
  } catch {
    return null;
  }
}

function readManifest(dir) {
  const file = path.join(dir, "plugin.json");
  if (!fs.existsSync(file)) return {};
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) throw new Error("not a JSON object");
  return manifest;
}

function readPlugin(dir, id, source) {
  const plugin = { id, name: id, version: null, description: "", source, dir, entry: null, error: null };
  if (!VALID_ID.test(id)) return { ...plugin, error: "Folder name can only use letters, numbers, dots, dashes and underscores." };

  let manifest;
  try {
    manifest = readManifest(dir);
  } catch (err) {
    return { ...plugin, error: `Could not read plugin.json: ${err.message}` };
  }
  plugin.name = text(manifest.name, 60, id);
  plugin.version = text(manifest.version, 30, null);
  plugin.description = text(manifest.description, 300, "");

  const apiVersion = manifest.apiVersion ?? API_VERSION;
  if (apiVersion !== API_VERSION) return { ...plugin, error: `Needs plugin API ${apiVersion}; this app provides ${API_VERSION}.` };

  const main = text(manifest.main, 200, "plugin.js");
  if (!resolveInside(dir, main)) return { ...plugin, error: `Entry file not found: ${main}` };
  plugin.entry = `/plugins/${id}/${main.split(path.sep).join("/")}`;

  if (manifest.host !== undefined) {
    const hostFile = typeof manifest.host === "string" ? resolveInside(dir, manifest.host) : null;
    if (!hostFile) return { ...plugin, entry: null, error: `Host file not found: ${manifest.host}` };
    plugin.hostFile = hostFile;
  }
  return plugin;
}

/**
 * Scans roots in order: [{ dir, source }]. A later root wins when two have the same
 * plugin id, so a user's copy replaces a bundled one. Returns plugins sorted by id.
 */
function discoverPlugins(roots) {
  const found = new Map();
  for (const { dir, source } of roots) {
    let names;
    try {
      names = fs.readdirSync(dir);
    } catch {
      continue; // this root doesn't exist on this install
    }
    for (const name of names) {
      if (name.startsWith(".")) continue;
      const pluginDir = path.join(dir, name);
      let isDir = false;
      try {
        isDir = fs.statSync(pluginDir).isDirectory(); // statSync follows symlinks: linked plugins work
      } catch {
        continue; // broken symlink
      }
      if (isDir) found.set(name, readPlugin(pluginDir, name, source));
    }
  }
  return [...found.values()].sort((a, b) => a.id.localeCompare(b.id));
}

module.exports = { API_VERSION, discoverPlugins, resolveInside };
