// The tabs' sessions (session.js), one per tab, on the backend main.js passes to initRunner.
// It routes the backend's events to them and ends a tab's session when the tab closes.
// No DOM: views listen with onSessionEvent and pass sizes in.

import { connect } from "../store.js";
import { runs } from "../core/runState.js";
import { emit as emitPluginEvent } from "../plugins/registry.js";
import { createSession } from "./session.js";

let backend = null;
const sessions = new Map(); // tabId -> session
const listeners = new Map(); // type -> Set of (session, payload)
const EVENTS = ["start", "output", "data", "fullscreen", "busy", "finish", "typeahead"];

/** backend: see ports/backend.js. */
export function initRunner(given) {
  backend = given;
  backend.onEvent(({ tabId, event }) => sessions.get(tabId)?.handle(event));
  connect({ endSession }); // closing a tab ends its session. Reopened tabs get a new id, so a new one.
}

/** The tab's session, made on first use. */
export function sessionFor(tab) {
  let session = sessions.get(tab.id);
  if (!session) {
    session = createSession({ tab, backend, runs, emitPlugin: emitPluginEvent });
    for (const type of EVENTS) session.on(type, (payload) => listeners.get(type)?.forEach((fn) => fn(session, payload)));
    sessions.set(tab.id, session);
  }
  return session;
}

/** listener(session, payload) for every session's `type` events (see session.js). */
export function onSessionEvent(type, listener) {
  if (!listeners.has(type)) listeners.set(type, new Set());
  listeners.get(type).add(listener);
}

/** Called when a command starts, ends, or turns busy or idle. Commands don't commit: only what shows them needs to change. */
export function onRunChange(fn) {
  onSessionEvent("start", fn);
  onSessionEvent("busy", fn);
  onSessionEvent("finish", fn);
}

/** Starts the tab's shell if it has none, so its first command is as quick as the rest. sizeOf() is only called if so. */
export function prepareShell(tab, sizeOf) {
  const session = sessionFor(tab);
  if (!session.hasShell) session.prepare(sizeOf());
}

export const runCommand = (tab, command, size) => sessionFor(tab).run(command, size);

export function endSession(tabId) {
  sessions.get(tabId)?.close();
  sessions.delete(tabId);
}

/** The block view's new size, in characters. */
export const resizeSessions = (cols, rows) => sessions.forEach((session) => session.resize(cols, rows));

/** Suggestions for the text typed so far. See ports/backend.js for what each one holds. */
export const getCompletions = (input, tab) => backend.complete(tab.id, input, { cwd: tab.cwd, history: tab.history });

/** Forwards a key press to the tab's running program. Returns true if it was used. */
export const forwardKey = (tabId, event) => sessions.get(tabId)?.forwardKey(event) ?? false;

export const forwardPaste = (tabId, text) => sessions.get(tabId)?.forwardPaste(text) ?? false;
