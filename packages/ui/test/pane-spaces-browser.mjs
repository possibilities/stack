import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

export async function revealPane(page, title, id) {
  await page.getByRole("main", { name: `${title} panes`, exact: true }).getByRole("button", { name: /^Panes/ }).click();
  const catalog = page.getByRole("dialog", { name: `Panes in ${title}`, exact: true });
  await catalog.getByRole("combobox", { name: `Find a pane in ${title}` }).fill(id);
  await catalog.locator(`[role="option"][data-value^="${id} "]`).click();
  await page.locator(`[data-pane-frame="${id}"]`).waitFor({ state: "visible" });
}

export async function verifyPaneDraft(page, { title, id, field }) {
  const original = await field.inputValue(), retained = await field.elementHandle();
  await field.press("Home"); await field.press("Shift+ArrowRight");
  const selection = await field.evaluate((element) => [element.selectionStart, element.selectionEnd]);
  const host = page.getByRole("main", { name: `${title} panes`, exact: true });
  const presets = host.getByRole("group", { name: `${title} layout preset`, exact: true });
  const previous = await presets.locator('[aria-pressed="true"]').innerText();
  const verify = async () => {
    await revealPane(page, title, id);
    assert.equal(await field.inputValue(), original, "layout never changes an unsaved field");
    assert.equal(await field.evaluate((element, held) => element === held, retained), true, "the live editor is not replaced during layout");
    assert.deepEqual(await field.evaluate((element) => [element.selectionStart, element.selectionEnd]), selection, "the retained editor keeps its selection");
  };
  for (const name of await presets.getByRole("button").allTextContents()) {
    await presets.getByRole("button", { name, exact: true }).click();
    await verify();
  }
  await host.locator(`[data-window="${id}"]`).locator("header").first().getByRole("button", { name: /^Close / }).click();
  await field.waitFor({ state: "hidden" });
  await verify();
  const rail = page.getByRole("navigation", { name: "Canvas spaces" });
  await rail.getByRole("link", { name: "HUD", exact: true }).click();
  await rail.getByRole("link", { name: title, exact: true }).click();
  await verify();
  await presets.getByRole("button", { name: previous, exact: true }).click();
  await revealPane(page, title, id);
  await retained.dispose();
}

export async function verifyPaneSpaces(page, { evidence, spaces }) {
  const rail = page.getByRole("navigation", { name: "Canvas spaces" });
  const routes = await rail.getByRole("link").evaluateAll((links) => links.map((link) => ({ title: link.getAttribute("aria-label"), path: new URL(link.href).pathname })));
  assert.equal(routes.length, 15, "every Canvas space remains reachable");
  const selected = spaces === "all" ? routes : routes.filter(({ path }) => spaces.split(",").includes(path === "/" ? "hud" : path.slice(1)));
  assert.ok(selected.length, "the requested migration batch exists");
  const report = [];
  for (const { title, path } of selected) {
    const space = path === "/" ? "hud" : path.slice(1);
    await page.setViewportSize({ width: 1600, height: 1000 });
    await rail.getByRole("link", { name: title, exact: true }).click();
    const host = page.getByRole("main", { name: `${title} panes`, exact: true });
    await host.waitFor();
    assert.equal(await page.getByRole("button", { name: "Reset window positions (T)", exact: true }).count(), 0, "pane workspaces do not expose the removed camera controls");
    const presets = host.getByRole("group", { name: `${title} layout preset`, exact: true });
    const names = await presets.getByRole("button").allTextContents();
    assert.ok(names.length >= 2, `${title} offers alternate task layouts`);
    const catalog = page.getByRole("dialog", { name: `Panes in ${title}`, exact: true });
    const openCatalog = async () => { await host.getByRole("button", { name: /^Panes/ }).click(); await catalog.waitFor(); };
    const reveal = (id) => revealPane(page, title, id);
    const fits = () => page.waitForFunction((space) => {
      const host = document.querySelector(`[data-canvas][data-space="${space}"]`), bounds = host.getBoundingClientRect();
      return document.documentElement.scrollWidth <= innerWidth && [...host.querySelectorAll('[data-pane-frame]:not([hidden])')].every((pane) => {
        const r = pane.getBoundingClientRect();
        const header = pane.querySelector("[data-window] > header"), title = header?.querySelector("h2");
        return r.width > 0 && r.height > 0 && r.left >= bounds.left - 1 && r.top >= bounds.top - 1 && r.right <= bounds.right + 1 && r.bottom <= bounds.bottom + 1
          && (!header || header.scrollWidth <= header.clientWidth + 1) && (!title || title.scrollWidth <= title.clientWidth + 1);
      });
    }, space, { timeout: 2000 });
    for (const name of names) {
      await presets.getByRole("button", { name, exact: true }).click();
      assert.equal(await presets.getByRole("button", { name, exact: true }).getAttribute("aria-pressed"), "true");
      await fits();
      await page.screenshot({ path: join(evidence, `${space}-${name.toLowerCase().replaceAll(" ", "-")}.png`), animations: "disabled" });
    }
    await presets.getByRole("button", { name: names[0], exact: true }).click();
    await openCatalog();
    const ids = await catalog.getByRole("group", { name: "All available panes", exact: true }).getByRole("option").evaluateAll((options) => options.map((option) => option.getAttribute("data-value").split(" ")[0]));
    assert.ok(ids.length >= 2, `${title} keeps its catalog even when an owner is unavailable`);
    await page.keyboard.press("Escape");
    for (const id of ids) {
      await reveal(id);
      const frame = host.locator(`[data-pane-frame="${id}"]`);
      const body = frame.locator(`[data-window="${id}"]`), retained = await body.elementHandle();
      const close = body.locator("header").first().getByRole("button", { name: /^Close / });
      if (!await close.isDisabled()) {
        await close.click();
        await frame.waitFor({ state: "hidden" });
        await reveal(id);
        assert.equal(await body.evaluate((element, previous) => element === previous, retained), true, `${id} close/reopen retains its actual body`);
      }
      await retained.dispose();
    }
    await reveal(ids[0]);
    for (const id of ids.slice(1)) {
      await reveal(id);
      await host.locator(`[data-window="${id}"]`).locator("header").first().getByRole("button", { name: /^Close / }).click();
    }
    assert.equal(await host.locator('[data-pane-frame]:visible').count(), 1);
    assert.equal(await host.locator(`[data-window="${ids[0]}"]`).locator("header").first().getByRole("button", { name: /^Close / }).isDisabled(), true, `${title} keeps its last pane open`);
    await host.getByRole("button", { name: "Undo close", exact: true }).click();
    await page.locator(`[data-pane-frame="${ids.at(-1)}"]`).waitFor();
    await host.getByRole("button", { name: "Reset pane layout", exact: true }).click();
    for (const width of [420, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await reveal(ids[0]);
      await fits();
      await openCatalog();
      const bounds = await catalog.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width, `${title} catalog fits at ${width}px`);
      assert.ok(await catalog.evaluate((element) => element.scrollWidth <= element.clientWidth), `${title} catalog content fits at ${width}px`);
      await page.keyboard.press("Escape");
      await page.screenshot({ path: join(evidence, `${space}-${width}.png`), animations: "disabled" });
    }
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await fits();
    await page.screenshot({ path: join(evidence, `${space}-text-200.png`), animations: "disabled" });
    await page.evaluate(() => { document.documentElement.style.fontSize = ""; });
    report.push({ space, presets: names, panes: ids, catalogRecovery: "passed", lastPane: "passed", narrow: "passed" });
  }
  await page.setViewportSize({ width: 1600, height: 1000 });
  await writeFile(join(evidence, "pane-matrix.json"), JSON.stringify(report, null, 2));
}
