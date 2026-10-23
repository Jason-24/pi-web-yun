// Exercise the real composer and SSE handlers; no model requests or session writes.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { chromium } from "playwright";

const streams = new Set();
let running = false;
const server = createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", "Access-Control-Allow-Origin": "*" });
  res.write(`data: ${JSON.stringify({ type: "connected", isStreaming: running, pendingExtensionUiIds: [] })}\n\n`);
  streams.add(res); req.on("close", () => streams.delete(res));
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const emit = (event) => { for (const stream of streams) stream.write(`data: ${JSON.stringify(event)}\n\n`); };
const browser = await chromium.launch({ headless: true, channel: process.platform === "win32" ? "msedge" : undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 960 }, locale: "zh-CN" });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const sid = "pet-chat-sync-fixture";
const cwd = "D:\\yun\\pi-web-yun";
const model = { provider: "fixture", modelId: "companion-test" };
const session = { id: sid, path: `${cwd}/fixture.jsonl`, cwd, name: "Companion sync fixture", created: new Date().toISOString(), modified: new Date().toISOString(), messageCount: 0, firstMessage: "" };
const commands = [];
let rejectPrompt = false;
await context.route((url) => url.pathname.startsWith("/api/agent/") || url.pathname.startsWith(`/api/sessions/${sid}`) || url.pathname === "/api/sessions" || url.pathname === "/api/models", async (route) => {
  const path = new URL(route.request().url()).pathname;
  if (path.endsWith("/events")) return route.fulfill({ status: 307, headers: { location: `http://127.0.0.1:${server.address().port}/events` } });
  if (path === "/api/agent/running") {
    // Deliberately stale: live transitions must work even when polling misses the entire turn.
    return route.fulfill({ json: { runningSessionIds: [], awaitingInputSessionIds: [] } });
  }
  if (path === "/api/models") return route.fulfill({ json: {
    models: { "fixture:companion-test": "Companion test" }, modelList: [{ id: "companion-test", provider: "fixture", name: "Companion test" }],
    defaultModel: model, thinkingLevels: {}, thinkingLevelMaps: {}, thinkingLevelPins: {},
  } });
  if (path === "/api/sessions") return route.fulfill({ json: { sessions: [session], runningSessionIds: [], awaitingInputSessionIds: [] } });
  if (path === `/api/sessions/${sid}`) return route.fulfill({ json: {
    sessionId: sid, filePath: session.path, totalActiveMs: 0, tree: [], leafId: null,
    context: { messages: [], entryIds: [], oldestEntryId: null, hasMore: false, turnsBefore: 0, thinkingLevel: "off", model },
  } });
  if (route.request().method() === "POST") {
    const command = route.request().postDataJSON(); commands.push(command);
    if (command.type === "prompt" && rejectPrompt) return route.fulfill({ status: 400, json: { error: "Fixture rejection", code: "prompt_rejected", accepted: false } });
    if (command.type === "prompt") running = true;
    const data = command.type === "get_tools" ? [] : command.type === "get_commands" ? { commands: [] } : {};
    return route.fulfill({ json: { success: true, data } });
  }
  return route.fulfill({ json: { running, state: { isStreaming: running, isPromptRunning: running, model: { id: model.modelId, provider: model.provider }, messages: [] } } });
});
await context.addInitScript(() => {
  localStorage.setItem("pi-locale", "zh-CN"); localStorage.setItem("pi-yun-pet-visible", "1");
  localStorage.setItem("pi-sound-enabled", "0");
});
const pet = page.locator("[data-pet-companion]");
const phase = (value) => page.waitForFunction((value) => document.querySelector("[data-pet-companion]")?.dataset.chatPhase === value, value, { timeout: 6000 });
const reply = { role: "assistant", content: [{ type: "text", text: "测试回复" }], timestamp: Date.now(), provider: "fixture", model: "companion-test", stopReason: "stop" };
async function send(text) {
  const input = page.locator("textarea.chat-input-textarea"); await input.fill(text); await input.press("Enter");
  await phase("sending");
  assert.match(await pet.innerText(), /收到你的消息/);
  await page.waitForFunction(() => document.querySelector('[data-pet-companion]')?.dataset.status === "busy");
  // The real EventSource handshake must have arrived before prompt dispatch.
  await page.waitForTimeout(50);
  assert.ok(streams.size);
}
try {
  await page.goto(`${process.env.E2E_URL || "http://127.0.0.1:30141"}/?session=${sid}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await pet.waitFor(); await page.locator("textarea.chat-input-textarea:not([disabled])").waitFor();
  await page.getByRole("button", { name: "桌宠互动", exact: true }).click();
  await page.getByRole("button", { name: "休息一下", exact: true }).click();
  assert.equal(await pet.getAttribute("data-status"), "sleeping");
  await send("验证消息同步");
  emit({ type: "agent_start" }); emit({ type: "message_start", message: reply });
  await phase("replying"); assert.match(await pet.innerText(), /正在回复/);
  emit({ type: "tool_execution_start", toolCallId: "fixture-tool", toolName: "read", args: {} });
  await phase("working"); assert.match(await pet.innerText(), /正在处理/);
  emit({ type: "extension_ui_request", id: "fixture-confirm", method: "confirm", title: "Fixture confirmation", message: "Continue?" });
  await phase("waiting"); assert.equal(await pet.getAttribute("data-status"), "waiting");
  emit({ type: "extension_ui_closed", id: "fixture-confirm" });
  await phase("working");
  running = false; emit({ type: "agent_end" }); emit({ type: "prompt_done" }); emit({ type: "agent_settled" });
  await phase("idle");
  assert.match(await pet.innerText(), /任务完成/); assert.equal(await pet.getAttribute("data-pose"), "cheer");
  // A second complete run is short enough to fit between two background polls.
  await send("验证停止状态");
  running = false; emit({ type: "agent_end" }); emit({ type: "prompt_done", aborted: true }); emit({ type: "agent_settled", aborted: true });
  await phase("idle"); assert.match(await pet.innerText(), /已经停下/); assert.doesNotMatch(await pet.innerText(), /任务完成/);
  await send("验证模型错误");
  emit({ type: "agent_start" });
  emit({ type: "message_end", message: { ...reply, content: [], stopReason: "error", errorMessage: "Fixture model failure" } });
  running = false; emit({ type: "agent_end" }); emit({ type: "prompt_done" }); emit({ type: "agent_settled" });
  await phase("idle"); assert.match(await pet.innerText(), /遇到一点问题/); assert.doesNotMatch(await pet.innerText(), /任务完成/);
  // Definite submission failure keeps the draft and must never celebrate completion.
  rejectPrompt = true;
  const input = page.locator("textarea.chat-input-textarea"); await input.fill("验证发送失败"); await input.press("Enter");
  await page.waitForFunction(() => document.querySelector('[data-pet-companion]')?.innerText.includes("遇到一点问题"));
  await phase("idle"); assert.equal(await input.inputValue(), "验证发送失败");
  assert.doesNotMatch(await pet.innerText(), /任务完成/);
  assert.equal(commands.filter((command) => command.type === "prompt").length, 4);
  assert.deepEqual(errors, []);
  console.log("PASS: actual composer send → SSE reply/tools/confirmation → complete, stopped and rejected; polling remains stale throughout");
} finally {
  await browser.close(); for (const stream of streams) stream.end();
  server.closeAllConnections(); await new Promise((resolve) => server.close(resolve));
}
