// The real page in a hidden Electron window: layout, CSS, focus, selection and real input
// events, which the stub DOM of the unit tests can't show. Browser build, so the mock shell.

import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, describe, test } from "node:test";
import { launch } from "./support/app.js";

let app;
before(async () => { app = await launch(); });
after(async () => { await app?.close(); });
beforeEach(async () => { await app.open(); });
afterEach(() => { assert.deepEqual(app.errors, [], "the page threw"); });

const rect = (selector) => app.evaluate((sel) => {
  const r = document.querySelector(sel).getBoundingClientRect();
  return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
}, selector);

const editorValue = () => app.evaluate(() => document.querySelector("#editor").value);
const focusedId = () => app.evaluate(() => document.activeElement?.id ?? "");
const tabNames = () => app.evaluate(() => [...document.querySelectorAll("#tabs .tab .name")].map((n) => n.textContent));
const activeTabName = () => app.evaluate(() => document.querySelector("#tabs .tab.active .name")?.textContent);

/** A new, empty tab from the tab bar's button. */
async function newTab() {
  const count = (await tabNames()).length;
  const { x, y } = await app.center("#newTabBtn");
  await app.click(x, y);
  await app.waitFor((n) => document.querySelectorAll("#tabs .tab").length === n && document.activeElement?.id === "editor", count + 1);
}

describe("prompt position", () => {
  test("on an empty tab the prompt is near the top", async () => {
    await newTab();
    const scroll = await rect("#termScroll");
    const input = await rect("#inputRow");
    assert.ok(input.height > 0);
    assert.ok(input.top - scroll.top < scroll.height * 0.25, `prompt at ${input.top - scroll.top}px of ${scroll.height}px`);
  });

  test("the prompt sits right after the last output", async () => {
    await newTab();
    await app.run("echo one");
    await app.run("help");
    const lastBlock = await rect("#output .block:last-child");
    const input = await rect("#inputRow");
    const scroll = await rect("#termScroll");
    assert.ok(Math.abs(input.top - lastBlock.bottom) <= 2, `gap of ${input.top - lastBlock.bottom}px`);
    assert.ok(input.bottom < scroll.bottom - 100, "the prompt went to the bottom of a mostly empty area");
  });

  test("the prompt scrolls with the output", async () => {
    await newTab();
    for (let i = 0; i < 4; i++) await app.run("help");
    const scroll = await rect("#termScroll");
    const pinned = await rect("#inputRow");
    assert.ok(await app.evaluate(() => document.querySelector("#termScroll").scrollTop > 0), "the output should overflow");
    assert.ok(pinned.bottom <= scroll.bottom + 1 && pinned.top >= scroll.top, "the prompt is in view at the bottom");

    await app.evaluate(() => { document.querySelector("#termScroll").scrollTop = 0; });
    await app.waitFor(() => document.querySelector("#termScroll").scrollTop === 0);
    const scrolled = await rect("#inputRow");
    assert.ok(scrolled.top > scroll.bottom, "scrolled up, the prompt should leave the view with the output");
  });
});

describe("focus", () => {
  test("typing goes to the input, even when nothing has focus", async () => {
    await app.type("ls");
    assert.equal(await editorValue(), "ls");
    await app.evaluate(() => document.activeElement.blur());
    await app.type(" -a");
    assert.equal(await editorValue(), "ls -a");
    assert.equal(await focusedId(), "editor");
  });

  test("a click on output focuses the input, and a drag keeps its selection", async () => {
    await app.run("echo hello world");
    await app.evaluate(() => document.activeElement.blur());
    assert.notEqual(await focusedId(), "editor");

    const line = await rect("#output .block:last-child .blockOutput");
    const y = (line.top + line.bottom) / 2;
    await app.click(line.left + 20, y);
    await app.waitFor(() => document.activeElement?.id === "editor");

    await app.drag({ x: line.left + 2, y }, { x: line.left + 60, y });
    const selected = await app.evaluate(() => getSelection().toString());
    assert.ok(selected.length > 3 && "hello world".startsWith(selected), `selected "${selected}"`);
  });
});

test("copying across blocks gives their text, line for line", async () => {
  await newTab();
  for (const word of ["one", "two", "three"]) await app.run(`echo ${word}`);
  const first = await rect("#output .block.isCommand .commandLine");
  const last = await rect("#output .block:last-child .blockOutput");
  await app.drag({ x: first.left + 1, y: first.top + 3 }, { x: last.right - 2, y: last.bottom - 3 });
  const text = await app.evaluate(() => getSelection().toString());
  assert.equal(text.replace(/\n$/, ""), "~ ❯ echo one\none\n~ ❯ echo two\ntwo\n~ ❯ echo three\nthree");
});

describe("running", () => {
  test("a command shows its block, hides the input while it runs, and Up recalls it", async () => {
    await newTab();
    await app.type("sleep 0.3");
    await app.press("Enter");
    await app.waitFor(() => document.querySelector("#inputRow").getBoundingClientRect().height === 0);
    assert.equal(await app.evaluate(() => document.querySelector("#output .block:last-child .commandText")?.textContent), "sleep 0.3");
    assert.equal(await focusedId(), "editor", "the hidden input keeps focus");

    await app.waitFor(() => document.querySelector("#inputRow").getBoundingClientRect().height > 0);
    assert.equal(await editorValue(), "");
    await app.press("ArrowUp");
    assert.equal(await editorValue(), "sleep 0.3");
  });

  test("Shift+Enter adds a line and grows the input", async () => {
    const before = await rect("#editor");
    await app.type("echo a");
    await app.press("Enter", { shift: true });
    await app.type("echo b");
    assert.equal(await editorValue(), "echo a\necho b");
    const grown = await rect("#editor");
    assert.ok(grown.height > before.height * 1.6, `${before.height}px became ${grown.height}px`);
    assert.equal(await app.evaluate(() => document.querySelectorAll("#output .block.isCommand").length), 0, "nothing ran");
  });
});

describe("tabs and sidebar", () => {
  test("new tab, switch and close", async () => {
    const names = await tabNames();
    await newTab();
    const added = await activeTabName();
    assert.equal((await tabNames()).length, names.length + 1);
    await app.run("echo only here");

    const first = await app.center("#tabs .tab .name");
    await app.click(first.x, first.y);
    await app.waitFor((name) => document.querySelector("#tabs .tab.active .name")?.textContent === name, names[0]);
    assert.ok(!(await app.evaluate(() => document.querySelector("#output").textContent.includes("only here"))));

    const item = await app.waitFor((name) => [...document.querySelectorAll("#groups .item")].some((n) => n.textContent.includes(name)), added);
    assert.ok(item, "the new tab is in the sidebar");
    const sidebarItem = await app.evaluate((name) => {
      const node = [...document.querySelectorAll("#groups .item .iname")].find((n) => n.textContent === name);
      const r = node.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    }, added);
    await app.click(sidebarItem.x, sidebarItem.y);
    await app.waitFor(() => document.querySelector("#output").textContent.includes("only here"));

    const close = await app.center("#tabs .tab.active .closeBtn");
    await app.click(close.x, close.y);
    await app.waitFor((n) => document.querySelectorAll("#tabs .tab").length === n, names.length);
    assert.ok(!(await tabNames()).includes(added));
  });

  test("dragging reorders tabs and groups, and the move arrows can be turned off for wider names", async () => {
    await newTab();
    const groupNames = () => app.evaluate(() => [...document.querySelectorAll("#groupTabs .chipName")].map((n) => n.textContent));
    /** Drags `from` to the point `at` (0 to 1) along `to`. */
    const dragOnto = (from, to, at) => app.evaluate((from, to, at) => {
      const box = document.querySelector(to).getBoundingClientRect();
      const init = { bubbles: true, cancelable: true, dataTransfer: new DataTransfer(), clientX: box.left + box.width * at, clientY: box.top + 5 };
      document.querySelector(from).dispatchEvent(new DragEvent("dragstart", init));
      document.querySelector(to).dispatchEvent(new DragEvent("dragover", init));
      document.querySelector(to).dispatchEvent(new DragEvent("drop", init));
      document.body.dispatchEvent(new DragEvent("dragend", init));
    }, from, to, at);

    const [first, second, third] = await tabNames();
    await dragOnto("#tabs .tab:nth-child(1)", "#tabs .tab:nth-child(3)", 0.9);
    assert.deepEqual(await tabNames(), [second, third, first]);
    await dragOnto("#tabs .tab:nth-child(3)", "#tabs .tab:nth-child(2)", 0.1);
    assert.deepEqual(await tabNames(), [second, first, third]);

    const groups = await groupNames();
    await dragOnto("#groupTabs .groupTab:nth-child(2)", "#groupTabs .groupTab:nth-child(1)", 0.1);
    assert.deepEqual(await groupNames(), [groups[1], groups[0]]);

    const nameWidth = () => app.evaluate(() => document.querySelector("#tabs .tab.active .name").getBoundingClientRect().width);
    const before = await nameWidth();
    await app.click(...Object.values(await app.center("#settingsBtn")));
    await app.waitFor(() => document.querySelector("#settings").open);
    await app.evaluate(() => { [...document.querySelectorAll("#settingsTopics button")].find((b) => b.textContent === "Tabs").click(); });
    await app.click(...Object.values(await app.center("#moveButtons")));
    assert.equal(await app.evaluate(() => document.querySelectorAll('#tabs [aria-label^="Move"], #groupTabs [aria-label^="Move"]').length), 0);
    assert.ok(await nameWidth() > before + 30, "the name got the arrows' room");
  });

  test("a rename keeps what was typed across a re-render", async () => {
    const tab = await app.center("#tabs .tab.active .name");
    await app.click(tab.x, tab.y, 2);
    await app.waitFor(() => document.activeElement?.classList.contains("inlineInput"));
    await app.press("Backspace"); // the name starts selected
    await app.type("renamed");
    await app.evaluate(async () => (await import("/src/store.js")).commit());
    assert.equal(await app.evaluate(() => document.activeElement?.value), "renamed");
    await app.press("Enter");
    await app.waitFor(() => document.querySelector("#tabs .tab.active .name")?.textContent === "renamed");
    assert.equal(await focusedId(), "editor");
  });

  test("a long new name shows from its start", async () => {
    const tab = await app.center("#tabs .tab.active .name");
    await app.click(tab.x, tab.y, 2);
    await app.waitFor(() => document.activeElement?.classList.contains("inlineInput"));
    await app.type("docker something");
    const box = await app.evaluate(() => {
      const input = document.activeElement.getBoundingClientRect();
      const label = document.activeElement.parentNode.getBoundingClientRect();
      return { overflow: input.right - label.right, scroll: document.activeElement.parentNode.scrollLeft };
    });
    assert.ok(box.overflow <= 0, "the text box fits in the name's room");
    assert.equal(box.scroll, 0);
    await app.press("Enter");
    await app.waitFor(() => document.querySelector("#tabs .tab.active .name")?.textContent === "docker something");
    assert.equal(await app.evaluate(() => document.querySelector("#tabs .tab.active .name").scrollLeft), 0, "not scrolled past its first letters");
  });
});

test("the light theme applies", async () => {
  const dark = await app.evaluate(() => getComputedStyle(document.querySelector(".main")).backgroundColor);
  const settings = await app.center("#settingsBtn");
  await app.click(settings.x, settings.y);
  await app.waitFor(() => document.querySelector("#settings").open);
  const light = await app.evaluate(() => {
    const card = [...document.querySelectorAll("#themes .themeCard")].find((c) => /light/i.test(c.textContent));
    const r = card.querySelector(".themePick").getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await app.click(light.x, light.y);
  await app.waitFor(() => document.documentElement.dataset.theme === "light");
  const background = await app.evaluate(() => getComputedStyle(document.querySelector(".main")).backgroundColor);
  const [r, g, b] = background.match(/\d+/g).map(Number);
  assert.notEqual(background, dark);
  assert.ok((r + g + b) / 3 > 180, `the terminal background is ${background}`);
});

test("the status bar + and − change the text size and keep focus", async () => {
  const size = () => app.evaluate(() => getComputedStyle(document.querySelector(".output")).fontSize);
  const before = parseFloat(await size());
  const plus = await app.center("#zoomIn");
  await app.click(plus.x, plus.y);
  await app.waitFor(() => document.documentElement.style.getPropertyValue("--font-size") !== "");
  assert.equal(parseFloat(await size()), before + 1);
  const minus = await app.center("#zoomOut");
  await app.click(minus.x, minus.y);
  await app.click(minus.x, minus.y);
  assert.equal(parseFloat(await size()), before - 1);
  assert.equal(await app.evaluate(() => document.activeElement?.id), "editor");
});

test("no horizontal scroll at a narrow width", async () => {
  await app.setSize(640, 500);
  await app.waitFor(() => innerWidth === 640);
  await app.run(`echo ${"x".repeat(300)} ${"y".repeat(40)}`);
  const widths = await app.evaluate(() => ({
    page: [document.documentElement.scrollWidth, document.documentElement.clientWidth],
    terminal: [document.querySelector("#termScroll").scrollWidth, document.querySelector("#termScroll").clientWidth],
  }));
  assert.ok(widths.page[0] <= widths.page[1], `page ${widths.page}`);
  assert.ok(widths.terminal[0] <= widths.terminal[1], `terminal ${widths.terminal}`);
});
