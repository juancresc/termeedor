const { execFile } = require("node:child_process");
const os = require("node:os");
const path = require("node:path");

/** Tabs keep their folder as "~/x". Returns the branch, or null outside a repository. */
exports.branch = (cwd) => new Promise((resolve) => {
  const dir = cwd === "~" ? os.homedir() : cwd.startsWith("~/") ? path.join(os.homedir(), cwd.slice(2)) : cwd;
  execFile("git", ["-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { timeout: 3000 }, (err, stdout) => {
    resolve(err ? null : stdout.trim());
  });
});
