const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

/** Tabs keep their folder as "~/x". */
const resolveDir = (cwd) => cwd === "~" ? os.homedir() : cwd.startsWith("~/") ? path.join(os.homedir(), cwd.slice(2)) : cwd;

// An app opened from the Finder gets a short PATH, without Homebrew's folders where gh usually is.
const env = { ...process.env, PATH: [process.env.PATH, "/opt/homebrew/bin", "/usr/local/bin"].filter(Boolean).join(path.delimiter) };

const run = (file, args, cwd, timeout) => new Promise((resolve) => {
  execFile(file, args, { cwd, timeout, env }, (err, stdout) => resolve(err ? null : stdout.trim() || null));
});

/** Returns the branch, or null outside a repository. */
exports.branch = (cwd) => run("git", ["rev-parse", "--abbrev-ref", "HEAD"], resolveDir(cwd), 3000);

/** The current branch's pull request as { number, url }, or null if it has none or gh isn't installed or signed in. */
exports.pullRequest = async (cwd) => {
  const out = await run("gh", ["pr", "view", "--json", "number,url"], resolveDir(cwd), 8000);
  try {
    const { number, url } = JSON.parse(out);
    return /^https:\/\//.test(url) ? { number, url } : null;
  } catch {
    return null;
  }
};
