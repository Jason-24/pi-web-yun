// Run against a healthy dev server: node e2e/pet-companion.mjs
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true,
  channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN", hasTouch: true });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let state = { runningSessionIds: [], awaitingInputSessionIds: [] };
await context.route("**/api/agent/running", (route) => route.fulfill({ json: state }));
// Keep this UI check independent of locally installed provider extensions.
await context.route((url) => url.pathname === "/api/models", (route) => route.fulfill({ json: {
  models: { "fixture:companion-test": "Companion test" },
  modelList: [{ id: "companion-test", name: "Companion test", provider: "fixture" }],
  defaultModel: { provider: "fixture", modelId: "companion-test" },
  thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {},
} }));
await context.addInitScript(() => {
  if (!localStorage.getItem("pet-e2e-seeded")) {
    localStorage.setItem("pet-e2e-seeded", "1");
    localStorage.setItem("pi-locale", "zh-CN");
    localStorage.setItem("pi-yun-pet-visible", "1");
    localStorage.setItem("pi-yun-pet-pos", JSON.stringify({ x: 99999, y: 99999 }));
  }
});
const pet = page.locator("[data-pet-companion]");
const character = () => page.getByRole("button", { name: "与小云互动", exact: true });
const more = () => page.getByRole("button", { name: "桌宠互动", exact: true });
const waitFor = async (attribute, value) => {
  await page.waitForFunction(({ attribute, value }) => document.querySelector("[data-pet-companion]")?.getAttribute(attribute) === value,
    { attribute, value }, { timeout: 12000 });
};
const inViewport = async () => {
  const box = await pet.boundingBox();
  const viewport = page.viewportSize();
  assert.ok(box.x >= 7 && box.y >= 7 && box.x + box.width <= viewport.width - 7 && box.y + box.height <= viewport.height - 7,
    `Companion must remain in viewport: ${JSON.stringify({ box, viewport })}`);
};

try {
  await page.goto(process.env.E2E_URL || "http://127.0.0.1:30141", { waitUntil: "domcontentloaded", timeout: 120000 });
  await pet.waitFor({ timeout: 120000 });
  await page.waitForFunction(() => [...document.querySelectorAll("[data-pet-companion] img")].length === 1
    && [...document.querySelectorAll("[data-pet-companion] img")].every((image) => image.complete && image.naturalWidth === 280));
  await inViewport();
  await pet.locator('[data-living="true"]').waitFor();
  assert.equal(await pet.locator("canvas").count(), 1, "Pose animation uses one stable canvas");
  const canvasPose = (pose) => page.waitForFunction((pose) => document.querySelector('[data-pet-companion] canvas')?.dataset.pose === pose, pose);

  await character().click();
  await waitFor("data-pose", "happy");
  await canvasPose("happy");
  const heart = pet.locator('span[aria-hidden="true"] svg path').first();
  assert.equal(await heart.evaluate(el => getComputedStyle(el).fill), "rgb(240, 98, 146)", "Pat hearts stay pink independently of theme accent");
  assert.ok(await pet.locator('[data-living]').evaluate((el) => el.getAnimations().length > 0), "Patting restores a small hop without scaling the face");
  const patLines = [];
  for (let i = 0; i < 5; i++) {
    // Leave the character's separate double-click greeting gesture untriggered.
    if (i > 0) { await page.waitForTimeout(550); await character().click(); }
    const line = await pet.getByRole("status").innerText();
    assert.ok(line.trim(), "Each pat has a spoken reaction");
    if (i > 0) assert.notEqual(line, patLines[i - 1], "Consecutive pats never repeat the same reply");
    patLines.push(line);
  }
  assert.equal(new Set(patLines.slice(0, 4)).size, 4, "All four pat replies appear before reuse");
  await more().click();
  await page.getByRole("button", { name: "打招呼", exact: true }).click();
  await waitFor("data-pose", "wave");
  await canvasPose("wave");
  await more().click();
  await page.getByRole("button", { name: "打打气", exact: true }).click();
  await waitFor("data-pose", "cheer");
  await canvasPose("cheer");
  assert.match(await pet.locator("img").getAttribute("src"), /cheer.webp$/, "Encouragement uses the authored raised-fist gesture");
  await mkdir("test-results/pet-companion", { recursive: true });
  await page.waitForTimeout(800);
  await pet.screenshot({ path: "test-results/pet-companion/cheer.png" });
  await more().click();
  await page.getByRole("button", { name: "休息一下", exact: true }).click();
  await waitFor("data-status", "sleeping");
  await canvasPose("sleep");
  assert.match(await pet.locator("img").getAttribute("src"), /sleep.webp$/, "Rest uses real closed eyes rather than painted lids");
  await page.waitForTimeout(250);
  await pet.screenshot({ path: "test-results/pet-companion/sleep.png" });
  await more().click();
  await page.getByRole("button", { name: "叫醒她", exact: true }).click();
  await waitFor("data-status", "idle");

  await more().click();
  await page.keyboard.press("Escape");
  assert.equal(await more().getAttribute("aria-expanded"), "false");
  assert.equal(await more().evaluate((element) => element === document.activeElement), true);
  await character().focus();
  const keyboardBefore = await pet.boundingBox();
  await page.keyboard.press("ArrowLeft");
  assert.ok(Math.abs((await pet.boundingBox()).x - keyboardBefore.x + 16) < 2, "Arrow-key movement is available on the figure");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Enter");
  await waitFor("data-pose", "happy");
  await waitFor("data-pose", "idle");

  const before = await pet.boundingBox();
  const box = await character().boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 55);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 250, box.y - 100, { steps: 8 });
  await page.mouse.up();
  const after = await pet.boundingBox();
  assert.ok(after.x < before.x - 200, "Dragging must move the companion");
  assert.equal(await pet.getAttribute("data-pose"), "idle", "Dragging must not also trigger patting");
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("pi-yun-pet-pos")));
  assert.ok(Math.abs(stored.x - after.x) < 2);
  await page.reload({ waitUntil: "domcontentloaded" });
  await pet.waitFor();
  assert.ok(Math.abs((await pet.boundingBox()).x - after.x) < 2, "Position must survive reload");

  state = { runningSessionIds: ["fixture"], awaitingInputSessionIds: [] };
  await waitFor("data-status", "busy");
  await waitFor("data-pose", "thinking");
  state = { runningSessionIds: ["fixture"], awaitingInputSessionIds: ["fixture"] };
  await waitFor("data-status", "waiting");
  assert.match(await pet.innerText(), /确认/);
  state = { runningSessionIds: [], awaitingInputSessionIds: [] };
  await waitFor("data-status", "idle");

  await mkdir("test-results/pet-companion", { recursive: true });
  await more().click();
  await page.getByRole("button", { name: "缩小一点", exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-yun-pet-small")), "1");
  await page.getByRole("button", { name: "放大一点", exact: true }).click();
  await page.keyboard.press("Escape");
  // Return to a clear corner for visual inspection after the drag tests.
  await page.evaluate(() => localStorage.setItem("pi-yun-pet-pos", JSON.stringify({ x: 1228, y: 480 })));
  await page.reload({ waitUntil: "domcontentloaded" });
  await pet.waitFor();
  await character().dblclick();
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/pet-companion/desktop.png" });
  await pet.screenshot({ path: "test-results/pet-companion/character.png" });
  await more().click();
  await page.waitForTimeout(200);
  const menuFits = async () => {
    const box = await page.locator("#pet-actions").boundingBox();
    const viewport = page.viewportSize();
    assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
      `Action panel stays within viewport: ${JSON.stringify({ box, viewport })}`);
  };
  await menuFits();
  await page.screenshot({ path: "test-results/pet-companion/menu.png" });
  await page.setViewportSize({ width: 1366, height: 960 });
  await page.waitForTimeout(200);
  await menuFits();

  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  await inViewport();
  assert.equal(await more().evaluate(el => getComputedStyle(el).opacity), "1", "Touch screens always expose the compact actions button");
  assert.ok((await more().boundingBox()).width >= 40, "Touch actions keep a usable hit target");
  // Crossing the mobile layout boundary remounts the rail and its companion.
  if (await page.locator("#pet-actions").count() === 0) await more().click();
  await menuFits();
  await page.getByRole("button", { name: "摸摸头", exact: true }).click();
  await waitFor("data-pose", "happy");
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/pet-companion/mobile.png" });
  await waitFor("data-pose", "idle");
  const mobileBefore = await pet.boundingBox();
  const mobileCharacter = await character().boundingBox();
  const touch = await context.newCDPSession(page);
  const start = { x: mobileCharacter.x + mobileCharacter.width / 2, y: mobileCharacter.y + 55 };
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [start] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: start.x - 70, y: start.y - 60 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  assert.ok((await pet.boundingBox()).x < mobileBefore.x - 50, "Native touch dragging must move the companion");
  assert.equal(await pet.getAttribute("data-pose"), "idle", "Touch dragging must not pat");
  const cancelBox = await character().boundingBox();
  await touch.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: cancelBox.x + 30, y: cancelBox.y + 30 }] });
  await touch.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  assert.equal(await pet.getAttribute("data-pose"), "idle", "Cancelled touch must not pat");
  await touch.detach();
  await page.clock.install();
  await page.clock.fastForward(95000);
  assert.equal(await pet.getAttribute("data-status"), "idle", "Idle time must never put the companion to sleep");
  assert.equal(await pet.getAttribute("data-pose"), "idle");
  await more().click();
  await page.getByRole("button", { name: "休息一下", exact: true }).click();
  await waitFor("data-status", "sleeping");
  const wakeBox = await character().boundingBox();
  await page.touchscreen.tap(wakeBox.x + wakeBox.width / 2, wakeBox.y + 40);
  await waitFor("data-status", "idle");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.waitForFunction(() => document.querySelector('[data-pet-companion] canvas')?.dataset.motion === "reduced");
  assert.equal(await pet.locator("[data-dragging]").evaluate((element) => getComputedStyle(element).animationName), "none");
  await page.setViewportSize({ width: 844, height: 390 });
  await page.waitForTimeout(200);
  await inViewport();
  await more().click();
  await page.getByRole("button", { name: "暂时隐藏", exact: true }).click();
  assert.equal(await pet.count(), 0);
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-yun-pet-visible")), "0");
  await page.getByRole("button", { name: "桌宠", exact: true }).click();
  await pet.waitFor();
  await inViewport();
  await pet.locator('[data-living="true"]').waitFor();
  await page.evaluate(() => {
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  const pausedFrame = await pet.locator("canvas").getAttribute("data-frame");
  await page.waitForTimeout(120);
  assert.equal(await pet.locator("canvas").getAttribute("data-frame"), pausedFrame, "Hidden tabs must stop portrait frames");
  await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")); });
  await pet.locator("canvas").evaluate((canvas) => canvas.dispatchEvent(new Event("contextlost")));
  await page.waitForFunction(() => document.querySelector('[data-pet-companion] [data-living]')?.dataset.living === "false");
  assert.equal(await pet.locator("img").evaluate((image) => getComputedStyle(image).opacity), "1", "Context loss must restore the selected authored pose");
  assert.deepEqual(errors, [], "The page must not emit JavaScript errors");
  console.log("PASS: authored gestures, unwarped rest, hop, keyboard, touch drag/cancel, persistence, background task states, sleep/wake, mobile, reduced motion, paused hidden tabs, canvas fallback");
} finally {
  await browser.close();
}
