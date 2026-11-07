// What the app can do, by id. Shortcuts, menus, buttons and plugins name an action here instead of
// wiring their own handler. Nothing typed ever reaches this: typed text goes to the shell.
//
// { id, label, run(...args), enabled?(...args), danger? }. `label` can be a function of the same
// args, for a label that depends on the target. A disabled action doesn't run, and menus leave it out.

const actions = new Map();

/** Returns the function that removes it. An id can't be taken twice. */
export function defineAction({ id, label, run, enabled = null, danger = false }) {
  if (actions.has(id)) throw new Error(`Action "${id}" already exists`);
  const action = { label, run, enabled, danger };
  actions.set(id, action);
  return () => { if (actions.get(id) === action) actions.delete(id); };
}

function find(id) {
  const action = actions.get(id);
  if (!action) throw new Error(`Unknown action "${id}"`);
  return action;
}

export const hasAction = (id) => actions.has(id);
export const actionIds = () => [...actions.keys()];

export function isEnabled(id, ...args) {
  const { enabled } = find(id);
  return !enabled || !!enabled(...args);
}

export function actionLabel(id, ...args) {
  const { label } = find(id);
  return typeof label === "function" ? label(...args) : label;
}

export function runAction(id, ...args) {
  if (isEnabled(id, ...args)) return find(id).run(...args);
  return undefined;
}

/** In the shape menu.js takes, bound to these args. */
export const menuItem = (id, ...args) => ({
  label: actionLabel(id, ...args),
  danger: find(id).danger,
  onSelect: () => runAction(id, ...args),
});
