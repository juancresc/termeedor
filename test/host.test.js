import assert from "node:assert/strict";
import { test, mock } from "node:test";
import { createPluginHost, createScope } from "../src/plugins/host.js";

const plugin = { id: "p" };

function hostWith(activate, options = {}) {
  const added = [];
  const host = createPluginHost({
    importModule: async () => ({ activate }),
    createApi: (_plugin, scope) => ({
      add: (name) => { added.push(name); return scope.track(() => added.splice(added.indexOf(name), 1)); },
    }),
    ...options,
  });
  return { host, added };
}

test("activate marks the plugin active; deactivate undoes what it added", async () => {
  const cleanup = mock.fn();
  const { host, added } = hostWith((api) => { api.add("a"); api.add("b"); return cleanup; });
  await host.activate(plugin);
  assert.equal(host.status("p").state, "active");
  assert.deepEqual(added, ["a", "b"]);

  host.deactivate("p");
  assert.deepEqual(added, []);
  assert.equal(cleanup.mock.callCount(), 1);
  assert.equal(host.status("p"), null);
});

test("a plugin that throws gets an error status and its partial additions are removed", async () => {
  const { host, added } = hostWith((api) => { api.add("a"); throw new Error("boom"); });
  await host.activate(plugin);
  assert.deepEqual(host.status("p"), { state: "error", error: "boom" });
  assert.deepEqual(added, []);
});

test("a plugin without an activate export gets an error", async () => {
  const { host } = hostWith(undefined);
  await host.activate(plugin);
  assert.match(host.status("p").error, /export a function named activate/);
});

test("a failed import gets an error", async () => {
  const host = createPluginHost({ importModule: async () => { throw new Error("syntax"); }, createApi: () => ({}) });
  await host.activate(plugin);
  assert.deepEqual(host.status("p"), { state: "error", error: "syntax" });
});

test("a plugin that never finishes starting times out and can't add anything afterwards", async () => {
  let api;
  const { host, added } = hostWith((a) => { api = a; return new Promise(() => {}); }, { timeoutMs: 5 });
  await host.activate(plugin);
  assert.match(host.status("p").error, /Did not finish/);
  assert.throws(() => api.add("late"), /turned off/);
  assert.deepEqual(added, []);
});

test("turning a plugin off while it starts runs its cleanup and leaves nothing behind", async () => {
  let finish;
  const cleanup = mock.fn();
  const { host, added } = hostWith((api) => { api.add("a"); return new Promise((resolve) => { finish = resolve; }); });
  const activating = host.activate(plugin);
  await new Promise((resolve) => setImmediate(resolve));

  host.deactivate("p");
  finish(cleanup);
  await activating;
  assert.deepEqual(added, []);
  assert.equal(cleanup.mock.callCount(), 1);
  assert.equal(host.status("p"), null);
});

test("activating twice runs the plugin once; it can be turned back on after being turned off", async () => {
  const activate = mock.fn();
  const { host } = hostWith(activate);
  await host.activate(plugin);
  await host.activate(plugin);
  assert.equal(activate.mock.callCount(), 1);
  host.deactivate("p");
  await host.activate(plugin);
  assert.equal(activate.mock.callCount(), 2);
});

test("a disposable removes only its own addition, once", () => {
  const scope = createScope();
  const cleanup = mock.fn();
  const handle = scope.track(cleanup);
  handle.dispose();
  handle.dispose();
  scope.dispose();
  assert.equal(cleanup.mock.callCount(), 1);
});
