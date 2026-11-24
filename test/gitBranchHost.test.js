// The git-branch plugin's host, with a fake gh first on PATH.

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

const bin = fs.mkdtempSync(path.join(os.tmpdir(), "termeedor-gh-"));
const answer = path.join(bin, "answer.json");
fs.writeFileSync(path.join(bin, "gh"), `#!/bin/sh\ncat "${answer}"\n`, { mode: 0o755 });
const savedPath = process.env.PATH;
process.env.PATH = `${bin}${path.delimiter}${savedPath}`; // read when the host loads
const host = createRequire(import.meta.url)("../plugins/git-branch/host.cjs");
process.env.PATH = savedPath;
after(() => fs.rmSync(bin, { recursive: true, force: true }));

const pullRequestFor = async (state) => {
  fs.writeFileSync(answer, JSON.stringify({ number: 7, url: "https://github.com/o/r/pull/7", state }));
  return host.pullRequest(bin);
};

test("a pull request says whether it is open, merged or closed", async () => {
  assert.deepEqual(await pullRequestFor("OPEN"), { number: 7, url: "https://github.com/o/r/pull/7", state: "open" });
  assert.equal((await pullRequestFor("MERGED")).state, "merged");
  assert.equal((await pullRequestFor("CLOSED")).state, "closed");
});
