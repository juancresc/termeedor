// Example of a plugin with an OS-side part: this file runs in the app's page,
// and host.cjs runs in its own process with full Node.js access.

const COPY_ICON = "⧉";
// A program that stays open in the tab (an agent, say) can open a pull request without any command finishing.
const POLL_MS = 10_000;
const CREATE_ITEM = { text: "Create PR", title: "Create a pull request for this branch on GitHub" };
const BRANCH_TITLE = "Git branch of this tab's folder";

/** Tells apart a pull request, a branch that can get one, and nothing to show. */
const prKey = (pr) => pr?.url ?? (pr?.missing ? "missing" : "");

export function activate(api) {
  let status = api.statusBar.add({ text: "", title: BRANCH_TITLE });
  let branch = null;
  let dirty = false; // the folder has changes not yet committed
  let pr = null; // { number, url } of the branch's pull request, or { missing: true } when one can be created
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
      if (pr?.url) window.open(pr.url); // the app opens web links in the browser
    },
  });

  api.actions.register({
    id: "createPullRequest",
    label: "Create a pull request for the branch",
    async run() {
      const tab = api.workspace.activeTab();
      if (!tab || !pr?.missing) return;
      prButton?.update({ text: "Opening…", title: "Opening GitHub in the browser" });
      const result = await api.host.call("createPullRequest", tab.cwd).catch((err) => ({ error: err.message }));
      prButton?.update(CREATE_ITEM);
      if (result?.error) api.workspace.print(tab, `Could not create the pull request: ${result.error}`);
      else refresh();
    },
  });

  /** Status items show in the order they were added, so the pull request goes in first to sit left of the branch. */
  function layout() {
    const next = `${branch}\n${dirty}\n${prKey(pr)}`;
    if (next === shown) return;
    shown = next;
    status.dispose();
    prButton?.dispose();
    copyButton?.dispose();
    prButton = pr?.url ? api.statusBar.add({ text: `PR #${pr.number}`, title: `Open ${pr.url}`, action: "openPullRequest" })
      : pr?.missing ? api.statusBar.add({ ...CREATE_ITEM, action: "createPullRequest" })
      : null;
    status = api.statusBar.add({
      text: branch ? `⎇ ${branch}${dirty ? "*" : ""}` : "",
      title: dirty ? `${BRANCH_TITLE}. It has uncommitted changes.` : BRANCH_TITLE,
    });
    copyButton = branch ? api.statusBar.add({ text: COPY_ICON, title: "Copy branch name", action: "copyBranch" }) : null;
  }

  async function refresh() {
    const ticket = ++refreshes;
    const tab = api.workspace.activeTab();
    const [nextBranch, nextDirty] = tab
      ? await Promise.all([api.host.call("branch", tab.cwd).catch(() => null), api.host.call("dirty", tab.cwd).catch(() => false)])
      : [null, false];
    if (ticket !== refreshes) return; // another tab or command took over meanwhile
    branch = nextBranch;
    dirty = Boolean(branch && nextDirty);
    // Asking GitHub takes a second or two, so show the last known answer right away and correct it after.
    const key = branch ? `${tab.cwd}\n${branch}` : null;
    pr = key ? prCache.get(key) ?? null : null;
    layout();
    if (!branch) return;
    const nextPr = await api.host.call("pullRequest", tab.cwd).catch(() => null);
    prCache.set(key, nextPr);
    if (ticket !== refreshes || prKey(nextPr) === prKey(pr)) return;
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
