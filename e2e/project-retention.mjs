// Isolated API fixtures: never writes real project/session state or sends prompts.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createJiti } from "jiti";

const { applySessionUiStateRequest, emptySessionUiState } = await createJiti(import.meta.url).import("../lib/session-ui-state-shared.ts");
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/project-retention");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true,
  channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
try {
  for (const width of [1440, 390]) {
    let state = emptySessionUiState();
    let failRemoval = false;
    const errors = [];
    const unexpectedWrites = [];
    const a = "D:/workspace/empty-alpha";
    const b = "D:/workspace/empty-beta";
    const context = await browser.newContext({ viewport: { width, height: 960 } });
    await context.addInitScript(() => {
      localStorage.setItem("pi-locale", "zh-CN");
      localStorage.setItem("pi-web:pet-visible", "false");
    });
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await context.route("**/api/**", async route => {
      const request = route.request();
      const url = new URL(request.url());
      const path = url.pathname;
      const reply = json => route.fulfill({ json });
      if (path === "/api/sessions/ui-state") {
        if (request.method() === "POST") {
          const body = request.postDataJSON();
          if (failRemoval && body.action === "remove-project") {
            failRemoval = false;
            return route.fulfill({ status: 500, json: { error: "fixture save failure" } });
          }
          const result = applySessionUiStateRequest(state, body, Date.now());
          state = { ...result.state, revision: state.revision + Number(result.changed) };
        }
        return reply({ state });
      }
      if (path === "/api/sessions") return reply({ sessions: [], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: state.revision, sessionListVersion: 1 });
      if (path === "/api/cwd/validate") {
        const { cwd } = request.postDataJSON();
        return reply({ cwd, projectRoot: cwd, projectKey: cwd });
      }
      if (path === "/api/worktrees") {
        const cwd = url.searchParams.get("cwd");
        return reply({ projectRoot: cwd, projectKey: cwd, isGit: true, isTopLevel: true, currentWorktreePath: cwd,
          worktrees: [{ path: cwd, branch: "main", isMain: true }] });
      }
      if (path === "/api/project-trust") return reply({ requiresTrust: false, trusted: true, mcpServers: [] });
      if (path === "/api/models") return reply({ models: {}, modelList: [], defaultModel: null });
      if (path === "/api/git/status") return reply({ isGit: false, files: [] });
      if (path === "/api/home") return reply({ home: "D:/workspace" });
      if (path.startsWith("/api/files/")) {
        const type = url.searchParams.get("type");
        if (type === "list") return reply({ entries: [{ name: "readme.md", isDir: false, size: 14 }] });
        if (type === "read") return reply({ content: "# Empty project", language: "markdown", size: 15, nextOffset: 15, truncated: false });
        if (type === "meta") return reply({ size: 15, mtimeMs: 1 });
        if (type === "watch") return route.fulfill({ contentType: "text/event-stream", body: "" });
      }
      if (request.method() !== "GET") unexpectedWrites.push(`${request.method()} ${path}`);
      return reply({});
    });
    const group = name => page.locator(".session-tree-group").filter({ has: page.locator(".session-tree-group-toggle", { hasText: name }) });
    const showSidebar = async () => {
      if (width < 640) {
        const toggle = page.locator(".workspace-sidebar-toggle");
        await toggle.waitFor();
        if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
      }
    };
    const waitUntil = async predicate => {
      for (let n = 0; n < 100; n++) {
        if (await predicate()) return;
        await page.waitForTimeout(100);
      }
      assert.fail("Timed out waiting for project state");
    };
    const remove = async name => {
      await group(name).hover();
      await group(name).getByRole("button", { name: `${name} 的操作`, exact: true }).click();
      await page.getByRole("menuitem", { name: "从列表移除", exact: true }).click();
    };
    await page.goto(`${base}/?cwd=${encodeURIComponent(a)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await waitUntil(() => !!state.projects[a]);
    await page.goto(`${base}/?cwd=${encodeURIComponent(b)}`, { waitUntil: "domcontentloaded" });
    await waitUntil(() => !!state.projects[b]);
    await showSidebar();
    await group("empty-alpha").waitFor();
    await group("empty-beta").waitFor();
    const openProject = page.locator('[data-row-key="section-projects"]').getByRole("button", { name: "创建项目", exact: true });
    await openProject.waitFor();
    assert.equal(await page.locator('[data-row-key="footer-open"]').count(), 0, "the project opener lives only in the heading");
    await openProject.click();
    await page.getByRole("dialog", { name: "创建项目", exact: true }).waitFor();
    await page.keyboard.press("Escape");
    await waitUntil(() => openProject.evaluate(button => document.activeElement === button));
    if (width >= 1200) assert.equal(await page.locator(".right-panel-container.right-panel-open").count(), 0, "opening the project picker keeps Files closed");
    await page.reload({ waitUntil: "domcontentloaded" });
    await showSidebar();
    await group("empty-alpha").waitFor();
    await group("empty-beta").waitFor();
    failRemoval = true;
    await remove("empty-alpha");
    await page.getByText("保存失败：fixture save failure", { exact: true }).waitFor();
    await group("empty-alpha").waitFor();
    assert.ok(state.projects[a], "refused removal retains saved project");
    await remove("empty-alpha");
    await group("empty-alpha").waitFor({ state: "detached" });
    await remove("empty-beta");
    await group("empty-beta").waitFor({ state: "detached" });
    await waitUntil(() => !!state.removedProjects?.[b]);
    await page.reload({ waitUntil: "domcontentloaded" });
    await showSidebar();
    await page.locator('.project-picker.is-row .is-project:not(.is-empty), .project-picker.is-stacked .is-project:not(.is-empty)').first().waitFor({ state: "attached" });
    await openProject.waitFor();
    assert.equal(await group("empty-alpha").count(), 0);
    assert.equal(await group("empty-beta").count(), 0, "the active cwd cannot resurrect a removed group");
    await openProject.click();
    const createDialog = page.getByRole("dialog", { name: "创建项目", exact: true });
    await createDialog.getByRole("combobox", { name: "选择已有项目文件夹" }).selectOption(b);
    await createDialog.getByRole("button", { name: "创建项目", exact: true }).click();
    await group("empty-beta").waitFor();
    await waitUntil(() => !!state.projects[b] && !state.removedProjects?.[b]);
    assert.equal(state.removedProjects[a] > 0, true, "reopening only restores the chosen project");
    if (width >= 1200) {
      await page.locator(".workspace-files-toggle").filter({ visible: true }).first().click();
      await page.locator("#session-sidebar-panel-files").getByText("readme.md", { exact: true }).click();
      await page.getByRole("heading", { name: "Empty project", exact: true }).waitFor();
    }
    await page.screenshot({ path: resolve(artifacts, `retained-${width}.png`) });
    assert.deepEqual(unexpectedWrites, [], "opening/removing projects creates no session or prompt");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: desktop/mobile empty-project retention, switching, reload, failed-save rollback, active removal and explicit reopening without session writes");
} finally {
  await browser.close();
}
