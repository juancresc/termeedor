// Example of a plugin with an OS-side part: this file runs in the app's page,
// and host.cjs runs in its own process with full Node.js access.

const COPY_ICON = "⧉";

export function activate(api) {
  let status = api.statusBar.add({ text: "", title: "Git branch of this tab's folder" });
  let branch = null;
  let pr = null; // { number, url } of the branch's pull request
  let prButton = null;
  let copyButton = null;
  let resetTimer = null;
  let refreshes = 0;

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

  api.actions.register({
    id: "openPullRequest",
    label: "Open the branch's pull request",
    run() {
      if (pr) window.open(pr.url); // the app opens web links in the browser
    },
  });

  /** Status items show in the order they were added, so the pull request goes in first to sit left of the branch. */
  function layout() {
    status.dispose();
    prButton?.dispose();
    copyButton?.dispose();
    prButton = pr ? api.statusBar.add({ text: `PR #${pr.number}`, title: `Open ${pr.url}`, action: "openPullRequest" }) : null;
    status = api.statusBar.add({ text: branch ? `⎇ ${branch}` : "", title: "Git branch of this tab's folder" });
    copyButton = branch ? api.statusBar.add({ text: COPY_ICON, title: "Copy branch name", action: "copyBranch" }) : null;
  }

  async function refresh() {
    const ticket = ++refreshes;
    const tab = api.workspace.activeTab();
    const nextBranch = tab ? await api.host.call("branch", tab.cwd).catch(() => null) : null;
    if (ticket !== refreshes) return; // another tab or command took over meanwhile
    branch = nextBranch;
    if (!branch) pr = null;
    layout();
    if (!branch) return;
    const nextPr = await api.host.call("pullRequest", tab.cwd).catch(() => null);
    if (ticket !== refreshes || nextPr?.url === pr?.url) return;
    pr = nextPr;
    layout();
  }

  api.events.on("tab:activate", refresh);
  api.events.on("command:finish", refresh);
  refresh();

  return () => clearTimeout(resetTimer);
}
