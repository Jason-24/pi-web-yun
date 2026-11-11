import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true,
  channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
const page = await context.newPage();
const errors = [];
let waiting = [];
page.on("pageerror", error => errors.push(error.message));
await context.addInitScript(() => {
  localStorage.setItem("pi-locale", "zh-CN");
  localStorage.setItem("pi-yun-pet-visible", "1");
  if (!sessionStorage.getItem("pet-controls-initialized")) {
    localStorage.setItem("pi-yun-pet-pos", JSON.stringify({ x: 1100, y: 400 }));
    sessionStorage.setItem("pet-controls-initialized", "1");
  }
});
await page.route("**/api/**", route => {
  const path = new URL(route.request().url()).pathname;
  let json = {};
  if (path === "/api/sessions") json = { sessions: [], runningSessionIds: [], awaitingInputSessionIds: [] };
  if (path === "/api/sessions/ui-state") json = { state: { version: 1, revision: 1, sessions: {}, projects: {} } };
  if (path === "/api/agent/running") json = { runningSessionIds: [], awaitingInputSessionIds: waiting };
  if (path === "/api/models") json = { models: {}, modelList: [], defaultModel: null };
  if (path === "/api/home") json = { home: "C:/Users/test" };
  return route.fulfill({ json });
});
const pet = page.locator("[data-pet-companion]");
const figure = page.getByRole("button", { name: "与小云互动", exact: true });
const actions = page.getByRole("button", { name: "桌宠互动", exact: true });
const opacity = value => page.waitForFunction(value => {
  const button = document.querySelector('[data-pet-companion] button[aria-controls="pet-actions"]');
  return button && getComputedStyle(button).opacity === value;
}, value);

try {
  await page.goto(process.env.E2E_URL || "http://127.0.0.1:30141", { waitUntil: "domcontentloaded", timeout: 120000 });
  await pet.locator('[data-living="true"]').waitFor();
  assert.doesNotMatch(await pet.innerText(), /小云|陪着你/, "No permanent name or status strip remains");
  await opacity("0");
  await mkdir("test-results/pet-companion", { recursive: true });
  await pet.screenshot({ path: "test-results/pet-companion/minimal-idle.png" });
  await figure.hover();
  await opacity("1");
  await actions.hover();
  await actions.click();
  await page.mouse.move(0, 0);
  await opacity("1");
  assert.equal(await actions.getAttribute("aria-expanded"), "true", "Open menu keeps its trigger visible away from the figure");
  await page.keyboard.press("Escape");
  assert.equal(await actions.evaluate(el => el === document.activeElement), true);
  await page.locator("body").click({ position: { x: 700, y: 10 } });
  await page.mouse.move(0, 0);
  await opacity("0");
  await figure.focus();
  await opacity("1");
  await page.keyboard.press("Tab");
  assert.equal(await actions.evaluate(el => el === document.activeElement), true);
  await page.keyboard.press("Enter");
  assert.equal(await actions.getAttribute("aria-expanded"), "true", "Keyboard users can reach and open the compact control");
  assert.equal(await page.getByRole("button", { name: "互动", exact: true }).evaluate(el => el === document.activeElement), true, "Opening transfers focus into the panel");
  await page.getByRole("button", { name: "暂时隐藏", exact: true }).focus();
  await page.keyboard.press("Tab");
  await page.waitForFunction(() => !document.querySelector("#pet-actions"));
  assert.equal(await actions.getAttribute("aria-expanded"), "false", "Tabbing away dismisses the panel without trapping focus");
  await figure.focus();
  const before = await pet.boundingBox();
  await page.keyboard.press("Shift+ArrowLeft");
  await page.waitForFunction(x => Math.abs(document.querySelector("[data-pet-companion]").getBoundingClientRect().x - x) < 1, before.x - 32);
  await actions.click();
  await page.getByRole("button", { name: "恢复位置", exact: true }).click();
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-yun-pet-pos")), null, "Reset removes only the saved position");
  await page.waitForFunction(() => document.querySelector("[data-pet-companion]").getBoundingClientRect().x > 1150);
  const resetPosition = await pet.boundingBox();
  await page.reload({ waitUntil: "domcontentloaded" });
  await pet.waitFor();
  await page.waitForFunction(x => Math.abs(document.querySelector("[data-pet-companion]").getBoundingClientRect().x - x) < 1, resetPosition.x);
  waiting = ["needs-attention"];
  await pet.locator('[data-pet-notice="waiting"]').waitFor();
  await page.locator("body").click({ position: { x: 700, y: 10 } });
  await page.mouse.move(0, 0);
  await opacity("1");
  waiting = [];
  await pet.locator('[data-pet-notice="waiting"]').waitFor({ state: "detached" });
  await opacity("0");
  await actions.focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 700, y: 10 } });
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workbench-settings-navigation.is-mobile").waitFor({ state: "attached" });
  await pet.waitFor();
  await opacity("1");
  const petBox = await pet.boundingBox(), controlBox = await actions.boundingBox();
  assert.ok(controlBox.x >= petBox.x && controlBox.x + controlBox.width <= petBox.x + petBox.width, "Actions stay within the clamped footprint");
  assert.ok(controlBox.width >= 40 && controlBox.height >= 40);
  await pet.screenshot({ path: "test-results/pet-companion/minimal-mobile.png" });
  await figure.focus();
  await page.evaluate(() => {
    for (const [key, value] of Object.entries({ offsetTop: 60, offsetLeft: 10, width: 370, height: 420 })) {
      Object.defineProperty(window.visualViewport, key, { configurable: true, value });
    }
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(() => document.querySelector("[data-pet-companion]").getBoundingClientRect().bottom <= 472);
  await page.keyboard.press("Shift+ArrowDown");
  await page.keyboard.press("Shift+ArrowRight");
  const moved = await page.evaluate(() => ({
    saved: JSON.parse(localStorage.getItem("pi-yun-pet-pos")),
    box: document.querySelector("[data-pet-companion]").getBoundingClientRect().toJSON(),
  }));
  assert.ok(moved.saved.x >= 18 && moved.saved.x + moved.box.width <= 372, "Keyboard movement respects visual-viewport horizontal offsets");
  assert.ok(moved.saved.y >= 68 && moved.saved.y + moved.box.height <= 472, "Keyboard movement stays above the software keyboard");
  assert.deepEqual(errors, []);
  console.log("PASS: hover, unread visibility, menu focus and Tab dismissal, accelerated movement, reset/reload, mobile target and viewport containment");
} finally {
  await browser.close();
}
