// Drives the real page in a hidden Electron window (harness.cjs) over the DevTools protocol.

import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import electron from "electron";

const HARNESS = path.join(path.dirname(fileURLToPath(import.meta.url)), "harness.cjs");
const PAGE = "termeedor://app/index.html";

const KEYS = {
  Enter: { code: "Enter", keyCode: 13, text: "\r" },
  Escape: { code: "Escape", keyCode: 27 },
  Tab: { code: "Tab", keyCode: 9 },
  Backspace: { code: "Backspace", keyCode: 8 },
  ArrowUp: { code: "ArrowUp", keyCode: 38 },
  ArrowDown: { code: "ArrowDown", keyCode: 40 },
  ArrowLeft: { code: "ArrowLeft", keyCode: 37 },
  ArrowRight: { code: "ArrowRight", keyCode: 39 },
};
const MODIFIERS = { alt: 1, ctrl: 2, meta: 4, shift: 8 };

/**
 * On macOS, a copy of Electron.app marked LSUIElement: an app hiding its Dock icon from its
 * main script is still registered as a regular app for an instant first. The copy is an APFS
 * clone, so it takes no space, and is made once per Electron version.
 */
function electronBinary() {
  if (process.platform !== "darwin") return electron;
  const bundle = electron.slice(0, electron.indexOf(".app/") + 4);
  const { version } = createRequire(import.meta.url)("electron/package.json");
  const copy = path.join(os.tmpdir(), "termeedor-e2e", `Electron-${version}.app`);
  const binary = path.join(copy, path.relative(bundle, electron));
  if (fs.existsSync(binary)) return binary;
  const partial = `${copy}.${process.pid}`;
  fs.mkdirSync(path.dirname(copy), { recursive: true });
  try {
    execFileSync("cp", ["-cR", bundle, partial]);
  } catch {
    fs.rmSync(partial, { recursive: true, force: true });
    return electron; // no clones on this disk: fall back to the Dock policy set in harness.cjs
  }
  execFileSync("plutil", ["-replace", "LSUIElement", "-bool", "true", path.join(partial, "Contents", "Info.plist")]);
  try {
    fs.renameSync(partial, copy);
  } catch (err) {
    fs.rmSync(partial, { recursive: true, force: true }); // another run made it first
    if (!fs.existsSync(binary)) throw err;
  }
  return binary;
}

export async function launch() {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-e2e-"));
  const env = { ...process.env, TERMEEDOR_E2E_TEMP: temp };
  delete env.ELECTRON_RUN_AS_NODE; // set when run from some Electron-based tools, and would skip the app
  const child = spawn(electronBinary(), [HARNESS], { stdio: ["pipe", "pipe", "pipe"], env });
  child.once("exit", () => fs.rmSync(temp, { recursive: true, force: true }));
  const pending = new Map();
  const listeners = new Set();
  const errors = [];
  let nextId = 1;
  let stderr = "";
  let ready;
  const started = new Promise((resolve, reject) => { ready = resolve; child.once("exit", (code) => reject(new Error(`harness exited ${code}: ${stderr}`))); });

  child.stderr.on("data", (chunk) => {
    stderr = (stderr + chunk).slice(-4000);
    if (process.env.E2E_DEBUG) process.stderr.write(chunk);
  });
  let buffer = "";
  child.stdout.on("data", (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.startsWith("@@e2e ")) continue;
      const message = JSON.parse(line.slice(6));
      if (message.id) {
        const { resolve, reject } = pending.get(message.id);
        pending.delete(message.id);
        message.error ? reject(new Error(message.error)) : resolve(message.result);
      } else if (message.event === "ready") ready();
      else {
        if (message.event === "Runtime.exceptionThrown") errors.push(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text);
        if (message.event === "crash") errors.push(`renderer gone: ${message.params.reason}`);
        for (const listener of listeners) listener(message);
      }
    }
  });
  child.once("exit", () => { for (const { reject } of pending.values()) reject(new Error(`harness exited: ${stderr}`)); });

  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    child.stdin.write(`${JSON.stringify({ id, method, params })}\n`);
  });

  await started;
  await send("Runtime.enable");
  await send("Page.enable");
  await send("Emulation.setFocusEmulationEnabled", { enabled: true }); // the page counts as focused though never shown

  /** Runs fn(...args) in the page and returns its JSON value. */
  async function evaluate(fn, ...args) {
    const { result, exceptionDetails } = await send("Runtime.evaluate", {
      expression: `(${fn})(...${JSON.stringify(args)})`,
      awaitPromise: true,
      returnByValue: true,
    });
    if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text);
    return result.value;
  }

  /** Polls until fn(...args) in the page is truthy, and returns that value. */
  async function waitFor(fn, ...args) {
    const deadline = Date.now() + 5000;
    for (;;) {
      const value = await evaluate(fn, ...args);
      if (value) return value;
      if (Date.now() > deadline) throw new Error(`Timed out waiting for ${fn}`);
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  const waitForLoad = () => new Promise((resolve) => {
    const listener = (message) => {
      if (message.event !== "Page.loadEventFired") return;
      listeners.delete(listener);
      resolve();
    };
    listeners.add(listener);
  });

  async function navigate(url) {
    const loaded = waitForLoad();
    await send("Page.navigate", { url });
    await loaded;
  }

  return {
    errors,
    send,
    evaluate,
    waitFor,

    /** A fresh page with no saved data, at the default size. */
    async open({ width = 1000, height = 700 } = {}) {
      await navigate("about:blank"); // the old page saves as it unloads, so clear after
      await send("Storage.clearDataForOrigin", { origin: "termeedor://app", storageTypes: "all" });
      await send("Harness.setSize", { width, height });
      await navigate(PAGE);
      await waitFor(() => document.querySelector("#tabs .tab") && document.activeElement?.id === "editor");
      errors.length = 0;
    },

    async reload() {
      await navigate(PAGE);
      await waitFor(() => document.querySelector("#tabs .tab"));
    },

    setSize: (width, height) => send("Harness.setSize", { width, height }),

    async press(key, modifiers = {}) {
      const def = KEYS[key] ?? { code: `Key${key.toUpperCase()}`, keyCode: key.toUpperCase().charCodeAt(0), text: key };
      const mods = Object.entries(MODIFIERS).reduce((sum, [name, bit]) => sum + (modifiers[name] ? bit : 0), 0);
      const base = { key, code: def.code, windowsVirtualKeyCode: def.keyCode, modifiers: mods };
      const text = mods & ~MODIFIERS.shift ? undefined : def.text;
      await send("Input.dispatchKeyEvent", { type: text ? "keyDown" : "rawKeyDown", ...base, text, unmodifiedText: text });
      await send("Input.dispatchKeyEvent", { type: "keyUp", ...base });
    },

    /** Types each character as a key press. */
    async type(text) {
      for (const char of text) {
        await send("Input.dispatchKeyEvent", { type: "keyDown", key: char, text: char, unmodifiedText: char });
        await send("Input.dispatchKeyEvent", { type: "keyUp", key: char });
      }
    },

    async mouse(type, x, y, extra = {}) {
      await send("Input.dispatchMouseEvent", { type, x, y, button: "left", buttons: type === "mouseReleased" ? 0 : 1, clickCount: 1, ...extra });
    },

    async click(x, y, clickCount = 1) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", x, y, button: "left", buttons: 1, clickCount });
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", x, y, button: "left", buttons: 0, clickCount });
    },

    async drag(from, to) {
      await send("Input.dispatchMouseEvent", { type: "mouseMoved", x: from.x, y: from.y });
      await send("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
      for (let step = 1; step <= 5; step++) {
        const x = from.x + ((to.x - from.x) * step) / 5;
        const y = from.y + ((to.y - from.y) * step) / 5;
        await send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y, button: "left", buttons: 1 });
      }
      await send("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
    },

    /** The center of the first element matching selector, in page pixels. */
    center: (selector) => waitFor((sel) => {
      const node = document.querySelector(sel);
      if (!node) return null;
      const r = node.getBoundingClientRect();
      return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
    }, selector),

    /** Types a command, runs it, and waits for its block to finish. */
    async run(command) {
      const blocks = await evaluate(() => document.querySelectorAll("#output .block.isCommand").length);
      await this.type(command);
      await this.press("Enter");
      await waitFor((n) => document.querySelectorAll("#output .block.isCommand").length > n
        && !document.querySelector("#inputRow").classList.contains("running"), blocks);
    },

    async close() {
      if (child.exitCode !== null) return;
      const exited = new Promise((resolve) => child.once("exit", resolve));
      send("Harness.quit").catch(() => {});
      child.stdin.end();
      await exited;
    },
  };
}
