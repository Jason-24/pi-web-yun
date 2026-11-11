// Run against the existing dev server. All APIs are isolated browser fixtures.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { checkModelSelector } from "./model-selector.mjs";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/interaction-navigation");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || undefined });
const cwd = "D:/workspace/interaction-fixture";
const sessions = Array.from({ length: 3 }, (_, i) => ({
  id: `interaction-${i}`, path: "", cwd, projectRoot: cwd, projectKey: cwd,
  name: `Task ${i}`, firstMessage: "Fixture", messageCount: 1,
  created: "2026-11-01T00:00:00Z", modified: "2026-11-01T00:00:00Z",
}));
const models = Array.from({ length: 15 }, (_, i) => ({ provider: "e2e", id: `model-${i}`, name: `Model ${i}` }));

try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, hasTouch: width < 640 });
    await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
    const page = await context.newPage();
    const errors = [], commands = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = json => route.fulfill({ json });
      if (path === "/api/sessions") return reply({ sessions, sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
      if (path === "/api/sessions/search") return reply({ results: sessions.map(session => ({ session, blockIndex: 0, titleMatch: true, before: "", match: "Task", after: session.id })), truncated: false });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
      if (path === "/api/models") return reply({ models: Object.fromEntries(models.map(m => [`${m.provider}:${m.id}`, m.name])), modelList: models,
        defaultModel: { provider: "e2e", modelId: "model-0" }, defaultThinkingLevel: "medium", thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {} });
      if (path === "/api/home") return reply({ home: "C:/Users/test" });
      if (path === "/api/cwd/validate") return reply({ valid: true, cwd });
      if (path === "/api/web-auth") return reply({ enabled: false });
      if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
      if (path === "/api/project-trust") return reply({ cwd, requiresTrust: false, trusted: true, mcpServers: [] });
      if (path === "/api/app-update") return reply({ latestVersion: "0.3.3" });
      if (path.startsWith("/api/sessions/")) {
        const session = sessions.find(item => path === `/api/sessions/${item.id}`);
        if (session) return reply({ sessionId: session.id, info: session, tree: [], leafId: null,
          context: { messages: [], entryIds: [], hasMore: false, model: null, thinkingLevel: "off" } });
      }
      if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
      if (path.startsWith("/api/agent/") && request.method() === "POST") commands.push(request.postDataJSON()?.type);
      return reply({});
    });

    await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const composer = page.locator("textarea.chat-input-textarea:visible");
    await composer.fill("First line");
    const firstHeight = (await composer.boundingBox()).height;
    await composer.press(width < 640 ? "Enter" : "Shift+Enter");
    await composer.pressSequentially("Second line");
    assert.equal(await composer.inputValue(), "First line\nSecond line");
    for (let i = 0; i < 4; i++) {
      await composer.press(width < 640 ? "Enter" : "Shift+Enter");
      await composer.pressSequentially(`Line ${i + 3}`);
    }
    assert.ok((await composer.boundingBox()).height > firstHeight, "multiline drafts grow the input");
    assert.deepEqual(commands, [], "newlines never send a message");
    await composer.fill("Preserve my draft");
    await page.locator(".composer-model-trigger").click();
    const trigger = page.locator(".composer-model-card .model-selector > button");
    await trigger.focus();
    await trigger.press("ArrowDown");
    const filter = page.getByRole("textbox", { name: "Filter models…", exact: true });
    await filter.fill("Model 1");
    await filter.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.equal(await page.getByRole("listbox").count(), 1, "IME Enter never chooses a model");
    await filter.press("ArrowDown");
    assert.equal(await page.getByRole("option", { name: "Model 1", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("End");
    assert.equal(await page.getByRole("option", { name: "Model 14", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Home");
    await page.keyboard.press("Enter");
    assert.equal(await page.getByRole("listbox").count(), 0);
    assert.equal(await trigger.evaluate(el => el === document.activeElement), true, "selection returns focus to the picker trigger");
    await page.keyboard.press("Escape");
    assert.equal(await composer.inputValue(), "Preserve my draft");
    if (width === 1440) {
      const toggle = page.locator(".sidebar-search-toggle");
      await toggle.click();
      const search = page.locator("#session-search-input");
      await search.fill("Task");
      await search.dispatchEvent("keydown", { key: "Escape", isComposing: true });
      assert.equal(await search.inputValue(), "Task", "IME Escape does not clear search");
      const results = page.locator("[data-session-search-result]");
      await results.first().waitFor();
      await search.press("ArrowDown");
      assert.equal(await results.first().evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("End");
      assert.equal(await results.last().evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Escape");
      assert.equal(await search.evaluate(el => el === document.activeElement), true);
      await search.press("Escape");
      assert.equal(await search.inputValue(), "");
      await search.press("Escape");
      assert.equal(await search.count(), 0);
      assert.equal(await toggle.evaluate(el => el === document.activeElement), true);
    }
    await checkModelSelector(page, { base, project: cwd, artifacts });
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    if (!await trigger.isVisible()) await page.locator(".composer-model-trigger").click();
    await trigger.click();
    await page.getByRole("option").first().focus();
    if (width < 640) {
      assert.ok((await page.getByRole("option").first().boundingBox()).height >= 44);
    }
    await page.screenshot({ path: resolve(artifacts, `picker-dark-${width}.png`) });
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.evaluate(() => localStorage.setItem("pi-enter-send-mode", "ctrlEnter"));
    await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`, { waitUntil: "domcontentloaded" });
    await composer.fill("Enter inserts");
    await composer.press("Enter");
    await composer.pressSequentially("a new line");
    assert.equal(await composer.inputValue(), "Enter inserts\na new line", "Ctrl+Enter send mode keeps plain Enter for newlines");
    assert.deepEqual(commands, [], "navigation never sends a prompt or abort");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve(artifacts, `navigation-${width}.png`) });
    console.log(`PASS: ${width}px keyboard navigation, IME, focus, drafts and nested Escape`);
    await context.close();
  }
} finally {
  await browser.close();
}
