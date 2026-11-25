// Isolated browser fixtures: no real sessions, model runs or settings writes.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/subagent-list");
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
worker.name = "恢复后检查项目结构";
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

sessions = [...sessions, child('beige', 'completed', 'Beige details'), child('gray', 'completed', 'Gray images'), child('setup', 'completed', 'Project setup')];
const openList = async () => {
  await page.getByRole('button', { name: '会话概览', exact: true }).click();
  await page.getByRole('dialog', { name: '会话概览', exact: true }).locator('[data-subagent-summary] button').click();
  const list = page.locator('#file-panel [data-subagent-list]');
  await list.waitFor();
  return list;
};
try {
  for (const [width, theme] of [[1440, 'light'], [1440, 'dark'], [390, 'light'], [320, 'light']]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto(base + '/?session=' + root.id, { waitUntil: 'domcontentloaded' });
    await page.evaluate(theme => { document.documentElement.dataset.theme = theme; document.documentElement.classList.toggle('dark', theme === 'dark'); }, theme);
    const mainComposer = page.locator('.workspace-conversation textarea.chat-input-textarea:visible').first();
    await mainComposer.fill('主聊天草稿保留');
    const readsBefore = detailReads.length;
    let list = await openList();
    assert.equal(detailReads.length, readsBefore, 'Listing never opens child histories');
    assert.equal(await list.locator('[data-subagent-id]').count(), 6, 'Only children');
    assert.match(await list.innerText(), /已开启 · 2/);
    assert.match(await list.innerText(), /已完成 · 3/);
    assert.match(await list.innerText(), /失败 · 1/);
    assert.equal(await page.getByRole('dialog').count(), 0, 'List is docked, not a floating dialog');
    const listTab = page.locator('#file-panel').getByRole('tab', { name: '子智能体', exact: true });
    assert.equal(await listTab.getAttribute('aria-selected'), 'true');
    if (width === 1440) {
      await page.waitForFunction(() => {
        const main = document.querySelector('.workspace-conversation').getBoundingClientRect();
        const dock = document.querySelector('#file-panel').getBoundingClientRect();
        return main.width > 200 && dock.width > 200 && main.right <= dock.left + 2;
      });
    }
    assert.equal(await page.locator('[data-workspace-page="agents"]').count(), 0);
    const box = await list.boundingBox();
    assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y >= 0 && box.y + box.height <= 961);
    assert.equal(await list.evaluate(el => el.scrollWidth <= el.clientWidth), true);
    await page.screenshot({ path: resolve(artifacts, 'list-' + width + '-' + theme + '.png'), animations: 'disabled' });
    if (width === 1440 && theme === 'light') await list.screenshot({ path: resolve(artifacts, 'list-detail.png'), animations: 'disabled' });
    await list.locator('[data-subagent-id="beige"]').click();
    await list.waitFor({ state: 'detached' });
    const dock = page.locator('#file-panel');
    await dock.getByRole('tab', { name: /Beige details/ }).waitFor();
    await dock.locator('textarea.chat-input-textarea:visible').waitFor();
    assert.equal(new URL(page.url()).searchParams.get('session'), root.id);
    assert.equal(await mainComposer.inputValue(), '主聊天草稿保留');
    assert.equal(await dock.getByRole('tab', { name: /Beige details/ }).count(), 1);
    if (width === 1440) {
      await dock.getByRole('tab', { name: '子智能体', exact: true }).click();
      await list.waitFor();
      await list.locator('[data-subagent-id="beige"]').click();
      await page.screenshot({ path: resolve(artifacts, 'side-chat-' + theme + '.png'), animations: 'disabled' });
      list = await openList();
      await list.locator('[data-subagent-id="beige"]').click();
      assert.equal(await dock.getByRole('tab', { name: /Beige details/ }).count(), 1);
    }
  }
  sessions = [root, ...Array.from({ length: 45 }, (_, i) => child('long-' + i, 'completed', 'Long task ' + i))];
  await page.goto(base + '/?session=' + root.id, { waitUntil: 'domcontentloaded' });
  const longList = await openList();
  await longList.getByText('没有已开启的子智能体', { exact: true }).waitFor();
  assert.equal(await longList.locator('[data-subagent-id]').count(), 45);
  assert.ok(await longList.evaluate(el => el.scrollHeight > el.clientHeight), 'Long lists scroll inside the dock');
  await longList.locator('[data-subagent-id="long-44"]').click();
  await page.locator('#file-panel').getByRole('tab', { name: /Long task 44/ }).waitFor();
  assert.equal(commands.includes('prompt'), false);
  assert.equal(commands.includes('abort'), false);
  assert.deepEqual(errors, []);
  console.log('PASS: summary to list to right-panel chat; preserved main URL/draft, docked layout and tab switching, one tab per child, long lists, desktop/dark/390/320px');
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, 'failure.png') });
  throw error;
} finally { await browser.close(); }
