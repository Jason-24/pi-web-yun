// Run against the existing dev server; all session/file APIs use isolated fixtures.
import assert from "node:assert/strict";
import { mkdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/file-reading");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ headless: true, channel: process.env.E2E_BROWSER_CHANNEL || "chrome" });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
const page = await context.newPage();
page.setDefaultTimeout(25_000);
const cwd = "D:/workspace/pi-web-yun";
const session = { id: "file-reading", path: "", cwd, projectRoot: cwd, projectKey: cwd, name: "阅读文件与快速查找", firstMessage: "阅读文件", messageCount: 2,
  created: "2026-10-27T00:00:00Z", modified: "2026-10-27T00:00:00Z" };
const fixtures = {
  "reading.txt": Array.from({ length: 1150 }, (_, i) => `${String(i + 1).padStart(4, "0")}  ${[5, 600, 1100].includes(i) ? "文件查找 [target]" : "Reading quietly, keeping the document in view."}`).join("\n"),
  "tokens.ts": 'export const value = "[target]";\nexport const other = "[target]";',
  "notes.md": "# 阅读笔记\n\n查找 **跨越加粗** 内容。\n\n第二处查找跨越加粗内容。",
  "table.csv": "name,value\nfirst,needle\nsecond,needle\n",
  "page.html": '<html><body><input id="note" /><p>needle</p></body></html>',
  "partial.txt": "prefix needle\n",
  "many.txt": "needle ".repeat(5002),
  "change.ts": "const value = 'needle';\n",
  "FileViewer.tsx": readFileSync(new URL("../components/FileViewer.tsx", import.meta.url), "utf8").split("\n").slice(0, 90).join("\n"),
  "这是一个用于检查文件标签栏省略与键盘切换的较长文件名称.ts": "export const width = 320;",
};
const errors = [];
const commands = [];
page.on("pageerror", error => errors.push(error.message));
await context.addInitScript(() => { if (window === window.top) localStorage.setItem("pi-locale", "zh-CN"); });
await page.route("**/api/**", async route => {
  const request = route.request();
  const url = new URL(request.url());
  const path = url.pathname;
  const reply = json => route.fulfill({ json });
  if (path === "/api/sessions") return reply({ sessions: [session], sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
  if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
  if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
  if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
  if (path === "/api/project-trust") return reply({ requiresTrust: false, trusted: true, mcpServers: [] });
  if (path === "/api/models") return reply({ models: [], modelList: [], defaultModel: null });
  if (path === "/api/git/status") return reply({ isGit: false, files: [] });
  if (path === "/api/git/diff") return reply(url.searchParams.get("path")?.endsWith("change.ts")
    ? { supported: true, status: "modified", patch: "diff --git a/change.ts b/change.ts\n--- a/change.ts\n+++ b/change.ts\n@@ -1 +1 @@\n-const value = 'old needle';\n+const value = 'new needle';\n" }
    : { supported: false });
  if (path === "/api/home") return reply({ home: "C:/Users/test" });
  if (path === "/api/file-index") {
    const query = (url.searchParams.get("q") || "").toLowerCase();
    return reply({ matches: Object.keys(fixtures).filter(name => name.toLowerCase().includes(query)).map(path => ({ path, isDir: false })) });
  }
  if (path.startsWith("/api/files/")) {
    const type = url.searchParams.get("type");
    const file = decodeURIComponent(path.split("/").pop());
    const content = fixtures[file] || "";
    if (type === "list") return reply({ entries: file === "components"
      ? [{ name: "FileViewer.tsx", isDir: false, size: fixtures["FileViewer.tsx"].length }]
      : [...Object.keys(fixtures).filter(name => name !== "FileViewer.tsx").map(name => ({ name, isDir: false, size: fixtures[name].length })), { name: "components", isDir: true }] });
    if (type === "watch") return route.fulfill({ contentType: "text/event-stream", body: "" });
    if (type === "meta") return reply({ size: content.length, mtimeMs: 1 });
    if (type === "read") {
      const more = file === "partial.txt" && url.searchParams.has("offset");
      return reply({ content: more ? "suffix needle\n" : content, language: file.endsWith(".tsx") ? "tsx" : file.endsWith(".ts") ? "typescript" : file.endsWith(".md") ? "markdown" : file.endsWith(".html") ? "html" : "text",
        size: file === "partial.txt" ? 100 : content.length, nextOffset: more ? 100 : content.length, truncated: file === "partial.txt" && !more });
    }
  }
  if (path === `/api/sessions/${session.id}`) return reply({ sessionId: session.id, info: session, filePath: "", tree: [], leafId: null,
    context: { messages: [{ role: "user", content: "文件查找 [target] 只查文件内容", timestamp: 1793059200000 }], entryIds: ["user"], hasMore: false, thinkingLevel: "off", model: null } });
  if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
  if (path.startsWith("/api/agent/") && request.method() === "POST") { commands.push(request.postDataJSON()?.type); return reply({ success: true, data: {} }); }
  return reply({});
});

try {
  await page.goto(`${base}/?session=${session.id}`, { waitUntil: "domcontentloaded", timeout: 120000 });
  await page.locator(".workspace-chat-view textarea").first().waitFor({ timeout: 90000 });
  assert.equal(await page.locator(".file-panel-header").isVisible(), false, "closed resources leave no header controls above chat");
  await page.locator(".workspace-files-toggle").filter({ visible: true }).first().click();
  const panel = page.locator("#file-panel");
  const tree = panel.locator("#workbench-file-tree");
  const openFile = async name => {
    if (await panel.locator(".file-tree-toggle").count() && await panel.locator(".file-tree-toggle").getAttribute("aria-expanded") === "false") await panel.locator(".file-tree-toggle").click();
    await tree.getByTitle(`${cwd}/${name}`, { exact: true }).click();
    await panel.locator(".file-viewer-content").waitFor();
  };
  const opener = panel.getByRole("tab", { name: "打开文件", exact: true });
  await opener.waitFor();
  assert.equal(await opener.getAttribute("aria-selected"), "true");
  assert.equal(await panel.locator(".workbench-file-empty").isVisible(), true, "the empty picker keeps a visible preview placeholder");
  await page.waitForFunction(() => Math.abs(document.querySelector(".file-panel-header").getBoundingClientRect().left - document.querySelector("#file-panel").getBoundingClientRect().left) < 1);
  // The empty picker supports dragging its directory boundary closed too.
  const dragTreeClosed = async (cancel = false) => {
    const handle = panel.locator(".workbench-tree-resizer");
    const box = await handle.boundingBox();
    const width = (await tree.boundingBox()).width;
    await page.mouse.move(box.x + box.width / 2, box.y + 160);
    await page.mouse.down();
    await page.mouse.move(box.x + width - 60, box.y + 160, { steps: 10 });
    if (cancel) await handle.dispatchEvent("pointercancel", { pointerId: 1 });
    await page.mouse.up();
  };
  const pickerTreeWidth = Math.round((await tree.boundingBox()).width);
  await dragTreeClosed();
  await page.waitForFunction(() => document.querySelector("#workbench-file-tree").getBoundingClientRect().width === 0);
  assert.equal(await tree.getAttribute("inert"), "");
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-workbench-file-tree-width")), String(pickerTreeWidth));
  await panel.locator(".workbench-tree-restore").click();
  await page.waitForFunction(width => Math.abs(document.querySelector("#workbench-file-tree").getBoundingClientRect().width - width) < 1, pickerTreeWidth);
  await dragTreeClosed(true);
  assert.equal(await panel.locator(".workbench-tree-restore").count(), 0, "Cancelling a drag never collapses the directory");
  await panel.locator(".workbench-tree-resizer").press("Enter");
  await page.waitForFunction(width => Math.abs(document.querySelector("#workbench-file-tree").getBoundingClientRect().width - width) < 1, pickerTreeWidth);
  const fileFilter = tree.getByRole("textbox", { name: "搜索文件", exact: true });
  await fileFilter.waitFor();
  assert.equal(await fileFilter.evaluate(el => el === document.activeElement), false, "a passive dock filter never steals focus");
  await fileFilter.fill("tokens");
  await tree.getByTitle(`${cwd}/tokens.ts`, { exact: true }).waitFor();
  assert.equal(await tree.getByTitle(`${cwd}/reading.txt`, { exact: true }).count(), 0);
  await fileFilter.press("Escape");
  assert.equal(await fileFilter.inputValue(), "");
  assert.equal(await fileFilter.isVisible(), true, "Escape clears the permanent filter without closing it");
  await tree.getByTitle(`${cwd}/reading.txt`, { exact: true }).waitFor();
  await page.screenshot({ path: resolve(artifacts, "file-picker-light.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
  await panel.locator(".file-panel-header").evaluate(el => Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {}))));
  await page.screenshot({ path: resolve(artifacts, "file-picker-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await opener.getByRole("button").click();
  await panel.locator(".file-panel-header").waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "显示文件面板", exact: true }).click();
  await opener.waitFor();
  await tree.getByTitle(`${cwd}/reading.txt`, { exact: true }).click();
  const content = panel.locator(".file-viewer-content");
  await content.waitFor();
  const shelf = page.locator(".workspace-unified-bar");
  const resourceHeader = panel.locator(".file-panel-header");
  const chatHeader = page.locator(".workspace-chat-header");
  const shelfBox = await shelf.boundingBox();
  const chatBox = await chatHeader.boundingBox();
  const tabsBox = await resourceHeader.boundingBox();
  assert.equal(chatBox.y, tabsBox.y, "conversation and resource tabs occupy the same shelf");
  assert.equal(chatBox.height, tabsBox.height);
  assert.ok(Math.abs(chatBox.x + chatBox.width - tabsBox.x) < 1, "tabs begin directly after the conversation context");
  assert.ok((await panel.boundingBox()).y >= shelfBox.y + shelfBox.height - 1, "the file divider begins below the shared header");
  const panelSeparator = page.locator('[data-resize-handle="right-panel"]');
  assert.ok((await panelSeparator.boundingBox()).y >= shelfBox.y + shelfBox.height - 1);
  await panelSeparator.press("ArrowLeft");
  await page.waitForFunction(left => Math.abs(document.querySelector(".file-panel-header").getBoundingClientRect().left - left + 12) < 1, tabsBox.x);
  assert.ok(Math.abs((await resourceHeader.boundingBox()).x - (await panel.boundingBox()).x) < 1, "the tab shelf stays aligned with the preview divider");
  await panelSeparator.press("ArrowRight");
  await page.waitForFunction(left => Math.abs(document.querySelector(".file-panel-header").getBoundingClientRect().left - left) < 1, tabsBox.x);
  await content.evaluate(el => { el.dataset.instance = "same"; el.scrollTop = 200; });
  const originalWidth = (await panel.locator(".workbench-file-preview").boundingBox()).width;
  const treeWidth = (await tree.boundingBox()).width;
  await dragTreeClosed();
  await page.waitForFunction(() => document.querySelector("#workbench-file-tree").getBoundingClientRect().width === 0);
  assert.ok((await panel.locator(".workbench-file-preview").boundingBox()).width > originalWidth + 150);
  assert.equal(await tree.evaluate(el => el.inert), true);
  assert.equal(await content.getAttribute("data-instance"), "same");
  assert.equal(await content.evaluate(el => el.scrollTop), 200);
  await content.focus();
  await page.keyboard.press("Control+f");
  const search = panel.getByRole("searchbox", { name: "查找文件内容…" });
  await search.fill("[target]");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 3");
  await search.press("Enter");
  assert.equal(await panel.locator(".file-find-count").textContent(), "2 / 3");
  assert.ok(await content.evaluate(el => el.scrollTop > 10000));
  await search.press("Shift+Enter");
  assert.equal(await panel.locator(".file-find-count").textContent(), "1 / 3");
  await search.fill("nothing-to-find");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "0 / 0");
  await search.fill("[target]");
  await search.press("Shift+Enter");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "3 / 3");
  await page.screenshot({ path: resolve(artifacts, "reading-collapsed-search.png") });
  await search.press("Escape");
  await panel.getByRole("search").waitFor({ state: "detached" });
  const beforeRestore = await content.evaluate(el => el.scrollTop);
  await panel.locator(".file-tree-toggle").click();
  await page.waitForFunction(width => Math.abs(document.querySelector("#workbench-file-tree").getBoundingClientRect().width - width) < 1, treeWidth);
  assert.equal(await content.evaluate(el => el.scrollTop), beforeRestore);
  assert.equal(await content.getAttribute("data-instance"), "same");
  const chatInput = page.locator(".workspace-chat-view textarea").first();
  await chatInput.fill("放大文件时保留这条未发送草稿");
  await chatInput.evaluate(el => { el.dataset.instance = "same-chat"; });
  const originalPanelWidth = (await panel.boundingBox()).width;
  const savedPanelWidth = await page.evaluate(() => localStorage.getItem("pi-right-panel-width"));
  await panel.locator(".file-panel-expand-button").click();
  assert.equal(await panel.getAttribute("class").then(value => value.includes("right-panel-reading-expanded")), true);
  await page.waitForFunction(() => document.querySelector("#workbench-file-tree").getBoundingClientRect().width === 0);
  await page.waitForFunction(() => Math.abs(document.querySelector("#file-panel").getBoundingClientRect().width - document.querySelector(".workspace-main").getBoundingClientRect().width) < 1);
  const mainBox = await page.locator(".workspace-main").boundingBox();
  const expandedFile = await panel.boundingBox();
  assert.ok(Math.abs(expandedFile.x - mainBox.x) < 1, "the file fills to the project sidebar edge");
  assert.equal(await page.locator("#session-sidebar").evaluate(el => el.inert), false);
  assert.equal(await page.getByRole("navigation", { name: "工作区导航" }).evaluate(el => el.inert), false);
  assert.equal(await chatInput.isVisible(), false);
  assert.equal(await page.locator("#workspace-conversation-content").evaluate(el => el.inert), true);
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-right-panel-width")), savedPanelWidth);
  assert.equal(await content.getAttribute("data-instance"), "same");
  await page.screenshot({ path: resolve(artifacts, "reading-focused.png") });
  const contextTab = page.locator(".workspace-context-tab");
  const readingTab = panel.getByRole("tab", { name: "reading.txt", exact: true });
  const focusedScrollTop = await content.evaluate(el => el.scrollTop);
  await contextTab.click();
  assert.equal(await chatInput.isVisible(), true);
  assert.equal(await chatInput.inputValue(), "放大文件时保留这条未发送草稿");
  assert.equal(await chatInput.getAttribute("data-instance"), "same-chat");
  assert.equal(await content.isVisible(), false);
  assert.equal(await readingTab.getAttribute("aria-selected"), "false");
  assert.equal(await contextTab.getAttribute("aria-pressed"), "true");
  await readingTab.click();
  assert.equal(await content.isVisible(), true);
  assert.equal(await content.getAttribute("data-instance"), "same");
  assert.equal(await content.evaluate(el => el.scrollTop), focusedScrollTop);
  const savedSidebarWidth = (await page.locator("#session-sidebar").boundingBox()).width;
  await page.locator('[data-resize-handle="sidebar"]').dblclick();
  await page.waitForFunction(() => document.querySelector("#session-sidebar").getBoundingClientRect().width < 1);
  assert.ok(Math.abs((await panel.boundingBox()).x - (await page.locator(".workspace-frame").boundingBox()).x - 1) < 1, "collapsing the sidebar lets the file reach the frame's left edge");
  await page.screenshot({ path: resolve(artifacts, "reading-sidebar-collapsed.png") });
  await page.locator("[data-sidebar-restore]").click();
  await page.waitForFunction(width => Math.abs(document.querySelector("#session-sidebar").getBoundingClientRect().width - width) < 1, savedSidebarWidth);
  await panel.locator(".file-panel-expand-button").click();
  await page.waitForFunction(width => Math.abs(document.querySelector("#workbench-file-tree").getBoundingClientRect().width - width) < 1, treeWidth);
  await page.waitForFunction(width => Math.abs(document.querySelector("#file-panel").getBoundingClientRect().width - width) < 1, originalPanelWidth);
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-right-panel-width")), savedPanelWidth);
  await panel.locator(".file-tree-toggle").click();
  await panel.locator(".file-panel-expand-button").click();
  await panel.locator(".file-panel-expand-button").click();
  assert.equal(await panel.locator(".file-tree-toggle").getAttribute("aria-expanded"), "false", "restoring the split preserves a previously collapsed directory");
  await panel.getByRole("button", { name: "关闭 reading.txt", exact: true }).click();
  await tree.getByTitle(`${cwd}/reading.txt`, { exact: true }).waitFor();
  assert.equal(await panel.locator(".workbench-file-empty").isVisible(), true, "closing the last file returns to the complete open-file picker");
  assert.equal(await opener.isVisible(), true);
  await tree.getByTitle(`${cwd}/reading.txt`, { exact: true }).click();

  await openFile("tokens.ts");
  await panel.getByRole("button", { name: "在文件中查找", exact: true }).click();
  await search.fill("const value");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 1");
  await search.fill("[target]");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 2");
  // Force the Safari fallback without changing React's text or the selection.
  await page.evaluate(() => { window.Highlight = undefined; });
  await search.press("Enter");
  await panel.locator(".file-find-highlights span.is-current").first().waitFor();
  assert.equal(await content.textContent().then(value => value.includes('export const value')), true);
  await search.press("Escape");

  await openFile("notes.md");
  await panel.locator(".markdown-file-preview").waitFor();
  await panel.getByRole("button", { name: "在文件中查找", exact: true }).click();
  await search.fill("查找跨越加粗内容");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 1");
  await search.fill("跨越加粗");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 2");
  await search.fill("查找 跨越加粗 内容");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 1");
  await search.press("Escape");

  for (const file of ["table.csv", "page.html"]) {
    await openFile(file);
    if (file === "page.html") {
      const frame = await (await panel.locator("iframe").elementHandle()).contentFrame();
      await frame.locator("#note").fill("Keep this image/page state");
      await panel.locator(".file-panel-expand-button").click();
      assert.equal(await frame.locator("#note").inputValue(), "Keep this image/page state");
      await contextTab.click();
      assert.equal(await chatInput.isVisible(), true);
      await panel.getByRole("tab", { name: "page.html", exact: true }).click();
      assert.equal(await frame.locator("#note").inputValue(), "Keep this image/page state");
      await panel.locator(".file-panel-expand-button").click();
      assert.equal(await frame.locator("#note").inputValue(), "Keep this image/page state");
    }
    await panel.getByRole("button", { name: "在文件中查找", exact: true }).click();
    await search.fill("needle");
    await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent?.endsWith("/ 2") || document.querySelector(".file-find-count")?.textContent?.endsWith("/ 1"));
    assert.equal(await panel.getByRole("button", { name: "Source", exact: true }).getAttribute("aria-pressed"), "true");
    await search.press("Escape");
  }
  await openFile("partial.txt");
  await panel.getByRole("button", { name: "在文件中查找", exact: true }).click();
  await search.fill("needle");
  await panel.getByText("仅查找已加载内容，加载更多后可继续查找。").waitFor();
  await panel.getByRole("button", { name: "加载更多", exact: true }).click();
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 2");
  assert.equal(await panel.locator(".file-find-scope").count(), 0);
  await search.press("Escape");
  await openFile("change.ts");
  await panel.getByRole("button", { name: "Diff", exact: true }).click();
  await panel.getByRole("button", { name: "在文件中查找", exact: true }).click();
  await search.fill("needle");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 2");
  await panel.getByText("仅查找当前显示的变更与上下文。").waitFor();
  await search.press("Escape");
  await openFile("many.txt");
  await panel.getByRole("button", { name: "在文件中查找", exact: true }).click();
  await search.fill("needle");
  await page.waitForFunction(() => document.querySelector(".file-find-count")?.textContent === "1 / 5000+");
  await search.press("Escape");
  await openFile("partial.txt");
  await page.locator(".workspace-chat-view textarea").first().focus();
  await page.keyboard.press("Control+f");
  assert.equal(await panel.getByRole("search").count(), 0, "chat retains browser find");
  await page.keyboard.press("Escape");
  await page.emulateMedia({ colorScheme: "dark" });
  await panel.getByRole("button", { name: "在文件中查找", exact: true }).click();
  await search.fill("needle");
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await panel.locator(".file-panel-expand-button").count(), 0, "narrow screens keep their existing file view");
  await page.waitForFunction(() => {
    const active = document.querySelector('.file-tab[aria-selected="true"]')?.getBoundingClientRect();
    const list = document.querySelector('.file-tab-list')?.getBoundingClientRect();
    return active && list && active.left >= list.left - 1 && active.right <= list.right + 1;
  });
  await page.screenshot({ path: resolve(artifacts, "reading-mobile-dark.png") });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await search.press("Escape");
  await page.setViewportSize({ width: 1728, height: 1000 });
  await openFile("这是一个用于检查文件标签栏省略与键盘切换的较长文件名称.ts");
  const longTab = panel.getByRole("tab", { name: "这是一个用于检查文件标签栏省略与键盘切换的较长文件名称.ts", exact: true });
  assert.ok((await longTab.boundingBox()).width <= 300);
  await longTab.focus();
  await longTab.press("ArrowLeft");
  assert.equal(await panel.getByRole("tab", { name: "many.txt", exact: true }).getAttribute("aria-selected"), "true");
  await panel.locator(".file-tree-toggle").click();
  await panel.getByRole("button", { name: "选择文件", exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("#workbench-file-tree").inert);
  await tree.getByTitle(`${cwd}/components`, { exact: true }).click();
  await tree.getByTitle(`${cwd}/components/FileViewer.tsx`, { exact: true }).click();
  await content.locator("span.token").first().waitFor();
  assert.equal(await panel.locator(".file-breadcrumb-current").textContent(), "FileViewer.tsx");
  assert.equal(await panel.locator(".file-breadcrumb-parents").textContent(), "pi-web-yuncomponents");
  const tabNames = await panel.getByRole("tab").evaluateAll(tabs => tabs.map(tab => tab.getAttribute("aria-label")));
  for (const name of tabNames) {
    if (name !== "FileViewer.tsx") await panel.getByRole("tab", { name, exact: true }).getByRole("button").click();
  }
  await panel.locator(".file-panel-expand-button").click();
  await page.waitForFunction(() => document.querySelector("#workbench-file-tree").getBoundingClientRect().width === 0);
  await page.waitForFunction(() => {
    const panel = document.querySelector("#file-panel");
    return Math.abs(panel.getBoundingClientRect().width - document.querySelector(".workspace-main").getBoundingClientRect().width) < 1;
  });
  await content.evaluate(el => { el.scrollTop = 0; el.scrollLeft = 0; });
  await page.evaluate(() => document.activeElement?.blur());
  await page.mouse.move(400, 700);
  await page.screenshot({ path: resolve(artifacts, "codex-file-dark.png") });
  await page.emulateMedia({ colorScheme: "light" });
  await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
  await panel.evaluate(el => Promise.all(el.getAnimations({ subtree: true }).filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {}))));
  await page.screenshot({ path: resolve(artifacts, "codex-file-light.png") });
  await page.getByRole("navigation", { name: "工作区导航" }).getByRole("button", { name: "主页", exact: true }).click();
  const homeView = page.getByRole("region", { name: "主页", exact: true });
  await homeView.waitFor();
  await homeView.evaluate(el => { el.dataset.instance = "same-home"; });
  await page.getByRole("button", { name: "显示文件面板", exact: true }).click();
  await panel.locator(".file-panel-expand-button").click();
  assert.equal(await contextTab.getAttribute("aria-label"), "显示主页");
  assert.equal(await homeView.isVisible(), false);
  await contextTab.press("Enter");
  assert.equal(await homeView.isVisible(), true);
  assert.equal(await homeView.getAttribute("data-instance"), "same-home");
  await panel.getByRole("tab", { name: "FileViewer.tsx", exact: true }).click();
  assert.equal(await homeView.isVisible(), false);
  assert.equal(await content.isVisible(), true);
  await page.screenshot({ path: resolve(artifacts, "focused-home-file.png") });
  await contextTab.press("Space");
  assert.equal(await homeView.isVisible(), true);
  assert.equal(await homeView.getAttribute("data-instance"), "same-home");
  await panel.getByRole("tab", { name: "FileViewer.tsx", exact: true }).click();
  await panel.locator(".file-panel-close-button").click();
  await resourceHeader.waitFor({ state: "hidden" });
  await page.getByRole("button", { name: "显示文件面板", exact: true }).click();
  await resourceHeader.waitFor();
  assert.equal(await panel.locator(".file-breadcrumb-current").textContent(), "FileViewer.tsx", "reopening the unified shelf retains the active file");
  assert.equal(await panel.locator(".file-panel-expand-button").getAttribute("aria-pressed"), "false");
  assert.equal(commands.some(type => type === "abort" || type === "prompt"), false);
  assert.deepEqual(errors, []);
  console.log("PASS: directory collapse/focus restoration, retained viewer/scroll, scoped find, literal/token/Markdown matches, wraparound, Safari fallback, HTML/CSV Source search, partial loading, mobile/dark, no prompts/aborts/errors.");
} catch (error) {
  console.error({ file: await panelPath(), count: await page.locator(".file-find-count").textContent({ timeout: 1000 }).catch(() => null), errors });
  await page.screenshot({ path: resolve(artifacts, "failure.png") }).catch(() => {});
  throw error;
} finally {
  await context.close();
  await browser.close();
}

async function panelPath() {
  return page.locator(".file-viewer-path").textContent({ timeout: 1000 }).catch(() => null);
}
