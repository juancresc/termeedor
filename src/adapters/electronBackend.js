// The backend on the desktop: the tab's real shell, over IPC (electron/preload.cjs, then
// electron/shellSessions.cjs). `shell` is the `shell` part of the desktop host.

import { createEventStream } from "../ports/backend.js";

const withoutIpcWrapper = (message) => message.replace(/^Error invoking remote method '[^']*': (Error: )?/, "");

/** What the shell offers, then past commands that aren't already in the list. */
function withHistory(fromShell, input, history) {
  const typed = input.trimStart();
  if (!typed) return fromShell;
  const leading = input.slice(0, input.length - typed.length);
  const past = [...new Set(history)]
    .reverse()
    .filter((h) => h.startsWith(typed) && h !== typed)
    .map((h) => ({ value: leading + h, label: h, kind: "history" }));
  const seen = new Set();
  return [...fromShell, ...past].filter((item) => !seen.has(item.value.trim()) && seen.add(item.value.trim()));
}

export function createElectronBackend(shell) {
  const stream = createEventStream();

  // The main process marks a shell that ended on its last finish event. The port has its own event for that.
  shell.onEvent(({ tabId, event }) => {
    const { shellExited, ...rest } = event;
    stream.send(tabId, rest);
    if (shellExited) stream.send(tabId, { type: "exit" });
  });

  return {
    takesInput: true,
    onEvent: stream.onEvent,
    async run(tabId, command, options) {
      try {
        await shell.run(tabId, command, options);
      } catch (err) {
        throw new Error(withoutIpcWrapper(err.message));
      }
    },
    write: (tabId, data) => shell.write(tabId, data),
    resize: (tabId, cols, rows) => shell.resize(tabId, cols, rows),
    kill: (tabId) => shell.kill(tabId),
    async complete(tabId, input, { cwd, history }) {
      return withHistory(await shell.complete(tabId, input, cwd), input, history);
    },
  };
}
