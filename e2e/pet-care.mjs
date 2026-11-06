// Fake time and API fixtures: no model calls and no real waiting for reminders.
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN", timezoneId: "Asia/Shanghai", reducedMotion: "reduce" });
const page = await context.newPage();
const errors = [], commands = [];
page.on("pageerror", (error) => errors.push(error.message));
await context.addInitScript(() => {
  localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-yun-pet-visible", "1");
  localStorage.setItem("pi-yun-pet-pos", JSON.stringify({ x: 1080, y: 180 }));
  localStorage.setItem("pi-sound-enabled", "0");
});
await context.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (route.request().method() === "POST") { const body = route.request().postDataJSON(); if (body) commands.push(body); }
  let json = {};
  if (path === "/api/sessions") json = { sessions: [], runningSessionIds: [], awaitingInputSessionIds: [] };
  if (path === "/api/sessions/ui-state") json = { state: { version: 1, revision: 1, sessions: {}, projects: {} } };
  if (path === "/api/agent/running") json = { runningSessionIds: [], awaitingInputSessionIds: [], recentRunResults: [] };
  if (path === "/api/models") json = { models: { "fixture:care-test": "Care test" }, modelList: [{ id: "care-test", provider: "fixture", name: "Care test" }], defaultModel: { provider: "fixture", modelId: "care-test" }, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {} };
  if (path === "/api/home") json = { home: "C:/Users/test" };
  return route.fulfill({ json });
});
const pet = page.locator("[data-pet-companion]");
const menu = pet.locator("#pet-actions");
const notice = pet.locator('[data-pet-notice="care"]');
const state = () => page.evaluate(() => JSON.parse(localStorage.getItem("pi-yun-pet-care-v1")));
const openCare = async () => {
  if (!await menu.isVisible()) await pet.getByRole("button", { name: "桌宠互动", exact: true }).click();
  await menu.getByRole("button", { name: "陪伴", exact: true }).click();
};
const setMinutes = async (label, minutes) => {
  await menu.getByLabel(label, { exact: true }).fill(String(minutes));
  await menu.getByLabel(label, { exact: true }).press("Enter");
};
try {
  await page.goto(`${process.env.E2E_URL || "http://127.0.0.1:30141"}/?cwd=${encodeURIComponent("D:\\yun-pi\\pi-web-yun")}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pet.waitFor();
  await page.bringToFront();
  // This guard is shared by all editors, including file/forms outside chat.
  await page.evaluate(() => {
    document.hasFocus = () => true;
    const editor = document.createElement("textarea"); editor.id = "care-typing-fixture";
    Object.assign(editor.style, { position: "fixed", left: "200px", top: "80px", width: "300px", height: "60px" });
    document.body.append(editor);
  });
  await page.clock.install({ time: new Date("2026-11-03T01:00:00Z") });
  await openCare();
  for (const label of ["久坐提醒", "喝水提醒", "坐姿提醒"]) {
    assert.equal(await menu.getByLabel(label, { exact: true }).isChecked(), false);
    await setMinutes(`${label}间隔（分钟）`, 1);
    await menu.getByLabel(label, { exact: true }).check();
  }
  const movementTimer = menu.getByRole("timer", { name: "久坐提醒剩余时间" });
  assert.match(await movementTimer.innerText(), /01:00/);
  await page.clock.runFor(3000);
  assert.match(await movementTimer.innerText(), /00:5[6789]/, JSON.stringify(await state()));
  await page.keyboard.press("Escape");
  await page.clock.runFor(52_000);
  // A stream of input defers the notice even when its time is due.
  const input = page.locator("#care-typing-fixture");
  await input.fill("还在输入，稍后再提醒");
  await page.clock.runFor(6000);
  assert.equal(await notice.count(), 0);
  await page.clock.runFor(4000);
  await notice.waitFor();
  const text = await notice.innerText();
  assert.match(text, /喝|水杯/); assert.match(text, /姿势|坐姿/); assert.match(text, /起来|站起来/);
  await mkdir("test-results/pet-companion", { recursive: true });
  await pet.screenshot({ path: "test-results/pet-companion/care-reminder.png" });
  await notice.getByRole("button", { name: "5 分钟后", exact: true }).click();
  assert.equal(await notice.count(), 0);
  assert.equal((await state()).habits.water.targetMs, 300_000);
  await openCare();
  await setMinutes("坐姿提醒间隔（分钟）", 2); await setMinutes("坐姿提醒间隔（分钟）", 1);
  await page.keyboard.press("Escape"); await page.clock.runFor(65_000);
  // The global cooldown can briefly hold this new interval after the first notice.
  await page.clock.runFor(60_000);
  await notice.waitFor();
  await notice.getByRole("button", { name: "今天不提醒", exact: true }).click();
  assert.equal((await state()).habits.posture.pausedOn, "2026-11-03");
  await openCare();
  await menu.getByRole("button", { name: "今天已暂停 · 恢复提醒", exact: true }).waitFor();
  await menu.getByLabel("专注时长（分钟）", { exact: true }).fill("1");
  await menu.getByRole("button", { name: "开始专注", exact: true }).click();
  await page.clock.runFor(5000);
  await menu.getByRole("button", { name: "暂停", exact: true }).click();
  const beforePause = (await state()).focus.remainingMs;
  await page.clock.runFor(5000);
  assert.equal((await state()).focus.remainingMs, beforePause);
  await menu.getByRole("button", { name: "继续", exact: true }).click();
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    window.__careNotifications = [];
    window.Notification = class {
      static permission = "granted";
      constructor(title) { window.__careNotifications.push(title); }
      close() {}
    };
    Object.defineProperty(document, "hidden", { configurable: true, value: true }); document.dispatchEvent(new Event("visibilitychange"));
  });
  await page.clock.runFor(65_000);
  await page.waitForFunction(() => JSON.parse(localStorage.getItem("pi-yun-pet-care-v1")).focus.phase === "done");
  assert.equal((await state()).focus.phase, "done");
  assert.deepEqual(await page.evaluate(() => window.__careNotifications), ["这段专注结束啦"]);
  assert.equal(await notice.count(), 0);
  await page.evaluate(() => {
    delete document.hidden; document.dispatchEvent(new Event("visibilitychange"));
    const dialog = document.createElement("div"); dialog.id = "care-confirmation"; dialog.setAttribute("role", "dialog");
    Object.assign(dialog.style, { position: "fixed", left: "200px", top: "200px", width: "300px", height: "200px" }); document.body.append(dialog);
  });
  await page.clock.runFor(65_000);
  assert.equal(await notice.count(), 0, "A confirmation keeps the focus-end notice waiting");
  assert.equal((await state()).focus.phase, "done");
  await page.evaluate(() => document.querySelector("#care-confirmation").remove());
  await page.clock.runFor(2000); await notice.waitFor();
  assert.match(await notice.innerText(), /这段专注结束啦/);
  await notice.getByRole("button", { name: "知道啦", exact: true }).click();
  assert.equal((await state()).focus.phase, "idle");
  await page.reload({ waitUntil: "domcontentloaded" }); await pet.waitFor(); await openCare();
  assert.equal(await menu.getByLabel("坐姿提醒", { exact: true }).isChecked(), true);
  await menu.getByRole("button", { name: "今天已暂停 · 恢复提醒", exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workbench-settings-navigation.is-mobile").waitFor({ state: "attached" }); await pet.waitFor(); await openCare();
  await page.clock.runFor(200);
  const box = await menu.boundingBox();
  assert.ok(box.x >= 0 && box.y >= 7 && box.x + box.width <= 390 && box.y + box.height <= 837, JSON.stringify(box));
  await page.screenshot({ path: "test-results/pet-companion/care-menu-mobile.png" });
  assert.equal(commands.filter((command) => command.type === "prompt").length, 0);
  assert.deepEqual(errors, []);
  console.log("PASS: opt-in intervals, combined nudges, typing deferral, snooze/today, focus pause/resume, away/dialog safety, storage and mobile menu");
} finally { await browser.close(); }
