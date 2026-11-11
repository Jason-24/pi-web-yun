// Run against the existing dev server; every API is an isolated browser fixture.
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { showSidebarFiles } from "./sidebar.mjs";

const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || "chrome" });
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const cwd = "D:/workspace/motion";
const session = { id: "motion-fixture", path: "", cwd, projectRoot: cwd, projectKey: cwd, name: "Motion fixture", firstMessage: "Check motion", messageCount: 2,
  created: "2026-11-01T00:00:00Z", modified: "2026-11-01T00:00:00Z" };
const otherCwd = "D:/workspace/motion-other";
const otherSession = { ...session, id: "motion-other", cwd: otherCwd, projectRoot: otherCwd, projectKey: otherCwd };
const messages = [
  { role: "user", content: "Check motion", timestamp: 1793491200000 },
  { role: "custom", customType: "compaction", display: true,
    content: "## Goal\n\n" + "Smooth disclosure content.\n\n".repeat(12), details: { tokensBefore: 12000 } },
  { role: "custom", customType: "status-update", display: true,
    content: "Extension status body.\n\n".repeat(4), details: { step: "Review", items: [1, 2, 3] } },
  { role: "assistant", timestamp: 1793491201000, content: [
    { type: "toolCall", toolCallId: "motion-call", toolName: "read", input: { path: "motion.txt", limit: 100 } },
  ] },
  { role: "toolResult", toolCallId: "motion-call", toolName: "read", timestamp: 1793491202000,
    content: [{ type: "text", text: "Retain tool output while closing.\n".repeat(5) },
      { type: "image", mimeType: "image/png", data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Zl1sAAAAASUVORK5CYII=" }] },
];
try {
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 }, reducedMotion: "no-preference" });
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", error => errors.push(error.stack));
    await context.addInitScript(() => localStorage.setItem("pi-locale", "en"));
    await context.addInitScript(() => {
      window.__treeAnimations = [];
      const animate = Element.prototype.animate;
      Element.prototype.animate = function (...args) {
        const result = animate.apply(this, args);
        if (this.hasAttribute("data-row-key")) window.__treeAnimations.push({ key: this.getAttribute("data-row-key"), animation: result });
        return result;
      };
    });
    await context.route("**/api/**", async route => {
      const url = new URL(route.request().url()), path = url.pathname;
      const reply = json => route.fulfill({ json });
      if (path === "/api/sessions") return reply({ sessions: [session, otherSession], runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd, otherCwd] } });
      if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [] });
      if (path === "/api/models") return reply({ models: [], modelList: [], defaultModel: null });
      if (path === "/api/home") return reply({ home: "C:/Users/test" });
      if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
      if (path === "/api/project-trust") return reply({ requiresTrust: false, trusted: true, mcpServers: [] });
      if (path === `/api/sessions/${session.id}`) return reply({ sessionId: session.id, info: session, tree: [], leafId: null,
        context: { messages, entryIds: messages.map((_, i) => `entry-${i}`), hasMore: false, model: null, thinkingLevel: "off" } });
      if (path.startsWith("/api/files/") && url.searchParams.get("type") === "list") return reply({ entries:
        path.endsWith("folder") ? Array.from({ length: 8 }, (_, i) => ({ name: `file-${i}.txt`, isDir: false, size: 1 })) : [{ name: "folder", isDir: true }] });
      if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
      return reply({});
    });
    await page.goto(`${base}/?session=${session.id}`, { waitUntil: "domcontentloaded" });
    const composer = page.locator("textarea.chat-input-textarea:visible");
    try { await composer.fill("Keep this draft", { timeout: 10000 }); }
    catch (error) { console.log({ errors, text: (await page.locator("body").innerText()).slice(0, 3000) }); throw error; }
    // Only explicit folds animate virtual rows; scrolling and reduced motion cancel them.
    if (width < 640) await page.locator(".workspace-sidebar-toggle").click();
    const group = page.locator(".session-tree-group-toggle").filter({ hasText: "motion" }).first();
    await group.waitFor();
    await group.click();
    await page.waitForFunction(() => window.__treeAnimations.length > 0);
    assert.ok(await page.evaluate(() => window.__treeAnimations.some(({ animation }) =>
      animation.effect.getKeyframes()[0].transform !== "translateY(0px)")), "fold moves affected virtual rows");
    await group.click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForFunction(() => window.__treeAnimations.every(({ animation }) => animation.playState !== "running"));
    const animationCount = await page.evaluate(() => window.__treeAnimations.length);
    await group.click();
    assert.equal(await page.evaluate(() => window.__treeAnimations.length), animationCount, "reduced motion folds immediately");
    await group.click();
    if (width < 640) await page.locator(".sidebar-overlay-backdrop").click({ position: { x: 380, y: 450 } });
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const toggle = page.getByRole("button", { name: /Conversation compacted/ });
    const disclosure = toggle.locator("..").locator(".ui-disclosure").first();
    const middle = await toggle.evaluate(async el => {
      el.click();
      const body = el.parentElement.querySelector(".ui-disclosure");
      while (!body.getAnimations().length) await new Promise(resolve => requestAnimationFrame(resolve));
      const animation = body.getAnimations()[0];
      animation.pause();
      animation.currentTime = 80;
      return { height: body.getBoundingClientRect().height, full: body.scrollHeight };
    });
    assert.ok(middle.height > 0 && middle.height < middle.full, `entrance has an intermediate height: ${JSON.stringify(middle)}`);
    // Reverse before settling: the body stays inert while leaving and then unmounts.
    await toggle.evaluate(el => el.click());
    assert.equal(await disclosure.getAttribute("inert"), "");
    await disclosure.waitFor({ state: "hidden" });
    await disclosure.locator(".ui-disclosure-body").waitFor({ state: "detached" });
    assert.equal(await disclosure.locator(".ui-disclosure-body").count(), 0);
    await toggle.click();
    await page.emulateMedia({ reducedMotion: "reduce" });
    await disclosure.evaluate(el => Promise.all(el.getAnimations().map(a => a.finished.catch(() => {}))));
    await toggle.click();
    await disclosure.waitFor({ state: "hidden" });
    await toggle.click();
    assert.equal(await disclosure.evaluate(el => el.getAnimations().length), 0);
    assert.equal(await composer.inputValue(), "Keep this draft");
    await toggle.click();
    await page.emulateMedia({ reducedMotion: "no-preference" });
    const customToggle = page.locator(".custom-message-toggle");
    const customBody = customToggle.locator("../..").locator(":scope > .ui-disclosure");
    const detailsToggle = page.locator(".custom-message-details-toggle");
    await detailsToggle.click();
    assert.equal(await detailsToggle.getAttribute("aria-expanded"), "true");
    await customToggle.click();
    assert.equal(await customBody.getAttribute("inert"), "");
    await customBody.waitFor({ state: "hidden" });
    await detailsToggle.waitFor({ state: "detached" });
    assert.equal(await detailsToggle.count(), 0, "custom footer unmounts after closing");
    await customToggle.click();
    await detailsToggle.waitFor();
    assert.equal(await detailsToggle.getAttribute("aria-expanded"), "true", "nested detail choice survives a fold");
    const process = page.locator(".process-details-toggle");
    if (await process.count() && await process.getAttribute("aria-expanded") === "false") await process.click();
    const toolToggle = page.locator(".tool-call-toggle");
    await toolToggle.scrollIntoViewIfNeeded();
    const card = toolToggle.locator("../..");
    const toolBodies = card.locator(":scope > .ui-disclosure");
    assert.equal(await card.locator("img").count(), 1, "result image remains visible while folded");
    await toolToggle.click();
    await card.getByText("Retain tool output while closing.", { exact: false }).waitFor();
    await toolBodies.evaluateAll(elements => Promise.all(elements.flatMap(el => el.getAnimations()).map(a => a.finished.catch(() => {}))));
    const closing = await toolToggle.evaluate(el => {
      el.click();
      return el.parentElement.parentElement.textContent;
    });
    assert.ok(closing.includes("Retain tool output"), "closing retains the actual result");
    await toolBodies.first().waitFor({ state: "hidden" });
    await toolBodies.last().waitFor({ state: "hidden" });
    await toolBodies.first().locator(".ui-disclosure-body").waitFor({ state: "detached" });
    await toolBodies.last().locator(".ui-disclosure-body").waitFor({ state: "detached" });
    assert.equal(await card.locator("img").count(), 1, "closing never hides result images");
    assert.equal(await toolBodies.locator(".ui-disclosure-body").count(), 0, "closed tool bodies are released");
    if (width === 1440) {
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await showSidebarFiles(page);
      const folder = page.getByTitle(`${cwd}/folder`, { exact: true });
      await folder.click();
      await page.getByTitle(`${cwd}/folder/file-0.txt`, { exact: true }).waitFor();
      await folder.click();
      await page.getByTitle(`${cwd}/folder/file-0.txt`, { exact: true }).waitFor({ state: "hidden" });
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${width}px virtual row motion, reduced motion, disclosures, reversal, custom details, tool images, cleanup and drafts`);
    await context.close();
  }
} finally { await browser.close(); }
