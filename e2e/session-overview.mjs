// Existing dev server, isolated APIs and browser storage. Never runs a real agent or terminal.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/session-overview");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const cwd = "D:/workspace/overview";
const id = "ab100000-0000-4000-8000-000000000001";
const otherId = "ab100000-0000-4000-8000-000000000002";
const terminalId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const unrelatedId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const session = { id, cwd, projectRoot: cwd, projectKey: cwd, name: "概览测试", firstMessage: "Overview fixture", messageCount: 1,
  created: "2026-11-04T00:00:00Z", modified: "2026-11-04T00:00:00Z" };
const second = { ...session, id: otherId, name: "另一条对话" };
const files = Array.from({ length: 7 }, (_, index) => ({ filePath: `${cwd}/change-${index}.ts`, code: "M", status: "modified", indexStatus: " ", worktreeStatus: "M" }));
const sourceFiles = Array.from({ length: 7 }, (_, index) => ({ kind: "file", id: `file-${index}`, path: `${cwd}/source-${index}.txt`, name: `source-${index}.txt` }));
const state = { model: { provider: "fixture", id: "base" }, thinkingLevel: "off", isStreaming: false, isPromptRunning: false };

try {
  for (const [width, theme] of [[1440, "breeze"], [1440, "dark"], [390, "breeze"], [320, "light"]]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: "reduce", hasTouch: width < 640, isMobile: width < 640 });
    await context.addInitScript(({ theme, cwd, terminalId, unrelatedId }) => {
      localStorage.setItem("pi-theme", theme); localStorage.setItem("pi-locale", "en");
      sessionStorage.setItem("pi-web:terminal-tabs", JSON.stringify({ tabs: [{ id: terminalId, cwd }, { id: unrelatedId, cwd: "D:/workspace/other" }], activeId: terminalId, open: false }));
    }, { theme, cwd, terminalId, unrelatedId });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], commands = [], requests = [];
    let failGit = false, failSources = false, notGit = false;
    let refreshGate = null;
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      requests.push({ path, method: request.method() });
      const reply = json => route.fulfill({ json });
      if (refreshGate && (path === "/api/git/status" || path.endsWith("/sources"))) await refreshGate;
      if (path === "/api/models") return reply({ models: { "fixture/base": "Fixture" }, modelList: [{ provider: "fixture", id: "base", name: "Fixture" }], defaultModel: { provider: "fixture", modelId: "base" }, thinkingLevels: { "fixture:base": ["off"] } });
      if (path === "/api/sessions") return reply({ sessions: [session, second], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
      if (path.endsWith("/sources")) {
        if (url.searchParams.has("image")) return route.fulfill({ contentType: "image/png", body: PNG });
        if (failSources) return route.fulfill({ status: 500, json: { error: "fixture" } });
        return reply(path.includes(otherId) ? { sources: [], total: 0 } : { sources: [{ kind: "image", id: "user:0", entryId: "user", blockIndex: 0, number: 1 }, ...sourceFiles], total: 8 });
      }
      if (path === `/api/sessions/${id}` || path === `/api/sessions/${otherId}`) return reply({ sessionId: path.split("/").at(-1), info: path.includes(otherId) ? second : session, tree: [], leafId: "user", filePath: "", context: {
        messages: [{ role: "user", content: "Keep this conversation and draft", timestamp: 1793750400000 }], entryIds: ["user"], hasMore: false, model: { provider: "fixture", modelId: "base" }, thinkingLevel: "off" } });
      if (path.endsWith("/state")) return reply({ state });
      if (path.startsWith("/api/terminal/")) {
        if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"output","data":"fixture terminal","offset":16}\n\n' });
        return reply({ id: path.split("/").at(-1), cwd: path.includes(terminalId) ? cwd : "D:/workspace/other" });
      }
      if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
      if (path.endsWith("/lease")) return reply({ running: false, awaitingInput: false, subagentsActive: false });
      if (path.startsWith("/api/agent/")) {
        if (request.method() === "POST") { const command = request.postDataJSON(); commands.push(command); return reply({ success: true, data: state }); }
        return reply({ state });
      }
      if (path === "/api/git/status") {
        if (failGit) return route.fulfill({ status: 500, json: { error: "fixture" } });
        return reply({ isGitRepository: !notGit, repositoryRoot: notGit ? null : cwd, files: notGit ? [] : files, additions: 407, deletions: 29 });
      }
      if (path === "/api/git/diff") return reply({ supported: true, status: "modified", patch: "diff --git a/change-0.ts b/change-0.ts\n--- a/change-0.ts\n+++ b/change-0.ts\n@@ -1 +1 @@\n-const value = 1;\n+const value = 2;\n" });
      if (path.startsWith("/api/files/")) {
        const type = url.searchParams.get("type");
        if (type === "watch") return route.fulfill({ contentType: "text/event-stream", body: "" });
        if (type === "list") return reply({ entries: [] });
        if (type === "meta") return reply({ size: 17, mtimeMs: 1 });
        if (type === "read") return reply({ content: "fixture file body", language: "text", size: 17, nextOffset: 17, truncated: false });
      }
      if (path === "/api/cwd/validate") return reply({ valid: true, cwd, projectRoot: cwd, projectKey: cwd });
      if (path === "/api/home") return reply({ home: "C:/Users/test" });
      if (path === "/api/web-auth") return reply({ enabled: false });
      if (path === "/api/app-update") return reply({ latestVersion: "0.2.7" });
      if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
      if (path === "/api/project-trust") return reply({ cwd, trusted: true, requiresTrust: false, mcpServers: [] });
      return reply({});
    });
    const input = page.locator(".chat-input-textarea");
    const trigger = page.getByRole("button", { name: "Conversation overview", exact: true });
    const panel = page.getByRole("dialog", { name: "Conversation overview", exact: true });
    const open = async () => { await trigger.click(); await panel.waitFor(); };
    try {
      await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await input.fill("Preserve this draft");
      const sourceRequests = () => requests.filter(r => r.path.endsWith("/sources") && r.method === "GET").length;
      assert.equal(sourceRequests(), 0, "closed overview fetches no source history");
      const commandsBefore = commands.length;
      await open();
      await panel.getByText("+407", { exact: true }).waitFor();
      await panel.getByText("Image 1", { exact: true }).waitFor();
      assert.equal(await panel.evaluate(el => getComputedStyle(el).animationName), "none", "reduced motion disables the panel entrance");
      assert.equal(await panel.evaluate(el => getComputedStyle(el, "::backdrop").animationName), "none");
      // A delayed refresh preserves loaded rows and their DOM instead of flashing empty.
      const firstChange = panel.getByRole("button", { name: /change-0\.ts/ });
      await firstChange.evaluate(el => { el.dataset.refreshIdentity = "retained"; });
      let releaseRefresh;
      refreshGate = new Promise(resolve => { releaseRefresh = resolve; });
      const refresh = panel.getByRole("button", { name: "Refresh overview", exact: true });
      await refresh.click();
      await page.waitForFunction(() => document.querySelector('dialog[open] button[aria-busy="true"]'));
      assert.equal(await firstChange.getAttribute("data-refresh-identity"), "retained");
      assert.equal(await panel.getByText("Image 1", { exact: true }).isVisible(), true);
      refreshGate = null;
      releaseRefresh();
      await page.waitForFunction(() => document.querySelector('dialog[open] button[aria-busy="false"]'));
      assert.equal(await firstChange.getAttribute("data-refresh-identity"), "retained");
      assert.equal(await panel.getByRole("button", { name: /^Terminal 1/ }).count(), 1);
      assert.equal(await panel.getByText("D:/workspace/other", { exact: true }).count(), 0);
      assert.equal(commands.length, commandsBefore, "opening never sends an agent command");
      await page.screenshot({ path: resolve(artifacts, `overview-${theme}-${width}.png`) });
      await panel.screenshot({ path: resolve(artifacts, `panel-${theme}-${width}.png`) });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      assert.notEqual(await panel.evaluate(el => getComputedStyle(el).animationName), "none", "ordinary motion has a panel entrance");
      await page.emulateMedia({ reducedMotion: "reduce" });
      for (const section of ["Project changes", "Conversation sources"]) {
        const region = panel.getByRole("region", { name: section, exact: true });
        await region.getByRole("button", { name: /^Show all/ }).click();
        await region.getByRole("button", { name: "Show less", exact: true }).waitFor();
      }
      const bounds = await panel.boundingBox();
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 941);
      assert.equal(await panel.getAttribute("data-sheet"), width <= 640 ? "true" : null);
      await panel.getByRole("button", { name: "Preview image: Image 1", exact: true }).click();
      const image = page.getByRole("dialog", { name: "Preview image", exact: true });
      await image.waitFor();
      await page.keyboard.press("Escape");
      await image.waitFor({ state: "hidden" });
      assert.equal(await panel.isVisible(), true, "first Escape closes only the image viewer");
      await page.keyboard.press("Escape");
      await panel.waitFor({ state: "hidden" });
      assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
      assert.equal(await input.inputValue(), "Preserve this draft");

      await open();
      await panel.getByRole("button", { name: /change-0\.ts/ }).click();
      await page.locator("#file-panel").getByRole("tab", { name: "change-0.ts", exact: true }).waitFor();
      assert.equal(await panel.count(), 0);
      assert.ok(requests.some(r => r.path === "/api/git/diff"), "change links reuse the existing diff viewer");
      if (width <= 640) await page.locator(".file-panel-close-button").click();
      await open();
      await panel.getByRole("button", { name: /source-0\.txt/ }).click();
      await page.locator("#file-panel").getByText("fixture file body", { exact: true }).waitFor();
      if (width <= 640) await page.locator(".file-panel-close-button").click();
      await open();
      await panel.getByRole("button", { name: /Terminal 1/ }).click();
      await page.locator("#file-panel").getByRole("tab", { selected: true }).filter({ hasText: /overview/ }).waitFor();
      if (width <= 640) await page.locator(".file-panel-close-button").click();

      failGit = true; failSources = true;
      await open();
      await panel.getByRole("alert").first().waitFor();
      assert.equal(await panel.getByRole("button", { name: /change-0\.ts/ }).count(), 1, "failed refresh retains loaded changes");
      assert.equal(await panel.getByText("Image 1", { exact: true }).count(), 1, "failed refresh retains loaded sources");
      failGit = false; failSources = false; notGit = true;
      await panel.getByRole("button", { name: "Refresh overview", exact: true }).click();
      await panel.getByText("This directory is not a Git repository.", { exact: true }).waitFor();
      await panel.getByText("Image 1", { exact: true }).waitFor();
      await page.mouse.click(width - 2, 2);
      await panel.waitFor({ state: "hidden" });
      assert.equal(await input.inputValue(), "Preserve this draft");
      const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await showSidebar.isVisible()) await showSidebar.click();
      await page.locator(`a[href*="session=${otherId}"]`).filter({ visible: true }).first().click();
      await page.waitForURL(url => url.searchParams.get("session") === otherId);
      await open();
      await panel.getByText("No images or file references in this branch yet.", { exact: true }).waitFor();
      assert.equal(await panel.getByText("Image 1", { exact: true }).count(), 0, "another conversation never inherits previous sources");
      await page.keyboard.press("Escape");
      assert.equal(commands.some(c => ["prompt", "abort", "set_model", "get_commands"].includes(c.type)), false);
      assert.deepEqual(errors, []);
      console.log(`PASS overview ${theme} ${width}px: sources, diff, terminal, nested Escape, retry, focus and draft`);
    } catch (error) {
      await page.screenshot({ path: resolve(artifacts, `failure-${theme}-${width}.png`) });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
