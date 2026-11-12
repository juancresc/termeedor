# Writing Termeedor plugins

A plugin is a folder with a `plugin.js` in it, much like a zsh plugin. Plugins only work in the desktop app, not the browser build.

## Quick start

```sh
mkdir -p ~/.termeedor/plugins/greet
cat > ~/.termeedor/plugins/greet/plugin.js <<'EOF'
export function activate(api) {
  api.actions.register({
    id: "greet",
    label: "Greet",
    run: (tab) => api.workspace.print(tab, `Hello, ${tab.name}!`),
  });
  api.menus.addTabItem("greet");
}
EOF
```

In Termeedor, open Settings, click **Reload plugins** and turn on **greet**. Then right-click a tab and choose **Greet**.

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
  "host": "host.cjs",
  "apiVersion": 2
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

Plugins can't add commands: everything typed in a tab goes to the shell. For a new command, use a zsh or bash alias or function.

Tabs and groups you receive are copies, so changing one changes nothing in the app. Anywhere a call takes a tab, a copy or its id works. A tab that has closed is ignored.

### `api.actions`

What a plugin can do goes in an action, and shortcuts, menus and status items refer to it by id.

`register({ id, label, run(...args), enabled?(...args), danger? })` adds one. Its full id is `<plugin id>.<id>`, also on the returned object. A plugin uses its own by `id` alone, others' by full id. A menu passes `run` and `enabled` the tab or group clicked, and hides the item when `enabled` returns false.

`run(id, target?, ...args)` runs any action. The app's own:

| Id | Takes |
| --- | --- |
| `newTab`, `reopenTab`, `closeTab`, `newGroup`, `toggleSidebar`, `openSettings`, `previousTab`, `nextTab`, `previousGroup`, `nextGroup`, `clearSessions`, `textLarger`, `textSmaller` | nothing |
| `goToTab` | a number, 1 to 9 |
| `goToGroup` | a number, 1 to 9 |
| `tab.rename`, `tab.toggleCollapsed`, `tab.toggleMinimized`, `tab.duplicate`, `tab.stop`, `tab.sendToNewGroup`, `tab.close` | a tab |
| `group.newTab`, `group.rename`, `group.toggleCollapsed`, `group.toggleMinimized`, `group.restoreTabs`, `group.close` | a group |

### `api.shortcuts.register(combo, actionId)`

`"Mod+KeyJ"` or `"Mod+Shift+KeyJ"`, using [`KeyboardEvent.code`](https://developer.mozilla.org/docs/Web/API/UI_Events/Keyboard_event_code_values) names. `Mod` is Cmd on macOS and Ctrl elsewhere. Built-in shortcuts and copy, paste, cut, undo, select all and quit can't be taken.

### `api.menus.addTabItem(actionId)` and `api.menus.addGroupItem(actionId)`

Adds the action to the right-click menu, with its label.

### `api.statusBar.add({ text, title, action })`

Adds an item to the status bar. Clicking it runs `action`, if given. Besides `dispose()`, the returned object has `update({ text, title })`.

### `api.events.on(name, handler)`

| Event | Payload |
| --- | --- |
| `tab:open`, `tab:close`, `tab:activate` | `{ tab }` |
| `command:start` | `{ tab, command }`. A command can span several lines |
| `command:finish` | `{ tab, command, output, aborted }` |

### `api.styles.add(path)`

Loads a stylesheet, with `path` relative to the entry file. Themes list the app's selectors and variables: see any file in `themes/`.

### `api.workspace`

`activeTab()`, `tabs()`, `groups()` and `openTab(groupId?)` return copies. `activateTab(tab)`, `closeTab(tab)`, `renameTab(tab, name)` and `setTabColor(tab, color)` change the app. `print(tab, text)` prints a line of output and leaves a prompt below it.

### `api.storage`

`get(key, fallback)` and `set(key, value)`. Values are JSON, kept separately per plugin.

### `api.host.call(method, ...args)`

Runs code outside the page, with full Node.js access. Name a file in `plugin.json`:

```json
{ "host": "host.cjs" }
```

```js
// host.cjs: runs in its own process, so a crash here can't take the app down
exports.branch = async (cwd) => { /* use child_process, fs, the network... */ };

// plugin.js
const branch = await api.host.call("branch", tab.cwd);
```

The process starts on the first call and stops when the plugin is turned off. Calls reject if the function throws, if it takes over 30 seconds or if the process dies. Arguments and results must be plain data. Tab folders are in the `~/x` form. See [`plugins/git-branch`](../plugins/git-branch) for a full example.

If the app was opened from the Finder, the host process has the system's default `PATH`, without what your shell's startup files add.

### `api.plugin` and `api.apiVersion`

The plugin's `{ id, name, version }`, and the API version it is running against.

## What plugins can and can't do

Plugins are fully trusted code, like a zsh plugin. Copies keep mistakes out of the app's state, but they aren't a wall: a plugin can read the contents of every tab, and can run anything on your computer as you. That's true even without a host file, because the page can reach the tabs' shells. Only turn on plugins you trust.

Code in `plugin.js` has no Node.js and can't make network requests directly, because of the page's security policy. Use a host file for those.

Only `api` is supported. Importing the app's own modules (such as `/src/store.js`) works, but those can change in any release. A breaking change to `api` will raise `apiVersion`, and plugins asking for a different version show an error instead of loading.

## Debugging

Errors from `activate` show under the plugin in Settings. Errors from callbacks go to the developer console (**View → Toggle Developer Tools**), labelled `[plugin <id>]`, and don't affect the rest of the app.
