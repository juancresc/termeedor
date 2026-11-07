// A block's colors and multi-line command through saving and loading. No DOM or storage.

import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";
import { addGroup, addTab, connect, defaultWorkspace, hydrate, state } from "../src/core/workspace.js";
import { readSnapshot, samePrint, tabFile, tabPrint } from "../src/core/saved.js";
import { sanitizeSettings } from "../src/core/sanitize.js";

connect({ save: () => {}, stopRun: () => {} });

beforeEach(() => {
  hydrate({ ws: { ...defaultWorkspace(), groups: [], tabs: [], activeTab: null }, past: [], settings: sanitizeSettings(null) });
});

test("a reopened tab keeps its colors and its multi-line command, and a color change counts as a change", () => {
  const tab = addTab(addGroup().id);
  const before = tabPrint(tab);
  tab.blocks = [{ command: "echo a\necho b", output: "a\nb", exit: 0, cwd: "~", styles: [[0, 1, "1;31"], [2, 3, "38;5;200"]] }];
  assert.equal(samePrint(before, tabPrint(tab)), false);

  const samePlainText = tabPrint(tab);
  tab.blocks[0].styles = [[0, 1, "32"]];
  assert.equal(samePrint(samePlainText, tabPrint(tab)), false);

  tab.blocks[0].styles = [[0, 1, "1;31"], [2, 3, "38;5;200"]];
  tab.draft = "typed\nlines";
  const saved = JSON.parse(JSON.stringify(tabFile(tab)));
  const { ws } = readSnapshot({
    workspace: { groups: state.ws.groups, tabs: [{ id: tab.id, groupId: tab.groupId, name: tab.name }] },
    tabs: [saved],
  });
  assert.deepEqual(ws.tabs[0].blocks, tab.blocks);
  assert.equal(ws.tabs[0].draft, "typed\nlines");
});
