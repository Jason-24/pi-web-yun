import { toolSettingsFixture } from "./tool-settings-fixture.mjs";
// Reuse an existing dev server. Every API is isolated; no real prompts or settings writes.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { openSettings, closeSettings } from "./settings.mjs";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/breeze-theme");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const cwd = "D:/workspace/design";
const session = { id: "breeze-preview", cwd, projectRoot: cwd, projectKey: cwd, name: "让工作空间更轻盈", firstMessage: "设计一个安静、清爽的工作空间。", messageCount: 2,
  created: "2026-11-04T00:00:00Z", modified: "2026-11-04T00:00:00Z" };
const state = { model: { provider: "fixture", id: "base" }, thinkingLevel: "high", isStreaming: false, isPromptRunning: false };
const messages = [
  { role: "user", content: "我想要一个像清晨微风一样，干净、舒适的工作空间。", timestamp: 1793750400000 },
  { role: "assistant", content: [{ type: "text", text: "已经准备好了。\n\n白色的阅读区域，搭配浅青绿的侧栏和柔和的渐变背景，让注意力留在内容上。\n\n- 保留熟悉的项目与对话导航\n- 让输入、阅读和工具操作自然衔接\n- 选择适合自己的节奏，继续下一件事" }], timestamp: 1793750410000 },
];
const luminance = hex => (hex.length === 4 ? [...hex.slice(1)].map(c => c + c).join("") : hex.slice(1)).match(/../g).map(p => parseInt(p, 16) / 255)
  .map(v => v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)
  .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
const contrast = (a, b) => (Math.max(luminance(a), luminance(b)) + 0.05) / (Math.min(luminance(a), luminance(b)) + 0.05);

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: "reduce" });
    await context.addInitScript(() => { localStorage.setItem("pi-locale", "en"); if (!localStorage.getItem("pi-theme")) localStorage.setItem("pi-theme", "light"); });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = json => route.fulfill({ json });
      if (request.method() !== "GET" && path !== "/api/cwd/validate") writes.push({ path, body: request.postData() });
      if (path === "/api/models") return reply({ models: { "fixture/base": "Design assistant" }, modelList: [{ provider: "fixture", id: "base", name: "Design assistant" }], defaultModel: { provider: "fixture", modelId: "base" }, thinkingLevels: { "fixture:base": ["off", "high"] } });
      if (path === "/api/sessions") return reply({ sessions: [session], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
      if (path === `/api/sessions/${session.id}`) return reply({ sessionId: session.id, info: session, tree: [], leafId: "assistant", filePath: "", context: { messages, entryIds: ["user", "assistant"], hasMore: false, model: { provider: "fixture", modelId: "base" }, thinkingLevel: "high" } });
      if (path === `/api/sessions/${session.id}/state`) return reply({ state });
      if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
      if (path.endsWith("/lease")) return reply({ running: false, awaitingInput: false, subagentsActive: false });
      if (path.startsWith("/api/agent/")) return reply(request.method() === "GET" ? { state } : { success: true, data: state });
      if (path === "/api/cwd/validate") return reply({ valid: true, cwd, projectRoot: cwd, projectKey: cwd });
      if (path === "/api/home") return reply({ home: "C:/Users/test" });
      if (path === "/api/web-auth") return reply({ enabled: false });
      if (path === "/api/app-update") return reply({ latestVersion: "0.2.7" });
      if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
      if (path === "/api/project-trust") return reply({ cwd, trusted: true, requiresTrust: false, mcpServers: [] });
      if (path === "/api/cache-miss-notices") return reply({ showCacheMissNotices: true });
      if (path === "/api/tools/settings") return reply(toolSettingsFixture);
      return reply({});
    });
    try {
      await page.goto(`${base}/?session=${session.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      const input = page.locator(".chat-input-textarea");
      await input.fill("接下来，我们从哪里开始？");
      const settings = await openSettings(page);
      const choose = async name => {
        const radio = settings.getByRole("radio", { name, exact: true });
        await radio.locator("..").click();
        assert.equal(await radio.isChecked(), true);
      };
      await choose("Breeze");
      await page.waitForFunction(() => document.documentElement.dataset.theme === "breeze");
      assert.equal(await page.evaluate(() => localStorage.getItem("pi-theme")), "breeze");
      assert.equal(await page.locator("html").evaluate(el => el.classList.contains("dark")), false);
      const colors = await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return Object.fromEntries(["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "tool-bg", "text", "text-muted", "text-dim", "accent", "accent-hover", "accent-contrast"].map(k => [k, style.getPropertyValue(`--${k}`).trim()]));
      });
      for (const fg of ["text", "text-muted", "text-dim", "accent"]) {
        for (const bg of ["bg", "bg-panel", "bg-hover", "bg-selected", "user-bg", "tool-bg"]) assert.ok(contrast(colors[fg], colors[bg]) >= 4.5, `${fg} ${colors[fg]} on ${bg} ${colors[bg]}: ${contrast(colors[fg], colors[bg])} meets AA`);
      }
      for (const bg of ["accent", "accent-hover"]) assert.ok(contrast(colors["accent-contrast"], colors[bg]) >= 4.5);
      assert.equal(await settings.locator(".settings-theme-options").evaluate(el => [...el.querySelectorAll(".settings-theme-name")].every(name => name.scrollWidth <= name.clientWidth && name.scrollHeight <= name.clientHeight)), true, "all swatch names fit");
      await page.screenshot({ path: resolve(artifacts, `settings-${width}.png`) });
      await closeSettings(page);
      assert.equal(await input.inputValue(), "接下来，我们从哪里开始？");
      assert.match(await page.locator(".workspace-shell").evaluate(el => getComputedStyle(el).backgroundImage), /linear-gradient/);
      assert.equal(await page.locator(".workspace-frame").evaluate(el => getComputedStyle(el).borderTopLeftRadius), width > 640 ? "18px" : "0px");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: resolve(artifacts, `conversation-${width}.png`) });
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForFunction(() => document.documentElement.dataset.theme === "breeze");
      await page.locator(".workspace-chat-header").getByText(session.name, { exact: true }).waitFor({ state: "attached" });
      await openSettings(page);
      for (const theme of ["Light", "Dark"]) {
        await choose(theme);
        await page.waitForFunction(id => document.documentElement.dataset.theme === id, theme.toLowerCase());
        assert.equal(await page.locator(".workspace-shell").evaluate(el => getComputedStyle(el).backgroundImage), "none", "other themes retain their original backdrop");
        assert.equal(await page.locator(".workspace-frame").evaluate(el => getComputedStyle(el).borderTopLeftRadius), width > 640 ? "14px" : "0px");
      }
      assert.equal(writes.some(w => w.body?.includes('"type":"prompt"')), false);
      assert.equal(writes.some(w => /\/models\/default|\/tools\/settings|\/cache-miss-notices/.test(w.path)), false);
      assert.deepEqual(errors, []);
      console.log(`PASS Breeze ${width}px: palette selection, contrast, draft, persistence, no overflow and theme isolation`);
    } catch (error) {
      await page.screenshot({ path: resolve(artifacts, `failure-${width}.png`) });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
