// Electron main process: the window, the termeedor:// scheme that serves the app and
// plugin files, and the few things the page may ask of the OS (see preload.cjs).

const { app, BrowserWindow, ipcMain, net, protocol, shell } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const { discoverPlugins, resolveInside } = require("./plugins.cjs");
const { complete } = require("./completions.cjs");
const pluginHosts = require("./pluginHosts.cjs");
const { removeIntegrationFiles } = require("./shellIntegration.cjs");
const { createShellSessions, resolveCwd } = require("./shellSessions.cjs");

const ORIGIN = "termeedor://app";
const APP_ROOT = path.join(__dirname, "..");
const APP_FILES = /^\/(index\.html|(src|styles|themes)\/.+)$/;
const VENDOR_FILES = /^\/vendor\/(xterm|addon-fit)\/((?:lib|css)\/[\w.-]+)$/;

// A real origin (not file://) so ES modules, localStorage and the page's CSP behave as on the web.
protocol.registerSchemesAsPrivileged([
  { scheme: "termeedor", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

// ---------- plugin folders ----------
const userPluginsDir = () => process.env.TERMEEDOR_PLUGINS_DIR || path.join(os.homedir(), ".termeedor", "plugins");

/** The folder the app was installed to. Portable builds report it through env vars. */
function installDir() {
  if (process.env.PORTABLE_EXECUTABLE_DIR) return process.env.PORTABLE_EXECUTABLE_DIR;
  if (process.env.APPIMAGE) return path.dirname(process.env.APPIMAGE);
  return path.dirname(process.execPath);
}

/** Lowest priority first. A later root's plugin replaces an earlier one with the same id. */
function pluginRoots() {
  const roots = [{ dir: app.isPackaged ? path.join(process.resourcesPath, "plugins") : path.join(APP_ROOT, "plugins"), source: "bundled" }];
  // Not on macOS: the install folder is inside the signed .app and is replaced on every update.
  if (app.isPackaged && process.platform !== "darwin") roots.push({ dir: path.join(installDir(), "plugins"), source: "install" });
  roots.push({ dir: userPluginsDir(), source: "user" });
  return roots;
}

let plugins = new Map(); // id -> plugin, refreshed each time the page asks for the list

function listPlugins() {
  const list = discoverPlugins(pluginRoots());
  plugins = new Map(list.map((plugin) => [plugin.id, plugin]));
  return { plugins: list, userDir: userPluginsDir() };
}

// ---------- termeedor:// ----------
function fileForPath(pathname) {
  // Check the decoded, normalized path: "/src/..%2fpackage.json" must not pass as "/src/...".
  if (/[\\\0]/.test(pathname)) return null;
  const clean = path.posix.normalize(pathname);
  const match = clean.match(/^\/plugins\/([^/]+)\/(.+)$/);
  if (match) {
    const plugin = plugins.get(match[1]);
    return plugin && !plugin.error ? resolveInside(plugin.dir, match[2]) : null;
  }
  const vendor = clean.match(VENDOR_FILES);
  if (vendor) return path.join(APP_ROOT, "node_modules", "@xterm", vendor[1] === "xterm" ? "xterm" : "addon-fit", vendor[2]);
  return APP_FILES.test(clean) ? path.join(APP_ROOT, clean) : null;
}

async function serve(request) {
  try {
    const { host, pathname } = new URL(request.url);
    const file = host === "app" ? fileForPath(decodeURIComponent(pathname)) : null;
    if (!file) return new Response("Not found", { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set("Cache-Control", "no-store"); // "Reload plugins" must pick up edited files
    return new Response(response.body, { status: response.status, headers });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

// ---------- windows ----------
function createWindow() {
  const isMac = process.platform === "darwin";
  const win = new BrowserWindow({
    width: 1200,
    height: 780,
    minWidth: 640,
    minHeight: 400,
    show: false,
    backgroundColor: "#0b0d12",
    // On macOS the real window buttons sit where the title bar draws its .lights placeholder.
    ...(isMac ? { titleBarStyle: "hidden", trafficLightPosition: { x: 10, y: 13 } } : {}),
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      preload: path.join(__dirname, "preload.cjs"),
    },
  });
  win.once("ready-to-show", () => win.show());
  // A reload starts the page's state over, so nothing it was running can stay behind.
  win.webContents.on("did-start-loading", stopBackgroundWork);
  shellWindow = win;
  win.loadURL(`${ORIGIN}/index.html`);
}

const isAppUrl = (url) => url.startsWith(`${ORIGIN}/`);
const openExternally = (url) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); };

app.on("web-contents-created", (_event, contents) => {
  contents.on("will-navigate", (event, url) => {
    if (isAppUrl(url)) return;
    event.preventDefault();
    openExternally(url);
  });
  contents.setWindowOpenHandler(({ url }) => {
    openExternally(url);
    return { action: "deny" };
  });
});

// ---------- shells ----------
let shellWindow = null;
const shells = createShellSessions((tabId, event) => {
  if (shellWindow && !shellWindow.isDestroyed()) shellWindow.webContents.send("shell:event", { tabId, event });
});

function stopBackgroundWork() {
  shells.killAll();
  pluginHosts.stopAll();
}

function completeInTab(tabId, input, cwd) {
  const session = shells.info(tabId);
  return complete(String(input), resolveCwd(session?.cwd ?? cwd), session?.path ?? process.env.PATH ?? "");
}

function callPluginHost(id, method, args) {
  const file = plugins.get(id)?.hostFile;
  if (!file) throw new Error(`Plugin "${id}" has no host file`);
  return pluginHosts.call(id, file, method, args);
}

// ---------- requests from the page ----------
function handle(channel, handler) {
  ipcMain.handle(channel, (event, ...args) => {
    if (!isAppUrl(event.senderFrame?.url ?? "")) throw new Error("Not allowed");
    return handler(...args);
  });
}

// ---------- lifecycle ----------
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    fs.mkdirSync(userPluginsDir(), { recursive: true });
    protocol.handle("termeedor", serve);
    handle("plugins:list", listPlugins);
    handle("plugins:open-folder", () => shell.openPath(userPluginsDir()));
    handle("plugins:host-call", callPluginHost);
    handle("plugins:host-stop", pluginHosts.stop);
    handle("shell:run", (tabId, command, options) => shells.run(tabId, String(command), options));
    handle("shell:write", (tabId, data) => shells.write(tabId, String(data)));
    handle("shell:resize", (tabId, cols, rows) => shells.resize(tabId, cols, rows));
    handle("shell:kill", (tabId) => shells.kill(tabId));
    handle("shell:complete", completeInTab);
    createWindow();
    app.on("activate", () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  });

  app.on("window-all-closed", () => {
    stopBackgroundWork();
    if (process.platform !== "darwin") app.quit();
  });
  app.on("before-quit", () => {
    stopBackgroundWork();
    removeIntegrationFiles();
  });
}
