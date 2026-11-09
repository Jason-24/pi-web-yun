import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { openSettings } from "./settings.mjs";

const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "en-US", reducedMotion: "reduce" });
const page = await context.newPage();
let selected = { provider: "relay", modelId: "first" };
let thinking = "medium";
let failure = false;
const writes = [];
await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
await context.route("**/api/**", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path === "/api/models/default" && route.request().method() === "PUT") {
    writes.push(route.request().postDataJSON());
    if (failure) return route.fulfill({ status: 409, json: { error: "Project overrides the default" } });
    if (writes.at(-1).thinkingLevel) thinking = writes.at(-1).thinkingLevel;
    else selected = { provider: writes.at(-1).provider, modelId: writes.at(-1).modelId };
    return route.fulfill({ json: { ok: true } });
  }
  if (path === "/api/models") return route.fulfill({ json: { modelList: [{ provider: "relay", id: "first", name: "First" }, { provider: "relay", id: "second", name: "Second" }], defaultModel: selected, savedDefaultThinkingLevel: thinking, models: {} } });
  if (path === "/api/models-config") return route.fulfill({ json: { providers: { relay: { models: [{ id: "first" }, { id: "second" }] } } } });
  if (path === "/api/auth/providers") return route.fulfill({ json: { oauthProviders: [], apiKeyProviders: [] } });
  if (path === "/api/models/enabled") return route.fulfill({ json: { allEnabled: true, patterns: null, stalePatterns: [], enabledTotal: 2, availableTotal: 2, scope: "global", editable: true, providers: [] } });
  if (path === "/api/sessions") return route.fulfill({ json: { sessions: [], runningSessionIds: [], awaitingInputSessionIds: [] } });
  if (path === "/api/sessions/ui-state") return route.fulfill({ json: { state: { version: 1, revision: 1, sessions: {}, projects: {} } } });
  if (path === "/api/home") return route.fulfill({ json: { home: "C:/Users/test" } });
  return route.fulfill({ json: {} });
});
try {
  await page.goto(`${process.env.E2E_URL || "http://127.0.0.1:30141"}/`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.getByRole("button", { name: "Open project" }).waitFor();
  await page.waitForTimeout(1000);
  const settings = await openSettings(page, "Models");
  const defaults = settings.locator(".model-defaults");
  const toggle = defaults.locator(".model-defaults-toggle");
  assert.equal(await defaults.evaluate(el => el.open), false, "Defaults start collapsed");
  assert.equal(await settings.locator(".config-sidebar > .model-defaults").count(), 1, "Defaults belong to the sidebar");
  await mkdir("test-results/default-model-settings", { recursive: true });
  await page.screenshot({ path: "test-results/default-model-settings/collapsed.png" });
  await toggle.click();
  assert.equal(writes.length, 0, "Opening defaults must not save settings");
  const picker = settings.getByLabel("Default model for new chats");
  await picker.waitFor();
  await mkdir("test-results/default-model-settings", { recursive: true });
  await page.screenshot({ path: "test-results/default-model-settings/desktop.png" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await page.waitForTimeout(250);
  await page.screenshot({ path: "test-results/default-model-settings/dark.png" });
  await page.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await picker.selectOption(JSON.stringify(["relay", "second"]));
  await settings.getByRole("button", { name: "Set default" }).click();
  await settings.getByText("Default model for new chats saved.").waitFor();
  assert.equal(writes.at(-1).modelId, "second");
  const level = settings.getByLabel("Default thinking level for new chats");
  assert.equal(await level.inputValue(), "medium");
  await level.selectOption("high");
  await settings.getByRole("button", { name: "Set thinking default" }).click();
  await settings.getByText("Default thinking level for new chats saved.").waitFor();
  assert.equal(writes.at(-1).thinkingLevel, "high");
  failure = true;
  await picker.selectOption(JSON.stringify(["relay", "first"]));
  await settings.getByRole("button", { name: "Set default" }).click();
  await settings.getByText("Project overrides the default").waitFor();
  assert.equal(selected.modelId, "second");
  await level.selectOption("low");
  await settings.getByRole("button", { name: "Set thinking default" }).click();
  await settings.getByText("Project overrides the default").waitFor();
  assert.equal(thinking, "high");
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(300);
  await page.screenshot({ path: "test-results/default-model-settings/mobile.png" });
  for (const id of ["settings-default-model", "settings-default-thinking"]) {
    const bounds = await settings.locator(`#${id}`).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 390);
  }
  await page.setViewportSize({ width: 320, height: 480 });
  for (const id of ["settings-default-model", "settings-default-thinking"]) {
    await settings.locator(`#${id}`).scrollIntoViewIfNeeded();
    const bounds = await settings.locator(`#${id}`).boundingBox();
    assert.ok(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320 && bounds.y >= 0 && bounds.y + bounds.height <= 480);
  }
  await toggle.click();
  await settings.getByRole("button", { name: "Add provider", exact: true }).waitFor();
  assert.equal(await defaults.evaluate(el => el.open), false);
  console.log("PASS: settings saves the new-chat default and shows project refusals");
} catch (error) {
  console.error((await page.locator("body").innerText()).slice(0, 2500));
  throw error;
} finally { await browser.close(); }
