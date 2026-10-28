// Run against the existing dev server. All API state is isolated in browser fixtures.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createJiti } from "jiti";

const { applySessionUiStateRequest, emptySessionUiState } = await createJiti(import.meta.url).import("../lib/session-ui-state-shared.ts");
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/project-create");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true,
  channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
try {
  for (const [width, theme] of [[1440, "light"], [1440, "dark"], [390, "light"]]) {
    const a = "D:/workspace/alpha";
    const b = `D:/workspace/${"long-folder-".repeat(6)}beta`;
    const defaultCwd = "D:/pi-cwd/20261029";
    let state = applySessionUiStateRequest(emptySessionUiState(), { action: "pin-project", projectKey: a, root: a, pinned: true }, 1).state;
    let failValidation = false;
    let failSave = false;
    const errors = [];
    const unexpectedWrites = [];
    const createRequests = [];
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    await context.addInitScript(({ theme }) => {
      localStorage.setItem("pi-locale", "zh-CN");
      localStorage.setItem("pi-theme", theme);
      localStorage.setItem("pi-web:pet-visible", "false");
    }, { theme });
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
          if (body.action === "create-project") {
            createRequests.push(body);
            await new Promise(resolve => setTimeout(resolve, 150));
            if (failSave) {
              failSave = false;
              return route.fulfill({ status: 500, json: { error: "fixture save failure" } });
            }
          }
          const result = applySessionUiStateRequest(state, body, Date.now());
          state = { ...result.state, revision: state.revision + Number(result.changed) };
        }
        return reply({ state });
      }
      if (path === "/api/sessions") return reply({ sessions: [], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: state.revision, sessionListVersion: 1 });
      if (path === "/api/cwd/browse") {
        const folder = url.searchParams.get("path") || a;
        return reply({ path: folder, parentPath: "D:/workspace", directories: [{ name: "child", path: `${folder}/child` }] });
      }
      if (path === "/api/default-cwd") return reply({ cwd: defaultCwd });
      if (path === "/api/cwd/validate") {
        if (failValidation) {
          failValidation = false;
          return route.fulfill({ status: 400, json: { error: "Directory is unavailable" } });
        }
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
        if (url.searchParams.get("type") === "list") return reply({ entries: [] });
        if (url.searchParams.get("type") === "watch") return route.fulfill({ contentType: "text/event-stream", body: "" });
      }
      if (request.method() !== "GET") unexpectedWrites.push(`${request.method()} ${path}`);
      return reply({});
    });
    async function showSidebar() {
      if (width < 640) {
        const toggle = page.locator(".workspace-sidebar-toggle");
        await toggle.waitFor();
        if (await toggle.getAttribute("aria-expanded") === "false") await toggle.click();
      }
    }
    const opener = page.locator('[data-row-key="section-projects"]').getByRole("button", { name: "创建项目", exact: true });
    const dialog = page.getByRole("dialog", { name: "创建项目", exact: true });
    const name = dialog.getByRole("textbox", { name: "项目名称", exact: true });
    const create = dialog.getByRole("button", { name: "创建项目", exact: true });
    await page.goto(`${base}/?cwd=${encodeURIComponent(a)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await showSidebar();
    await opener.click();
    await name.waitFor();
    assert.equal(await name.evaluate(element => element === document.activeElement), true);
    assert.equal(await create.isDisabled(), true);
    await page.screenshot({ path: resolve(artifacts, `empty-${width}-${theme}.png`) });
    await name.fill("取消草稿");
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
    assert.equal(await opener.evaluate(element => element === document.activeElement), true);
    assert.equal(createRequests.length, 0);

    await opener.click();
    await dialog.getByRole("button", { name: "添加", exact: true }).click();
    const picker = page.locator(".directory-picker-backdrop");
    await picker.waitFor();
    await page.keyboard.press("Escape");
    await picker.waitFor({ state: "detached" });
    await dialog.waitFor();
    await page.waitForFunction(() => document.activeElement?.textContent === "添加");
    assert.equal(await dialog.getByRole("button", { name: "添加", exact: true }).evaluate(element => element === document.activeElement), true);
    await dialog.getByRole("button", { name: "添加", exact: true }).click();
    await picker.locator("#directory-path").fill(b);
    await picker.locator("form").first().evaluate(form => form.requestSubmit());
    await picker.getByRole("button", { name: "选择此文件夹", exact: true }).click();
    await picker.waitFor({ state: "detached" });
    assert.equal(await name.inputValue(), b.split("/").at(-1));
    await name.fill("云端工作台");
    await page.screenshot({ path: resolve(artifacts, `selected-${width}-${theme}.png`) });
    assert.equal(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth), true, "long paths wrap within the dialog");
    // Tab wraps within the modal, including reverse Tab from its first control.
    await create.focus();
    await page.keyboard.press("Tab");
    assert.equal(await dialog.getByRole("button", { name: "关闭", exact: true }).evaluate(element => element === document.activeElement), true);
    await page.keyboard.press("Shift+Tab");
    assert.equal(await create.evaluate(element => element === document.activeElement), true);

    failValidation = true;
    await create.click();
    await dialog.getByRole("alert").filter({ hasText: "Directory is unavailable" }).waitFor();
    assert.equal(createRequests.length, 0);
    failSave = true;
    await create.click();
    await dialog.getByRole("alert").filter({ hasText: "项目保存失败" }).waitFor();
    assert.equal(await name.inputValue(), "云端工作台");
    assert.equal(state.projects[b], undefined);
    await create.click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(state.projectNames[b], "云端工作台");
    assert.equal(state.projects[b].root, b);
    assert.equal(createRequests.length, 2, "one failed request and one successful retry");
    await page.reload({ waitUntil: "domcontentloaded" });
    await showSidebar();
    await page.locator(".session-tree-group-name").getByText("云端工作台", { exact: true }).waitFor();
    await opener.click();
    await dialog.getByRole("combobox", { name: "选择已有项目文件夹" }).selectOption(b);
    assert.equal(await name.inputValue(), "云端工作台", "reopening preserves the existing alias");
    await dialog.getByRole("button", { name: "移除来源文件夹" }).click();
    assert.equal(await create.isDisabled(), true);
    await dialog.getByRole("button", { name: "使用默认目录" }).click();
    await name.fill("默认项目");
    await create.click();
    await dialog.waitFor({ state: "detached" });
    assert.equal(state.projectNames[defaultCwd], "默认项目");
    assert.deepEqual(unexpectedWrites, [], "no prompts, sessions or unexpected writes");
    assert.deepEqual(errors, []);
    await context.close();
  }
  console.log("PASS: project dialog desktop/mobile/light/dark, nested browse/Escape, focus, validation, atomic save failure/retry, alias restoration and default folder");
} finally {
  await browser.close();
}
