// Example of a plugin with an OS-side part: this file runs in the app's page,
// and host.cjs runs in its own process with full Node.js access.

export function activate(api) {
  const status = api.statusBar.add({ text: "", title: "Git branch of this tab's folder" });

  async function refresh() {
    const tab = api.workspace.activeTab();
    const branch = tab ? await api.host.call("branch", tab.cwd).catch(() => null) : null;
    status.update({ text: branch ? `⎇ ${branch}` : "" });
  }

  api.events.on("tab:activate", refresh);
  api.events.on("command:finish", refresh);
  refresh();
}
