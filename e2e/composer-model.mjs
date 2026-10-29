// Existing dev server, isolated APIs; never sends a real prompt or changes settings.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/composer-model");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
const page = await context.newPage();
const cwd = "D:/workspace/model-control";
const session = { id: "composer-model", path: "", cwd, projectRoot: cwd, projectKey: cwd, name: "模型与推理控件", firstMessage: "测试", messageCount: 1,
  created: "2026-10-29T00:00:00Z", modified: "2026-10-29T00:00:00Z" };
const models = [
  { provider: "fixture", id: "base", name: "DeepSeek V4.1 Flash" },
  { provider: "fixture", id: "mapped", name: "自定义推理模型" },
  { provider: "fixture", id: "plain", name: "无推理模型" },
  { provider: "fixture", id: "single", name: "单档推理模型" },
  ...Array.from({ length: 6 }, (_, i) => ({ provider: "fixture", id: `extra-${i}`, name: `Extra ${i}` })),
];
const capabilities = { "fixture:base": ["off", "low", "medium", "high"], "fixture:mapped": ["off", "low", "high", "max"], "fixture:plain": ["off"], "fixture:single": ["off", "high"] };
let model = models[0];
let level = "low";
let defaultLevel = "medium";
let streaming = false;
const commands = [], writes = [], errors = [];
const state = () => ({ model: { provider: model.provider, id: model.id }, thinkingLevel: level, isStreaming: streaming, isPromptRunning: streaming });
page.on("pageerror", error => errors.push(error.message));
await context.route("**/api/**", async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const reply = json => route.fulfill({ json });
  if (path === "/api/models") return reply({ models: Object.fromEntries(models.map(item => [`${item.provider}/${item.id}`, item.name])), modelList: models,
    defaultModel: { provider: "fixture", modelId: "base" }, defaultThinkingLevel: defaultLevel, savedDefaultThinkingLevel: defaultLevel,
    thinkingLevels: capabilities, thinkingLevelMaps: { "fixture:mapped": { low: "quick", high: "turbo", max: null } }, thinkingLevelPins: {} });
  if (path === "/api/models/default") { const edit = request.postDataJSON(); writes.push(edit); if (edit.thinkingLevel) defaultLevel = edit.thinkingLevel; return reply({ success: true }); }
  if (path === "/api/sessions") return reply({ sessions: [session], sessionListVersion: 1, runningSessionIds: streaming ? [session.id] : [], awaitingInputSessionIds: [] });
  if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
  if (path === "/api/agent/running") return reply({ runningSessionIds: streaming ? [session.id] : [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
  if (path === `/api/sessions/${session.id}`) return reply({ sessionId: session.id, info: session, tree: [], leafId: "user", filePath: "",
    context: { messages: [{ role: "user", content: "测试", timestamp: 1793232000000 }], entryIds: ["user"], hasMore: false,
      model: { provider: model.provider, modelId: model.id }, thinkingLevel: level } });
  if (path === `/api/sessions/${session.id}/state`) return reply({ state: state() });
  if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "connected", isStreaming: streaming })}\n\n` });
  if (path.endsWith("/lease")) return reply({ running: streaming, awaitingInput: false, subagentsActive: false });
  if (path.startsWith("/api/agent/") && request.method() === "POST") {
    const command = request.postDataJSON(); commands.push(command);
    if (command.type === "set_thinking_level") level = command.level;
    if (command.type === "set_model") { model = models.find(item => item.id === command.modelId); level = capabilities[`fixture:${model.id}`]?.includes(level) ? level : capabilities[`fixture:${model.id}`]?.at(-1) ?? "medium"; }
    return reply({ success: true, data: command.type === "set_model" ? { provider: model.provider, id: model.id } : command.type === "get_state" ? state() : {} });
  }
  if (path.startsWith("/api/agent/")) return reply({ state: state() });
  if (path === "/api/cwd/validate") return reply({ valid: true, cwd, projectRoot: cwd, projectKey: cwd });
  if (path === "/api/home") return reply({ home: "C:/Users/test" });
  if (path === "/api/web-auth") return reply({ enabled: false });
  if (path === "/api/app-update") return reply({ latestVersion: "0.2.3" });
  if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
  if (path === "/api/project-trust") return reply({ cwd, trusted: true, requiresTrust: false, mcpServers: [] });
  return reply({});
});

const trigger = page.locator(".composer-model-trigger");
const card = page.getByRole("dialog", { name: "模型与推理强度", exact: true });
const slider = card.getByRole("slider", { name: "推理强度", exact: true });
const modelPicker = card.getByRole("button", { name: "选择模型", exact: true });
const chooseModel = async name => {
  await modelPicker.click();
  await page.getByRole("option", { name, exact: true }).click();
  await page.waitForFunction(name => document.querySelector(".composer-model-trigger")?.textContent.includes(name), name);
  await page.waitForFunction(() => !document.querySelector(".composer-model-trigger")?.hasAttribute("aria-busy"));
  assert.equal(await modelPicker.evaluate(el => el === document.activeElement), true);
};
try {
  await page.goto(`${base}/?session=${session.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await trigger.filter({ hasText: models[0].name }).waitFor();
  await page.locator(".chat-input-textarea").fill("保留这条草稿");
  const tools = page.getByRole("button", { name: "更改工具预设", exact: true });
  assert.equal(await tools.innerText(), "工具");
  assert.match(await tools.getAttribute("title"), /默认工具/);
  assert.deepEqual(await tools.evaluate(el => [getComputedStyle(el).borderWidth, getComputedStyle(el).backgroundColor]), ["0px", "rgba(0, 0, 0, 0)"]);
  await page.locator(".chat-composer-card").screenshot({ path: resolve(artifacts, "composer-footer.png") });
  const agents = page.locator('[data-workspace-view="agents"]');
  assert.equal(await agents.locator("svg circle").count(), 1, "the Agents control uses the shared group outline");
  assert.equal(await agents.evaluate(el => getComputedStyle(el).color), "rgb(85, 114, 219)");
  await agents.screenshot({ path: resolve(artifacts, "agents-icon.png") });
  await trigger.click();
  await card.waitFor();
  assert.equal(await slider.getAttribute("max"), "2");
  await card.getByRole("button", { name: "关闭", exact: true }).click();
  await slider.press("Home");
  await page.waitForFunction(() => document.querySelector('.composer-model-trigger')?.textContent.includes("·低"));
  assert.equal(level, "low", "the first slider stop activates reasoning from Off");
  await slider.press("End");
  await page.waitForFunction(() => document.querySelector('.composer-model-trigger')?.textContent.includes("·高"));
  assert.equal(level, "high");
  await card.getByRole("button", { name: "恢复默认推理强度", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.composer-model-trigger')?.textContent.includes("·中"));
  assert.equal(level, "medium", "reset updates the actual live session");
  await slider.press("End");
  await card.getByRole("button", { name: "使用并设为新会话默认推理级别", exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.model-reasoning-saveDefault')?.textContent.includes("新会话默认推理级别"));
  assert.equal(writes.at(-1).thinkingLevel, "high");
  await page.screenshot({ path: resolve(artifacts, "desktop.png") });
  await card.screenshot({ path: resolve(artifacts, "card.png") });
  await chooseModel("自定义推理模型");
  assert.equal(await slider.getAttribute("max"), "1", "null mapping and unsupported levels stay out");
  await slider.press("Home");
  await page.waitForFunction(() => document.querySelector('.model-reasoning-heading')?.textContent.includes("quick"));
  await slider.press("End");
  await page.waitForFunction(() => document.querySelector('.model-reasoning-heading')?.textContent.includes("turbo"));
  assert.equal(level, "high", "mapped labels retain canonical protocol values");
  await chooseModel("单档推理模型");
  assert.equal(await slider.count(), 0);
  await card.locator(".model-reasoning-single button").waitFor();
  await chooseModel("无推理模型");
  assert.equal(await slider.count(), 0);
  await card.getByText("此模型不支持调节推理强度。", { exact: true }).waitFor();
  await chooseModel("DeepSeek V4.1 Flash");
  await modelPicker.click();
  await page.getByRole("textbox", { name: "筛选模型…", exact: true }).fill("自定义");
  await page.keyboard.press("Escape");
  assert.equal(await card.isVisible(), true, "first Escape closes the nested picker");
  await page.keyboard.press("Escape");
  assert.equal(await card.count(), 0);
  assert.equal(await trigger.evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator(".chat-input-textarea").inputValue(), "保留这条草稿");

  streaming = true;
  await page.reload({ waitUntil: "domcontentloaded" });
  await trigger.click();
  assert.equal(await modelPicker.isDisabled(), true);
  assert.equal(await slider.isEnabled(), true, "reasoning remains editable mid-run");
  await slider.press("End");
  assert.equal(commands.at(-1).type, "set_thinking_level");
  await page.keyboard.press("Escape");
  assert.equal(commands.some(command => command.type === "abort"), false);

  streaming = false;
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload({ waitUntil: "domcontentloaded" });
  await trigger.click();
  const bounds = await card.boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390 && bounds.y >= 0 && bounds.y + bounds.height <= 844);
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.screenshot({ path: resolve(artifacts, "mobile-dark.png") });
  await modelPicker.click();
  const filter = page.getByRole("textbox", { name: "筛选模型…", exact: true });
  await filter.fill("DeepSeek");
  await page.evaluate(() => {
    const viewport = window.visualViewport;
    Object.defineProperty(viewport, "height", { configurable: true, get: () => 350 });
    Object.defineProperty(viewport, "offsetTop", { configurable: true, get: () => 70 });
    viewport.dispatchEvent(new Event("resize"));
  });
  await page.waitForFunction(() => {
    const filter = document.querySelector('.model-selector input');
    const list = document.querySelector('.model-selector [role="listbox"]');
    if (!filter || !list || document.activeElement !== filter) return false;
    const rect = list.getBoundingClientRect(), viewport = window.visualViewport;
    return rect.top >= viewport.offsetTop && rect.bottom <= viewport.offsetTop + viewport.height;
  });
  assert.equal(await filter.inputValue(), "DeepSeek");
  await page.screenshot({ path: resolve(artifacts, "mobile-keyboard.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");
  await page.evaluate(() => {
    delete window.visualViewport.height; delete window.visualViewport.offsetTop;
    window.visualViewport.dispatchEvent(new Event("resize"));
  });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.equal(commands.some(command => command.type === "prompt" || command.type === "abort"), false);
  assert.deepEqual(errors, []);
  console.log("PASS: combined control, discrete/sparse/mapped/single/off reasoning, live reset and default save, model changes, draft and Escape focus, mid-run reasoning, mobile/dark/keyboard; no prompts/aborts or browser errors.");
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, "failure.png") }).catch(() => {});
  console.error({ model, level, commands: commands.slice(-5), errors });
  throw error;
} finally { await context.close(); await browser.close(); }
