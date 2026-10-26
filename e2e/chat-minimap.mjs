// Run against an existing dev server: E2E_BROWSER_CHANNEL=chrome node e2e/chat-minimap.mjs
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "playwright";

export async function checkChatMinimap({ browser, base, artifacts }) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, reducedMotion: "reduce" });
  const page = await context.newPage();
  const cwd = "D:/workspace/minimap";
  const session = { id: "minimap-layout", path: "", cwd, projectRoot: cwd, projectKey: cwd,
    name: "对话导航样式检查", firstMessage: "问题 1：检查这一轮对话", messageCount: 24,
    created: "2026-10-26T00:00:00Z", modified: "2026-10-26T00:00:00Z" };
  const messages = Array.from({ length: 12 }, (_, index) => [
    { role: "user", content: `问题 ${index + 1}：检查这一轮对话`, timestamp: 1792972800000 + index * 2000 },
    { role: "assistant", content: [{ type: "text", text: index === 2
      ? "侧边栏可以收起吗？可以按下面的方式使用。\n\n- 桌面保留功能入口\n- 项目侧栏按需收起\n- 手机使用抽屉导航"
      : `## 回答 ${index + 1} 的要点\n\n` + "每轮对话都有清楚的标题与摘要，方便快速回看并跳转到对应的位置。\n\n".repeat(6) }], timestamp: 1792972801000 + index * 2000, stopReason: "stop" },
  ]).flat();
  const chatContext = { messages, entryIds: messages.map((_, index) => `entry-${index}`), oldestEntryId: "entry-0", hasMore: false, turnsBefore: 5, thinkingLevel: "off", model: null };
  const errors = [];
  const commands = [];
  page.on("pageerror", error => errors.push(error.message));
  await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const reply = json => route.fulfill({ json });
    if (path === "/api/sessions") return reply({ sessions: [session], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
    if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
    if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
    if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
    if (path === "/api/project-trust") return reply({ cwd, requiresTrust: false, trusted: true, mcpServers: [] });
    if (path === "/api/models") return reply({ models: [], modelList: [], defaultModel: null });
    if (path === "/api/home") return reply({ home: "C:/Users/test" });
    if (path === "/api/tools/settings") return reply({ powershell: false, codemode: false });
    if (path === "/api/cache-miss-notices") return reply({ enabled: true });
    if (path === "/api/web-auth") return reply({ enabled: false });
    if (path === `/api/sessions/${session.id}/context`) return reply({ context: chatContext });
    if (path === `/api/sessions/${session.id}`) return reply({ sessionId: session.id, info: session, context: chatContext, filePath: "", tree: [], leafId: "entry-23", totalActiveMs: 0 });
    if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
    if (path.startsWith("/api/agent/") && request.method() === "POST") {
      commands.push(request.postDataJSON().type);
      return reply({ success: true, data: {} });
    }
    return reply({});
  });

  try {
    await page.goto(`${base}/?session=${session.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
    const rail = page.locator("[data-chat-minimap]");
    const preview = page.locator("[data-minimap-preview-box]");
    const nodes = page.locator("[data-minimap-node-index]");
    const scroll = page.locator(".workspace-chat-view .overflow-y-auto").first();
    await nodes.first().waitFor({ timeout: 90000 });
    assert.equal(await nodes.count(), 12);
    const railBox = await rail.boundingBox();
    const scrollBox = await scroll.boundingBox();
    assert.ok(railBox.x + railBox.width <= scrollBox.x + 1, "the ticks sit to the left of the transcript");
    const firstBox = await nodes.first().boundingBox();
    const lastBox = await nodes.last().boundingBox();
    assert.ok(firstBox.y > railBox.y + 100, "the tick group sits near the middle of the conversation");
    assert.ok(lastBox.y - firstBox.y <= 112, "the ticks form a compact group");
    const markerWidths = () => nodes.evaluateAll(elements => elements.map(el => el.querySelector("span").getBoundingClientRect().width));
    assert.ok((await markerWidths()).every(width => width === 6), "all ticks stay short before hovering, including the current turn");
    assert.equal(await page.locator("[data-minimap-lock]").evaluate(el => getComputedStyle(el).opacity), "0", "the lock stays hidden while idle");
    await page.screenshot({ path: resolve(artifacts, "chat-minimap-idle.png") });
    const hover = async index => {
      await nodes.nth(index).hover();
      await preview.waitFor();
      await preview.locator(`[data-minimap-preview-index="${index}"]`).waitFor();
      assert.equal(await preview.locator("[data-minimap-preview-index]").count(), 1, "only the hovered turn is previewed");
      const box = await preview.boundingBox();
      assert.ok(box.x >= railBox.x + railBox.width, "the preview opens to the right of the ticks");
      assert.ok(box.width <= 330 && box.height <= 205, "the preview is a compact summary card");
      assert.ok(box.y >= railBox.y && box.y + box.height <= railBox.y + railBox.height, "the card stays within the conversation height");
    };
    await hover(2);
    const widths = await markerWidths();
    assert.ok(widths[2] > widths[1] && widths[1] > widths[0] && widths[0] >= 6, "nearby ticks widen gradually toward the pointer");
    await preview.getByText("项目侧栏按需收起", { exact: true }).waitFor();
    assert.equal(await preview.locator('span[aria-hidden="true"]').first().textContent(), "08", "turn numbers include unloaded history");
    await preview.getByText("更早的 5 轮还没加载，点击加载", { exact: true }).waitFor();
    await page.screenshot({ path: resolve(artifacts, "chat-minimap-summary.png") });
    await hover(6);
    await preview.getByRole("button", { name: "回答 7 的要点", exact: true }).click();
    await page.waitForFunction(() => {
      const heading = [...document.querySelectorAll(".workspace-chat-view h2")].find(el => el.textContent === "回答 7 的要点");
      const scroller = heading?.closest(".overflow-y-auto");
      return heading && scroller && Math.abs(heading.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight * .3) < 5;
    });
    await nodes.nth(4).focus();
    await nodes.nth(4).press("Enter");
    assert.equal(await nodes.nth(4).getAttribute("aria-current"), "step");
    await page.waitForFunction(() => {
      const message = document.querySelector('[data-entry-id="entry-8"]');
      const scroller = message?.closest(".overflow-y-auto");
      return message && scroller && Math.abs(message.getBoundingClientRect().top - scroller.getBoundingClientRect().top - scroller.clientHeight * .3) < 5;
    });
    await preview.locator('[data-minimap-preview-index="4"]').waitFor();
    await page.mouse.move(0, 0);
    await page.locator(".workspace-chat-view textarea").focus();
    await preview.waitFor({ state: "detached" });
    assert.ok((await markerWidths()).every(width => width === 6), "ticks return to their quiet width after leaving");
    const before = await scroll.evaluate(el => el.scrollTop);
    await page.mouse.click(railBox.x + railBox.width / 2, railBox.y + 10);
    assert.equal(await scroll.evaluate(el => el.scrollTop), before, "empty gutter space does not navigate");
    assert.equal(await preview.count(), 0, "empty gutter space does not open a preview");
    await hover(3);
    const lock = page.locator("[data-minimap-lock]");
    await lock.click();
    await preview.waitFor({ state: "detached" });
    await nodes.first().hover();
    assert.equal(await preview.count(), 0, "the saved lock suppresses hover previews");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.locator('[data-minimap-lock="on"]').waitFor();
    await lock.click();
    await nodes.last().hover();
    await preview.waitFor();
    await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
    await page.screenshot({ path: resolve(artifacts, "chat-minimap-dark.png") });
    await page.evaluate(() => { document.documentElement.dataset.theme = "light"; });
    await page.locator('[data-resize-handle="sidebar"]').dblclick();
    await nodes.nth(2).hover();
    await preview.waitFor();
    await page.screenshot({ path: resolve(artifacts, "chat-minimap-sidebar-collapsed.png") });
    await page.setViewportSize({ width: 1024, height: 650 });
    await nodes.last().hover();
    const resized = await preview.boundingBox();
    assert.ok(resized.y >= (await rail.boundingBox()).y && resized.y + resized.height <= (await rail.boundingBox()).y + (await rail.boundingBox()).height);
    await page.setViewportSize({ width: 390, height: 844 });
    await rail.waitFor({ state: "detached" });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.equal(commands.some(type => type === "prompt" || type === "abort"), false);
    assert.deepEqual(errors, []);
    console.log("PASS: left conversation ticks, compact per-turn previews, lists, heading jumps, keyboard selection, blank gutter, persisted lock, history numbering, sidebar collapse, dark and responsive layouts.");
  } catch (error) {
    await page.screenshot({ path: resolve(artifacts, "chat-minimap-failure.png") });
    throw error;
  } finally { await context.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const artifacts = resolve("test-results/chat-minimap");
  mkdirSync(artifacts, { recursive: true });
  const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || undefined });
  try { await checkChatMinimap({ browser, base: process.env.E2E_BASE_URL || "http://127.0.0.1:30141", artifacts }); }
  finally { await browser.close(); }
}
