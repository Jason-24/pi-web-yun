// Reuse an existing dev server. Every API is isolated; no real prompts or settings writes.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { openSettings } from "./settings.mjs";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const chinese = process.env.E2E_LOCALE === "zh-CN";
const artifacts = resolve("test-results/skills-layout");
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
    let skills = [
      { name: "find-skills", description: "Discover and install agent skills for everyday work, from testing and documentation to design reviews.", filePath: "C:/Users/test/.agents/skills/find-skills/SKILL.md", baseDir: "C:/Users/test/.agents/skills/find-skills", sourceInfo: { source: "user", scope: "user" }, disableModelInvocation: false, install: { scope: "global", source: "vercel-labs/skills", package: "vercel-labs/skills@find-skills", skillsShUrl: "https://skills.sh/vercel-labs/skills/find-skills", canCheckForUpdates: true, versionHash: "d6cb3021" } },
      { name: "ui-review", description: "Review interface layout and accessibility.", filePath: `${cwd}/.agents/skills/ui-review/SKILL.md`, baseDir: `${cwd}/.agents/skills/ui-review`, sourceInfo: { source: "project", scope: "project" }, disableModelInvocation: false },
    ];
    let undoSkills = null, undoSourcePath = null;
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], writes = [];
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = json => route.fulfill({ json });
      if (request.method() !== "GET" && path !== "/api/cwd/validate") writes.push({ path, body: request.postData() });
      if (path === "/api/skills/transfer") {
        const body = request.postDataJSON();
        if (body.action === "undo") { skills = undoSkills; return reply({ targetPath: undoSourcePath }); }
        const source = skills.find(skill => skill.filePath === body.filePath);
        const targetScope = source.install.scope === "global" ? "project" : "global";
        const targetPath = targetScope === "project" ? `${cwd}/.agents/skills/${source.name}/SKILL.md` : `C:/Users/test/.agents/skills/${source.name}/SKILL.md`;
        if (skills.some(skill => skill.filePath === targetPath)) return route.fulfill({ status: 409, json: { code: "conflict", targetPath } });
        if (body.action === "preview") return reply({ targetPath, targetScope });
        assert.equal(body.sharedAcknowledged, true);
        undoSkills = structuredClone(skills); undoSourcePath = source.filePath;
        const target = { ...structuredClone(source), filePath: targetPath, baseDir: targetPath.slice(0, -9), install: { ...source.install, scope: targetScope }, loaded: body.mode === "move", sourceInfo: { source: targetScope === "project" ? "project" : "user", scope: targetScope === "project" ? "project" : "user" } };
        if (body.mode === "move") skills = skills.filter(skill => skill.filePath !== source.filePath);
        skills.push(target);
        return reply({ targetPath, undoToken: "fixture-undo-token" });
      }
      if (path === "/api/skills/remove") {
        const body = request.postDataJSON();
        assert.equal(body.sharedAcknowledged, true);
        skills = skills.filter(skill => skill.filePath !== body.filePath);
        return reply({ success: true, failed: false, remains: false, backupPath: "C:/Users/test/.agents/.pi-web-skill-trash/find-skills-example" });
      }
      if (path === "/api/skills") return reply({ skills, diagnostics: skills.some(skill => skill.loaded === false) ? [{ type: "collision", message: "same name", collision: { resourceType: "skill", name: "find-skills", winnerPath: undoSourcePath, loserPath: skills.find(skill => skill.loaded === false).filePath } }] : [], projectResourcesLoaded: true });
      if (path === "/api/skills/content") return reply({ content: "---\nname: find-skills\n---\n## When to use this skill\n\nFind the right skill for your task and keep it available to your agent.\n\n- Search by the task you want to complete\n- Review the source and installation location\n- Install in your project or globally\n\n## Quick start\n\nDescribe the task you want help with. The agent can suggest matching skills and explain how to use them." });
      if (path === "/api/skills/search") return reply({ results: [] });
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
      if (path === "/api/tools/settings") return reply({ powershell: false, codemode: false });
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
      } else settings = await openSettings(page, "Skills");
      await settings.getByRole("button", { name: "find-skills", exact: true }).click();
      await settings.getByRole("heading", { name: "find-skills", exact: true }).waitFor();
      await settings.getByText("When to use this skill", { exact: true }).waitFor();
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const detail = settings.locator(".config-detail").filter({ visible: true });
      assert.ok(await detail.evaluate(el => el.scrollWidth <= el.clientWidth), "detail fits its viewport");
      const remove = settings.getByRole("button", { name: chinese ? "卸载" : "Remove", exact: true });
      await remove.scrollIntoViewIfNeeded();
      assert.ok((await remove.boundingBox()).width < 150, "remove action stays compact");
      await detail.evaluate(el => { el.scrollTop = 0; });
      await page.screenshot({ path: resolve(artifacts, `skills-${chinese ? "zh-" : ""}${width}.png`) });
      if (width === 1440) {
        await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.classList.add("dark"); });
        await page.screenshot({ path: resolve(artifacts, `skills-dark-${chinese ? "zh-" : ""}${width}.png`) });
        await page.evaluate(() => { document.documentElement.dataset.theme = "light"; document.documentElement.classList.remove("dark"); });
      }
      const openTransfer = settings.getByRole("button", { name: chinese ? "调整范围…" : "Adjust scope…", exact: true });
      await openTransfer.click();
      const transfer = settings.locator(".skills-transferForm");
      await transfer.getByText(chinese ? "目标位置" : "Destination", { exact: true }).waitFor();
      await transfer.getByRole("radio", { name: chinese ? /复制/ : /Copy/ }).check();
      await transfer.scrollIntoViewIfNeeded();
      assert.ok(await transfer.evaluate(el => el.scrollWidth <= el.clientWidth), "scope form fits its pane");
      await page.screenshot({ path: resolve(artifacts, `scope-transfer-${chinese ? "zh-" : ""}${width}.png`) });
      await transfer.getByRole("button", { name: chinese ? "确认复制到项目" : "Copy to project", exact: true }).click();
      await settings.locator(".skills-hero .skills-shadowBadge").waitFor();
      assert.match(await settings.locator(".skills-pathField code").first().textContent(), /workspace/);
      await settings.getByRole("button", { name: chinese ? "撤销" : "Undo", exact: true }).click();
      await settings.getByText(chinese ? "已撤销范围调整。" : "Scope change undone.", { exact: true }).waitFor();
      await openTransfer.click();
      await transfer.getByText(chinese ? "目标位置" : "Destination", { exact: true }).waitFor();
      await transfer.getByRole("button", { name: chinese ? "确认移动到项目" : "Move to project", exact: true }).click();
      await settings.getByText(chinese ? "已将 find-skills 移动到项目。" : "Moved find-skills to project.", { exact: true }).waitFor();
      await settings.getByRole("button", { name: chinese ? "撤销" : "Undo", exact: true }).click();
      await settings.getByText(chinese ? "已撤销范围调整。" : "Scope change undone.", { exact: true }).waitFor();
      page.once("dialog", dialog => dialog.accept());
      await remove.click();
      await settings.getByText(chinese ? "已卸载 find-skills。" : "Uninstalled find-skills.", { exact: true }).waitFor();
      assert.equal(await settings.locator("details[open]").count(), 0, "backup details start collapsed");
      await page.screenshot({ path: resolve(artifacts, `skills-notice-${chinese ? "zh-" : ""}${width}.png`) });
      await settings.getByRole("button", { name: chinese ? "关闭通知" : "Dismiss notification", exact: true }).click();
      assert.equal(await settings.getByText(chinese ? "已卸载 find-skills。" : "Uninstalled find-skills.", { exact: true }).count(), 0);
      assert.deepEqual(errors, []);
      console.log(`PASS skills ${width}px: detail layout, compact uninstall, collapsed notice and no overflow`);
    } catch (error) {
      console.log({ errors, url: page.url() });
      await page.screenshot({ path: resolve(artifacts, `failure-${width}.png`) });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
