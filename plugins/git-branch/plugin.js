// Example of a plugin with an OS-side part: this file runs in the app's page,
// and host.cjs runs in its own process with full Node.js access.

const COPY_ICON = "⧉";
// A program that stays open in the tab (an agent, say) can open a pull request without any command finishing.
const POLL_MS = 10_000;

export function activate(api) {
  let status = api.statusBar.add({ text: "", title: "Git branch of this tab's folder" });
  let branch = null;
  let pr = null; // { number, url } of the branch's pull request
  let prButton = null;
  let copyButton = null;
  let resetTimer = null;
  let refreshes = 0;
  const prCache = new Map(); // "folder\nbranch" -> last pull request seen there, or null
  let shown = null; // what the status bar shows now, so a refresh that changes nothing doesn't redraw it

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
    const next = `${branch}\n${pr?.url}`;
    if (next === shown) return;
    shown = next;
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
    // Asking GitHub takes a second or two, so show the last known answer right away and correct it after.
    const key = branch ? `${tab.cwd}\n${branch}` : null;
    pr = key ? prCache.get(key) ?? null : null;
    layout();
    if (!branch) return;
    const nextPr = await api.host.call("pullRequest", tab.cwd).catch(() => null);
    prCache.set(key, nextPr);
    if (ticket !== refreshes || nextPr?.url === pr?.url) return;
    pr = nextPr;
    layout();
  }

  api.events.on("tab:activate", refresh);
  api.events.on("command:finish", refresh);
  const refreshIfVisible = () => { if (!document.hidden) refresh(); };
  const poll = setInterval(refreshIfVisible, POLL_MS);
  window.addEventListener("focus", refreshIfVisible);
  refresh();

  return () => {
    clearTimeout(resetTimer);
    clearInterval(poll);
    window.removeEventListener("focus", refreshIfVisible);
  };
}
