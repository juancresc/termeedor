// App-wide constants. Change limits and defaults here.

export const PROMPT = "❯ ";

// Optional tab/group colors. Stored as tokens; each theme defines the actual shade
// (--c1 … --c8 in themes/*.css), so colors always match the current theme.
// null = no color: the item just uses the theme's normal colors (the default).
export const TAB_COLORS = ["c1", "c2", "c3", "c4", "c5", "c6", "c7", "c8"];
export const colorVar = (token) => (token ? `var(--${token})` : null);

export const STORAGE_KEYS = {
  workspace: "termeedor.workspace.v2", // groups, open tabs, layout
  past: "termeedor.past.v2",           // closed tabs ("Past sessions")
  settings: "termeedor.settings.v2",   // theme, font size, imported themes
};

export const LIMITS = {
  name: 60,
  groups: 100,
  tabs: 500,
  past: 200,
  content: 500_000,
  history: 200,
  cwd: 200,
  themeName: 40,
  themeCss: 100_000,
  themeScopedCss: 300_000, // the same CSS after every selector is scoped to its theme
  customThemes: 30,
  plugins: 200,
  pluginStorage: 500_000, // characters of JSON per api.storage key
};

export const SIDEBAR = { default: 240, min: 160, max: 520, collapseBelow: 110 };
export const FONT_SIZE = { default: 13, min: 10, max: 20 };

// preview = [panel, terminal background, accent] for the small theme card
export const BUILTIN_THEMES = [
  { id: "default", name: "Default", preview: ["#151821", "#0b0d12", "#6aa8ff"] },
  { id: "dark", name: "Dark", preview: ["#0c0c0c", "#000000", "#e6e6e6"] },
  { id: "light", name: "Light", preview: ["#ebedf0", "#ffffff", "#2563eb"] },
  { id: "paper", name: "Paper", preview: ["#e8e1d1", "#fbf7ee", "#b5651d"] },
  { id: "ocean", name: "Ocean", preview: ["#0f2232", "#081520", "#4fd1c5"] },
  { id: "forest", name: "Forest", preview: ["#16211a", "#0d1510", "#8bd17c"] },
  { id: "dusk", name: "Dusk", preview: ["#211a2e", "#150f1e", "#f0a6ca"] },
  { id: "contrast", name: "Contrast", preview: ["#000000", "#000000", "#ffea00"] },
];
