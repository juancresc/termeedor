// core runs with no DOM and no storage: nothing here stubs them.

import assert from "node:assert/strict";
import fs from "node:fs";
import { beforeEach, test } from "node:test";
import { LIMITS } from "../src/constants.js";
import {
  addGroup, addTab, clearPast, closeGroup, closeTab, commit, connect, defaultWorkspace, deletePast, hydrate, reopenLastClosed,
  renameItem, shouldConfirmCloseGroup, state, subscribe,
} from "../src/core/workspace.js";
import { readSnapshot, tabFile } from "../src/core/saved.js";
import { sanitizeSettings } from "../src/core/sanitize.js";
import { textBlock } from "../src/core/transcript.js";

const saves = [];
const stops = [];
connect({ save: (parts) => saves.push(parts), endSession: (id) => stops.push(id) });

beforeEach(() => {
  hydrate({ ws: { ...defaultWorkspace(), groups: [], tabs: [], activeTab: null }, past: [], settings: sanitizeSettings(null) });
  saves.length = 0;
  stops.length = 0;
});

test("core imports no UI, no storage and nothing that runs commands", () => {
  const folder = new URL("../src/core/", import.meta.url);
  for (const name of fs.readdirSync(folder)) {
    const source = fs.readFileSync(new URL(name, folder), "utf8");
    for (const [, target] of source.matchAll(/from "([^"]+)"/g)) {
      assert.match(target, /^\.\/|^\.\.\/constants\.js$/, `${name} imports ${target}`);
    }
    assert.doesNotMatch(source, /\b(document|window|localStorage|termeedorHost)\b/, name);
  }
});

test("a commit asks for the workspace to be saved by default, and notifies", () => {
  let renders = 0;
  subscribe(() => { renders++; });
  commit();
  commit("settings");
  assert.deepEqual(saves, [["workspace"], ["settings"]]);
  assert.equal(renders, 2);
});

test("closing a tab ends its session, archives it and saves both parts", () => {
  const tab = addTab(addGroup().id);
  saves.length = 0;
  closeTab(tab);
  assert.deepEqual(stops, [tab.id]);
  assert.deepEqual(saves, [["workspace", "past"]]);
  assert.equal(state.past[0].name, tab.name);
});

test("closed tabs get distinct times, newest first, even in the same millisecond", () => {
  const group = addGroup(); // starts with a terminal of its own
  const first = state.ws.tabs.at(-1);
  const [a, b, c] = [addTab(group.id), addTab(group.id), addTab(group.id)];
  closeGroup(group);
  assert.deepEqual(state.past.map((p) => p.name), [first.name, a.name, b.name, c.name]);
  const times = state.past.map((p) => p.closedAt);
  assert.ok(times[0] > times[1] && times[1] > times[2]);
});

test("past sessions can be renamed, reopened and deleted", () => {
  const tab = addTab(addGroup().id);
  tab.draft = "typed";
  closeTab(tab);
  renameItem("past", state.past[0], "kept");
  assert.deepEqual(saves.at(-1), ["past"]);
  reopenLastClosed();
  assert.equal(state.ws.tabs.at(-1).name, "kept");
  assert.equal(state.ws.tabs.at(-1).draft, "typed");
  assert.equal(state.past.length, 0);

  closeTab(state.ws.tabs.at(-1));
  deletePast(state.past[0]);
  assert.equal(state.past.length, 0);
});

const layoutTab = { id: "t1", groupId: "g1", name: "tab" };
const layoutWith = (tabs) => ({ groups: [{ id: "g1", name: "Group" }], tabs });

test("a tab's layout and scrollback are read back together, old content included", () => {
  const { ws, recovered } = readSnapshot({
    workspace: layoutWith([layoutTab, { id: "t2", groupId: "g1", name: "old" }]),
    tabs: [{ id: "t1", blocks: [textBlock("hi")], draft: "d", cwd: "/x", history: ["ls"] }, { id: "t2", content: "❯ ls\nfile\n❯ typed" }],
  });
  assert.equal(recovered, false);
  assert.deepEqual(ws.tabs[0].blocks, [textBlock("hi")]);
  assert.equal(ws.tabs[0].cwd, "/x");
  assert.deepEqual(ws.tabs[0].history, ["ls"]);
  assert.equal(ws.tabs[1].draft, "typed");
});

test("a tab with no file still opens, just empty", () => {
  const { ws, recovered } = readSnapshot({ workspace: layoutWith([layoutTab]) });
  assert.deepEqual(ws.tabs[0].blocks, []);
  assert.equal(recovered, false);
});

test("tab files with no layout become past sessions, and empty ones just go", () => {
  const { ws, past, recovered } = readSnapshot({
    workspace: null,
    tabs: [{ id: "t1", blocks: [textBlock("precious")] }, { id: "t2", blocks: [] }],
    past: [{ id: "p1", name: "older", closedAt: 5, tab: {} }],
  });
  assert.equal(ws, null);
  assert.equal(recovered, true);
  assert.deepEqual(past.map((p) => p.id), ["t1", "p1"]);
  assert.equal(past[0].tab.blocks[0].output, "precious");
});

test("a recovery that stopped partway doesn't double up", () => {
  const body = { id: "t1", blocks: [textBlock("precious")] };
  const { past } = readSnapshot({ tabs: [body], past: [{ id: "t1", name: "Recovered tab", closedAt: 5, tab: body }] });
  assert.equal(past.length, 1);
});

test("past sessions load newest first, with ties kept in order but made distinct", () => {
  const entry = (id, closedAt) => ({ id, closedAt, tab: {} });
  const { past } = readSnapshot({ past: [entry("a", 5), entry("b", 9), entry("c", 5)] });
  assert.deepEqual(past.map((p) => p.id), ["b", "a", "c"]);
  assert.ok(past[1].closedAt > past[2].closedAt);
});

test("past sessions over the limit keep the newest", () => {
  const raw = Array.from({ length: LIMITS.past + 3 }, (_, i) => ({ id: `p${i}`, closedAt: i, tab: {} }));
  const { past } = readSnapshot({ past: raw });
  assert.equal(past.length, LIMITS.past);
  assert.equal(past[0].id, `p${LIMITS.past + 2}`);
});

test("a saved tab is capped with the usual trimming, and the tab itself isn't touched", () => {
  const block = { command: null, output: `${"old\n".repeat(LIMITS.content)}newest`, exit: null, cwd: null };
  const tab = { id: "t", blocks: [block], draft: "", cwd: "~", history: Array(LIMITS.history + 5).fill("ls") };
  const length = block.output.length;
  const file = tabFile(tab);
  assert.ok(file.blocks[0].output.length <= LIMITS.content);
  assert.ok(file.blocks[0].output.endsWith("newest"));
  assert.equal(file.history.length, LIMITS.history);
  assert.equal(block.output.length, length);
});

test("a new tab starts in the active tab's path when the setting is on", () => {
  state.settings.newTabInCurrentPath = true;
  addTab().cwd = "~/work/api";
  assert.equal(addTab().cwd, "~/work/api");
});

test("a new tab starts at home when the setting is off", () => {
  addTab().cwd = "~/work/api";
  assert.equal(addTab().cwd, "~");
});

test("the first tab starts at home even with the setting on", () => {
  state.settings.newTabInCurrentPath = true;
  assert.equal(addTab().cwd, "~");
});

test("the ask-before-closing-groups setting survives a reload and defaults to on", () => {
  assert.equal(sanitizeSettings({ confirmCloseGroup: false }).confirmCloseGroup, false);
  assert.equal(sanitizeSettings({ confirmCloseGroup: true }).confirmCloseGroup, true);
  assert.equal(sanitizeSettings(null).confirmCloseGroup, true);
});

test("closing a group asks only when the setting is on and the group has tabs", () => {
  const group = addGroup(); // comes with a tab
  assert.equal(shouldConfirmCloseGroup(group), true);
  state.settings.confirmCloseGroup = false;
  assert.equal(shouldConfirmCloseGroup(group), false);
  state.settings.confirmCloseGroup = true;
  state.ws.tabs = [];
  assert.equal(shouldConfirmCloseGroup(group), false);
});

test("clearing sessions removes every closed tab and saves", () => {
  closeGroup(addGroup());
  closeGroup(addGroup());
  assert.equal(state.past.length, 2);
  saves.length = 0;
  clearPast();
  assert.deepEqual(state.past, []);
  assert.ok(saves.flat().includes("past"));
});

test("the new-tab path setting survives a reload and defaults to off", () => {
  assert.equal(sanitizeSettings({ newTabInCurrentPath: true }).newTabInCurrentPath, true);
  assert.equal(sanitizeSettings({ newTabInCurrentPath: "yes" }).newTabInCurrentPath, false);
  assert.equal(sanitizeSettings(null).newTabInCurrentPath, false);
});

test("a new tab in another group takes the path of the tab that was active", () => {
  state.settings.newTabInCurrentPath = true;
  const other = addGroup();
  state.ws.tabs[0].cwd = "~/other";
  addGroup();
  state.ws.tabs[1].cwd = "~/current";
  assert.equal(addTab(other.id).cwd, "~/current");
});
