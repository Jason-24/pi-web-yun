// Existing dev server; API fixtures keep the real session catalog untouched.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/home-recents");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
const page = await context.newPage();
const cwd = "D:/workspace/recent-tasks";
const sessions = Array.from({ length: 17 }, (_, i) => ({
  id: `home-recent-${i}`, path: "", cwd, projectRoot: cwd, projectKey: cwd,
  name: `最近任务 ${String(i + 1).padStart(2, "0")}`, firstMessage: "测试最近任务", messageCount: 1,
  created: "2026-10-29T00:00:00Z", modified: new Date(Date.UTC(2026, 9, 29, 12, 0, 0) - i * 60000).toISOString(),
}));
let catalog = sessions;
const errors = [];
const commands = [];
page.on("pageerror", error => errors.push(error.message));
await context.route("**/api/**", async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const reply = json => route.fulfill({ json });
  if (path === "/api/sessions") return reply({ sessions: catalog, sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
  if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
  if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
  if (path === "/api/models") return reply({ models: [], modelList: [], defaultModel: null });
  if (path === "/api/home") return reply({ home: "C:/Users/test" });
  if (path === "/api/web-auth") return reply({ enabled: false });
  if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
  if (path === "/api/project-trust") return reply({ cwd, requiresTrust: false, trusted: true, mcpServers: [] });
  if (path === "/api/app-update") return reply({ latestVersion: "0.2.3" });
  if (path.startsWith("/api/sessions/")) {
    const session = sessions.find(item => path === `/api/sessions/${item.id}`);
    if (session) return reply({ sessionId: session.id, info: session, tree: [], leafId: null,
      context: { messages: [], entryIds: [], hasMore: false, model: null, thinkingLevel: "off" } });
  }
  if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
  if (path.startsWith("/api/agent/") && request.method() === "POST") {
    commands.push(request.postDataJSON()?.type);
    return reply({ success: true, data: {} });
  }
  return reply({});
});

try {
  await page.goto(`${base}/?home=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const home = page.locator(".home-view");
  await home.locator(".home-session").first().waitFor();
  assert.equal(await home.locator(".home-session").count(), 8);
  assert.deepEqual(await home.locator(".home-session-title").allTextContents(), sessions.slice(0, 8).map(item => item.name));

  const toggle = page.locator(".session-tree-recents-toggle");
  await toggle.scrollIntoViewIfNeeded();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.equal(await toggle.evaluate(el => el.firstElementChild.tagName.toLowerCase()), "svg");
  await toggle.hover();
  assert.notEqual(await toggle.evaluate(el => getComputedStyle(el).backgroundColor), "rgba(0, 0, 0, 0)");
  await toggle.click({ position: { x: 200, y: 12 } });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:sidebar-recents-collapsed")), "true");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".session-tree-recents-toggle")?.getAttribute("aria-expanded") === "false");
  await toggle.press("Enter");
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  await toggle.press("Space");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.press("Enter");
  await page.screenshot({ path: resolve(artifacts, "desktop.png") });

  const more = home.getByRole("button", { name: "查看更多", exact: true });
  await more.press("Enter");
  assert.equal(await home.locator(".home-session").count(), 16);
  await more.press("Space");
  assert.equal(await home.locator(".home-session").count(), 17);
  const less = home.getByRole("button", { name: "收起", exact: true });
  assert.equal(await less.evaluate(el => el === document.activeElement), true);
  await less.press("Enter");
  assert.equal(await home.locator(".home-session").count(), 8);
  assert.equal(await more.evaluate(el => el === document.activeElement), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await more.click();
  assert.equal(await home.locator(".home-session").count(), 16);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(artifacts, "mobile-dark.png") });
  await home.locator(".home-session").nth(15).click();
  await page.waitForURL(`**/?session=${sessions[15].id}`);

  catalog = sessions.slice(0, 2);
  await page.goto(`${base}/?home=1`, { waitUntil: "domcontentloaded" });
  await home.locator(".home-session").first().waitFor();
  assert.equal(await home.locator(".home-session").count(), 2);
  assert.equal(await home.locator(".home-recent-more").count(), 0);
  catalog = [];
  await page.reload({ waitUntil: "domcontentloaded" });
  await home.locator(".home-empty").waitFor();
  assert.equal(await home.locator(".home-recent-more").count(), 0);
  assert.equal(commands.some(type => type === "prompt" || type === "abort"), false);
  assert.deepEqual(errors, []);
  console.log("PASS: full-row hover/disclosure, keyboard and persisted collapse; 8/16/17 recent tasks, stable focus, session links, short/empty lists and mobile/dark; no prompts/aborts or browser errors.");
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, "failure.png") }).catch(() => {});
  console.error({ errors });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
