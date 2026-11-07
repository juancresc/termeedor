// platform.js reads its answers once, on import, so each case imports its own copy.

import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const src = new URL("../src/", import.meta.url);
let copies = 0;

async function platformWith({ host, platform }) {
  const navigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", { value: { platform }, configurable: true });
  if (host) globalThis.termeedorHost = host;
  try {
    return await import(`../src/platform.js?copy=${copies++}`);
  } finally {
    delete globalThis.termeedorHost;
    Object.defineProperty(globalThis, "navigator", navigator);
  }
}

test("no host means the browser build", async () => {
  const { host, isDesktop } = await platformWith({ platform: "Linux x86_64" });
  assert.equal(host, null);
  assert.equal(isDesktop, false);
});

test("a host means the desktop, and is what gets exposed", async () => {
  const fake = { platform: "darwin" };
  const { host, isDesktop } = await platformWith({ host: fake, platform: "MacIntel" });
  assert.equal(host, fake);
  assert.equal(isDesktop, true);
});

test("Mac or not comes from the browser's platform", async () => {
  assert.equal((await platformWith({ platform: "MacIntel" })).isMac, true);
  assert.equal((await platformWith({ platform: "Win32" })).isMac, false);
  assert.equal((await platformWith({ platform: "Linux x86_64" })).isMac, false);
});

test("the keymap gives the browser build only Alt+arrows", async () => {
  const { shortcutList, findShortcut } = await import("../src/keymap.js");
  assert.deepEqual(shortcutList(), ["Alt+← previous tab", "Alt+→ next tab"]);
  assert.equal(findShortcut({ altKey: true, metaKey: false, ctrlKey: false, shiftKey: false, code: "ArrowLeft" }).action, "previousTab");
  assert.equal(findShortcut({ altKey: false, metaKey: true, ctrlKey: false, shiftKey: false, code: "KeyT" }), undefined);
});

/** Every file under src/, as [path, text]. */
function sources(folder = src, prefix = "") {
  return fs.readdirSync(folder, { withFileTypes: true }).flatMap((entry) => (entry.isDirectory()
    ? sources(new URL(`${entry.name}/`, folder), `${prefix}${entry.name}/`)
    : [[`${prefix}${entry.name}`, fs.readFileSync(new URL(entry.name, folder), "utf8")]]));
}

test("only platform.js looks at where the app is running", () => {
  for (const [name, source] of sources()) {
    if (name === "platform.js") continue;
    assert.doesNotMatch(source, /termeedorHost|hasRealShell|navigator\.(platform|userAgent)/, name);
  }
});

test("fake commands exist only in the mock backend", () => {
  for (const [name, source] of sources()) {
    if (name !== "adapters/mockBackend.js") assert.doesNotMatch(source, /command not found|MOCK_FS/, name);
  }
});
