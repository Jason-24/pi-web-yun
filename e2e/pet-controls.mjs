import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const browser = await chromium.launch({ headless: true,
  channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await context.addInitScript(() => {
  localStorage.setItem("pi-locale", "zh-CN");
  localStorage.setItem("pi-yun-pet-visible", "1");
  localStorage.setItem("pi-yun-pet-pos", JSON.stringify({ x: 1100, y: 400 }));
});
await page.route("**/api/**", route => {
  const path = new URL(route.request().url()).pathname;
  let json = {};
  if (path === "/api/sessions") json = { sessions: [], runningSessionIds: [], awaitingInputSessionIds: [] };
  if (path === "/api/sessions/ui-state") json = { state: { version: 1, revision: 1, sessions: {}, projects: {} } };
  if (path === "/api/agent/running") json = { runningSessionIds: [], awaitingInputSessionIds: [] };
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
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 700, y: 10 } });
  await page.mouse.move(0, 0);
  await page.setViewportSize({ width: 390, height: 844 });
  await opacity("1");
  const petBox = await pet.boundingBox(), controlBox = await actions.boundingBox();
  assert.ok(controlBox.x >= petBox.x && controlBox.x + controlBox.width <= petBox.x + petBox.width, "Actions stay within the clamped footprint");
  assert.ok(controlBox.width >= 40 && controlBox.height >= 40);
  await pet.screenshot({ path: "test-results/pet-companion/minimal-mobile.png" });
  assert.deepEqual(errors, []);
  console.log("PASS: no nameplate, desktop hover, open-menu persistence, focus/Tab/Enter, mobile target and viewport containment");
} finally {
  await browser.close();
}
