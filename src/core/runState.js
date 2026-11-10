// The renderer's one record of what is running in each tab. Runtime only, never saved.
// Each tab's session (terminal/session.js) starts and finishes its runs; the rest of the app reads it.
//   idle -> start -> running -> stop -> stopping -> finish -> idle
//                    running -> finish -> idle
// A stopped command stays "stopping" until it really ends: a program can ignore Ctrl+C.
// The PTY keeps its own state in the main process (electron/shellSessions.cjs).

export function createRunState() {
  const runs = new Map(); // tabId -> { phase, controller, block }

  return {
    phase: (tabId) => runs.get(tabId)?.phase ?? "idle",
    isRunning: (tabId) => runs.has(tabId),

    /** Returns the run's abort signal. A tab runs one command at a time, so a running one is kept. */
    start(tabId, block = null) {
      if (!runs.has(tabId)) runs.set(tabId, { phase: "running", controller: new AbortController(), block });
      return runs.get(tabId).controller.signal;
    },

    /** Returns false if nothing is running. */
    stop(tabId) {
      const run = runs.get(tabId);
      if (!run) return false;
      run.phase = "stopping";
      run.controller.abort();
      return true;
    },

    finish(tabId) {
      runs.delete(tabId);
    },

    /** The transcript block receiving the run's output. */
    block: (tabId) => runs.get(tabId)?.block ?? null,
  };
}

export const runs = createRunState();
