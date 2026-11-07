// npm can install node-pty's prebuilt spawn-helper without its execute bit. Without it,
// every shell fails with "posix_spawnp failed", in development and in packaged builds.

const fs = require("node:fs");
const path = require("node:path");

const prebuilds = path.join(__dirname, "..", "node_modules", "node-pty", "prebuilds");
if (process.platform !== "win32" && fs.existsSync(prebuilds)) {
  for (const platform of fs.readdirSync(prebuilds)) {
    const helper = path.join(prebuilds, platform, "spawn-helper");
    if (fs.existsSync(helper)) fs.chmodSync(helper, 0o755);
  }
}
