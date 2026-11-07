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

  test(`${platform}: keeps editing, zoom, full screen and window keys`, () => {
    const roles = rolesIn(menuTemplate(isMac));
    for (const role of ["editMenu", "windowMenu", "zoomIn", "zoomOut", "resetZoom", "togglefullscreen", "toggleDevTools"]) {
      assert.ok(roles.includes(role), role);
    }
  });
}

test("only macOS has the app menu", () => {
  assert.ok(rolesIn(menuTemplate(true)).includes("appMenu"));
  assert.equal(rolesIn(menuTemplate(false)).includes("appMenu"), false);
});
