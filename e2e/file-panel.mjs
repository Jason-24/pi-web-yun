import assert from "node:assert/strict";
import { showSidebarFiles } from "./sidebar.mjs";

// Keep width changes from applying Chrome's automatic scroll anchoring: this
// fixture checks retained iframe state, including its explicit scroll position.
export const filePanelFixture = `<!doctype html><html><body style="margin:20px;min-height:2400px;overflow-anchor:none">
<label>Notes <input id="notes"></label>
<label>Filter <select id="filter"><option>All</option><option>Pending</option></select></label>
<p>HTML preview state must survive layout changes.</p>
<script>window.previewInstance = Math.random();</script></body></html>`;

export async function checkFilePanel(page, filePath) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  if (page.viewportSize().width >= 1200) {
    const files = page.locator(".workspace-files-toggle").filter({ visible: true }).first();
    if (await files.getAttribute("aria-expanded") !== "true") await files.click();
  } else {
    await showSidebarFiles(page);
  }
  // The DOM title normalizes Windows paths to forward slashes
  // (lib/file-paths.ts normalizeFilePathSlashes), so match in that form.
  await page.getByTitle(filePath.replace(/\\/g, "/"), { exact: true }).click();
  const panel = page.locator("#file-panel");
  const iframe = panel.locator("iframe");
  await iframe.waitFor();
  const frame = await (await iframe.elementHandle()).contentFrame();
  await frame.locator("#notes").fill("Keep this note");
  await frame.locator("#filter").selectOption({ label: "Pending" });
  await frame.evaluate(() => scrollTo(0, 120));
  const instance = await frame.evaluate(() => window.previewInstance);
  const width = () => panel.evaluate(async el => {
    await new Promise(requestAnimationFrame);
    await Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {})));
    return el.getBoundingClientRect().width;
  });
  const storedWidths = () => page.evaluate(() => [
    localStorage.getItem("pi-sidebar-width"), localStorage.getItem("pi-right-panel-width"),
  ]);
  const toggle = panel.getByRole("button", { name: "Expand file reading", exact: true });
  if (page.viewportSize().width < 1200) {
    assert.equal(await toggle.isVisible(), false, "Narrow layouts keep their existing file view");
  } else {
    // Include a manually resized split in the round trip.
    const separator = page.locator('[data-resize-handle="right-panel"]');
    if (await separator.isVisible()) await separator.press("ArrowLeft");
    const originalWidth = await width();
    const originalStored = await storedWidths();
    for (let i = 0; i < 2; i++) {
      await toggle.click();
      assert.equal(await panel.getByRole("button", { name: "Restore file panel width", exact: true }).getAttribute("aria-pressed"), "true");
      const expandedWidth = await width();
      assert.equal(Math.round(expandedWidth), Math.round((await page.locator(".workspace-main").boundingBox()).width));
      assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), false);
      assert.equal(await page.locator("#workspace-conversation-content").evaluate(el => el.inert), true);
      await page.locator(".workspace-context-tab").click();
      assert.equal(await page.locator("#workspace-conversation-content").evaluate(el => el.inert), false);
      await panel.getByRole("tab", { name: filePath.split(/[\\/]/).pop(), exact: true }).click();
      assert.equal(await frame.evaluate(() => window.previewInstance), instance);
      assert.equal(await frame.evaluate(() => scrollY), 120);
      assert.equal(await frame.locator("#notes").inputValue(), "Keep this note");
      assert.equal(await frame.locator("#filter").inputValue(), "Pending");
      await panel.getByRole("button", { name: "Restore file panel width", exact: true }).press("Enter");
      assert.equal(await width(), originalWidth);
      assert.deepEqual(await storedWidths(), originalStored);
      assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), false);
    }
    await toggle.click();
    await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
    await page.getByRole("button", { name: "Show file panel", exact: true }).click();
    assert.equal(await toggle.getAttribute("aria-pressed"), "false", "Reopening returns to the split layout");
    assert.equal(await width(), originalWidth);
    assert.equal(await frame.evaluate(() => window.previewInstance), instance);
  }
  await panel.getByRole("button", { name: "Hide file panel", exact: true }).click();
  console.log(`PASS: file panel width and preview state at ${page.viewportSize().width}px`);
}
