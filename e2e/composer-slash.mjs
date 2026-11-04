// Existing dev server, isolated APIs: no real session, prompt or setting writes.
import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || (process.platform === "win32" ? "msedge" : undefined) });
const cwd = "D:/workspace/slash-fixture";
const session = { id: "composer-slash", cwd, projectRoot: cwd, projectKey: cwd, name: "Slash fixture", firstMessage: "Existing request", messageCount: 1,
  created: "2026-11-04T00:00:00Z", modified: "2026-11-04T00:00:00Z" };
const slashCommands = [
  { name: "skill:writing", description: "Polish a draft", source: "skill" },
  { name: "deploy", description: "Deploy extension", source: "extension" },
  { name: "review", description: "Review template", source: "prompt" },
];

async function check(mobile) {
  const context = await browser.newContext(mobile
    ? { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }
    : { viewport: { width: 1440, height: 1000 } });
  await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
  const page = await context.newPage();
  const commands = [], errors = [];
  let streaming = false;
  const state = () => ({ model: { provider: "fixture", id: "base" }, thinkingLevel: "off", isStreaming: streaming, isPromptRunning: streaming });
  page.on("pageerror", error => errors.push(error.message));
  await context.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = json => route.fulfill({ json });
    if (path === "/api/models") return reply({ models: { "fixture/base": "Fixture" }, modelList: [{ provider: "fixture", id: "base", name: "Fixture" }], defaultModel: { provider: "fixture", modelId: "base" }, thinkingLevels: { "fixture:base": ["off"] } });
    if (path === "/api/sessions") return reply({ sessions: [session], sessionListVersion: 1, runningSessionIds: streaming ? [session.id] : [], awaitingInputSessionIds: [] });
    if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
    if (path === "/api/agent/running") return reply({ runningSessionIds: streaming ? [session.id] : [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
    if (path === `/api/sessions/${session.id}`) return reply({ sessionId: session.id, info: session, tree: [], leafId: "user", filePath: "", context: {
      messages: [{ role: "user", content: "Existing request", timestamp: 1793750400000 }], entryIds: ["user"], hasMore: false,
      model: { provider: "fixture", modelId: "base" }, thinkingLevel: "off" } });
    if (path === `/api/sessions/${session.id}/state`) return reply({ state: state() });
    if (path === `/api/sessions/${session.id}/context`) return reply({ context: { messages: [], entryIds: [], hasMore: false } });
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: `data: ${JSON.stringify({ type: "connected", isStreaming: streaming })}\n\n` });
    if (path.endsWith("/lease")) return reply({ running: streaming, awaitingInput: false, subagentsActive: false });
    if (path.startsWith("/api/agent/") && request.method() === "POST") {
      const command = request.postDataJSON(); commands.push(command);
      return reply({ success: true, data: command.type === "get_commands" ? { commands: slashCommands } : command.type === "get_state" ? state() : {} });
    }
    if (path.startsWith("/api/agent/")) return reply({ state: state() });
    if (path === "/api/skills") return reply({ skills: [] });
    if (path === "/api/cwd/validate") return reply({ valid: true, cwd, projectRoot: cwd, projectKey: cwd });
    if (path === "/api/home") return reply({ home: "C:/Users/test" });
    if (path === "/api/web-auth") return reply({ enabled: false });
    if (path === "/api/app-update") return reply({ latestVersion: "0.2.7" });
    if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
    if (path === "/api/project-trust") return reply({ cwd, trusted: true, requiresTrust: false, mcpServers: [] });
    return reply({});
  });
  const input = page.locator(".chat-input-textarea");
  const skill = page.getByRole("button", { name: /^\/skill:writing/ });
  const builtin = page.getByRole("button", { name: /^\/reload/ });
  const waitValue = value => page.waitForFunction(value => document.querySelector(".chat-input-textarea")?.value === value, value);
  try {
    await page.goto(`${base}/?session=${session.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    await input.waitFor();
    await input.fill("/");
    await skill.waitFor();
    assert.equal(await builtin.count(), 1, "leading slash retains operational commands");
    await input.fill("请润色这段话/");
    await skill.waitFor();
    assert.equal(await builtin.count(), 0, "inline slash offers skills only");
    assert.equal(await page.getByRole("button", { name: /^\/deploy/ }).count(), 0);
    assert.equal(await page.getByRole("button", { name: /^\/review/ }).count(), 0);
    if (mobile) await skill.tap();
    else await input.press("Tab");
    await waitValue("/skill:writing 请润色这段话");
    assert.equal(commands.filter(c => c.type === "prompt").length, 0, "selection never submits a prompt");
    await input.press("Control+z");
    await waitValue("请润色这段话/");

    for (const text of ["Visit https://example.com/", "Open C:/src/", "Read ./src/file", "!cat /"]) {
      await input.fill(text);
      await skill.waitFor({ state: "hidden" });
    }
    const draft = "第一段\n请润色 /wri 保留结尾";
    await input.fill(draft);
    await input.evaluate((el, cursor) => { el.setSelectionRange(cursor, cursor); el.dispatchEvent(new Event("select", { bubbles: true })); }, draft.indexOf(" 保留"));
    await input.press("ArrowLeft");
    await input.press("ArrowRight");
    await skill.waitFor();
    if (mobile) await skill.tap();
    else await input.press("Enter");
    await waitValue("/skill:writing 第一段\n请润色  保留结尾");
    assert.equal(await input.evaluate(el => el.value.slice(el.selectionStart)), " 保留结尾");
    if (!mobile) {
      await page.locator('[data-workspace-view="history"]').click();
      await page.locator('[data-workspace-view="chat"]').click();
    }
    await waitValue("/skill:writing 第一段\n请润色  保留结尾");

    if (!mobile) {
      await input.fill("请用 /wri");
      await skill.waitFor();
      await input.dispatchEvent("compositionstart");
      await input.dispatchEvent("keydown", { key: "Enter", isComposing: true, keyCode: 229 });
      assert.equal(await input.inputValue(), "请用 /wri", "IME confirmation does not choose a skill");
      await input.dispatchEvent("compositionend");
    }
    await input.fill("正常发送的需求 /wri");
    await skill.waitFor();
    if (mobile) await skill.tap();
    else await input.press("Tab");
    await page.getByRole("button", { name: "Send", exact: true }).click();
    await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value === "");
    assert.equal(commands.filter(c => c.type === "prompt").at(-1).message, "/skill:writing 正常发送的需求");
    // The same editor normalization must reach both streaming prompt modes.
    streaming = true;
    await page.reload({ waitUntil: "domcontentloaded" });
    const steer = page.getByRole("button", { name: "Steer", exact: true });
    await steer.waitFor();
    for (const [label, behavior] of [["Steer", "steer"], ["Follow-up", "followUp"]]) {
      await input.fill("排队的需求 /wri");
      await skill.waitFor();
      if (mobile) await skill.tap();
      else await input.press("Tab");
      await waitValue("/skill:writing 排队的需求 ");
      await page.getByRole("button", { name: label, exact: true }).click();
      await page.waitForFunction(() => document.querySelector(".chat-input-textarea")?.value === "");
      const prompt = commands.filter(c => c.type === "prompt").at(-1);
      assert.equal(prompt.message, "/skill:writing 排队的需求");
      assert.equal(prompt.streamingBehavior, behavior);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS composer slash: ${mobile ? "mobile" : "desktop"}`);
  } finally { await context.close(); }
}

try { await check(false); await check(true); } finally { await browser.close(); }
