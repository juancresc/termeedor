// Example plugin. Copy this folder into ~/.termeedor/plugins to start your own.
// docs/plugins.md describes everything on `api`.

export function activate(api) {
  let count = api.storage.get("commandCount", 0);

  const counter = api.statusBar.add({
    text: `${count} commands`,
    title: "Commands run. Click to reset.",
    onClick: () => setCount(0),
  });

  function setCount(value) {
    count = value;
    api.storage.set("commandCount", count);
    counter.update({ text: `${count} commands` });
  }

  api.events.on("command:finish", () => setCount(count + 1));

  api.menus.addTabItem({
    label: "Say hello",
    onSelect: (tab) => api.workspace.print(tab, `Hello, ${tab.name}!`),
  });

  api.shortcuts.register("Mod+Shift+KeyH", () => {
    const tab = api.workspace.activeTab();
    if (tab) api.workspace.print(tab, "Hello from a shortcut!");
  });
}
