// UI and polling fixtures only; never starts a model or writes a real session.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
const cwd = "D:\\yun-pi\\pi-web-yun";
const sessions = [["pet-personal-a", "商品图片"], ["pet-personal-b", "俄文标题"], ["pet-personal-c", "资料整理"]]
  .map(([id, name]) => ({ id, name, cwd, path: `${cwd}/${id}.jsonl`, created: new Date().toISOString(), modified: new Date().toISOString(), messageCount: 0, firstMessage: "" }));
const model = { provider: "fixture", modelId: "companion-test" };
let running = [], waiting = [], results = [];
let requests = 0;
const commands = [];
await context.addInitScript(() => {
  localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-yun-pet-visible", "1");
  localStorage.setItem("pi-yun-pet-pos", JSON.stringify({ x: 1100, y: 200 })); localStorage.setItem("pi-sound-enabled", "0");
});
await context.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/agent/running") { requests++; return route.fulfill({ json: { runningSessionIds: running, awaitingInputSessionIds: waiting, recentRunResults: results } }); }
  if (path === "/api/sessions") return route.fulfill({ json: { sessions, runningSessionIds: running, awaitingInputSessionIds: waiting } });
  if (path === "/api/sessions/ui-state") return route.fulfill({ json: { state: { version: 1, revision: 1, sessions: {}, projects: {} } } });
  if (path === "/api/models") return route.fulfill({ json: { models: { "fixture:companion-test": "Companion test" }, modelList: [{ id: model.modelId, provider: model.provider, name: "Companion test" }], defaultModel: model, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {} } });
  if (sessions.some((session) => path === `/api/sessions/${session.id}`)) {
    const id = path.split("/")[3];
    return route.fulfill({ json: { sessionId: id, filePath: sessions.find((session) => session.id === id).path, tree: [], leafId: null, totalActiveMs: 0,
      context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false, turnsBefore: 0, thinkingLevel: "off", model } } });
  }
  if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "connected", isStreaming: false, pendingExtensionUiIds: [] })}\n\n` });
  if (path.startsWith("/api/agent/") && route.request().method() === "POST") {
    const command = route.request().postDataJSON(); if (command) commands.push(command);
    return route.fulfill({ json: { success: true, data: command?.type === "get_tools" ? [] : command?.type === "get_commands" ? { commands: [] } : {} } });
  }
  if (path.startsWith("/api/agent/")) return route.fulfill({ json: { running: false, state: { isStreaming: false, isPromptRunning: false, model: { id: model.modelId, provider: model.provider }, messages: [] } } });
  return route.fulfill({ json: path === "/api/home" ? { home: "C:/Users/test" } : {} });
});
const page = await context.newPage();
const errors = []; page.on("pageerror", (error) => errors.push(error.message));
const pet = page.locator("[data-pet-companion]");
const panel = pet.locator("#pet-actions");
const notice = pet.locator('[data-pet-notice="result"]');
const waitText = (text) => page.waitForFunction((text) => document.querySelector('[data-pet-companion]')?.textContent.includes(text), text, { timeout: 12000 });
const openMenu = async (tab) => {
  if (!(await panel.isVisible())) await pet.getByRole("button", { name: "桌宠互动", exact: true }).click();
  await panel.getByRole("button", { name: tab, exact: true }).click();
};
let sequence = 0;
const finish = (index, kind) => { results.push({ id: `result-${++sequence}`, sessionId: sessions[index].id, kind, at: Date.now() + sequence }); };
try {
  await page.goto(`${process.env.E2E_URL || "http://127.0.0.1:30141"}/?cwd=${encodeURIComponent(cwd)}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pet.waitFor(); await page.waitForFunction(() => document.documentElement.lang === "zh-CN");
  while (requests < 2) await page.waitForTimeout(100);
  // These complete between polls: the UI must use explicit outcomes, not disappearances.
  finish(0, "complete"); finish(1, "stopped"); finish(2, "error");
  await waitText("后台会话遇到一点问题");
  await notice.getByRole("button", { name: "查看 3 个提醒", exact: true }).click();
  assert.match(await panel.innerText(), /本轮已结束/); assert.match(await panel.innerText(), /已经停止/); assert.match(await panel.innerText(), /遇到问题/);
  assert.equal(await panel.getByRole("link").count(), 3);
  await panel.getByRole("button", { name: "已读：资料整理", exact: true }).click();
  await waitText("后台会话已经停下");
  await panel.getByRole("button", { name: "偏好", exact: true }).click();
  await panel.getByLabel("桌宠名字", { exact: true }).fill("团团");
  await panel.getByLabel("桌宠名字", { exact: true }).press("Enter");
  await panel.getByLabel("安静陪伴", { exact: true }).check();
  await page.keyboard.press("Escape");
  assert.equal(await pet.getByRole("button", { name: "与团团互动", exact: true }).count(), 1);
  assert.equal(await notice.count(), 0, "Quiet mode hides ordinary background completion and stop bubbles");
  await pet.getByRole("button", { name: "与团团互动", exact: true }).click();
  assert.ok((await pet.getByRole("status").innerText()).trim(), "Explicit interaction still speaks in quiet mode");
  await page.reload({ waitUntil: "domcontentloaded" }); await pet.waitFor();
  await pet.getByRole("button", { name: "与团团互动", exact: true }).waitFor();
  await openMenu("偏好");
  assert.equal(await panel.getByLabel("安静陪伴", { exact: true }).isChecked(), true);
  assert.equal(await panel.getByLabel("桌宠名字", { exact: true }).inputValue(), "团团");
  await page.keyboard.press("Escape");
  // First-poll history is ignored; a subsequent genuine error remains actionable.
  await page.waitForTimeout(3000); assert.equal(await notice.count(), 0);
  finish(2, "error"); await waitText("后台会话遇到一点问题");
  running = [sessions[0].id, sessions[1].id]; waiting = [...running];
  await waitText("有任务在等你确认");
  await pet.getByRole("button", { name: "查看 3 个提醒", exact: true }).click();
  assert.equal(await panel.getByRole("link").count(), 3);
  // A list link selects the requested conversation in place.
  const origin = await page.evaluate(() => performance.timeOrigin);
  await panel.getByRole("link", { name: /等你确认.*俄文标题/ }).click();
  await page.waitForURL(`**/?session=${sessions[1].id}`);
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
  running = []; waiting = [];
  // Preferences propagate to another tab without losing the name.
  const other = await context.newPage();
  await other.goto(page.url(), { waitUntil: "domcontentloaded" });
  await other.locator("[data-pet-companion]").getByRole("button", { name: "与团团互动", exact: true }).waitFor();
  await other.getByRole("button", { name: "桌宠互动", exact: true }).click();
  await other.locator("#pet-actions").getByRole("button", { name: "偏好", exact: true }).click();
  await other.getByLabel("安静陪伴", { exact: true }).uncheck();
  await other.close(); await page.bringToFront();
  await openMenu("偏好");
  assert.equal(await panel.getByLabel("安静陪伴", { exact: true }).isChecked(), false);
  assert.equal(await panel.getByLabel("桌宠名字", { exact: true }).inputValue(), "团团");
  await waitText("后台会话遇到一点问题");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workbench-settings-navigation.is-mobile").waitFor({ state: "attached" });
  await pet.waitFor(); await openMenu("偏好");
  await waitText("后台会话遇到一点问题");
  const box = await panel.boundingBox();
  assert.ok(box.y >= 7 && box.y + box.height <= 837, "The larger preferences menu fits the phone viewport");
  await mkdir("test-results/pet-companion", { recursive: true });
  await page.screenshot({ path: "test-results/pet-companion/preferences-mobile.png" });
  await panel.getByRole("button", { name: /提醒/ }).click();
  await page.screenshot({ path: "test-results/pet-companion/notices-mobile.png" });
  assert.match(await panel.innerText(), /资料整理/);
  await panel.getByRole("button", { name: "偏好", exact: true }).click();
  await panel.getByLabel("桌宠名字", { exact: true }).fill("");
  await panel.getByLabel("桌宠名字", { exact: true }).press("Enter");
  assert.equal(await pet.getByRole("button", { name: "与小云互动", exact: true }).count(), 1);
  assert.equal(commands.filter((command) => command.type === "prompt").length, 0);
  assert.deepEqual(errors, []);
  console.log("PASS: explicit background outcomes, dismiss/read, selectable notices, quiet errors and interactions, saved name, reload/tab sync and mobile menu");
} finally { await browser.close(); }
