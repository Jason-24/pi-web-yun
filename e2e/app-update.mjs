// Run against the existing dev server: node e2e/app-update.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { version } = require("../package.json");
const piVersion = require("../node_modules/@earendil-works/pi-coding-agent/package.json").version;
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/app-update");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || undefined });
const errors = [];
let state = "current";
let checks = 0;
const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
const page = await context.newPage();
page.on("pageerror", error => errors.push(error.message));
await page.route("**/api/**", async route => {
  const path = new URL(route.request().url()).pathname;
  const reply = json => route.fulfill({ json });
  if (path === "/api/app-update") {
    checks++;
    if (state === "failed") return route.fulfill({ status: 502, json: { error: "Offline" } });
    const latestVersion = state === "update" ? "99.0.0" : state === "older" ? "0.0.1" : state === "invalid" ? "broken" : version;
    // Deliberately untrusted flags/URL: the UI must compare the actual versions.
    return reply({ currentVersion: version, latestVersion, updateAvailable: state !== "update", releaseUrl: "https://example.invalid/" });
  }
  if (path === "/api/sessions") return reply({ sessions: [], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
  if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [] } });
  if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
  if (path === "/api/models") return reply({ models: [], modelList: [], defaultModel: null });
  if (path === "/api/home") return reply({ home: "C:/Users/test" });
  if (path === "/api/web-auth") return reply({ enabled: false });
  return reply({});
});

try {
  await page.goto(base, { waitUntil: "domcontentloaded", timeout: 120000 });
  const trigger = page.locator('[data-workspace-action="update"]');
  const dialog = page.getByRole("dialog", { name: "版本与更新" });
  await trigger.waitFor({ timeout: 90000 });
  await page.waitForFunction(() => document.querySelector('[data-workspace-action="update"]')?.title.includes("pi-yun 已是最新版本"));
  await trigger.click();
  await dialog.getByText("pi-yun 已是最新版本", { exact: true }).waitFor();
  assert.equal(await trigger.getAttribute("data-update-available"), "false");
  assert.match(await dialog.innerText(), new RegExp(`v${piVersion.replaceAll(".", "\\.")}`));
  assert.equal(await dialog.locator("a").count(), 0);
  assert.equal(await dialog.locator("code").innerText(), "npm install -g pi-yun@latest");
  await page.screenshot({ path: resolve(artifacts, "current.png"), animations: "disabled" });
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "hidden" });
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);

  // The entry occupies the screenshot's requested slot, directly above the pet.
  const updateBox = await trigger.boundingBox();
  const petBox = await page.locator('[data-workspace-action="pet"]').boundingBox();
  assert.ok(updateBox.y + updateBox.height <= petBox.y && petBox.y - updateBox.y < 60);
  assert.ok(updateBox.y > 600);

  state = "update";
  await trigger.click();
  await dialog.getByRole("button", { name: "检查更新", exact: true }).click();
  await dialog.getByText("pi-yun v99.0.0 可更新", { exact: true }).waitFor();
  assert.equal(await trigger.getAttribute("data-update-available"), "true");
  const link = dialog.getByRole("link", { name: "查看更新说明" });
  assert.equal(await link.getAttribute("href"), "https://github.com/Jason-24/pi-web-yun/releases/tag/v99.0.0");
  assert.match(await dialog.locator("code").innerText(), /npm install -g pi-yun@latest/);
  await page.keyboard.press("Escape");
  await trigger.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector('[data-workspace-action="update"]')).color === "rgb(59, 130, 246)");
  assert.equal(await trigger.evaluate(el => getComputedStyle(el).color), "rgb(59, 130, 246)");
  await page.screenshot({ path: resolve(artifacts, "update-light.png"), animations: "disabled" });
  await page.evaluate(() => { document.documentElement.classList.add("dark"); document.documentElement.dataset.theme = "dark"; });
  await trigger.click();
  await dialog.waitFor();
  await page.screenshot({ path: resolve(artifacts, "update-dark.png"), animations: "disabled" });

  state = "failed";
  await dialog.getByRole("button", { name: "检查更新", exact: true }).click();
  await dialog.getByText("暂时无法检查更新，请重试。", { exact: true }).waitFor();
  assert.equal(await trigger.getAttribute("data-update-available"), "true", "network errors preserve a known update");
  state = "older";
  await dialog.getByRole("button", { name: "检查更新", exact: true }).click();
  await dialog.getByText("pi-yun 已是最新版本", { exact: true }).waitFor();
  assert.equal(await trigger.getAttribute("data-update-available"), "false");
  state = "invalid";
  await dialog.getByRole("button", { name: "检查更新", exact: true }).click();
  await dialog.getByText("暂时无法检查更新，请重试。", { exact: true }).waitFor();
  assert.equal(await trigger.getAttribute("data-update-available"), "false");
  await page.keyboard.press("Escape");

  // A failed first check must not claim that the app is current.
  state = "failed";
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector('[data-workspace-action="update"]')?.title.includes("暂时无法检查更新"));
  await trigger.click();
  await dialog.getByText("暂时无法检查更新，请重试。", { exact: true }).waitFor();
  assert.equal(await trigger.getAttribute("data-update-available"), "false");
  state = "update";
  await dialog.getByRole("button", { name: "检查更新", exact: true }).click();
  await dialog.getByText("pi-yun v99.0.0 可更新", { exact: true }).waitFor();
  await page.keyboard.press("Escape");

  await page.setViewportSize({ width: 390, height: 844 });
  await page.locator(".workspace-sidebar-toggle").click();
  await trigger.click();
  await dialog.getByText("pi-yun v99.0.0 可更新", { exact: true }).waitFor();
  assert.equal(await trigger.count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  const sheet = await dialog.boundingBox();
  assert.ok(sheet.x >= 0 && sheet.x + sheet.width <= 390);
  await page.screenshot({ path: resolve(artifacts, "update-mobile.png"), animations: "disabled" });
  assert.deepEqual(errors, []);
  console.log(`PASS: versions, neutral/current/older, blue update (including hover), failure/retry/invalid data, safe release link, focus/Escape, desktop placement, dark and mobile; ${checks} checks.`);
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, "failure.png") });
  console.error({ checks, errors, dialogs: await page.getByRole("dialog").allTextContents(), url: page.url() });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
