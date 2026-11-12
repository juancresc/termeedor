// Example of a plugin with an OS-side part: this file runs in the app's page,
// and host.cjs runs in its own process with full Node.js access.

const COPY_ICON = "⧉";

export function activate(api) {
  const status = api.statusBar.add({ text: "", title: "Git branch of this tab's folder" });
  let branch = null;
  let copyButton = null;
  let resetTimer = null;

  api.actions.register({
    id: "copyBranch",
    label: "Copy git branch",
    async run() {
      if (!branch) return;
      await navigator.clipboard.writeText(branch);
      copyButton?.update({ text: "✓", title: "Copied" });
      clearTimeout(resetTimer);
      resetTimer = setTimeout(() => copyButton?.update({ text: COPY_ICON, title: "Copy branch name" }), 1200);
    },
  });

  async function refresh() {
    const tab = api.workspace.activeTab();
    branch = tab ? await api.host.call("branch", tab.cwd).catch(() => null) : null;
    status.update({ text: branch ? `⎇ ${branch}` : "" });
    if (branch && !copyButton) {
      copyButton = api.statusBar.add({ text: COPY_ICON, title: "Copy branch name", action: "copyBranch" });
    } else if (!branch && copyButton) {
      copyButton.dispose();
      copyButton = null;
    }
  }

  api.events.on("tab:activate", refresh);
  api.events.on("command:finish", refresh);
  refresh();

  return () => clearTimeout(resetTimer);
}
