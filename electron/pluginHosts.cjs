// One process per plugin that has an OS-side file. It starts on the first call and stops when
// the plugin is turned off or the page reloads.

const { utilityProcess } = require("electron");
const path = require("node:path");

const CALL_TIMEOUT_MS = 30000;
const hosts = new Map(); // plugin id -> { process, pending: Map<callId, { resolve, reject, timer }> }
let nextCallId = 1;

function settleAll(host, message) {
  for (const { reject, timer } of host.pending.values()) {
    clearTimeout(timer);
    reject(new Error(message));
  }
  host.pending.clear();
}

function start(pluginId, file) {
  const child = utilityProcess.fork(path.join(__dirname, "pluginHostRunner.cjs"), [file], {
    serviceName: `termeedor-plugin-${pluginId}`,
    stdio: "inherit",
  });
  const host = { process: child, pending: new Map() };
  hosts.set(pluginId, host);

  child.on("message", ({ id, result, error }) => {
    const call = host.pending.get(id);
    if (!call) return;
    host.pending.delete(id);
    clearTimeout(call.timer);
    if (error) call.reject(new Error(error));
    else call.resolve(result);
  });
  child.on("exit", () => {
    if (hosts.get(pluginId) === host) hosts.delete(pluginId);
    settleAll(host, "The plugin's host process stopped.");
  });
  return host;
}

function call(pluginId, file, method, args) {
  const host = hosts.get(pluginId) ?? start(pluginId, file);
  return new Promise((resolve, reject) => {
    const id = nextCallId++;
    const timer = setTimeout(() => {
      host.pending.delete(id);
      reject(new Error(`"${method}" didn't finish within ${CALL_TIMEOUT_MS / 1000}s`));
    }, CALL_TIMEOUT_MS);
    host.pending.set(id, { resolve, reject, timer });
    host.process.postMessage({ id, method, args });
  });
}

function stop(pluginId) {
  const host = hosts.get(pluginId);
  if (!host) return;
  hosts.delete(pluginId);
  settleAll(host, "The plugin was turned off.");
  host.process.kill();
}

const stopAll = () => [...hosts.keys()].forEach(stop);

module.exports = { call, stop, stopAll };
