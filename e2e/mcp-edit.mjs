import { toolSettingsFixture } from "./tool-settings-fixture.mjs";
// Reuse an existing dev server. Every API is isolated; no real prompts or settings writes.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { openSettings } from "./settings.mjs";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const chinese = false;
const artifacts = resolve("test-results/mcp-edit");
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

try {
  for (const width of [1440, 390, 320]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: "reduce" });
    await context.addInitScript(locale => { localStorage.setItem("pi-locale", locale); localStorage.setItem("pi-theme", "light"); }, chinese ? "zh-CN" : "en");
    let command = "npx", args = ["-y", "@scope/server"];
    const serverInfo = () => ({ name: "mysql-loans-dev", scope: "global", sourcePath: "C:/Users/test/.pi/agent/mcp.json", configKey: "key", enabled: true, validated: true, transport: "stdio", command, args, envNames: ["API_TOKEN"], headerNames: [], usesOAuth: false, commandFields: [], variableReferences: [], masked: false, exposure: "codemode" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = json => route.fulfill({ json });
      if (request.method() !== "GET" && path !== "/api/cwd/validate") writes.push({ path, body: request.postData() });
      if (path === "/api/mcp") {
        if (request.method() === "GET") return reply({ mcp: { available: true }, codemode: { sandbox: { state: "available" }, preference: "automatic", builtinDisabled: false }, files: [{ scope: "global", path: serverInfo().sourcePath, exists: true, problems: [] }], servers: [serverInfo(), { ...serverInfo(), name: "http-docs", transport: "http", command: undefined, args: undefined, url: "https://example.com/mcp?token=•••", envNames: [], headerNames: ["Authorization"], masked: true }] });
        const body = request.postDataJSON();
        if (body.action === "read-edit" && body.name === "http-docs") return reply({ version: "http-version", transport: "http", fields: { url: { hidden: true, value: "" } }, names: ["Authorization"], values: { Authorization: { hidden: true, value: "" } } });
        if (body.action === "update" && body.name === "http-docs") return reply({ success: true });
        if (body.action === "read-edit") return reply({ version: "version", transport: "stdio", fields: { command: { hidden: false, value: command }, args: { hidden: false, value: JSON.stringify(args, null, 2) }, cwd: { hidden: false, value: "" } }, names: ["API_TOKEN", "KIBANA_URL", "TOKEN_REFERENCE"], values: { API_TOKEN: { hidden: true, value: "" }, KIBANA_URL: { hidden: false, value: "https://kibana.example.com/sit" }, TOKEN_REFERENCE: { hidden: false, value: "${MY_TOKEN}" } } });
        if (body.action === "update") {
          if (body.patch.fields.command === "conflict") return route.fulfill({ status: 409, json: { reason: "config-changed" } });
          command = body.patch.fields.command ?? command;
          if (body.patch.fields.args) args = JSON.parse(body.patch.fields.args);
          return reply({ success: true });
        }
        throw new Error("Unexpected MCP action: " + body.action);
      }
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
      await page.locator(".chat-input-textarea").fill("layout preview");
      await page.locator(".workspace-chat-header").getByText(session.name, { exact: true }).waitFor({ state: "attached" });
      await page.waitForTimeout(1000); // Let the initial workspace restoration settle.
      let settings;
      if (chinese) {
        const sidebar = page.getByRole("button", { name: "显示侧边栏", exact: true });
        if (await sidebar.isVisible()) await sidebar.click();
        await page.getByRole("button", { name: "设置", exact: true }).click();
        settings = page.getByRole("region", { name: "设置", exact: true });
        await settings.getByRole("button", { name: "技能", exact: true }).filter({ visible: true }).click();
      } else settings = await openSettings(page, "MCP");
      await settings.getByRole("button", { name: /mysql-loans-dev/ }).click();
      await settings.getByRole("button", { name: "Edit", exact: true }).click();
      const editor = settings.getByRole("region", { name: "Edit connection", exact: true });
      await editor.locator("#mcp-edit-command").waitFor();
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
      assert.equal(await editor.getByLabel("Configured value for KIBANA_URL", { exact: true }).inputValue(), "https://kibana.example.com/sit");
      assert.equal(await editor.getByLabel("Configured value for TOKEN_REFERENCE", { exact: true }).inputValue(), "${MY_TOKEN}");
      assert.equal(await editor.getByLabel("Configured value for API_TOKEN", { exact: true }).getAttribute("placeholder"), "Configured (sensitive value hidden)");
      assert.equal(await editor.getByLabel("Configured value for API_TOKEN", { exact: true }).inputValue(), "");
      await editor.locator("#mcp-edit-command").fill("conflict");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await editor.getByRole("alert").filter({ hasText: "configuration changed" }).waitFor();
      await editor.getByRole("button", { name: "Cancel", exact: true }).click();
      await settings.getByRole("button", { name: "Edit", exact: true }).click();
      await editor.locator("#mcp-edit-command").fill("node");
      await editor.locator("#mcp-edit-args").fill('["a b", "server.js"]');
      if (width === 1440) {
        await page.emulateMedia({ reducedMotion: "no-preference" });
        const tabs = settings.locator(".settings-section-tabs");
        await tabs.getByRole("button", { name: "General", exact: true }).click();
        await tabs.getByRole("button", { name: "MCP", exact: true }).click();
        await page.waitForFunction(() => {
          const active = document.querySelector('.settings-section-tab[aria-current="page"]')?.getBoundingClientRect();
          const indicator = document.querySelector(".settings-section-indicator")?.getBoundingClientRect();
          return active && indicator && Math.abs(active.x + active.width / 2 - indicator.x - indicator.width / 2) < 1;
        });
        assert.equal(await editor.locator("#mcp-edit-command").inputValue(), "node", "category transitions preserve the mounted editor draft");
        assert.equal(await editor.locator("#mcp-edit-args").inputValue(), '["a b", "server.js"]');
        await page.emulateMedia({ reducedMotion: "reduce" });
        assert.equal(await tabs.locator(".settings-section-indicator").evaluate(el => getComputedStyle(el).transitionDuration), "0s");
      }
      await editor.getByRole("combobox", { name: "Action for API_TOKEN", exact: true }).selectOption("literal");
      await editor.getByLabel("New value for API_TOKEN", { exact: true }).fill("replacement-secret");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      assert.equal(await editor.evaluate(node => node.scrollWidth <= node.clientWidth + 1), true);
      assert.equal(await editor.getByRole("alert").count(), 0);
      await page.screenshot({ path: `${artifacts}/editor-${width}.png`, fullPage: true });
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await settings.getByRole("status").filter({ hasText: "Configuration saved" }).waitFor();
      const updates = writes.filter(item => item.path === "/api/mcp" && JSON.parse(item.body).action === "update");
      assert.equal(updates.length, 2);
      const patch = JSON.parse(updates[1].body).patch;
      assert.deepEqual(JSON.parse(patch.fields.args), ["a b", "server.js"]);
      assert.deepEqual(patch.values, [{ name: "API_TOKEN", action: "literal", value: "replacement-secret" }]);
      if (width <= 640) await settings.locator(".settings-phone-back").click();
      await settings.getByRole("button", { name: /http-docs/ }).click();
      await settings.getByRole("button", { name: "Edit", exact: true }).click();
      await editor.getByLabel("Replace the hidden value (otherwise keep it)").waitFor();
      assert.equal(await editor.locator("#mcp-edit-url").count(), 0);
      await editor.getByLabel("Replace the hidden value (otherwise keep it)").check();
      await editor.locator("#mcp-edit-url").fill("https://new.example.com/mcp");
      await editor.getByRole("combobox", { name: "Action for Authorization", exact: true }).selectOption("remove");
      await editor.getByRole("button", { name: "Save", exact: true }).click();
      await settings.getByRole("status").filter({ hasText: "Configuration saved" }).waitFor();
      const httpPatch = JSON.parse(writes.filter(item => item.path === "/api/mcp" && JSON.parse(item.body).action === "update").at(-1).body).patch;
      assert.deepEqual(httpPatch, { fields: { url: "https://new.example.com/mcp" }, values: [{ name: "Authorization", action: "remove" }] });
      assert.deepEqual(errors, []);
      console.log(`MCP editor ${width}px: conflict, cancel, save and layout passed`);
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
