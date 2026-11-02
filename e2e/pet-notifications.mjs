// Simulated sessions only: no model calls or writes to session files.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const cwd = "D:\\yun-pi\\pi-web-yun";
const model = { provider: "fixture", modelId: "companion-test" };
const sessions = [
  ["pet-notice-active", "正在进行的会话"],
  ["pet-notice-a", "需要确认的商品图片"],
  ["pet-notice-b", "另一项等待确认的任务"],
].map(([id, name]) => ({ id, name, cwd, path: `${cwd}/${id}.jsonl`, created: new Date().toISOString(),
  modified: new Date().toISOString(), messageCount: 0, firstMessage: "" }));
let waiting = [];
let activeRunning = true;
const streams = new Map();
const server = createServer((req, res) => {
  const id = new URL(req.url, "http://localhost").searchParams.get("session");
  const pending = waiting.includes(id);
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" });
  const emit = (event) => res.write(`data: ${JSON.stringify(event)}\n\n`);
  emit({ type: "connected", isStreaming: pending || (id === sessions[0].id && activeRunning), pendingExtensionUiIds: pending ? [`confirm-${id}`] : [] });
  if (pending) emit({ type: "extension_ui_request", id: `confirm-${id}`, method: "confirm", title: "确认继续", message: "需要你的选择" });
  streams.set(res, { id, emit }); req.on("close", () => streams.delete(res));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.addInitScript(() => {
  localStorage.setItem("pi-locale", "zh-CN");
  localStorage.setItem("pi-yun-pet-visible", "1");
  localStorage.setItem("pi-yun-pet-pos", JSON.stringify({ x: 1180, y: 180 }));
  localStorage.setItem("pi-sound-enabled", "0");
});
await context.route((url) => url.pathname.startsWith("/api/agent/") || url.pathname === "/api/sessions"
  || sessions.some((session) => url.pathname === `/api/sessions/${session.id}`) || url.pathname === "/api/models", async (route) => {
  const path = new URL(route.request().url()).pathname;
  const id = path.split("/")[3];
  const running = waiting.includes(id) || (id === sessions[0].id && activeRunning);
  if (path.endsWith("/events")) return route.fulfill({ status: 307,
    headers: { location: `http://127.0.0.1:${server.address().port}/events?session=${id}` } });
  if (path === "/api/agent/running") return route.fulfill({ json: {
    runningSessionIds: [...waiting, ...(activeRunning ? [sessions[0].id] : [])], awaitingInputSessionIds: waiting,
  } });
  if (path === "/api/sessions") return route.fulfill({ json: { sessions, runningSessionIds: [], awaitingInputSessionIds: [] } });
  if (path.startsWith("/api/sessions/")) return route.fulfill({ json: {
    sessionId: id, filePath: sessions.find((session) => session.id === id).path, totalActiveMs: 0, tree: [], leafId: null,
    context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false, turnsBefore: 0, thinkingLevel: "off", model },
  } });
  if (path === "/api/models") return route.fulfill({ json: {
    models: { "fixture:companion-test": "Companion test" }, modelList: [{ id: model.modelId, provider: model.provider, name: "Companion test" }],
    defaultModel: model, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {},
  } });
  if (path.endsWith("/lease")) return route.fulfill({ json: { running, awaitingInput: waiting.includes(id), subagentsActive: false } });
  if (route.request().method() === "POST") {
    const command = route.request().postDataJSON();
    const data = command.type === "get_tools" ? [] : command.type === "get_commands" ? { commands: [] } : {};
    return route.fulfill({ json: { success: true, data } });
  }
  return route.fulfill({ json: { running, state: { isStreaming: running, isPromptRunning: running,
    model: { id: model.modelId, provider: model.provider }, messages: [] } } });
});
const pet = page.locator("[data-pet-companion]");
const notice = pet.locator('[data-pet-notice="waiting"]');
async function waitText(text) {
  await page.waitForFunction((text) => document.querySelector('[data-pet-notice="waiting"]')?.textContent.includes(text), text, { timeout: 12000 });
}
async function inViewport() {
  const box = await pet.boundingBox(), viewport = page.viewportSize();
  assert.ok(box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7, JSON.stringify(box));
}
try {
  await page.goto(`${process.env.E2E_URL || "http://127.0.0.1:30141"}/?session=${sessions[0].id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pet.waitFor();
  await page.waitForFunction(() => document.querySelector("[data-pet-companion]")?.dataset.status === "busy");
  // Temporary avoidance must not overwrite the position the user saved.
  const preferredBefore = await page.evaluate(() => localStorage.getItem("pi-yun-pet-pos"));
  const original = await pet.boundingBox();
  await page.evaluate(({ x, y, width, height }) => {
    const dialog = document.createElement("div");
    dialog.id = "pet-placement-fixture"; dialog.setAttribute("role", "dialog");
    Object.assign(dialog.style, { position: "fixed", left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
    document.body.append(dialog);
  }, original);
  await page.waitForFunction(() => {
    const a = document.querySelector("[data-pet-companion]").getBoundingClientRect();
    const b = document.querySelector("#pet-placement-fixture").getBoundingClientRect();
    return a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
  });
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-yun-pet-pos")), preferredBefore);
  await page.evaluate(() => document.querySelector("#pet-placement-fixture").remove());
  await page.waitForFunction(({ x, y }) => {
    const rect = document.querySelector("[data-pet-companion]").getBoundingClientRect();
    return Math.abs(rect.x - x) < 1 && Math.abs(rect.y - y) < 1;
  }, original);
  // A stale poll for the active chat must not invent a confirmation.
  waiting = [sessions[0].id];
  await page.waitForTimeout(3000);
  assert.equal(await notice.count(), 0);
  // Other chats needing input outrank a busy selected chat; duplicates do not count.
  waiting = [sessions[2].id, sessions[1].id, sessions[1].id];
  await waitText(sessions[1].name);
  assert.equal(await pet.getAttribute("data-status"), "waiting");
  assert.match(await notice.innerText(), /还有 1 个会话/);
  assert.equal(await notice.getByRole("link").getAttribute("href"), `?session=${sessions[1].id}`);
  await page.locator('[data-workspace-view="settings"]').click();
  await page.getByRole("region", { name: "设置", exact: true }).waitFor();
  await page.waitForTimeout(8500);
  await waitText(sessions[1].name);
  const popupPromise = context.waitForEvent("page");
  await notice.getByRole("link").click({ modifiers: [process.platform === "darwin" ? "Meta" : "Control"] });
  const popup = await popupPromise;
  await popup.waitForURL(`**/?session=${sessions[1].id}`);
  assert.ok(page.url().includes(`session=${sessions[0].id}`), "Modified activation leaves the original selection alone");
  await popup.close(); await page.bringToFront();
  await mkdir("test-results/pet-companion", { recursive: true });
  await pet.screenshot({ path: "test-results/pet-companion/persistent-reminder.png" });
  const origin = await page.evaluate(() => performance.timeOrigin);
  await notice.getByRole("link").click();
  await page.waitForURL(`**/?session=${sessions[1].id}`);
  await page.waitForFunction(() => document.querySelector("[data-pet-companion]")?.dataset.chatPhase === "waiting");
  assert.equal(await page.evaluate(() => performance.timeOrigin), origin, "Jumping from Settings must stay in the page");
  assert.equal(await page.getByRole("region", { name: "设置", exact: true }).count(), 0);
  // Resolve through the live stream, leaving its poll deliberately stale.
  for (const { id, emit } of streams.values()) if (id === sessions[1].id) {
    emit({ type: "extension_ui_closed", id: `confirm-${id}` });
    emit({ type: "agent_end" }); emit({ type: "prompt_done" }); emit({ type: "agent_settled" });
  }
  await waitText(sessions[2].name);
  assert.doesNotMatch(await notice.innerText(), /还有/);
  // A keyboard-activated link returns to the next waiting chat in the same page.
  await notice.getByRole("link").focus(); await page.keyboard.press("Enter");
  await page.waitForURL(`**/?session=${sessions[2].id}`);
  await page.waitForFunction(() => document.querySelector("[data-pet-companion]")?.dataset.chatPhase === "waiting");
  // Remove stale entries once their selected chats' live state has taken over.
  waiting = [sessions[2].id]; activeRunning = false;
  await page.waitForTimeout(3000);
  await waitText(sessions[2].name);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workbench-settings-navigation.is-mobile").waitFor({ state: "attached" });
  await pet.waitFor();
  await waitText(sessions[2].name);
  await inViewport();
  assert.equal(await pet.evaluate((el) => el.className.includes("small")), true, "Phones default to the small figure");
  // Measure the actual confirmation panel and composer, not just the figure.
  assert.equal(await page.evaluate(() => {
    const a = document.querySelector("[data-pet-companion]").getBoundingClientRect();
    return [...document.querySelectorAll('.chat-input-shell, [role="dialog"]')].every((el) => {
      const b = el.getBoundingClientRect();
      return !b.width || !b.height || a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom;
    });
  }), true, "The reminder leaves both confirmation and composer clear");
  const linkBox = await notice.getByRole("link").boundingBox();
  assert.ok(linkBox.x >= 0 && linkBox.x + linkBox.width <= 390, "Reminder link stays on screen");
  await page.screenshot({ path: "test-results/pet-companion/persistent-reminder-mobile.png" });
  for (const { id, emit } of streams.values()) if (id === sessions[2].id) {
    emit({ type: "extension_ui_closed", id: `confirm-${id}` });
    emit({ type: "agent_end" }); emit({ type: "prompt_done" }); emit({ type: "agent_settled" });
  }
  await notice.waitFor({ state: "detached" });
  // A background-only start must link to that job, never the idle selected chat.
  waiting = []; activeRunning = true;
  await page.waitForFunction((id) => document.querySelector('[data-pet-notice="transient"] a')?.getAttribute("href") === `?session=${id}`, sessions[0].id, { timeout: 12000 });
  await page.waitForTimeout(8500);
  assert.equal(await pet.getByRole("status").innerText(), "", "Ordinary start notices still expire");
  // Emulate the visual viewport shrink used by mobile software keyboards.
  await page.locator("textarea.chat-input-textarea:not([disabled])").focus();
  await page.evaluate(() => {
    Object.defineProperty(window.visualViewport, "height", { configurable: true, value: 420 });
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(() => {
    const a = document.querySelector("[data-pet-companion]").getBoundingClientRect();
    const b = document.querySelector(".chat-input-shell").getBoundingClientRect();
    return a.bottom <= 412 && (a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
  });
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-yun-pet-pos")), preferredBefore);
  await page.screenshot({ path: "test-results/pet-companion/keyboard-avoidance.png", clip: { x: 0, y: 0, width: 390, height: 420 } });
  await page.evaluate(() => {
    delete window.visualViewport.height;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  assert.deepEqual(errors, []);
  console.log("PASS: actionable persistent reminders, in-place jumps, stale-poll suppression, reversible dialog avoidance, mobile defaults and software-keyboard viewport");
} finally {
  await browser.close(); for (const stream of streams.keys()) stream.end();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
