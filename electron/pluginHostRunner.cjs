// Runs a plugin's OS-side file in its own process, so a crash can't take the app down.
// argv[2] is the file. Each message from the app calls one of the functions it exports.

const { pathToFileURL } = require("node:url");

const loading = import(pathToFileURL(process.argv[2]).href).then((module) => module.default ?? module);

process.parentPort.on("message", async ({ data: { id, method, args } }) => {
  try {
    const functions = await loading;
    if (typeof method !== "string" || !Object.hasOwn(functions, method) || typeof functions[method] !== "function") {
      throw new Error(`The plugin's host file doesn't export a function named "${method}"`);
    }
    process.parentPort.postMessage({ id, result: await functions[method](...args) });
  } catch (err) {
    process.parentPort.postMessage({ id, error: err?.message ?? String(err) });
  }
});
