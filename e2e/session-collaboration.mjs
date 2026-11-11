// Isolated browser fixtures: no real sessions, model runs or settings writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/session-collaboration");
await mkdir(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
const cwd = "D:/workspace/collaboration";
const root = { id: "collaboration-main", name: "你好", path: "", cwd, projectRoot: cwd, projectKey: cwd,
  firstMessage: "你好", messageCount: 2, created: "2026-11-10T00:00:00Z", modified: "2026-11-11T00:00:00Z" };
const side = { ...root, id: "collaboration-side", name: "侧聊", relation: { kind: "side", parentSessionId: root.id } };
const child = (id, status, description) => ({ ...root, id, name: description,
  relation: { kind: "subagent", parentSessionId: root.id, profile: "explore", status, description } });
const worker = child("collaboration-worker", "running", "梳理项目结构");
const failed = child("collaboration-failed", "failed", "检查依赖");
const queued = child("collaboration-queued", "queued", "排队任务");
let sessions = [root, side, worker, failed, queued];
const usage = (tokens, modelId = "fixture-model", thinkingLevel = "high") => ({ tokens: { input: tokens, output: 0, cacheRead: 0, cacheWrite: 0, total: tokens },
  cost: .002, toolCalls: 12, totalActiveMs: 24000, model: { provider: "fixture", modelId }, thinkingLevel });
const stats = { [root.id]: usage(930000), [side.id]: usage(1200, "Jfclaw-1.0", "max"), [worker.id]: usage(5200), [failed.id]: usage(400) };
const commands = [], detailReads = [], forks = [], deletes = [], statsRequests = [], errors = [];
let failFork = true, failDelete = true;
await context.addInitScript(() => { localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-yun-pet-visible", "0"); });
await context.route("**/api/**", async route => {
  const request = route.request(), path = new URL(request.url()).pathname;
  const reply = json => route.fulfill({ json });
  if (path === "/api/sessions") return reply({ sessions, sessionListVersion: sessions.length, runningSessionIds: [worker.id], awaitingInputSessionIds: [] });
  if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
  if (path === "/api/agent/running") return reply({ runningSessionIds: [worker.id], awaitingInputSessionIds: [], sessionListVersion: sessions.length });
  if (path === "/api/sessions/stats") { statsRequests.push(request.postDataJSON().ids); return reply({ stats }); }
  if (path === "/api/models") return reply({ models: {}, modelList: [], defaultModel: null });
  if (path === "/api/home") return reply({ home: "C:/Users/test" });
  if (path === "/api/web-auth") return reply({ enabled: false });
  if (path === "/api/git/status") return reply({ isGit: false, files: [] });
  if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
  if (path === "/api/app-update") return reply({ latestVersion: "0.3.3" });
  if (path.endsWith("/fork")) {
    forks.push(request.postDataJSON());
    if (failFork) return route.fulfill({ status: 409, json: { error: "side chat fixture refusal" } });
    const created = { ...side, id: "collaboration-new-side", name: "新侧聊" };
    sessions = [...sessions, created]; return reply({ sessionId: created.id, session: created });
  }
  if (request.method() === "DELETE") {
    deletes.push(path);
    if (failDelete) return route.fulfill({ status: 500, json: { error: "delete fixture failure" } });
    sessions = sessions.filter(session => !path.endsWith(session.id)); return reply({ success: true });
  }
  const session = sessions.find(session => path === `/api/sessions/${session.id}`);
  if (session) {
    detailReads.push(session.id);
    return reply({ sessionId: session.id, info: session, filePath: "", tree: [], leafId: null, totalActiveMs: 0,
      context: { messages: [{ role: "user", content: "你好", timestamp: 1794355200000 }], entryIds: ["greeting"], hasMore: false, thinkingLevel: "off", model: null } });
  }
  if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
  if (path.startsWith("/api/agent/") && request.method() === "POST") {
    const command = request.postDataJSON();
    if (command?.type) commands.push(command.type);
    return reply({ success: true, data: command?.type === "get_tools" ? [] : {} });
  }
  if (path.startsWith("/api/agent/")) return reply({ running: false, state: { isStreaming: false, messages: [] } });
  return reply({});
});
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
const panel = page.locator('[data-workspace-page="agents"]');
const inspect = id => panel.locator(`[data-collaboration-session="${id}"]`);
const detail = panel.getByRole("region", { name: "会话详情", exact: true });
const open = () => page.locator('[data-workspace-view="agents"]:visible').click();

try {
  await page.goto(`${base}/?session=${root.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const composer = page.locator("textarea.chat-input-textarea:visible").first();
  await composer.fill("保留当前草稿");
  await open();
  await panel.getByRole("heading", { name: "会话协作", exact: true }).waitFor();
  await detail.getByText("930k tokens", { exact: true }).waitFor();
  assert.ok(statsRequests.some(ids => sessions.every(session => ids.includes(session.id))));
  assert.match(await panel.innerText(), /1 个主会话 · 1 个侧聊 · 3 个子 Agent/);
  const readsBefore = [...detailReads], commandsBefore = [...commands];
  await inspect(side.id).click();
  await detail.getByText("Jfclaw-1.0", { exact: true }).waitFor();
  assert.match(await detail.innerText(), /max/);
  assert.deepEqual(detailReads, readsBefore, "Inspecting never loads or revives the child's chat");
  assert.deepEqual(commands, commandsBefore, "Inspecting never sends agent commands");
  assert.ok(page.url().includes(root.id));
  await inspect(queued.id).focus();
  await page.keyboard.press("End");
  await detail.getByRole("heading", { name: "排队任务", exact: true }).waitFor();
  assert.match(await detail.innerText(), /排队中/);
  assert.match(await detail.innerText(), /—/);
  assert.doesNotMatch(await detail.innerText(), /\$0\.00/, "Missing stats stay unknown");
  stats[queued.id] = usage(2000, "late-recorded-model", "off");
  await detail.getByText("late-recorded-model", { exact: true }).waitFor();
  assert.doesNotMatch(await detail.innerText(), /思考深度/);
  await page.keyboard.press("Home");
  await detail.getByRole("heading", { name: "你好", exact: true }).waitFor();
  await detail.getByRole("button", { name: "继续对话", exact: true }).click();
  await composer.waitFor();
  assert.equal(await composer.inputValue(), "保留当前草稿");
  await open();
  await panel.getByRole("button", { name: "新建侧聊", exact: true }).click();
  await panel.getByRole("alert").filter({ hasText: "side chat fixture refusal" }).waitFor();
  assert.deepEqual(forks, [{ side: true }]);
  assert.equal(await panel.getByRole("button", { name: "新建侧聊", exact: true }).isEnabled(), true);
  await inspect(side.id).click();
  await detail.getByRole("button", { name: "更多", exact: true }).click();
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  await page.waitForFunction(() => document.activeElement?.classList.contains("session-tree-confirm-cancel"));
  await page.keyboard.press("Escape");
  assert.equal(await panel.count(), 1, "Escape cancels deletion before leaving the page");
  assert.equal(await detail.getByRole("button", { name: "更多", exact: true }).evaluate(el => el === document.activeElement), true);
  assert.deepEqual(deletes, []);
  const deleteFromMore = async () => {
    await detail.getByRole("button", { name: "更多", exact: true }).click();
    await page.getByRole("menuitem", { name: "删除", exact: true }).click();
    await detail.locator(".session-tree-confirm-delete").click();
  };
  await deleteFromMore();
  await panel.getByRole("alert").filter({ hasText: "delete fixture failure" }).waitFor();
  assert.equal(await inspect(side.id).count(), 1);
  failDelete = false;
  await deleteFromMore();
  await inspect(side.id).waitFor({ state: "detached" });
  await detail.getByRole("heading", { name: "你好", exact: true }).waitFor();
  await inspect(worker.id).click();
  await detail.getByRole("heading", { name: "梳理项目结构", exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifacts, "desktop-light.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; document.documentElement.classList.add("dark"); });
  await page.screenshot({ path: resolve(artifacts, "desktop-dark.png") });
  for (const width of [780, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await inspect(root.id).click();
    await inspect(failed.id).click();
    await detail.getByRole("heading", { name: "检查依赖", exact: true }).waitFor();
    assert.equal(await panel.evaluate(el => el.scrollWidth <= el.clientWidth), true, `${width}px page has no overflow`);
    assert.equal(await detail.evaluate(el => el.scrollWidth <= el.clientWidth), true, `${width}px details have no overflow`);
    await page.screenshot({ path: resolve(artifacts, `layout-${width}.png`) });
  }
  await page.setViewportSize({ width: 1440, height: 960 });
  await inspect(root.id).click();
  await detail.getByRole("button", { name: "继续对话", exact: true }).click();
  assert.equal(await composer.inputValue(), "保留当前草稿");
  await open(); failFork = false;
  await panel.getByRole("button", { name: "新建侧聊", exact: true }).click();
  await panel.getByText("1 个主会话 · 1 个侧聊 · 3 个子 Agent", { exact: true }).waitFor();
  assert.equal(forks.length, 2);
  assert.ok(page.url().includes(root.id), "New side chat leaves the main conversation selected");
  sessions = [...sessions, ...Array.from({ length: 7 }, (_, index) => child(`collaboration-extra-${index}`, "completed", `更多任务 ${index}`))];
  await page.reload({ waitUntil: "domcontentloaded" });
  await open();
  const search = panel.getByRole("searchbox", { name: "搜索 Agents", exact: true });
  await search.fill("更多任务 3");
  assert.equal(await panel.locator("[data-collaboration-session]").count(), 2, "Filtering keeps the main session plus matching children");
  await inspect("collaboration-extra-3").click();
  await detail.getByRole("heading", { name: "更多任务 3", exact: true }).waitFor();
  await search.fill("does-not-exist");
  await panel.getByText("没有匹配的 Agent", { exact: true }).waitFor();
  await detail.getByRole("heading", { name: "你好", exact: true }).waitFor();
  await search.fill("");
  await page.setViewportSize({ width: 320, height: 900 });
  await inspect("collaboration-extra-6").click();
  await detail.getByRole("heading", { name: "更多任务 6", exact: true }).waitFor();
  const listHeight = await panel.getByRole("navigation", { name: "选择会话", exact: true }).evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight }));
  assert.ok(listHeight.height <= 340 && listHeight.scroll > listHeight.height, "Long lists scroll independently on phones so details remain reachable");
  assert.equal(commands.includes("prompt"), false);
  assert.equal(commands.includes("abort"), false);
  assert.deepEqual(errors, []);
  console.log("PASS: split list/details, keyboard inspection without chat reads, live stats, unknown usage, queued status, retained draft, create refusal/retry, delete cancel/failure/success, desktop/mobile/dark bounds");
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, "failure.png") });
  throw error;
} finally { await browser.close(); }
