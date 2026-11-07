// What the app needs from a place to keep its data. See adapters/ for the two there are.
//
// load(): Promise<Snapshot>, everything saved, untrusted:
//   { settings, workspace, tabs: [{ id, blocks, draft, history, cwd }], past: [entry],
//     files: { settings, workspace, tabs: [id], past: [id] },  what is really stored
//     unsaved?,      nothing loaded counts as stored, so the next save writes it all
//     saveFailed? }  an earlier step failed, and the status bar should say so
//
// write(changes): boolean | Promise<boolean>, true once every change is stored. Later saves wait for it.
// writeSync(changes): boolean, and it has finished when it returns. The page may be going away.
//
// changes: { seq?, settings?, workspace?, tabs: [file], past: [file], removeTabs: [id], removePast: [id] }
// Only what changed. A workspace holds no scrollback, and each file carries its own id.
// A higher `seq` is newer, and an older batch that arrives later must be refused.

const METHODS = ["load", "write", "writeSync"];

export function assertPersistence(adapter) {
  for (const method of METHODS) {
    if (typeof adapter[method] !== "function") throw new Error(`Persistence adapter has no ${method}()`);
  }
  return adapter;
}
