import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { test } from "node:test";

const { menuTemplate } = createRequire(import.meta.url)("../electron/menu.cjs");

const rolesIn = (items) => items.flatMap((item) => [item.role, ...rolesIn(item.submenu ?? [])]).filter(Boolean);

for (const [platform, isMac] of [["macOS", true], ["Windows and Linux", false]]) {
  test(`${platform}: no menu item reloads the page, so Cmd/Ctrl+R can't wipe the app`, () => {
    const roles = rolesIn(menuTemplate(isMac));
    assert.equal(roles.includes("reload"), false);
    assert.equal(roles.includes("forceReload"), false);
    assert.equal(roles.includes("viewMenu"), false); // this built-in menu includes both
  });

  test(`${platform}: keeps editing, full screen and window keys`, () => {
    const roles = rolesIn(menuTemplate(isMac));
    for (const role of ["editMenu", isMac ? "windowMenu" : "minimize", "close", "resetZoom", "togglefullscreen", "toggleDevTools"]) {
      assert.ok(roles.includes(role), role);
    }
  });

  test(`${platform}: no page zoom, so Cmd/Ctrl +/− change the text size within its limits`, () => {
    const roles = rolesIn(menuTemplate(isMac));
    for (const role of ["zoomIn", "zoomOut"]) assert.equal(roles.includes(role), false, role);
  });
}

for (const [platform, isMac] of [["macOS", true], ["Windows and Linux", false]]) {
  test(`${platform}: closing the window takes Shift, so Cmd/Ctrl+W in a dialog can't end every shell`, () => {
    const items = (list) => list.flatMap((item) => [item, ...items(item.submenu ?? [])]);
    const all = items(menuTemplate(isMac));
    // the built-in menus whose Close has Cmd/Ctrl+W: macOS's File, and the Window menu elsewhere
    assert.equal(all.some((item) => item.role === (isMac ? "fileMenu" : "windowMenu")), false);
    for (const item of all.filter((i) => i.role === "close")) assert.match(item.accelerator, /^Shift\+/);
  });
}

test("only macOS has the app menu", () => {
  assert.ok(rolesIn(menuTemplate(true)).includes("appMenu"));
  assert.equal(rolesIn(menuTemplate(false)).includes("appMenu"), false);
});
