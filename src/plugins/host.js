// Plugin lifecycle: load, activate, deactivate. A plugin that throws, hangs or fails to
// load gets an error status and everything it had added is removed; the app keeps going.
// Takes its dependencies as arguments, so it runs in plain Node for tests.

/** Tracks what one activation added, so turning the plugin off can undo all of it. */
export function createScope() {
  const cleanups = new Set();
  let disposed = false;
  return {
    track(cleanup) {
      if (disposed) {
        cleanup();
        throw new Error("This plugin has been turned off");
      }
      cleanups.add(cleanup);
      return {
        dispose() {
          if (cleanups.delete(cleanup)) cleanup();
        },
      };
    },
    dispose() {
      disposed = true;
      for (const cleanup of [...cleanups].reverse()) {
        try {
          cleanup();
        } catch (err) {
          console.error("Plugin cleanup failed", err);
        }
      }
      cleanups.clear();
    },
  };
}

/**
 * importModule(plugin) → Promise<module>; createApi(plugin, scope) → the object passed to activate;
 * onChange() runs whenever a status changes.
 */
export function createPluginHost({ importModule, createApi, onChange = () => {}, timeoutMs = 5000 }) {
  const running = new Map(); // id -> { scope, cleanup }
  const statuses = new Map(); // id -> { state: "active" | "loading" | "error", error? }

  function setStatus(id, status) {
    if (status) statuses.set(id, status);
    else statuses.delete(id);
    onChange();
  }

  function timeout() {
    let timer;
    const promise = new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`Did not finish starting within ${timeoutMs / 1000}s`)), timeoutMs);
    });
    return { promise, cancel: () => clearTimeout(timer) };
  }

  async function activate(plugin) {
    if (running.has(plugin.id)) return;
    const entry = { scope: createScope(), cleanup: null };
    running.set(plugin.id, entry);
    setStatus(plugin.id, { state: "loading" });

    const limit = timeout();
    try {
      const start = async () => {
        const module = await importModule(plugin);
        if (typeof module.activate !== "function") throw new Error("plugin file must export a function named activate");
        return module.activate(createApi(plugin, entry.scope));
      };
      const cleanup = await Promise.race([start(), limit.promise]);
      if (running.get(plugin.id) !== entry) {
        if (typeof cleanup === "function") runCleanup(plugin.id, cleanup); // turned off while starting
        return;
      }
      if (typeof cleanup === "function") entry.cleanup = cleanup;
      setStatus(plugin.id, { state: "active" });
    } catch (err) {
      console.error(`[plugin ${plugin.id}]`, err);
      if (running.get(plugin.id) !== entry) return;
      entry.scope.dispose();
      running.delete(plugin.id);
      setStatus(plugin.id, { state: "error", error: err?.message ?? String(err) });
    } finally {
      limit.cancel();
    }
  }

  function runCleanup(id, cleanup) {
    try {
      cleanup();
    } catch (err) {
      console.error(`[plugin ${id}]`, err);
    }
  }

  function deactivate(id) {
    const entry = running.get(id);
    running.delete(id);
    if (entry) {
      if (entry.cleanup) runCleanup(id, entry.cleanup);
      entry.scope.dispose();
    }
    setStatus(id, null);
  }

  return { activate, deactivate, status: (id) => statuses.get(id) ?? null };
}
