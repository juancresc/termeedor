# Writing Termeedor plugins

A plugin is a folder with a `plugin.js` in it, much like a zsh plugin. Plugins only work in the desktop app, not the browser build.

## Quick start

```sh
mkdir -p ~/.termeedor/plugins/greet
cat > ~/.termeedor/plugins/greet/plugin.js <<'EOF'
export function activate(api) {
  api.commands.register("greet", ({ arg }) => `Hello, ${arg || "world"}!`);
}
EOF
```

In Termeedor, open Settings, click **Reload plugins** and turn on **greet**. Then type `greet` in a tab.

Plugins are off until you turn them on. There's a fuller example in [`plugins/hello`](../plugins/hello).

## Where plugins go

| Folder | Label in Settings | Notes |
| --- | --- | --- |
| `~/.termeedor/plugins` | your folder | Use this one. It survives app updates. **Open plugins folder** in Settings goes here. |
| `<install folder>/plugins` | install folder | Windows and Linux only. Meant for portable builds, where the folder is next to the `.exe` or AppImage. Installers may replace it on update. |
| `resources/plugins` | built in | Ships with the app. |

If two folders have a plugin with the same name, the one higher in this table is used. macOS has no install folder: anything put inside `Termeedor.app` breaks its signature and is lost on update.

You can symlink a plugin folder into `~/.termeedor/plugins`, which is handy while developing. Set `TERMEEDOR_PLUGINS_DIR` to use a different folder instead of `~/.termeedor/plugins`.

## Files

The folder name is the plugin's id. It can use letters, numbers, dots, dashes and underscores.

`plugin.json` is optional:

```json
{
  "name": "Greet",
  "version": "1.0.0",
  "description": "Shown in Settings.",
  "main": "plugin.js",
  "apiVersion": 1
}
```

The entry file is an ES module that exports `activate`. It can import other files from its own folder with relative paths. `activate` may be async, but must finish within 5 seconds.

```js
export function activate(api) {
  // Everything added through `api` is removed automatically when the plugin is turned off.
  // Optionally return a function to clean up anything else, such as timers.
  const timer = setInterval(tick, 1000);
  return () => clearInterval(timer);
}
```

`activate` runs again each time the plugin is turned back on, using the same loaded module, so keep state inside it. **Reload plugins** is what picks up edited files.

## API

Every `register`/`add`/`on` call below returns an object with `dispose()`, which removes just that item early. Invalid or conflicting calls throw; if that happens during `activate`, the plugin fails to start and Settings shows the error.

### `api.commands.register(name, handler, { description })`

Adds a shell command. Built-in commands and another plugin's commands can't be replaced.

```js
api.commands.register("wait", async ({ arg, args, session, emit, signal }) => {
  emit("starting");           // stream a line of output
  await doWork(signal);       // signal aborts on Ctrl+C or when the tab closes
  session.name = arg;         // session is the tab: name, color, cwd and history can be changed
  return "done";              // a string to print, { output }, { clear: true }, or nothing
}, { description: "shown in help" });
```

### `api.shortcuts.register(combo, handler)`

`"Mod+KeyJ"` or `"Mod+Shift+KeyJ"`, using [`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values) names. `Mod` is Cmd on macOS and Ctrl elsewhere. Built-in shortcuts and copy, paste, cut, undo, select all and quit can't be taken.

### `api.menus.addTabItem(item)` and `api.menus.addGroupItem(item)`

Adds to the right-click menu. `item` is `{ label, onSelect(target), danger?, when?(target) }`, where `target` is the tab or group clicked and `when` decides whether the item shows.

### `api.statusBar.add({ text, title, onClick })`

Adds an item to the status bar. Besides `dispose()`, the returned object has `update({ text, title })`.

### `api.events.on(name, handler)`

| Event | Payload |
| --- | --- |
| `tab:open`, `tab:close`, `tab:activate` | `{ tab }` |
| `command:start` | `{ tab, command }` |
| `command:finish` | `{ tab, command, output, aborted }` |

### `api.styles.add(path)`

Loads a stylesheet, with `path` relative to the entry file. Themes list the app's selectors and variables: see any file in `themes/`.

### `api.workspace`

`activeTab()`, `tabs()`, `groups()`, `openTab(groupId?)`, `activateTab(tab)`, `closeTab(tab)`, `renameTab(tab, name)`, `setTabColor(tab, color)`, and `print(tab, text)`, which prints a line of output and leaves a prompt below it.

### `api.storage`

`get(key, fallback)` and `set(key, value)`. Values are JSON, kept separately per plugin.

### `api.plugin` and `api.apiVersion`

The plugin's `{ id, name, version }`, and the API version it is running against.

## What plugins can and can't do

Plugins run inside the app's page, as trusted code:

- They **can** read and change everything in the app, including the contents of every tab. Only turn on plugins you trust.
- They **can't** use Node.js, read your files (only the app's and plugin folders), start processes or make network requests. The page's security policy and Electron's sandbox block these. They can open a web link in your default browser, and that link can carry data out.

Only `api` is supported. Importing the app's own modules (such as `/src/store.js`) works, but those can change in any release. A breaking change to `api` will raise `apiVersion`, and plugins asking for a different version show an error instead of loading.

## Debugging

Errors from `activate` show under the plugin in Settings. Errors from callbacks go to the developer console (**View → Toggle Developer Tools**), labelled `[plugin <id>]`, and don't affect the rest of the app.
