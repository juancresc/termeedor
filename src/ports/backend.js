// What the terminal needs from whatever runs commands. See adapters/ for the two there are.
// Every tab has its own shell, which starts on the tab's first command.
//
// run(tabId, command, { cwd, cols, rows }): Promise, settled once the command was handed over.
//   It rejects if it couldn't be, with a message fit to show. Results only arrive as events.
// write(tabId, data): bytes for what is running. "\x03" is Ctrl+C, and the command ends with a finish event.
// resize(tabId, cols, rows)
// kill(tabId): ends the tab's shell, and whatever it was running.
// complete(tabId, input, { cwd, history }): Promise<[{ value, label, kind, description? }]>, where value is
//   the whole new input and always starts with `input`.
// onEvent(listener): returns a function that stops listening. listener({ tabId, event }) gets:
//   { type: "output", data }        terminal bytes, escape sequences included
//   { type: "alt", on }             a program took over the screen, or gave it back
//   { type: "finish", exit?, cwd, typeahead? }  the command ended. No exit means it isn't known.
//                                   typeahead: bytes written for it that it never read
//   { type: "typeahead", data }     bytes written after the command ended, so they weren't sent on
//   { type: "exit" }                the shell is gone, and the tab's next run starts a new one.
//                                   A desktop shell that ends between commands isn't reported.
// takesInput: true if keys and pastes go to a running command. If false, the editor keeps them.

const METHODS = ["run", "write", "resize", "kill", "complete", "onEvent"];

export function assertBackend(adapter) {
  for (const method of METHODS) {
    if (typeof adapter[method] !== "function") throw new Error(`Backend adapter has no ${method}()`);
  }
  if (typeof adapter.takesInput !== "boolean") throw new Error("Backend adapter has no takesInput");
  return adapter;
}

/** The listener list both adapters need. */
export function createEventStream() {
  const listeners = new Set();
  return {
    onEvent(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    send: (tabId, event) => listeners.forEach((listener) => listener({ tabId, event })),
  };
}
