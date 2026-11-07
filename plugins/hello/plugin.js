// Example plugin. Copy this folder into ~/.termeedor/plugins to start your own.
// docs/plugins.md describes everything on `api`.

export function activate(api) {
  let count = api.storage.get("commandCount", 0);

  api.actions.register({ id: "resetCount", label: "Reset command count", run: () => setCount(0) });
  const counter = api.statusBar.add({
    text: `${count} commands`,
    title: "Commands run. Click to reset.",
    action: "resetCount",
  });

  function setCount(value) {
    count = value;
    api.storage.set("commandCount", count);
    counter.update({ text: `${count} commands` });
  }

  api.events.on("command:finish", () => setCount(count + 1));

  api.actions.register({
    id: "sayHello",
    label: "Say hello",
    run: (tab) => api.workspace.print(tab, `Hello, ${tab.name}!`),
  });
  api.menus.addTabItem("sayHello");

  api.actions.register({
    id: "shortcutHello",
    label: "Say hello from a shortcut",
    run: () => {
      const tab = api.workspace.activeTab();
      if (tab) api.workspace.print(tab, "Hello from a shortcut!");
    },
  });
  api.shortcuts.register("Mod+Shift+KeyH", "shortcutHello");
}
