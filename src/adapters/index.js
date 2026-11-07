// The one place that chooses where data is kept, and what runs commands.

import { assertBackend } from "../ports/backend.js";
import { assertPersistence } from "../ports/persistence.js";
import { host } from "../platform.js";
import { createElectronBackend } from "./electronBackend.js";
import { createFileAdapter } from "./fileStore.js";
import { createLocalStorageAdapter } from "./localStorageStore.js";
import { createMockBackend } from "./mockBackend.js";

export function chooseAdapter(data = host?.data) {
  return assertPersistence(data ? createFileAdapter(data) : createLocalStorageAdapter());
}

/** `mock` is only used if there is no shell: see createMockBackend. */
export function chooseBackend(shell = host?.shell, mock = {}) {
  return assertBackend(shell ? createElectronBackend(shell) : createMockBackend(mock));
}
