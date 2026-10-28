import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export async function checkArchiveWorkspace({ browser, base, artifacts }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
  const page = await context.newPage();
  await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  const payment = "D:/work/payment";
  const tools = "D:/work/tools";
  const archivedAt = Date.parse("2026-10-25T00:00:00Z");
  const info = (id, name, cwd) => ({ id, name, cwd, projectRoot: cwd, projectKey: cwd, path: "", firstMessage: name, messageCount: 2,
    created: "2026-10-20T00:00:00Z", modified: "2026-10-21T00:00:00Z" });
  const live = info("archive-live", "当前正在处理的项目任务", payment);
  const a = info("archive-a", "修复支付回调的重复通知", payment);
  const b = info("archive-b", "整理工具服务的接口说明", tools);
  const child = { ...info("archive-child", "归档任务中的子代理", payment), relation: { kind: "subagent", parentSessionId: a.id, profile: "test", description: "child", status: "completed" } };
  const sessions = [live, a, b, child];
  const state = { version: 1, revision: 1, sessions: { [a.id]: { archivedAt, pinnedAt: archivedAt - 1 }, [b.id]: { archivedAt: archivedAt - 1000 } },
    projects: {}, projectOrder: [payment, tools], projectNames: { [payment]: "支付项目", [tools]: "工具项目" } };
  const writes = [];
  const commands = [];
  const errors = [];
  let refuseRestore = true;
  const deletes = [];
  let refuseDelete = true;
  let keepRunningOnce = true;
  let holdDelete = false;
  let releaseDelete = null;
  page.on("pageerror", error => errors.push(error.message));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const reply = json => route.fulfill({ json });
    if (path === "/api/sessions/delete" && request.method() === "POST") {
      const { ids } = request.postDataJSON();
      deletes.push(ids);
      if (holdDelete) await new Promise(resolve => { releaseDelete = resolve; });
      if (refuseDelete) { refuseDelete = false; return route.fulfill({ status: 503, json: { error: "Fixture delete failure" } }); }
      if (keepRunningOnce) { keepRunningOnce = false; return reply({ deleted: [], running: ids, missing: [] }); }
      const deleted = sessions.filter(session => ids.includes(session.id) || ids.includes(session.relation?.parentSessionId)).map(session => session.id);
      for (const id of deleted) {
        sessions.splice(sessions.findIndex(session => session.id === id), 1);
        delete state.sessions[id];
      }
      state.revision++;
      return reply({ deleted, running: [], missing: [] });
    }
    if (path === "/api/sessions/ui-state") {
      if (request.method() === "POST") {
        const body = request.postDataJSON();
        writes.push(body);
        if (body.action === "set" && body.archived === false) {
          if (refuseRestore) { refuseRestore = false; return route.fulfill({ status: 503, json: { error: "Fixture restore failure" } }); }
          for (const id of body.ids) { delete state.sessions[id].archivedAt; }
          state.revision++;
        }
      }
      return reply({ state });
    }
    if (path === "/api/sessions") return reply({ sessions, runningSessionIds: [], awaitingInputSessionIds: [], sessionListVersion: 1 });
    if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: state.revision, sessionListVersion: 1 });
    if (path === "/api/worktrees") {
      const cwd = url.searchParams.get("cwd") || payment;
      return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
    }
    if (path === "/api/models") return reply({ models: [], modelList: [], defaultModel: null });
    if (path === "/api/home") return reply({ home: "C:/Users/test" });
    if (path === "/api/project-trust") return reply({ requiresTrust: false, trusted: true, mcpServers: [] });
    const selected = sessions.find(session => path === `/api/sessions/${session.id}`);
    if (selected) return reply({ info: selected, sessionId: selected.id, filePath: "", tree: [], leafId: null, totalActiveMs: 0,
      context: { messages: [{ role: "user", content: selected.name, timestamp: 1792540800000 }, { role: "assistant", content: [{ type: "text", text: "会话内容保持原样。" }], timestamp: 1792540801000, stopReason: "stop" }],
        entryIds: ["u1", "a1"], oldestEntryId: "u1", hasMore: false, turnsBefore: 0, thinkingLevel: "off", model: null } });
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
    if (path.startsWith("/api/agent/") && request.method() === "POST") {
      commands.push(request.postDataJSON()?.type);
      return reply({ success: true, data: {} });
    }
    return reply({});
  });

  const footer = page.locator("[data-archive-entry]");
  const pane = page.locator("[data-workspace-page=archive]");
  const row = id => pane.locator(`[data-archived-session="${id}"]`);
  const sidebarRow = name => page.locator("#session-sidebar-panel-sessions .session-tree-session").filter({ hasText: name });
  const checkToastAboveArchive = async () => {
    const toast = page.locator(".sidebar-toast");
    await toast.waitFor();
    await toast.evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
    const toastBox = await toast.boundingBox();
    const archiveBox = await footer.boundingBox();
    assert.ok(toastBox.y + toastBox.height <= archiveBox.y - 8, "operation toasts leave the fixed archive entry unobstructed");
    assert.equal(await footer.evaluate(el => {
      const box = el.getBoundingClientRect();
      return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
    }), true, "the archive entry remains clickable through every toast");
  };
  try {
    await page.goto(`${base}/?session=${live.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await footer.getByText("2", { exact: true }).waitFor({ timeout: 90000 });
    await page.locator(".workspace-chat-view textarea").first().fill("未发送的草稿");
    await page.locator(".workspace-chat-view textarea").first().evaluate(element => { element.dataset.instance = "original"; });
    assert.equal(await sidebarRow(a.name).count(), 0);
    assert.equal(await sidebarRow(b.name).count(), 0);
    const footerTop = (await footer.boundingBox()).y;
    await footer.click();
    await row(a.id).waitFor();
    assert.equal(await pane.locator("[data-archived-session]").count(), 2);
    assert.equal(await pane.getByText(child.name, { exact: true }).count(), 0);
    assert.equal(await footer.getAttribute("aria-current"), "page");
    assert.equal(await page.locator("[data-workspace-view=home]").getAttribute("aria-current"), null);
    assert.ok(await sidebarRow(live.name).isVisible(), "opening the archive leaves the live project list visible");
    assert.equal(await page.locator(".workspace-chat-view textarea").first().getAttribute("data-instance"), "original");
    assert.equal((await footer.boundingBox()).y, footerTop);
    await page.screenshot({ path: resolve(artifacts, "archive-workspace.png") });
    const search = pane.getByRole("searchbox", { name: "搜索标题或项目…" });
    await search.fill("工具");
    assert.equal(await pane.locator("[data-archived-session]").count(), 1);
    await search.press("Escape");
    assert.ok(await pane.isVisible());
    await pane.getByRole("combobox", { name: "按项目筛选" }).selectOption(payment);
    assert.equal(await pane.locator("[data-archived-session]").count(), 1);
    await pane.getByRole("combobox", { name: "按项目筛选" }).selectOption("");
    await search.fill("nothing-matches");
    await pane.getByText("没有符合搜索条件的归档会话。", { exact: true }).waitFor();
    await search.fill("");
    await row(b.id).getByRole("link").click();
    await page.waitForURL(`**/?session=${b.id}`);
    assert.equal(writes.filter(write => write.action === "set").length, 0, "viewing does not restore a session");
    await footer.click();
    await row(a.id).locator(".archive-workspace-restore").click();
    await row(a.id).getByText("恢复失败，请重试。", { exact: true }).waitFor();
    await checkToastAboveArchive();
    await footer.getByText("2", { exact: true }).waitFor();
    await row(a.id).locator(".archive-workspace-restore").click();
    await row(a.id).waitFor({ state: "detached" });
    await footer.getByText("1", { exact: true }).waitFor();
    await sidebarRow(a.name).waitFor();
    assert.equal(state.sessions[a.id].pinnedAt, archivedAt - 1);
    await row(b.id).locator(".archive-workspace-restore").click();
    await pane.getByText("没有已归档的会话", { exact: true }).waitFor();
    await footer.getByText("0", { exact: true }).waitFor();
    await sidebarRow(b.name).waitFor();
    assert.ok(await footer.isVisible(), "the entry remains when the archive is empty");
    const restoreWrites = writes.filter(write => write.action === "set");
    assert.deepEqual(restoreWrites.map(write => write.ids), [[a.id], [a.id], [b.id]]);
    assert.ok(restoreWrites.every(write => write.archived === false));
    await page.setViewportSize({ width: 390, height: 844 });
    await page.locator(".workspace-sidebar-toggle").click();
    await footer.click();
    await page.waitForFunction(() => document.querySelector("#session-sidebar").getBoundingClientRect().right <= 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(artifacts, "archive-mobile.png") });
    for (const session of [live, a, b]) state.sessions[session.id] = { ...state.sessions[session.id], archivedAt };
    state.revision++;
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${base}/?home=1`, { waitUntil: "domcontentloaded" });
    await footer.getByText("3", { exact: true }).waitFor();
    assert.equal(await page.locator(".home-session").count(), 0, "Home excludes archived tasks");
    await footer.click();
    await pane.locator("[data-archived-session]").first().waitFor();
    assert.equal(await pane.locator("[data-archived-session]").count(), 3, "all archived projects remain reachable");
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.screenshot({ path: resolve(artifacts, "archive-dark.png") });
    const deleteButton = () => row(a.id).locator(".archive-workspace-delete");
    const confirmation = () => row(a.id).locator(".archive-delete-confirmation");
    await deleteButton().click();
    await confirmation().getByRole("button", { name: "取消", exact: true }).waitFor();
    assert.equal(await confirmation().getByRole("button", { name: "取消", exact: true }).evaluate(element => document.activeElement === element), true);
    await confirmation().getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(deletes.length, 0, "Cancel sends no delete request");
    await deleteButton().click();
    await page.keyboard.press("Escape");
    assert.equal(await confirmation().count(), 0);
    assert.ok(await pane.isVisible(), "Escape dismisses confirmation without leaving the archive");
    assert.equal(deletes.length, 0);
    await deleteButton().click();
    await page.screenshot({ path: resolve(artifacts, "archive-delete-confirm.png") });
    await confirmation().getByRole("button", { name: "删除", exact: true }).click();
    await row(a.id).getByRole("alert").waitFor();
    assert.ok(sessions.some(session => session.id === a.id), "a failed delete preserves the session");
    const runningResponse = page.waitForResponse(response => response.url().endsWith("/api/sessions/delete"));
    await confirmation().getByRole("button", { name: "删除", exact: true }).click();
    await runningResponse;
    await row(a.id).getByRole("alert").waitFor();
    assert.ok(sessions.some(session => session.id === child.id), "a running-family refusal preserves subagents");
    await confirmation().getByRole("button", { name: "删除", exact: true }).click();
    await row(a.id).waitFor({ state: "detached" });
    await footer.getByText("2", { exact: true }).waitFor();
    assert.equal(sessions.some(session => session.id === child.id), false, "successful deletion removes the archived family");
    await checkToastAboveArchive();
    await page.screenshot({ path: resolve(artifacts, "archive-toast-above-entry.png") });
    assert.ok(sessions.some(session => session.id === live.id), "other conversations are untouched");
    await row(b.id).getByRole("link").click();
    await page.waitForURL(`**/?session=${b.id}`);
    await footer.click();
    await row(b.id).locator(".archive-workspace-delete").click();
    await row(b.id).locator(".archive-delete-confirmation").getByRole("button", { name: "删除", exact: true }).click();
    await row(b.id).waitFor({ state: "detached" });
    await footer.getByText("1", { exact: true }).waitFor();
    assert.ok(await pane.isVisible(), "deleting the previously selected archived session keeps the archive open");
    assert.deepEqual(deletes, [[a.id], [a.id], [a.id], [b.id]]);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector("#session-sidebar").getBoundingClientRect().right <= 1);
    await page.locator(".workspace-sidebar-toggle").click();
    await footer.waitFor();
    await page.waitForFunction(() => document.querySelector("#session-sidebar").getBoundingClientRect().left >= 0);
    await checkToastAboveArchive();
    await page.screenshot({ path: resolve(artifacts, "archive-toast-mobile.png") });
    await footer.click();
    await page.waitForFunction(() => document.querySelector("#session-sidebar").getBoundingClientRect().right <= 1);
    await row(live.id).locator(".archive-workspace-delete").click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(artifacts, "archive-mobile-delete-confirm.png") });
    await row(live.id).locator(".archive-delete-confirmation").getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(deletes.length, 4);
    // The bulk action confirms all archived projects, even while filters hide rows.
    const bulkA = info("archive-bulk-a", "批量归档支付任务", payment);
    const bulkB = info("archive-bulk-b", "批量归档工具任务", tools);
    const bulkChild = { ...child, id: "archive-bulk-child", relation: { ...child.relation, parentSessionId: bulkA.id } };
    const newlyArchived = info("archive-later", "确认后才归档的任务", tools);
    sessions.push(bulkA, bulkB, bulkChild, newlyArchived);
    delete state.sessions[live.id].archivedAt;
    state.sessions[bulkA.id] = { archivedAt };
    state.sessions[bulkB.id] = { archivedAt };
    state.revision++;
    refuseDelete = true;
    keepRunningOnce = true;
    await page.setViewportSize({ width: 1440, height: 960 });
    await page.goto(`${base}/?session=${live.id}`, { waitUntil: "domcontentloaded" });
    await footer.getByText("2", { exact: true }).waitFor();
    await footer.click();
    await row(bulkA.id).waitFor();
    const clearButton = pane.locator(".archive-workspace-clear");
    const clearConfirmation = pane.locator(".archive-clear-confirmation");
    await search.fill("批量归档支付");
    await pane.getByRole("combobox", { name: "按项目筛选" }).selectOption(payment);
    assert.equal(await pane.locator("[data-archived-session]").count(), 1);
    await clearButton.click();
    await clearConfirmation.getByText("永久删除全部 2 个归档会话？", { exact: true }).waitFor();
    assert.equal(await clearConfirmation.getByRole("button", { name: "取消", exact: true }).evaluate(el => el === document.activeElement), true);
    await page.keyboard.press("Escape");
    await clearConfirmation.waitFor({ state: "detached" });
    assert.ok(await pane.isVisible());
    assert.equal(deletes.length, 4, "opening and cancelling sends no deletion request");
    await clearButton.click();
    await clearConfirmation.getByRole("button", { name: "取消", exact: true }).click();
    assert.equal(deletes.length, 4);
    await clearButton.click();
    await page.screenshot({ path: resolve(artifacts, "archive-clear-confirmation.png") });
    await clearConfirmation.getByRole("button", { name: "清空归档", exact: true }).click();
    const clearError = pane.getByText("部分归档未能删除，可能已恢复或开始运行，请刷新后重试。", { exact: true });
    await clearError.waitFor();
    assert.deepEqual([...deletes.at(-1)].sort(), [bulkA.id, bulkB.id].sort());
    assert.ok(sessions.some(session => session.id === bulkA.id));
    // A server-side running-family refusal leaves the remaining archive retryable.
    await clearButton.click();
    await clearConfirmation.getByRole("button", { name: "清空归档", exact: true }).click();
    await clearError.waitFor();
    assert.ok(sessions.some(session => session.id === bulkB.id));
    await clearButton.click();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector("#session-sidebar").getBoundingClientRect().right <= 1);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: resolve(artifacts, "archive-clear-mobile.png") });
    holdDelete = true;
    await Promise.all([
      page.waitForRequest(request => request.url().includes("/api/sessions/delete")),
      clearConfirmation.getByRole("button", { name: "清空归档", exact: true }).click(),
    ]);
    assert.equal(await clearButton.isDisabled(), true);
    assert.equal(await clearConfirmation.getByRole("button", { name: "取消", exact: true }).isDisabled(), true);
    assert.equal(await row(bulkA.id).locator(".archive-workspace-restore").isDisabled(), true);
    assert.equal(await row(bulkA.id).locator(".archive-workspace-delete").isDisabled(), true);
    await clearConfirmation.locator(".is-danger").evaluate(el => { el.click(); el.click(); });
    assert.equal(deletes.length, 7, "duplicate clicks cannot send overlapping batches");
    state.sessions[newlyArchived.id] = { archivedAt };
    state.revision++;
    holdDelete = false;
    releaseDelete();
    await clearConfirmation.waitFor({ state: "detached" });
    await footer.getByText("1", { exact: true }).waitFor();
    assert.equal(sessions.some(session => [bulkA.id, bulkB.id, bulkChild.id].includes(session.id)), false);
    assert.ok(sessions.some(session => session.id === live.id), "unarchived conversations remain untouched");
    assert.ok(sessions.some(session => session.id === newlyArchived.id), "a new archive is outside the confirmed snapshot");
    await search.fill("");
    await pane.getByRole("combobox", { name: "按项目筛选" }).selectOption("");
    await clearButton.click();
    await clearConfirmation.getByText("永久删除全部 1 个归档会话？", { exact: true }).waitFor();
    await clearConfirmation.getByRole("button", { name: "清空归档", exact: true }).click();
    await footer.getByText("0", { exact: true }).waitFor();
    await pane.getByText("没有已归档的会话", { exact: true }).waitFor();
    assert.equal(await clearButton.isDisabled(), true);
    assert.equal(commands.some(type => type === "prompt" || type === "abort"), false);
    assert.deepEqual(errors, []);
    console.log("PASS: archive navigation/search/restore, single and batch deletion, Cancel/Escape, failure/retry, running-family refusal, confirmed-id snapshot, family cleanup, unarchived protection, duplicate-submit guard, selected-session preservation, mobile/dark; no prompt/abort or browser errors.");
  } catch (error) {
    await page.screenshot({ path: resolve(artifacts, "archive-failure.png") }).catch(() => {});
    console.error({ deletes, errors, archiveErrors: await pane.getByRole("alert").allTextContents().catch(() => []) });
    throw error;
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const artifacts = resolve("test-results/archive-workspace");
  mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || undefined });
  try { await checkArchiveWorkspace({ browser, base: process.env.E2E_BASE_URL || "http://127.0.0.1:30141", artifacts }); }
  finally { await browser.close(); }
}
