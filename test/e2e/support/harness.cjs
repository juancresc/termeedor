// Electron main process for the browser tests: the page, never shown, driven over the
// DevTools protocol. Lines of JSON in on stdin, out on stdout. No preload, so the page runs
// the browser build (localStorage, mockBackend) in an in-memory profile.

const { app, BrowserWindow, protocol, session, net } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { pathToFileURL } = require("node:url");

// Before anything else: no Dock icon, no menu bar entry, no activation.
if (process.platform === "darwin") app.setActivationPolicy("accessory");
app.dock?.hide();

// The caller makes this folder and removes it, even if this process is killed.
const temp = process.env.TERMEEDOR_E2E_TEMP || fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-e2e-"));
app.setPath("userData", path.join(temp, "userData"));
app.setPath("sessionData", path.join(temp, "sessionData"));
process.env.TERMEEDOR_DATA_DIR = path.join(temp, "data"); // unused by the browser build, but never ~/.termeedor

app.commandLine.appendSwitch("disable-gpu");
// Linux CI with no display server. (xvfb-run works too.)
if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) app.commandLine.appendSwitch("ozone-platform", "headless");
app.commandLine.appendSwitch("force-device-scale-factor", "1");

const ROOT = path.join(__dirname, "..", "..", "..");
const FILES = /^\/(index\.html|(src|styles|themes)\/.+|node_modules\/@xterm\/headless\/lib-headless\/xterm-headless\.mjs)$/;

protocol.registerSchemesAsPrivileged([
  { scheme: "termeedor", privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

const send = (message) => process.stdout.write(`@@e2e ${JSON.stringify(message)}\n`);

async function serve(request) {
  const clean = path.posix.normalize(decodeURIComponent(new URL(request.url).pathname));
  if (!FILES.test(clean) || clean.includes("..")) return new Response("Not found", { status: 404 });
  return net.fetch(pathToFileURL(path.join(ROOT, clean)).href);
}

app.whenReady().then(async () => {
  const ses = session.fromPartition("e2e"); // no "persist:", so storage lives in memory
  ses.protocol.handle("termeedor", serve);
  ses.setPermissionRequestHandler((_wc, _permission, done) => done(false));

  const win = new BrowserWindow({
    width: 1000,
    height: 700,
    show: false,
    paintWhenInitiallyHidden: true,
    webPreferences: { partition: "e2e", offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true },
  });
  const wc = win.webContents;
  wc.on("render-process-gone", (_e, details) => send({ event: "crash", params: details }));
  wc.debugger.attach("1.3");
  wc.debugger.on("message", (_e, method, params) => send({ event: method, params }));

  const harness = {
    "Harness.setSize": ({ width, height }) => win.setContentSize(width, height),
    "Harness.quit": () => setImmediate(() => app.exit(0)),
  };

  let buffer = "";
  process.stdin.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const { id, method, params = {} } = JSON.parse(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      Promise.resolve()
        .then(() => (harness[method] ? harness[method](params) : wc.debugger.sendCommand(method, params)))
        .then((result) => send({ id, result: result ?? {} }), (err) => send({ id, error: String(err?.message ?? err) }));
    }
  });
  process.stdin.on("end", () => app.exit(0));
  await win.loadURL("about:blank"); // the protocol answers nothing until there is a page
  send({ event: "ready" });
});
