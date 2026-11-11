// The topic list and search box in the settings dialog: hide what isn't asked for, without touching what is rendered.

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
    for (const sub of group.querySelectorAll(".setSub")) {
      sub.classList.toggle("searchHidden", !sub.querySelector(`:is(${ITEMS}):not(.searchHidden)`));
    }
    group.classList.toggle("searchHidden", shownInGroup === 0);
    shown += shownInGroup;
  }
  return shown;
}

/** Where the search words appear in a text, as [start, end] pairs. */
export function matchRanges(text, query) {
  const terms = query.split(/\s+/).filter(Boolean).map((term) => term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (!terms.length) return [];
  return [...text.matchAll(new RegExp(terms.join("|"), "gi"))].map((m) => [m.index, m.index + m[0].length]);
}

/** Tints the matches, styled by ::highlight(settingsMatch), without changing the page's elements. */
function highlightMatches(root, query) {
  const ranges = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    for (const [start, end] of matchRanges(walker.currentNode.data, query)) {
      const range = new Range();
      range.setStart(walker.currentNode, start);
      range.setEnd(walker.currentNode, end);
      ranges.push(range);
    }
  }
  CSS.highlights.set("settingsMatch", new Highlight(...ranges));
}

/** Shows only the chosen topic. A search looks through all of them, so it shows them all. */
export function showTopic(root, topic, searching) {
  for (const group of root.querySelectorAll(".setGroup")) {
    group.classList.toggle("topicHidden", !searching && group.querySelector("h4").textContent !== topic);
  }
}

let topic = null;

/** Lists the sections of the dialog as topics, and starts on the first. */
export function initSettingsTopics() {
  const body = document.getElementById("settingsBody");
  const buttons = [...body.querySelectorAll(".setGroup")].map((group) => {
    const title = group.querySelector("h4").textContent;
    const button = document.createElement("button");
    button.textContent = title;
    button.onclick = () => {
      topic = title;
      document.getElementById("settingsSearch").value = "";
      applySettingsSearch();
      body.scrollTop = 0;
    };
    return button;
  });
  topic = buttons[0].textContent;
  document.getElementById("settingsTopics").replaceChildren(...buttons);
}

/** Applies the topic and what's in the search box. Needed again whenever settings content is rendered. */
export function applySettingsSearch() {
  const body = document.getElementById("settingsBody");
  const query = document.getElementById("settingsSearch").value;
  const searching = query.trim() !== "";
  const shown = filterSettings(body, query);
  showTopic(body, topic, searching);
  highlightMatches(body, query);
  document.getElementById("settingsNoMatch").hidden = shown > 0;

  const groups = [...body.querySelectorAll(".setGroup")];
  for (const [index, button] of [...document.getElementById("settingsTopics").children].entries()) {
    button.classList.toggle("on", !searching && button.textContent === topic);
    button.classList.toggle("searchHidden", groups[index].classList.contains("searchHidden")); // topics with no match
  }
}
