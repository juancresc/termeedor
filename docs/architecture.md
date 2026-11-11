# Architecture

Electron app with a vanilla JS page. No framework, no build step. The app owns the input line and sends finished commands to the user's real shell.

## Layout

| Where | What |
| --- | --- |
| `electron/main.cjs` | Window, `termeedor://` protocol, IPC |
| `electron/menu.cjs` | App menu, with no reload items |
| `electron/shellSessions.cjs` | One PTY per tab (node-pty) |
| `electron/shellParser.cjs`, `shellIntegration.cjs` | Shell hooks and OSC 133 markers: command start, finish, cwd |
| `electron/shellCompleter.cjs`, `zshCompletion.zsh` | Tab completion from a hidden zsh |
| `electron/completions.cjs` | Tab completion's fallback: PATH commands and paths |
| `electron/plugins.cjs`, `pluginHosts.cjs` | Plugin discovery, and one process per plugin host file |
| `electron/dataStore.cjs` | Saved data as files in `~/.termeedor` (`TERMEEDOR_DATA_DIR` overrides it) |
| `src/core/` | No DOM or storage. `workspace` (state and what changes it), `actions` (the registry of what the app can do, by id), `sanitize` (stored data is untrusted), `saved` (state to files and back), `saver` (what to save, and when), `transcript` (a tab's blocks and draft), `styles` (styling's saved form, validation, CSS), `runState` (what is running, never saved, written by sessions) |
| `src/store.js` | The import path for state and actions. Loads saved data on import, and connects core to the adapter |
| `src/ports/persistence.js`, `src/adapters/` | The persistence interface. `fileStore` on the desktop (also migrates old localStorage), `localStorageStore` in the browser. `adapters/index.js` chooses |
| `src/ports/backend.js`, `src/adapters/` | The backend interface: `run`, `write`, `resize`, `kill`, `complete`, and `output`, `alt`, `finish`, `exit` events. `electronBackend` is the IPC client, and `mockBackend` is the browser's fake shell, the only place fake commands exist. `adapters/index.js` chooses |
| `src/platform.js` | Desktop or browser, Mac or not, and the desktop host. The only code that reads `termeedorHost` or `navigator.platform` |
| `src/storage.js` | localStorage helpers, for the browser build, the migration and plugins' `api.storage` |
| `src/main.js` | Wiring: chooses the backend and passes it to `runner` |
| `src/editor.js` | The terminal area: connects the output, the input and the sessions, status bar, xterm, sizes |
| `src/terminal/` | `outputView` (blocks as read-only DOM, scrolling), `inputEditor` (the input: keys, history, completion UI), `session` (one tab's commands from block to finish: run state, text model, flushing, fullscreen, input, cwd, plugin events; no DOM), `runner` (one session per tab, routes backend events, ends a closed tab's session), `size` (the output area in characters), `textModel` (a terminal with no display, `@xterm/headless`, read back as text and styling), `fullscreen` (xterm for vim, top), `keys` |
| `src/plugins/` | Host, scope, registry, public API |
| `src/appActions.js` | The app's own actions. Shortcuts, menus and most buttons name them by id |
| `src/patch.js` | Updates the page from freshly built nodes, changing only what differs |
| `src/*.js` (the rest) | UI: tab bar, sidebar, menus, settings, themes |

## Command flow

1. Enter: `editor` calls `runner.runCommand` with the size. The tab's `session` adds the block, starts the run and calls the backend's `run`. On the desktop that is `electronBackend`, then IPC, then `shellSessions`, then the PTY.
2. PTY output: `shellParser` emits `output`, `alt`, `finish` events, which `electronBackend` passes to `runner`, then to the tab's session.
3. The session puts `output` through `textModel` into the block, and emits `output`, `data` (raw bytes), `fullscreen`, `start`, `finish`. `editor` only listens: `outputView` redraws, or xterm gets `data` while a full-screen program runs.
4. Closing a tab calls core's `endSession`: the run ends with 130 and the shell is killed.
5. While a command runs, the input is out of sight but keeps focus, and keys and pastes go to the program. The mock's commands read nothing, so in the browser they go nowhere, and Ctrl+C reaches the mock through `write`.

A command with a line break, or any other character a line editor would act on, goes to the shell as a bracketed paste followed by Enter, so the editor inserts it as text and runs it as one input. zsh then parses all of it before running anything; bash reads it a line at a time, as with any paste, so an earlier line can have run before a later line's syntax error. A command can't end its own paste. An unterminated quote or heredoc leaves the shell at a continuation prompt: keys are forwarded and Ctrl+C recovers, but until a command starts nothing the shell draws is shown, so what is typed there isn't visible.

Lines that have scrolled off a terminal's screen can't change, so `textModel` reads each of them once, and a flush reads only the screen and what newly scrolled off. It tells `outputView` how much of the text is that stable part, which goes into chunks that are never redrawn, and the rest is compared piece by piece. A resize, a full reset or an erased scrollback starts both over.

In the browser, `mockBackend` takes the place of everything after `run` and sends the same events.

A real-terminal view (xterm for the whole tab) would plug in at `editor.listenToSessions`: listen to `data`, send keys with `session.write` and its size with `session.resizePty`.

## Saved data

```text
~/.termeedor/        0700, files 0600: scrollback can contain secrets
  settings.json      theme, font size
  workspace.json     groups, tab order, layout (no scrollback)
  tabs/<id>.json     a tab's blocks (with their styling), draft, history, cwd
  past/<id>.json     a closed tab
  plugins/           not part of this
```

- **Loading:** `store.js` loads with a top-level await, so every module importing it waits. The UI modules still see a ready `state`.
- **What gets written:** the editor and plugins change tabs in place, so `saver` compares each tab with what was last saved instead of relying on marks. A batch holds only the files that differ. Only one async batch runs at a time, and what arrives meanwhile joins the next.
- **Order:** settings, past, tabs, workspace, then removals, stopping at the first failure. So a closed tab reaches `past/` before its file goes, and once `workspace.json` is written, everything before it was too.
- **Final save:** async IPC may not finish during unload, so `beforeunload` calls `saveNow`, which sends what is left over a synchronous IPC. Saving a theme uses the same path, so a failed save can still be undone and reported. Batches are numbered, and the data store refuses an older one arriving after a newer one. A renderer crash loses at most the last debounce, which output that never pauses can stretch to 2s.
- **Styling:** a block's `styles` is `[[start, end, code], ...]` over its plain `output`, in order and not overlapping, left out when there is none. It is read from the terminal's cells, never parsed from the stream. `code` is the SGR numbers in one fixed order, such as `1;31` or `38;2;1;2;3`. On load a range counts only if its offsets fit and its code is exactly what the app would write. A tab keeps at most `LIMITS.styleRanges` ranges, and past that the oldest output goes plain.
- **Damage:** a file that can't be used moves to `<name>.corrupt-<time>`. A tab file no layout mentions comes back as a past session.
- **Migration:** on the desktop, usable `STORAGE_KEYS` values move to files when there is no `workspace.json`. They are removed only after every file was written and read back. If it fails, the app runs from them, reports it, and tries again next start. Values that can't be read are left in place.

## Rules

- It behaves like a real terminal: everything typed goes to the user's shell. There are no custom commands, from the app or from plugins. App actions live in menus and shortcuts, and nothing typed reaches them.
- Output is an event stream, never a returned string.
- Command boundaries come from shell markers, never from matching text. Whether a line is a command comes from the transcript. Only the migration of old saved tabs reads the prompt out of text.
- Text reaches the page only as text nodes, and colors only as theme variables or `rgb()` of checked numbers.
- The output has no line numbers. They belong to the input only.
- Plugins are fully trusted. `api` is the only supported surface.
- `src/` must keep working without Electron: the browser build uses the mock.
- Stored data is untrusted and validated on load.

## Tests

- `npm test`: Node only, with a stub DOM (`test/support`). No layout, CSS, focus or real events.
- `npm run test:e2e`: the browser build in an Electron window that is never shown (offscreen, in-memory profile), driven over the DevTools protocol (`test/e2e/support`). For layout, focus, selection and real keys and clicks. On macOS it runs an APFS clone of Electron.app marked `LSUIElement`, so no Dock icon shows.


## Known problems

| Problem | Where |
| --- | --- |
| Plugins' `api.storage` is still localStorage, and the browser build keeps all scrollback in one value | `plugins/api.js`, `adapters/localStorageStore.js` |
| A desktop shell that ends between commands sends no `exit` event, so the tab's next `run` is what notices | `electron/shellSessions.cjs` |
| On bash, completion doesn't know flags or branches | `completions.cjs` |
| Completion functions run the programs they complete for (`git`, `npm`), as they do in zsh | `shellCompleter.cjs` |
| What the shell draws at a continuation prompt isn't shown, so an unterminated quote looks like a silent running command | `electron/shellParser.cjs` |
| Erased cells with a background color are trimmed with the line's end, so a background that fills a line stops at its last character | `terminal/textModel.js` |
| A running program's cursor always shows at the end of its output, whatever column it is really in | `styles/base.css` |
| Only the window's own resize reaches the PTY: dragging the sidebar or changing the font size waits for the next one | `editor.js` |

## Target

```text
src/core/       no DOM or storage: workspace, selection, actions, events, what gets saved
src/ports/      backend, persistence
src/adapters/   electron and mock backends; file and localStorage stores
src/terminal/   one run state machine, transcript model, views
src/ui/         reads state, dispatches actions
src/plugins/    the API hands out ids and copies
```

- Dependencies point inward: `ui` and `adapters` depend on `core`, and `core` imports nothing outward.
- A tab is `{ blocks: [{ command, output, exit, cwd }], draft }`, not one string.

## Plan

Each step ships alone. New features can continue between steps.

1. **Small fixes (done).** Every line goes to the shell, with no app or plugin commands. Erasing the scrollback (`ESC[3J`, sent by `clear`) clears the whole tab. Load trims keep the newest text. Failed saves show in the status bar.
2. **Transcript model (done).** `tab.content` became `blocks` and `draft`, and saved tabs migrate on load. A migrated tab's history is one plain block, so its old commands can't be re-run. `runState` replaces the renderer's three run records; `shellSessions` keeps the PTY's own state. The textarea stays, rendered from blocks, so re-running a line uses its block and the `❯ ` matching is gone.
3. **Store split (done).** State and actions moved to `core`, with tests, and `store.js` stays the import path. Data moved from localStorage to files in `~/.termeedor`: layout and scrollback are separate, one tab's output rewrites one file, and scrollback is capped per tab.
4. **Backend port (done).** `adapters/index.js` chooses Electron or mock, and `platform.js` is the one answer to desktop or browser and Mac or not. `shell.js` became the mock adapter, the only place fake commands remain. `realShell.js` became `terminal/runner.js` and `size.js`, and its IPC moved to the Electron adapter. The mock now sends events through the same path as the real shell.
5. **Editor-style view (done).** Blocks are read-only DOM with native selection, and only what changed is redrawn. The input is a separate plain textarea right after the output, scrolling with it, so the rules guarding the caret and the prompt are gone. Multi-line commands go to the shell as a bracketed paste. Each real command has a re-run button, and clicking text never runs anything. Color is read from the terminal's cells and saved with each block. Line numbers apply to the input only.
6. **Completion (done).** `shellCompleter` asks one hidden zsh, shared by all tabs and started on the first Tab, with the user's rc files. It gets requests over a socket and no keys, so it can't run the line, and it captures `compadd`. It answers within 1s, or `completions.cjs` does; the same on a crash, no results or another shell. zsh's own completion evaluates `$(x)/`, so lines with `(`, a backtick or a hidden operator never reach it.
7. **Cleanup (done).** Shortcuts, menus, most buttons and plugins name actions by id. Views still build their lists, and `patch` changes only what differs, so rows keep hover, focus and an open rename. Closed tabs' text is read once. A command never commits: its spinners and status update in place (`runMarks`). Plugins get copies and refer to actions by id. No framework was needed.
