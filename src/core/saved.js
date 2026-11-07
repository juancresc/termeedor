// What is saved, and how it maps to state. Layout and scrollback are separate so that a change
// to one tab touches one file. No DOM or storage.
//
// A snapshot is what a persistence adapter loads (see ports/persistence.js). It is untrusted.

import { LIMITS } from "../constants.js";
import { copyBlocks, trimTranscript } from "../terminal/transcript.js";
import { sanitizePastEntry, sanitizeSettings, sanitizeWorkspace } from "./sanitize.js";

const isObject = (v) => v !== null && typeof v === "object";

// ---------- state to files ----------
const tabLayout = ({ id, groupId, name, color, collapsed, minimized }) => ({ id, groupId, name, color, collapsed, minimized });

/** workspace.json: everything but scrollback. */
export const layoutOf = ({ groups, tabs, activeTab, activeGroup, sidebarOpen, sidebarWidth }) => ({
  groups, tabs: tabs.map(tabLayout), activeTab, activeGroup, sidebarOpen, sidebarWidth,
});

/** Trims a copy: a running command's block is still being written to. */
function savedBody(tab) {
  const transcript = { blocks: copyBlocks(tab.blocks), draft: tab.draft };
  trimTranscript(transcript);
  return { ...transcript, history: tab.history.slice(-LIMITS.history), cwd: tab.cwd };
}

export const tabFile = (tab) => ({ id: tab.id, ...savedBody(tab) });
export const pastFile = (entry) => ({ ...entry, tab: { color: entry.tab.color, ...savedBody(entry.tab) } });

/** Every file, for when nothing has been written yet. */
export const allChanges = ({ ws, past, settings }) => ({
  settings,
  ...(ws ? { workspace: layoutOf(ws) } : {}),
  tabs: ws ? ws.tabs.map(tabFile) : [],
  past: past.map(pastFile),
  removeTabs: [],
  removePast: [],
});

// ---------- fingerprints ----------
// The editor and plugins change tabs in place, so nothing marks a tab as changed: a tab is compared
// with what was last saved. These are flat lists of values holding the same strings as the tab,
// and comparing a string with itself takes no time, so this stays cheap at any scrollback size.
const bodyPrint = (tab) => [
  tab.draft, tab.cwd, ...tab.history,
  ...tab.blocks.flatMap((block) => [block.command, block.output, block.exit, block.cwd]),
];
export const tabPrint = bodyPrint;
export const pastPrint = (entry) => [
  entry.name, entry.closedAt, entry.tab.color, ...bodyPrint(entry.tab),
];
export const samePrint = (a, b) => !!a && a.length === b.length && a.every((value, i) => value === b[i]);

// ---------- files to state ----------
/** Newest first. Past files have no list to keep their order in, so times must be unique. */
function orderPast(entries) {
  const sorted = [...entries].sort((a, b) => b.closedAt - a.closedAt);
  sorted.forEach((entry, i) => {
    if (i && entry.closedAt >= sorted[i - 1].closedAt) entry.closedAt = sorted[i - 1].closedAt - 1;
  });
  return sorted;
}

function readWorkspace(workspace, bodies) {
  if (!isObject(workspace) || !Array.isArray(workspace.tabs)) return null;
  const tabs = workspace.tabs.map((tab) => (isObject(tab) ? { ...tab, ...bodies.get(tab.id) } : tab));
  return sanitizeWorkspace({ ...workspace, tabs });
}

/**
 * A tab file no layout mentions is scrollback we would otherwise lose: the layout was unreadable,
 * or a save stopped partway. It becomes a past session. Reading it twice gives the same entry.
 */
function recoverOrphans(bodies, ws) {
  const open = new Set(ws?.tabs.map((tab) => tab.id));
  const orphans = [...bodies.values()].filter((body) => !open.has(body.id)).map((body) => sanitizePastEntry({
    id: body.id, name: "Recovered tab", closedAt: Date.now(), tab: body,
  }));
  return orphans.filter((entry) => entry.tab.blocks.length || entry.tab.draft);
}

/** `ws` is null when no usable workspace was saved. `recovered` means tab files were found with no tab. */
export function readSnapshot({ settings = null, workspace = null, tabs = [], past = [] }) {
  const bodies = new Map(tabs.filter(isObject).map((body) => [body.id, body]));
  const ws = readWorkspace(workspace, bodies);
  const saved = past.map((entry) => sanitizePastEntry(entry)).filter(Boolean);
  const known = new Set(saved.map((entry) => entry.id));
  const orphans = recoverOrphans(bodies, ws).filter((entry) => !known.has(entry.id));
  return {
    ws,
    past: orderPast([...saved, ...orphans]).slice(0, LIMITS.past),
    settings: sanitizeSettings(settings),
    recovered: bodies.size > (ws?.tabs.filter((tab) => bodies.has(tab.id)).length ?? 0),
  };
}

/** Which files a loaded snapshot found, so the saver knows what it may later replace or remove. */
export const filesIn = ({ settings, workspace, tabs = [], past = [] }) => ({
  settings: !!settings,
  workspace: !!workspace,
  tabs: tabs.map((tab) => tab.id),
  past: past.map((entry) => entry.id),
});
