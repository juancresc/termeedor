// The search box in the settings dialog: hides what doesn't match, without touching what is rendered.

const ITEMS = ".setRow, .themeCard, .themeActions, .setGroup > .hint";

/** Items match on their text, data-keywords and group name. Returns how many are left showing. */
export function filterSettings(root, query) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  let shown = 0;
  for (const group of root.querySelectorAll(".setGroup")) {
    const title = group.querySelector("h4").textContent;
    let shownInGroup = 0;
    for (const item of group.querySelectorAll(ITEMS)) {
      const text = `${title} ${item.textContent} ${item.dataset.keywords ?? ""}`.toLowerCase();
      const matches = terms.every((term) => text.includes(term));
      item.classList.toggle("searchHidden", !matches);
      if (matches) shownInGroup++;
    }
    group.classList.toggle("searchHidden", shownInGroup === 0);
    shown += shownInGroup;
  }
  return shown;
}

/** Applies what's in the search box. Needed again whenever settings content is rendered. */
export function applySettingsSearch() {
  const shown = filterSettings(document.getElementById("settingsBody"), document.getElementById("settingsSearch").value);
  document.getElementById("settingsNoMatch").hidden = shown > 0;
}
