const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

/** Tabs keep their folder as "~/x". */
const resolveDir = (cwd) => cwd === "~" ? os.homedir() : cwd.startsWith("~/") ? path.join(os.homedir(), cwd.slice(2)) : cwd;

// An app opened from the Finder gets a short PATH, without Homebrew's folders where gh usually is.
const env = { ...process.env, PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(path.delimiter) };

/** Resolves with what the program wrote, and never rejects. */
const exec = (file, args, cwd, timeout) => new Promise((resolve) => {
  execFile(file, args, { cwd, timeout, env }, (err, stdout, stderr) => resolve({ ok: !err, stdout: String(stdout).trim(), stderr: String(stderr).trim() }));
});

const run = async (file, args, cwd, timeout) => {
  const { ok, stdout } = await exec(file, args, cwd, timeout);
  return ok ? stdout || null : null;
};

/** Returns the branch, or null outside a repository. */
exports.branch = (cwd) => run("git", ["rev-parse", "--abbrev-ref", "HEAD"], resolveDir(cwd), 3000);

/** True when the folder has changes not yet committed: edited, staged or new files. */
exports.dirty = async (cwd) => {
  // Without optional locks, so checking in the background never gets in the way of a git command the user runs.
  const out = await run("git", ["--no-optional-locks", "status", "--porcelain"], resolveDir(cwd), 3000);
  return out !== null;
};

/** True on the repository's main branch, where there is nothing to open a pull request from. */
async function onDefaultBranch(dir) {
  const [branch, remoteHead] = await Promise.all([
    run("git", ["rev-parse", "--abbrev-ref", "HEAD"], dir, 3000),
    run("git", ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"], dir, 3000),
  ]);
  // A repository that wasn't cloned may not record the remote's main branch, so go by the usual names.
  return remoteHead ? remoteHead === `origin/${branch}` : ["main", "master"].includes(branch);
}

/**
 * The current branch's pull request as { number, url }, or { missing: true } when it has none and one could be created.
 * Null when there is nothing to offer: on the main branch, or gh isn't installed or signed in.
 */
exports.pullRequest = async (cwd) => {
  const dir = resolveDir(cwd);
  const { ok, stdout, stderr } = await exec("gh", ["pr", "view", "--json", "number,url"], dir, 8000);
  if (!ok) return /no pull requests found/i.test(stderr) && !(await onDefaultBranch(dir)) ? { missing: true } : null;
  try {
    const { number, url } = JSON.parse(stdout);
    return /^https:\/\//.test(url) ? { number, url } : null;
  } catch {
    return null;
  }
};

/**
 * Opens GitHub's "new pull request" page for the current branch in the browser, where the user writes and confirms it.
 * Returns { ok: true }, or { error } with gh's reason, such as a branch that isn't pushed yet. It never pushes.
 */
exports.createPullRequest = async (cwd) => {
  const { ok, stderr } = await exec("gh", ["pr", "create", "--web"], resolveDir(cwd), 15000);
  return ok ? { ok: true } : { error: stderr || "gh could not open the pull request page" };
};
