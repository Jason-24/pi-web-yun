// Existing dev server, isolated APIs. No real agents, terminal processes or project writes.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/panel-tools");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const cwd = "D:/workspace/panel-tools";
const id = "ab100000-0000-4000-8000-000000000001";
const childId = "ab100000-0000-4000-8000-000000000002";
const session = { id, cwd, projectRoot: cwd, projectKey: cwd, name: "Main conversation", firstMessage: "Parent context", messageCount: 1,
  created: "2026-11-04T00:00:00Z", modified: "2026-11-04T00:00:00Z" };
const child = { ...session, id: childId, name: "Side chat", parentSessionId: id, relation: { kind: "side", parentSessionId: id } };
const state = { model: { provider: "fixture", id: "base" }, thinkingLevel: "off", isStreaming: false, isPromptRunning: false };

try {
  for (const [width, theme] of [[1440, "breeze"], [1440, "dark"], [390, "breeze"], [320, "light"]]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: "reduce", hasTouch: width < 640, isMobile: width < 640 });
    await context.addInitScript(theme => { localStorage.setItem("pi-theme", theme); localStorage.setItem("pi-locale", "en"); }, theme);
    const page = await context.newPage(); page.setDefaultTimeout(15000);
    const errors = [], commands = [], writes = [];
    let created = false, failFork = false, holdFork = false, releaseFork;
    const sideMessages = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      const reply = json => route.fulfill({ json });
      if (request.method() !== "GET") writes.push({ path, body: request.postData() });
      if (path === "/api/models") return reply({ models: { "fixture/base": "Fixture" }, modelList: [{ provider: "fixture", id: "base", name: "Fixture" }], defaultModel: { provider: "fixture", modelId: "base" }, thinkingLevels: { "fixture:base": ["off"] } });
      if (path === "/api/sessions") return reply({ sessions: created ? [session, child] : [session], sessionListVersion: created ? 2 : 1, runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: created ? 2 : 1 });
      if (path.endsWith("/fork")) {
        assert.equal(request.postDataJSON().side, true);
        if (failFork) return route.fulfill({ status: 409, json: { error: "fixture fork refused" } });
        if (holdFork) await new Promise(resolve => { releaseFork = resolve; });
        created = true; return reply({ sessionId: childId, session: child });
      }
      if (path === `/api/sessions/${id}` || path === `/api/sessions/${childId}`) {
        const isChild = path.endsWith(childId);
        const messages = [{ role: "user", content: isChild ? "Inherited parent context" : "Parent context", timestamp: 1793750400000 }, ...(isChild ? sideMessages : [])];
        return reply({ sessionId: isChild ? childId : id, info: isChild ? child : session, tree: [], leafId: "user", filePath: "", context: {
          messages, entryIds: messages.map((_, i) => `user-${i}`), hasMore: false, model: { provider: "fixture", modelId: "base" }, thinkingLevel: "off" } });
      }
      if (path.endsWith("/state")) return reply({ state });
      if (path === "/api/terminal") return reply({ id: request.postDataJSON().id, cwd });
      if (path.startsWith("/api/terminal/")) {
        if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"output","data":"fixture terminal","offset":16}\n\n' });
        return reply({ id: path.split("/").at(-1), cwd });
      }
      if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
      if (path.endsWith("/lease")) return reply({ running: false, awaitingInput: false, subagentsActive: false });
      if (path.startsWith("/api/agent/")) {
        if (request.method() === "POST") {
          const command = request.postDataJSON(); commands.push({ path, ...command });
          if (command.type === "prompt" && path.endsWith(childId)) sideMessages.push({ role: "user", content: command.message, timestamp: Date.now() });
          return reply({ success: true, data: state });
        }
        return reply({ state });
      }
      if (path === "/api/git/status") return reply({ isGitRepository: true, repositoryRoot: cwd, additions: 12, deletions: 3, files: [{ filePath: `${cwd}/change.ts`, code: "M", status: "modified", indexStatus: " ", worktreeStatus: "M" }] });
      if (path === "/api/git/diff") return reply({ supported: true, status: "modified", patch: "diff --git a/change.ts b/change.ts\n--- a/change.ts\n+++ b/change.ts\n@@ -1 +1 @@\n-old\n+new\n" });
      if (path.startsWith("/api/files/")) {
        const type = url.searchParams.get("type");
        if (type === "watch") return route.fulfill({ contentType: "text/event-stream", body: "" });
        if (type === "list") return reply({ entries: ["doc.txt", "change.ts"].map(name => ({ name, isDir: false, size: 17 })) });
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
    const panel = page.locator("#file-panel");
    const mainInput = page.locator(".workspace-chat-view .chat-input-textarea").first();
    const tool = name => panel.locator(".panel-tool-grid").getByRole("button", { name: new RegExp(`^${name}`) });
    const newTab = async () => { await panel.locator(".file-tab-add").click(); await panel.locator(".panel-tool-launcher").waitFor(); };
    const openTabs = async () => {
      await (width <= 640 ? panel.locator(".panel-tab-switcher") : page.locator(".panel-tab-switcher").first()).click();
      const menu = page.getByRole("menu", { name: "Open tabs", exact: true });
      await menu.waitFor();
      return menu;
    };
    const chooseTab = async label => {
      const menu = await openTabs();
      await menu.getByRole("menuitemradio", { name: label, exact: true }).click();
    };
    try {
      await page.goto(`${base}/?session=${id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await mainInput.fill("Main draft stays here");
      await page.locator(".panel-tab-switcher").first().click();
      await panel.locator(".panel-tool-launcher").waitFor();
      assert.equal(writes.some(w => w.path.endsWith("/fork") || w.path === "/api/terminal"), false);
      await page.screenshot({ path: resolve(artifacts, `launcher-${theme}-${width}.png`), animations: "disabled" });
      await tool("Files").click();
      await panel.getByRole("tab", { name: "Open file", exact: true }).waitFor();
      await panel.locator("#workbench-file-tree").getByTitle(`${cwd}/doc.txt`, { exact: true }).click();
      await panel.getByText("fixture file body", { exact: true }).waitFor();
      let menu = await openTabs();
      const closeDoc = menu.getByRole("menuitem", { name: "Close doc.txt", exact: true });
      if (width > 640) await menu.getByRole("menuitemradio", { name: "doc.txt", exact: true }).hover();
      assert.equal(await closeDoc.evaluate(el => getComputedStyle(el).opacity), "1", "close is visible on hover or touch");
      await page.screenshot({ path: resolve(artifacts, `tab-close-${theme}-${width}.png`), animations: "disabled" });
      await closeDoc.click();
      await menu.getByRole("menuitemradio", { name: "doc.txt", exact: true }).waitFor({ state: "detached" });
      assert.equal(await menu.getByRole("menuitemradio", { name: "Open file", exact: true }).getAttribute("aria-checked"), "true", "closing the active file falls back to the remaining tab");
      const closeLast = menu.getByRole("menuitem", { name: "Close Open file", exact: true });
      await closeLast.focus(); await closeLast.press("Enter");
      await menu.waitFor({ state: "detached" });
      assert.equal(await panel.getByRole("tab").count(), 0, "the last tab can be closed from the menu");
      assert.equal(await mainInput.inputValue(), "Main draft stays here");
      await page.locator(".panel-tab-switcher").first().click();
      await tool("Files").click();
      await newTab();
      failFork = true;
      await tool("Side chat").click();
      await panel.getByRole("alert").filter({ hasText: "fixture fork refused" }).waitFor();
      assert.equal(await mainInput.inputValue(), "Main draft stays here", "a refused /side invocation leaves the draft intact");
      failFork = false;
      holdFork = true;
      await tool("Side chat").click();
      await panel.getByRole("status").filter({ hasText: "Opening…" }).waitFor();
      await page.keyboard.press("Control+Alt+s");
      holdFork = false;
      releaseFork();
      const sideInput = panel.locator(".chat-input-textarea");
      await sideInput.fill("Side draft stays here");
      assert.equal(writes.filter(w => w.path.endsWith("/fork")).length, 2, "card and shortcut share the main /side command's pending guard after a refusal");
      assert.equal(await page.locator('[data-workspace-page="agents"]').count(), 0, "the entry invokes /side instead of navigating to Agents");
      assert.equal(new URL(page.url()).searchParams.get("session"), id, "side chat never replaces the main conversation");
      await newTab();
      await tool("Files").click();
      assert.equal(await panel.getByRole("tab", { name: "Open file", exact: true }).count(), 1, "file tool is reused");
      await chooseTab("Side chat");
      assert.equal(await sideInput.inputValue(), "Side draft stays here");
      const sidePromptSent = page.waitForResponse(response => new URL(response.url()).pathname === `/api/agent/${childId}`
        && response.request().method() === "POST" && response.request().postDataJSON()?.type === "prompt");
      await sideInput.press(width <= 640 ? "Control+Enter" : "Enter");
      await sidePromptSent;
      await page.waitForFunction(() => document.querySelector("#file-panel .chat-input-textarea")?.value === "");
      assert.equal(commands.some(c => c.type === "prompt" && c.path.endsWith(id)), false);
      assert.equal(commands.filter(c => c.type === "prompt" && c.path.endsWith(childId)).at(-1)?.message, "Side draft stays here");
      await page.screenshot({ path: resolve(artifacts, `side-${theme}-${width}.png`), animations: "disabled" });
      await newTab();
      await tool("Changes").click();
      await panel.locator(".panel-change-row").click();
      await panel.getByRole("tab", { name: "change.ts", exact: true }).waitFor();
      await newTab();
      await tool("Terminal").click();
      await panel.getByRole("tab", { selected: true }).filter({ hasText: "panel-tools" }).waitFor();
      const terminalCreates = writes.filter(w => w.path === "/api/terminal");
      assert.equal(new Set(terminalCreates.map(w => JSON.parse(w.body).id)).size, 1);
      await page.keyboard.press("Control+p");
      await panel.getByRole("tab", { name: "Open file", exact: true, selected: true }).waitFor();
      await page.keyboard.press("Control+Shift+G");
      await panel.locator(".panel-changes").waitFor();
      await page.keyboard.press("Control+`");
      await panel.getByRole("tab", { selected: true }).filter({ hasText: "panel-tools" }).waitFor();
      assert.equal(writes.filter(w => w.path === "/api/terminal").length, terminalCreates.length, "terminal shortcut reuses the existing terminal");
      menu = await openTabs();
      const activeTerminalLabel = await panel.getByRole("tab", { selected: true }).getAttribute("aria-label");
      if (width > 640) await menu.getByRole("menuitemradio", { name: "change.ts", exact: true }).hover();
      await menu.getByRole("menuitem", { name: "Close change.ts", exact: true }).click();
      await menu.getByRole("menuitemradio", { name: "change.ts", exact: true }).waitFor({ state: "detached" });
      assert.equal(await panel.getByRole("tab", { selected: true }).getAttribute("aria-label"), activeTerminalLabel, "closing an inactive tab never selects it");
      const closeSide = menu.getByRole("menuitem", { name: "Close Side chat", exact: true });
      await closeSide.focus(); await closeSide.press("Enter");
      await menu.getByRole("menuitemradio", { name: "Side chat", exact: true }).waitFor({ state: "detached" });
      assert.equal(writes.some(write => write.path === `/api/sessions/${childId}`), false, "closing a side tab does not delete its session");
      const terminate = menu.getByRole("menuitem", { name: /^Terminate terminal / });
      const terminated = page.waitForResponse(response => new URL(response.url()).pathname.startsWith("/api/terminal/") && response.request().method() === "DELETE");
      await terminate.focus(); await terminate.press("Enter");
      await terminated;
      await panel.getByRole("tab", { name: activeTerminalLabel, exact: true }).waitFor({ state: "detached" });
      assert.equal(await menu.getByRole("menuitemradio", { checked: true }).count(), 1, "terminating the active terminal selects a remaining tab");
      await page.keyboard.press("Escape");
      assert.equal(commands.some(c => c.type === "abort"), false);
      await panel.locator(".file-panel-close-button").click();
      assert.equal(await mainInput.inputValue(), "Main draft stays here");
      await page.goto(`${base}/?session=${childId}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      const backToMain = page.getByRole("button", { name: "Back to main chat" });
      await backToMain.click();
      await page.waitForURL(url => url.searchParams.get("session") === id);
      await page.getByText("Parent context", { exact: true }).first().waitFor();
      assert.equal(await backToMain.count(), 0, "the return action is only shown in a side chat");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.deepEqual(errors, []);
      assert.equal(writes.filter(w => w.path.endsWith("/fork")).length, 2);
      console.log(`PASS panel tools ${theme} ${width}px: /side invocation, refusal/retry and shared pending guard, drafts, isolated send, files, terminal and shortcuts`);
    } catch (error) {
      await page.screenshot({ path: resolve(artifacts, `failure-${theme}-${width}.png`) });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
