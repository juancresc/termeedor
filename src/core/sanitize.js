// Validation of everything read back from storage. Stored data is treated as untrusted:
// unknown fields are dropped and sizes are capped. No DOM or storage.

import { TAB_COLORS, LIMITS, SIDEBAR, FONT_SIZE, BUILTIN_THEMES } from "../constants.js";
import { uid } from "./uid.js";
import { sanitizeTranscript } from "../terminal/transcript.js";

// ---------- primitive validators ----------
const isObject = (v) => v !== null && typeof v === "object";
const text = (v, max, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
const safeId = (v) => (typeof v === "string" && /^[a-z0-9-]{1,20}$/i.test(v) ? v : uid());
const tabColor = (v) => (TAB_COLORS.includes(v) ? v : null);
const clamp = (v, min, max, fallback) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback);

/** Accepts only plain color values (hex, rgb[a], hsl[a]). */
export function cssColor(v) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return /^(#[0-9a-f]{3,8}|(rgb|hsl)a?\([\d\s.,%/]+\))$/i.test(s) ? s : null;
}

// ---------- domain validators ----------
function sanitizeTabBody(t) {
  return {
    color: tabColor(t.color),
    ...sanitizeTranscript(t), // also migrates tabs saved as one string
    cwd: text(t.cwd, LIMITS.cwd, "~"),
    history: Array.isArray(t.history) ? t.history.filter((h) => typeof h === "string").slice(-LIMITS.history) : [],
  };
}

export function sanitizeWorkspace(raw) {
  if (!isObject(raw) || !Array.isArray(raw.groups) || !Array.isArray(raw.tabs)) return null;

  const groups = raw.groups.slice(0, LIMITS.groups).filter(isObject).map((g) => ({
    id: safeId(g.id),
    name: text(g.name, LIMITS.name, "Group"),
    color: tabColor(g.color),
    collapsed: !!g.collapsed,
    minimized: !!g.minimized,
  }));

  const groupIds = new Set(groups.map((g) => g.id));
  const tabs = raw.tabs.slice(0, LIMITS.tabs)
    .filter((t) => isObject(t) && groupIds.has(t.groupId))
    .map((t) => ({ id: safeId(t.id), groupId: t.groupId, name: text(t.name, LIMITS.name, "shell"), collapsed: !!t.collapsed, minimized: !!t.minimized, ...sanitizeTabBody(t) }));

  return {
    groups,
    tabs,
    activeTab: text(raw.activeTab, 20, null),
    activeGroup: text(raw.activeGroup, 20, null),
    sidebarOpen: raw.sidebarOpen !== false,
    sidebarWidth: clamp(raw.sidebarWidth, SIDEBAR.min, SIDEBAR.max, SIDEBAR.default),
  };
}

export function sanitizePastEntry(raw) {
  if (!isObject(raw) || !isObject(raw.tab)) return null;
  return {
    id: safeId(raw.id),
    name: text(raw.name, LIMITS.name, "shell"),
    closedAt: clamp(raw.closedAt, 0, Number.MAX_SAFE_INTEGER, Date.now()),
    tab: sanitizeTabBody(raw.tab),
  };
}

function sanitizeCustomTheme(raw) {
  if (!isObject(raw) || !/^c-[a-z0-9]{1,12}$/.test(raw.id) || typeof raw.css !== "string") return null;
  const preview = Array.isArray(raw.preview) ? raw.preview : [];
  return {
    id: raw.id,
    name: text(raw.name, LIMITS.themeName, "Custom"),
    css: raw.css.slice(0, LIMITS.themeScopedCss),
    source: text(raw.source, LIMITS.themeCss, null), // as written by the user; null if imported before this was kept
    preview: [0, 1, 2].map((i) => cssColor(preview[i]) ?? "#888"),
  };
}

export function sanitizeSettings(raw) {
  const s = isObject(raw) ? raw : {};
  const customThemes = (Array.isArray(s.customThemes) ? s.customThemes : [])
    .slice(0, LIMITS.customThemes).map(sanitizeCustomTheme).filter(Boolean);
  const knownTheme = BUILTIN_THEMES.some((t) => t.id === s.theme) || customThemes.some((t) => t.id === s.theme);
  return {
    theme: knownTheme ? s.theme : "default",
    fontSize: clamp(s.fontSize, FONT_SIZE.min, FONT_SIZE.max, FONT_SIZE.default),
    lineNumbers: s.lineNumbers !== false,
    showAllGroups: s.showAllGroups === true, // second row: every group's tabs, not just the selected group's
    // color for new tabs: "none", "group" (use the group's color) or one of TAB_COLORS
    defaultTabColor: s.defaultTabColor === "group" || TAB_COLORS.includes(s.defaultTabColor) ? s.defaultTabColor : "none",
    customThemes,
    enabledPlugins: (Array.isArray(s.enabledPlugins) ? s.enabledPlugins : [])
      .filter((id) => typeof id === "string").slice(0, LIMITS.plugins),
  };
}
