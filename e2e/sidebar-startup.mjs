// Check the actual server paint as well as hydrated reloads; no session writes.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ headless: true,
  channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
try {
  const initial = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 1600, height: 1000 } });
  const firstPaint = await initial.newPage();
  await firstPaint.goto(base, { waitUntil: "load", timeout: 120000 });
  const inlineFiles = firstPaint.locator(".session-sidebar > .sidebar-files-panel");
  assert.equal(await inlineFiles.count(), 1, "Exercise the inline server fallback before hydration");
  // Streaming Suspense reveals its server HTML with a tiny script. Reveal that
  // boundary manually while application scripts remain disabled.
  await firstPaint.locator(".workspace-shell").evaluate(shell => {
    for (let parent = shell.parentElement; parent; parent = parent.parentElement) parent.removeAttribute("hidden");
  });
  for (const width of [1600, 1200, 1199]) {
    await firstPaint.setViewportSize({ width, height: 1000 });
    assert.equal(await inlineFiles.isVisible(), width < 1200, "Only narrow layouts paint the inline files");
    assert.equal(await firstPaint.locator(".sidebar-files-resize-handle").isVisible(), width < 1200);
    if (width >= 1200) {
      const archive = await firstPaint.locator(".sidebar-archive-entry").boundingBox();
      const sidebar = await firstPaint.locator(".session-sidebar").boundingBox();
      assert.ok(sidebar.y + sidebar.height - archive.y - archive.height < 16, "Archive stays at the sidebar bottom on the first paint");
    }
  }
  await initial.close();

  for (const placement of ["below", "tab"]) {
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.addInitScript(placement => {
      localStorage.setItem("pi-locale", "zh-CN");
      localStorage.setItem("pi-web:sidebar-files-placement", placement);
      window.inlineFileFlashes = 0;
      const check = () => {
        const files = document.querySelector(".session-sidebar > .sidebar-files-panel");
        if (innerWidth >= 1200 && files?.getBoundingClientRect().height > 0 && getComputedStyle(files).display !== "none") window.inlineFileFlashes++;
        requestAnimationFrame(check);
      };
      requestAnimationFrame(check);
    }, placement);
    await page.route("**/api/**", async route => {
      const path = new URL(route.request().url()).pathname;
      let json = {};
      if (path === "/api/sessions") json = { sessions: [], runningSessionIds: [], awaitingInputSessionIds: [] };
      if (path === "/api/sessions/ui-state") json = { state: { version: 1, revision: 1, sessions: {}, projects: {} } };
      if (path === "/api/agent/running") json = { runningSessionIds: [], awaitingInputSessionIds: [] };
      if (path === "/api/models") json = { models: {}, modelList: [], defaultModel: null };
      if (path === "/api/home") json = { home: "C:/Users/test" };
      return route.fulfill({ json });
    });
    for (let reload = 0; reload < 3; reload++) {
      if (reload) await page.reload({ waitUntil: "domcontentloaded" });
      else await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.locator("#workbench-file-tree #session-sidebar-panel-files").waitFor({ state: "attached" });
      assert.equal(await page.evaluate(() => window.inlineFileFlashes), 0, "No frame shows the inline fallback during reload");
    }
    await page.locator(".workspace-files-toggle").filter({ visible: true }).first().click();
    await page.locator("#workbench-file-tree #session-sidebar-panel-files").waitFor();
    assert.equal(await page.locator("#session-sidebar-panel-files").count(), 1, "The right dock retains the single explorer");
    await page.setViewportSize({ width: 1199, height: 1000 });
    await page.locator(".session-sidebar > #session-sidebar-panel-files").waitFor({ state: "attached" });
    if (placement === "below") await page.locator(".session-sidebar > #session-sidebar-panel-files").waitFor();
    else await page.getByRole("tab", { name: "文件", exact: true }).waitFor();
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: server paint, breakpoint boundary, archive position, repeated reloads with both preferences, dock visibility and narrow layouts");
} finally {
  await browser.close();
}
