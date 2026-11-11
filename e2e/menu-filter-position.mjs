// Existing dev server, isolated API fixtures. A low anchor reproduces upward menu placement.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || "chrome" });
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const sessions = Array.from({ length: 12 }, (_, i) => {
  const cwd = `D:/workspace/project-${String(i).padStart(2, "0")}`;
  return { id: `menu-${i}`, cwd, path: "", projectRoot: cwd, projectKey: cwd,
    name: `Task ${i}`, firstMessage: "Fixture", messageCount: 1, created: "2026-11-01T00:00:00Z", modified: "2026-11-01T00:00:00Z" };
});
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 800 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const errors = [], writes = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  await context.route("**/api/**", async route => {
    const request = route.request(), url = new URL(request.url()), path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (path === "/api/sessions") return reply({ sessions, runningSessionIds: [], awaitingInputSessionIds: [] });
    if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: sessions.map(s => s.cwd) } });
    if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [] });
    if (path === "/api/models") return reply({ models: {}, modelList: [], defaultModel: null });
    if (path === "/api/home") return reply({ home: "C:/Users/test" });
    if (path === "/api/worktrees") {
      const cwd = url.searchParams.get("cwd");
      return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
    }
    if (path === "/api/cwd/validate") return reply({ valid: true, cwd: sessions[0].cwd });
    if (path === "/api/project-trust") return reply({ requiresTrust: false, trusted: true, mcpServers: [] });
    if (request.method() !== "GET") writes.push(path);
    return reply({});
  });
  await page.goto(`${base}/?cwd=${encodeURIComponent(sessions[0].cwd)}`, { waitUntil: "domcontentloaded" });
  const composer = page.locator("textarea.chat-input-textarea:visible");
  await composer.fill("Preserve the draft");
  const trigger = page.locator(".new-session-context .project-picker-button.is-project");
  await trigger.waitFor();
  // Keep production menu placement; move only its fixture anchor near the viewport bottom.
  await trigger.evaluate(el => Object.assign(el.style, { position: "fixed", bottom: "24px", left: "350px", width: "180px", zIndex: "300" }));
  await trigger.click();
  const input = page.locator(".sidebar-menu-filter-input");
  await input.waitFor();
  const original = await input.boundingBox();
  await input.fill("project-11");
  await page.getByRole("menuitemradio").filter({ hasText: "project-11" }).waitFor();
  await input.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.ok(Math.abs((await input.boundingBox()).y - original.y) < 1, "filtering leaves the field at its original height");
  await input.fill("");
  await page.waitForFunction(() => document.querySelectorAll('[role="menuitemradio"]').length >= 12);
  assert.ok(Math.abs((await input.boundingBox()).y - original.y) < 1, "clearing restores results without moving the field");
  await page.setViewportSize({ width: 1100, height: 600 });
  await input.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const menu = await page.locator(".sidebar-menu").boundingBox();
  assert.ok(menu.y >= 0 && menu.y + menu.height <= 601, "resizing still clamps the menu into the viewport");
  await page.keyboard.press("Escape");
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  assert.equal(await composer.inputValue(), "Preserve the draft");
  assert.deepEqual(errors, []);
  assert.deepEqual(writes, []);
  console.log("PASS: upward menu keeps its filter stable, resizes within viewport and preserves focus/draft without writes");
  await context.close();
} finally { await browser.close(); }
