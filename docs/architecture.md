# Architecture

Electron app with a vanilla JS page. No framework, no build step. The app owns the input line and sends finished commands to the user's real shell.

## Layout

| Where | What |
| --- | --- |
| `electron/main.cjs` | Window, `termeedor://` protocol, IPC |
| `electron/shellSessions.cjs` | One PTY per tab (node-pty) |
| `electron/shellParser.cjs`, `shellIntegration.cjs` | Shell hooks and OSC 133 markers: command start, finish, cwd |
| `electron/completions.cjs` | Tab completion: PATH commands and paths |
| `electron/plugins.cjs`, `pluginHosts.cjs` | Plugin discovery, and one process per plugin host file |
| `src/store.js`, `storage.js` | State, actions, validated localStorage |
| `src/editor.js` | Textarea: input rules, history, completion UI, runs, gutter |
| `src/shell.js` | Sends every line to the shell, or to the browser mock |
| `src/terminal/` | `transcript` (a tab's blocks and draft), `runState` (what is running), `realShell` (IPC client), `textModel` (output to plain text), `fullscreen` (xterm for vim, top), `keys` |
| `src/plugins/` | Host, scope, registry, public API |
| `src/*.js` (the rest) | UI: tab bar, sidebar, menus, settings, themes |

## Command flow

1. Enter: `editor` calls `shell.runCommand`, which goes to `realShell`, then IPC, then `shellSessions`, then the PTY.
2. PTY output: `shellParser` emits `output`, `alt`, `finish` events to `realShell`.
3. `output` goes through `textModel` into the textarea, or to xterm while a full-screen program runs.
4. While a command runs, keys and pastes go to the program.

## Rules

- It behaves like a real terminal: everything typed goes to the user's shell. There are no custom commands, from the app or from plugins. App actions live in menus and shortcuts.
- Output is an event stream, never a returned string.
- Command boundaries come from shell markers, never from matching text. Whether a line is a command comes from the transcript. Only the migration of old saved tabs reads the prompt out of text.
- Plugins are fully trusted. `api` is the only supported surface.
- `src/` must keep working without Electron: the browser build uses the mock.
- Stored data is untrusted and validated on load.

## Known problems

| Problem | Where |
| --- | --- |
| Shells are killed by diffing state after a commit | `realShell.js` `initRealShell` |
| All scrollback is one localStorage value, saved on every commit | `store.js`, `storage.js` |
| Every commit rebuilds the DOM | `tabbar.js`, `sidebar.js` |
| `store` and `editor` have no tests; `store` touches localStorage on import | `test/` |
| Browser vs desktop checks are scattered; `isMac` is defined twice | `shell.js`, `keymap.js`, `editor.js` |
| Plugins get live `tab` objects | `plugins/api.js` |
| Colors are dropped; completion doesn't know flags or branches | `textModel.js`, `completions.cjs` |

## Target

```text
src/core/       no DOM or storage: workspace, selection, actions, events
src/ports/      backend, persistence
src/adapters/   electron and mock backends; scrollback and settings stores
src/terminal/   one run state machine, transcript model, views
src/ui/         reads state, dispatches actions
src/plugins/    unchanged, but the API hands out ids and copies
```

- Dependencies point inward: `ui` and `adapters` depend on `core`, and `core` imports nothing outward.
- A tab is `{ blocks: [{ command, output, exit, cwd }], draft }`, not one string.

## Plan

Each step ships alone. New features can continue between steps.

1. **Small fixes (done).** Every line goes to the shell, with no app or plugin commands. Erasing the scrollback (`ESC[3J`, sent by `clear`) clears the whole tab. Load trims keep the newest text. Failed saves show in the status bar.
2. **Transcript model (done).** `tab.content` became `blocks` and `draft`, and saved tabs migrate on load. A migrated tab's history is one plain block, so its old commands can't be re-run. `runState` replaces the renderer's three run records; `shellSessions` keeps the PTY's own state. The textarea stays, rendered from blocks, so re-running a line uses its block and the `❯ ` matching is gone.
3. **Store split.** Move to `core` with tests. Save layout and scrollback separately, with scrollback capped per tab.
4. **Backend port.** One place chooses Electron or mock. `shell.js` becomes the mock adapter, the only place fake commands remain.
5. **Editor-style view.** A separate input editor over command blocks. Keep color in the model and render it. Multi-line input.
6. **Completion.** Hidden zsh helper behind `complete(input, cwd)`, with `completions.cjs` as the fallback. First prove it with a real `.zshrc`, and find out why `git log --ona` returned nothing in the prototype.
7. **Cleanup.** Action registry for shortcuts, menus and plugins. Render only what changed. Plugin API v2.

Add a framework only if step 7 still hurts, and then only `lit-html`.
