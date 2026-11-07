// The closed-tabs list against a stub DOM: its "5m ago" keeps time by itself, so that nothing
// the user does, like pressing Enter, is what makes it change.

import assert from "node:assert/strict";
import { mock, test } from "node:test";

import { nodeFor } from "./support/editorDom.js";

mock.timers.enable({ apis: ["setInterval", "Date"], now: 1_000_000 });

const { initSidebar, renderSidebar } = await import("../src/sidebar.js");
const { state } = await import("../src/store.js");

const closedTab = () => ({
  id: "closed", name: "shell", closedAt: Date.now(),
  tab: { color: null, blocks: [], draft: "", cwd: "~", history: [] },
});

test("a closed tab's time changes as soon as the minute is up, with no redraw", () => {
  initSidebar();
  mock.timers.tick(30_000); // tabs close at any moment, not when a timer happens to start
  state.past = [closedTab()];
  renderSidebar();
  const shown = () => nodeFor("pastSessions").textContent;
  assert.match(shown(), /just now/);

  mock.timers.tick(59_000);
  assert.match(shown(), /just now/);

  mock.timers.tick(1_000);
  assert.match(shown(), /1m ago/);

  renderSidebar(); // what pressing Enter does
  assert.match(shown(), /1m ago/);
});

test("a tab's spinner comes and goes without rebuilding its row", async () => {
  const { refreshSidebarRuns } = await import("../src/sidebar.js");
  const { runs } = await import("../src/terminal/runState.js");
  renderSidebar();
  const row = nodeFor("groups").allWithClass("item")[0];
  const id = state.ws.tabs[0].id;
  const spinners = () => row.allWithClass("spinner").length;
  assert.equal(spinners(), 0);

  runs.start(id);
  refreshSidebarRuns();
  assert.equal(spinners(), 1);

  runs.finish(id);
  refreshSidebarRuns();
  assert.equal(spinners(), 0);
  assert.equal(nodeFor("groups").allWithClass("item")[0], row);
});
