import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS } from "../src/constants.js";
import { sanitizePastEntry, sanitizeWorkspace } from "../src/storage.js";

const workspaceWith = (content) => ({
  groups: [{ id: "g1", name: "Group" }],
  tabs: [{ id: "t1", groupId: "g1", name: "tab", content }],
});
const loadedContent = (content) => sanitizeWorkspace(workspaceWith(content)).tabs[0].blocks[0]?.output ?? "";

test("short content loads unchanged", () => {
  assert.equal(loadedContent("a\nb"), "a\nb");
});

test("over the limit, the newest output stays and starts on a whole line", () => {
  const content = `${"old\n".repeat(LIMITS.content)}newest`;
  const loaded = loadedContent(content);
  assert.ok(loaded.length <= LIMITS.content);
  assert.ok(loaded.endsWith("newest"));
  assert.ok(loaded.startsWith("old\n"));
});

test("one long line over the limit keeps its end", () => {
  const loaded = loadedContent(`${"x".repeat(LIMITS.content)}end`);
  assert.equal(loaded.length, LIMITS.content);
  assert.ok(loaded.endsWith("end"));
});

test("a group only has the color picked for it, even if an automatic one was saved", () => {
  const saved = workspaceWith("");
  saved.groups = [{ id: "g1", name: "Plain", autoColor: "c6" }, { id: "g2", name: "Picked", color: "c2", autoColor: "c6" }];
  const [plain, picked] = sanitizeWorkspace(saved).groups;
  assert.equal(plain.color, null);
  assert.equal(picked.color, "c2");
  assert.ok(!("autoColor" in plain));
});

test("a workspace with no groups stays that way when loaded", () => {
  const loaded = sanitizeWorkspace({ groups: [], tabs: [] });
  assert.deepEqual(loaded.groups, []);
  assert.deepEqual(loaded.tabs, []);
});

test("content that isn't text loads empty", () => {
  assert.equal(loadedContent(42), "");
});

test("open tabs and past sessions both migrate old content on load, and the old field is gone", () => {
  const expected = { blocks: [{ command: null, output: "❯ ls\nfile", exit: null, cwd: null }], draft: "typed" };
  const saved = "❯ ls\nfile\n❯ typed";

  const { content, ...tab } = sanitizeWorkspace(workspaceWith(saved)).tabs[0];
  assert.equal(content, undefined);
  assert.deepEqual({ blocks: tab.blocks, draft: tab.draft }, expected);

  const past = sanitizePastEntry({ id: "p1", name: "old", tab: { content: saved } });
  assert.equal(past.tab.content, undefined);
  assert.deepEqual({ blocks: past.tab.blocks, draft: past.tab.draft }, expected);
});

test("a failed save is reported, and clears once saving works again", async () => {
  let full = true;
  const items = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => items.get(key) ?? null,
      setItem(key, value) {
        if (full) throw new Error("quota");
        items.set(key, value);
      },
    },
  });
  const warn = console.warn;
  console.warn = () => {};
  try {
    const { commit, hasSaveFailed, subscribe } = await import("../src/store.js");
    let renders = 0;
    subscribe(() => { renders++; });

    commit();
    assert.equal(hasSaveFailed(), true);
    await Promise.resolve();
    assert.equal(renders, 2); // the commit, then the change in save status

    full = false;
    commit();
    assert.equal(hasSaveFailed(), false);
  } finally {
    console.warn = warn;
  }
});

test("a new tab opens at the end of the list, or right after the tab it was asked for next to", async () => {
  const { addTab, state } = await import("../src/store.js");
  const first = addTab();
  const last = addTab(first.groupId);
  const beside = addTab(first.groupId, first);
  const order = state.ws.tabs.map((t) => t.id);
  assert.equal(order.indexOf(beside.id), order.indexOf(first.id) + 1);
  assert.equal(order.indexOf(last.id), order.length - 1);
});
