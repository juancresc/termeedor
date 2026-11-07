import assert from "node:assert/strict";
import { test } from "node:test";
import { LIMITS } from "../src/constants.js";
import { sanitizeWorkspace } from "../src/storage.js";

const workspaceWith = (content) => ({
  groups: [{ id: "g1", name: "Group" }],
  tabs: [{ id: "t1", groupId: "g1", name: "tab", content }],
});
const loadedContent = (content) => sanitizeWorkspace(workspaceWith(content)).tabs[0].content;

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

test("content that isn't text loads empty", () => {
  assert.equal(loadedContent(42), "");
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
