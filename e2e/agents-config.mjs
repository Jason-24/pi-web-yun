// All APIs are fixtures: never write real agent templates or start an agent.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { openSettings } from "./settings.mjs";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/agents-config");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || "msedge" });
const cwd = "D:/workspace/agents-design";
const builtin = { name: "explore", displayName: "Explore", description: "Quickly inspect a codebase without modifying it", systemPrompt: "Explore the codebase to answer the delegated question. Do not modify files. Report concrete findings with file paths and relevant symbols.", tools: ["read", "grep", "find", "ls"], loadSkills: false, loadExtensions: false, codemode: "off", mcp: "off", promptMode: "append", inheritContext: false, runInBackground: false, enabled: true, scope: "builtin" };
const plan = { ...builtin, name: "plan", displayName: "Plan", description: "Turn a task into an actionable implementation plan.", skills: ["review"], extensions: ["custom-extension"], promptMode: "replace" };

try {
  for (const [width, theme] of [[1440, "breeze"], [1440, "dark"], [390, "breeze"], [320, "light"]]) {
    const context = await browser.newContext({ viewport: { width, height: 960 }, reducedMotion: "reduce" });
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    const errors = [], writes = [];
    let profiles = [structuredClone(builtin), structuredClone(plan)];
    let settings = { enabled: true, maxConcurrent: 10 };
    let refuseSave = false;
    await context.addInitScript(theme => { localStorage.setItem("pi-locale", "en"); localStorage.setItem("pi-theme", theme); }, theme);
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request(), path = new URL(request.url()).pathname;
      const reply = json => route.fulfill({ json });
      if (path === "/api/subagents/profiles") {
        if (request.method() === "GET") return reply({ profiles });
        const body = request.postDataJSON();
        writes.push({ path, method: request.method(), body });
        if (request.method() === "PUT") {
          if (refuseSave) return route.fulfill({ status: 409, json: { error: "Fixture save failed" } });
          const profile = { ...body.profile, scope: body.scope, filePath: `C:/Users/test/.pi/agent/agents/${body.profile.name}.md` };
          profiles = [...profiles.filter(item => item.name !== profile.name || item.scope !== profile.scope), profile];
          return reply({ profile });
        }
        const profile = profiles.find(item => item.name === body.name && item.scope === body.scope);
        if (request.method() === "PATCH") { Object.assign(profile, { enabled: body.enabled }); return reply({ profile }); }
        if (request.method() === "DELETE") { profiles = profiles.filter(item => item !== profile); return reply({}); }
        throw new Error("Unexpected profile action");
      }
      if (path === "/api/subagents/settings") {
        if (request.method() === "PUT") { const body = request.postDataJSON(); writes.push({ path, body }); settings = { ...settings, ...body }; }
        return reply(settings);
      }
      if (path === "/api/sessions") return reply({ sessions: [], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
      if (path === "/api/project-trust") return reply({ cwd, trusted: true, requiresTrust: false, mcpServers: [] });
      if (path === "/api/models") return reply({ models: {}, modelList: [{ provider: "fixture", id: "base", name: "Fixture model" }], defaultModel: null });
      if (path === "/api/home") return reply({ home: "C:/Users/test" });
      if (path === "/api/cwd/validate") return reply({ valid: true, cwd, projectRoot: cwd, projectKey: cwd });
      if (path === "/api/web-auth") return reply({ enabled: false });
      return reply({});
    });
    try {
      await page.goto(`${base}/?cwd=${encodeURIComponent(cwd)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
      await page.locator(".chat-input-textarea").waitFor();
      await page.waitForLoadState("networkidle");
      const panel = await openSettings(page, "Sub-agents");
      const agents = panel.locator(".agents-panel");
      const row = name => agents.locator(".config-sidebar-item").filter({ hasText: name });
      await row("Explore").click();
      await agents.locator(".agents-prompt-preview").waitFor();
      assert.equal(await agents.locator(".agents-profile-form").count(), 0, "viewing a built-in is not a disabled form");
      assert.equal(await agents.getByRole("button", { name: "Edit template", exact: true }).count(), 0);
      await agents.getByText("This built-in template is read-only.", { exact: false }).waitFor();
      await page.screenshot({ path: resolve(artifacts, `overview-${theme}-${width}.png`) });
      const backToList = async () => { if (width <= 640) await panel.locator(".settings-phone-back").click(); };
      await agents.getByRole("button", { name: "Duplicate", exact: true }).click();
      const form = agents.locator(".agents-profile-form");
      await form.waitFor();
      assert.equal(await form.getByLabel("Sub-agent ID", { exact: true }).inputValue(), "explore-copy");
      assert.equal(await form.getByLabel("System instructions", { exact: true }).inputValue(), builtin.systemPrompt);
      await form.getByRole("button", { name: "All tools", exact: true }).click();
      assert.equal(await form.getByRole("checkbox", { checked: true }).count(), 7);
      await form.getByLabel("System instructions", { exact: true }).fill("Do not lose this unsaved instruction.");
      await backToList();
      await row("Plan").click();
      const dialog = page.getByRole("dialog", { name: "Discard unsaved changes?", exact: true });
      await dialog.waitFor();
      await page.keyboard.press("Escape");
      await dialog.waitFor({ state: "detached" });
      assert.equal(await form.getByLabel("System instructions", { exact: true }).inputValue(), "Do not lose this unsaved instruction.");
      // On phones the intercepted row click has already opened the original detail.
      await backToList();
      await row("Plan").click();
      await dialog.getByRole("button", { name: "Discard changes", exact: true }).click();
      await agents.locator(".agents-profile-title").filter({ hasText: "Plan" }).waitFor();
      assert.equal(writes.length, 0, "discard and navigation write nothing");
      await agents.getByRole("button", { name: "Duplicate", exact: true }).click();
      await form.getByLabel("Display name", { exact: true }).fill("Project reviewer");
      await form.getByRole("button", { name: "Read-only tools", exact: true }).click();
      await form.locator(".agents-advanced summary").click();
      await form.getByLabel("Inherit parent context", { exact: true }).check();
      await form.getByLabel("Code mode", { exact: true }).selectOption("inherit");
      await page.screenshot({ path: resolve(artifacts, `editor-${theme}-${width}.png`) });
      assert.equal(await agents.evaluate(element => element.scrollWidth <= element.clientWidth + 1), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      refuseSave = true;
      await agents.getByRole("button", { name: "Save", exact: true }).click();
      await agents.getByRole("alert").filter({ hasText: "Fixture save failed" }).waitFor();
      assert.equal(await form.getByLabel("Display name", { exact: true }).inputValue(), "Project reviewer");
      refuseSave = false;
      await form.getByLabel("System instructions", { exact: true }).press("Control+Enter");
      await form.waitFor({ state: "detached" });
      const saved = writes.filter(item => item.method === "PUT").at(-1).body;
      assert.equal(saved.scope, "global");
      assert.deepEqual(saved.profile.tools, builtin.tools);
      assert.equal(saved.profile.codemode, "inherit");
      assert.equal(saved.profile.inheritContext, true);
      assert.equal(saved.profile.mcp, "off");
      assert.deepEqual(saved.profile.skills, ["review"]);
      assert.deepEqual(saved.profile.extensions, ["custom-extension"]);
      assert.equal(saved.profile.promptMode, "replace");
      await agents.getByRole("button", { name: "Edit template", exact: true }).click();
      assert.equal(await agents.getByRole("button", { name: "Save", exact: true }).isDisabled(), true);
      await form.getByLabel("Display name", { exact: true }).fill("Temporary name");
      await agents.getByRole("button", { name: "Cancel", exact: true }).click();
      await agents.locator(".agents-profile-title").filter({ hasText: "Project reviewer" }).waitFor();
      await agents.getByRole("button", { name: "Delete", exact: true }).click();
      const deleteDialog = page.getByRole("dialog", { name: "Delete Project reviewer?", exact: true });
      await deleteDialog.waitFor();
      assert.equal(await deleteDialog.getByRole("button", { name: "Cancel", exact: true }).evaluate(el => el === document.activeElement), true);
      await page.keyboard.press("Escape");
      await deleteDialog.waitFor({ state: "detached" });
      assert.equal(writes.filter(item => item.method === "DELETE").length, 0);
      await agents.getByRole("button", { name: "Delete", exact: true }).click();
      await deleteDialog.getByRole("button", { name: "Delete", exact: true }).click();
      await agents.locator(".agents-profile-title").filter({ hasText: "Explore" }).waitFor();
      assert.equal(writes.filter(item => item.method === "DELETE").length, 1);
      if (width === 1440) {
        const concurrency = agents.getByLabel("Concurrent sub-agents", { exact: true });
        await concurrency.fill("0"); await concurrency.blur();
        await agents.getByRole("alert").filter({ hasText: "1 to 32" }).waitFor();
        assert.equal(writes.filter(item => item.path.endsWith("/settings")).length, 0);
        await concurrency.fill("5"); await concurrency.blur();
        await page.waitForFunction(() => !document.querySelector('.agents-concurrency-control input').disabled);
        assert.equal(settings.maxConcurrent, 5);
        await concurrency.focus(); await concurrency.blur();
        assert.equal(writes.filter(item => item.path.endsWith("/settings")).length, 1, "unchanged concurrency does not save again");
      }
      assert.deepEqual(errors, []);
      console.log(`PASS agent templates ${theme} ${width}px: read-only overview, duplicate, permissions, discard/Escape, failed save/retry, cancel, dirty state and layout`);
    } catch (error) {
      await page.screenshot({ path: resolve(artifacts, `failure-${theme}-${width}.png`), fullPage: true });
      throw error;
    } finally { await context.close(); }
  }
} finally { await browser.close(); }
