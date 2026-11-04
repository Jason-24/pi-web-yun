// Existing dev server, isolated API/event fixtures; never calls a real agent.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/compaction-status");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const cwd = "D:/workspace/compaction";
const session = { id: "compaction-status", cwd, projectRoot: cwd, projectKey: cwd, name: "Compaction fixture", firstMessage: "Existing request", messageCount: 1,
  created: "2026-11-04T00:00:00Z", modified: "2026-11-04T00:00:00Z" };
try {
  for (const [width, theme] of [[1440, "breeze"], [1440, "dark"], [320, "light"]]) {
    const context = await browser.newContext({ viewport: { width, height: 940 }, reducedMotion: "reduce" });
    await context.addInitScript(theme => {
      localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-theme", theme);
      window.EventSource = class extends EventTarget {
        static CONNECTING = 0; static OPEN = 1; static CLOSED = 2;
        readyState = 1;
        constructor(url) {
          super(); this.url = String(url);
          if (this.url.includes("/api/agent/")) {
            window.fixtureSource = this;
            setTimeout(() => this.onmessage?.(new MessageEvent("message", { data: JSON.stringify({ type: "connected", isStreaming: false }) })), 0);
          }
        }
        close() { this.readyState = 2; }
      };
    }, theme);
    const page = await context.newPage(), errors = [], writes = [];
    const state = { model: { provider: "fixture", id: "base" }, thinkingLevel: "off", isStreaming: false, isPromptRunning: false, isCompacting: true };
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = json => route.fulfill({ json });
      if (request.method() !== "GET") writes.push(request.postDataJSON());
      if (path === "/api/models") return reply({ models: { "fixture/base": "Fixture" }, modelList: [{ provider: "fixture", id: "base", name: "Fixture" }], defaultModel: { provider: "fixture", modelId: "base" } });
      if (path === "/api/sessions") return reply({ sessions: [session], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
      if (path === `/api/sessions/${session.id}`) return reply({ sessionId: session.id, info: session, tree: [], leafId: "user", context: {
        messages: [{ role: "user", content: "请整理这份报告", timestamp: 1793750400000 }], entryIds: ["user"], hasMore: false,
        model: { provider: "fixture", modelId: "base" }, thinkingLevel: "off" } });
      if (path.endsWith("/state") || path.startsWith("/api/agent/")) return reply({ state });
      if (path === "/api/home") return reply({ home: "C:/Users/test" });
      if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
      if (path === "/api/project-trust") return reply({ cwd, trusted: true, requiresTrust: false, mcpServers: [] });
      return reply({});
    });
    const emit = event => page.evaluate(event => window.fixtureSource.onmessage(new MessageEvent("message", { data: JSON.stringify(event) })), event);
    try {
      await page.goto(`${base}/?session=${session.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      const row = page.locator(".chat-compaction-status");
      await row.waitFor();
      assert.equal(await row.innerText(), "正在压缩上下文 · 可能需要几分钟");
      assert.equal(await row.getAttribute("role"), "status");
      await page.locator(".chat-input-textarea").fill("保留我的草稿");
      await emit({ type: "queue_update", steering: ["queued"], followUp: [] });
      await row.getByText(/1/).waitFor();
      await page.screenshot({ path: resolve(artifacts, `${theme}-${width}.png`), animations: "disabled" });
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      state.isCompacting = false;
      await emit({ type: "compaction_end", aborted: true });
      await row.waitFor({ state: "hidden" });
      await emit({ type: "auto_compaction_start" });
      await row.waitFor();
      await emit({ type: "auto_compaction_end", aborted: true });
      await row.waitFor({ state: "hidden" });
      assert.equal(await page.locator(".chat-input-textarea").inputValue(), "保留我的草稿");
      assert.equal(writes.some(command => ["prompt", "compact", "abort_compaction"].includes(command?.type)), false);
      assert.deepEqual(errors, []);
      console.log(`PASS compaction status ${theme} ${width}px: restored state, queued count, manual/auto lifecycle, draft and bounds`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
