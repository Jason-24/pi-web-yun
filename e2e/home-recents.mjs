// Existing dev server; API fixtures keep the real session catalog untouched.
import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const artifacts = resolve("test-results/home-recents");
mkdirSync(artifacts, { recursive: true });
const browser = await chromium.launch({ channel: process.env.E2E_BROWSER_CHANNEL || undefined });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
await context.addInitScript(() => localStorage.setItem("pi-locale", "zh-CN"));
const page = await context.newPage();
const cwd = "D:/workspace/recent-tasks";
const sessions = Array.from({ length: 17 }, (_, i) => ({
  id: `home-recent-${i}`, path: "", cwd, projectRoot: cwd, projectKey: cwd,
  name: `最近任务 ${String(i + 1).padStart(2, "0")}`, firstMessage: "测试最近任务", messageCount: 1,
  created: "2026-10-29T00:00:00Z", modified: new Date(Date.UTC(2026, 9, 29, 12, 0, 0) - i * 60000).toISOString(),
}));
let catalog = [...sessions, { ...sessions[0], id: "side-chat", name: "隐藏的侧边对话", relation: { kind: "side", parentSessionId: sessions[0].id }, modified: "2026-10-30T00:00:00Z" }];
const errors = [];
const commands = [];
page.on("pageerror", error => errors.push(error.message));
await context.route("**/api/**", async route => {
  const request = route.request();
  const path = new URL(request.url()).pathname;
  const reply = json => route.fulfill({ json });
  if (path === "/api/sessions") return reply({ sessions: catalog, sessionListVersion: 1, runningSessionIds: [], awaitingInputSessionIds: [] });
  if (path === "/api/sessions/ui-state") return reply({ state: { version: 1, revision: 1, sessions: {}, projects: {}, projectOrder: [cwd] } });
  if (path === "/api/agent/running") return reply({ runningSessionIds: [], awaitingInputSessionIds: [], sessionUiStateRevision: 1, sessionListVersion: 1 });
  if (path === "/api/models") return reply({ models: [], modelList: [], defaultModel: null });
  if (path === "/api/home") return reply({ home: "C:/Users/test" });
  if (path === "/api/web-auth") return reply({ enabled: false });
  if (path === "/api/worktrees") return reply({ projectRoot: cwd, projectKey: cwd, isGit: false, worktrees: [] });
  if (path === "/api/project-trust") return reply({ cwd, requiresTrust: false, trusted: true, mcpServers: [] });
  if (path === "/api/app-update") return reply({ latestVersion: "0.2.3" });
  if (path.startsWith("/api/sessions/")) {
    const session = sessions.find(item => path === `/api/sessions/${item.id}`);
    if (session) return reply({ sessionId: session.id, info: session, tree: [], leafId: null,
      context: { messages: [], entryIds: [], hasMore: false, model: null, thinkingLevel: "off" } });
  }
  if (path.endsWith("/events")) return route.fulfill({ contentType: "text/event-stream", body: 'data: {"type":"connected","isStreaming":false}\n\n' });
  if (path.startsWith("/api/agent/") && request.method() === "POST") {
    commands.push(request.postDataJSON()?.type);
    return reply({ success: true, data: {} });
  }
  return reply({});
});

try {
  await page.goto(`${base}/?home=1`, { waitUntil: "domcontentloaded", timeout: 120000 });
  const home = page.locator(".home-view");
  await home.locator(".home-session").first().waitFor();
  assert.equal(await home.locator(".home-session").count(), 8);
  assert.deepEqual(await home.locator(".home-session-title").allTextContents(), sessions.slice(0, 8).map(item => item.name));

  const toggle = page.locator(".session-tree-recents-toggle");
  await toggle.scrollIntoViewIfNeeded();
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  assert.equal(await toggle.locator(".session-tree-section-count").textContent(), "10");
  assert.equal(await toggle.evaluate(el => el.lastElementChild.classList.contains("session-tree-chevron")), true);
  assert.equal(await toggle.evaluate(el => el.firstElementChild.tagName.toLowerCase()), "svg");
  assert.equal(await toggle.locator(".session-tree-section-count").innerText(), "10");
  const projectToggle = page.locator(".session-tree-group > .session-tree-group-toggle").first();
  const projectRow = page.locator(`[data-row-key="session:group:${sessions[0].id}"]`);
  const recentRow = page.locator(`[data-row-key="recent:${sessions[0].id}"]`);
  const createProject = page.locator(".session-tree-section-action");
  const archiveEntry = page.locator(".sidebar-archive-entry");
  const sessionColumns = row => row.evaluate(el => {
    const box = el.getBoundingClientRect();
    const avatar = el.querySelector(".session-tree-session-avatar");
    const avatarStyle = getComputedStyle(avatar);
    const link = el.querySelector(".session-tree-main");
    const actionWidth = el.querySelector(".session-tree-actions")?.getBoundingClientRect().width ?? 0;
    return {
      left: box.left,
      width: box.width,
      height: box.height,
      title: el.querySelector(".session-tree-title").getBoundingClientRect().left,
      trailingEdge: link.getBoundingClientRect().right + actionWidth,
      avatar: avatar.getBoundingClientRect().left,
      avatarWidth: avatar.getBoundingClientRect().width,
      image: avatarStyle.backgroundImage,
      frame: avatarStyle.backgroundPosition,
    };
  });
  const checkSessionColumns = async (pixels) => {
    if (await projectToggle.getAttribute("aria-expanded") === "false") await projectToggle.click();
    await page.mouse.move(0, 0);
    const project = await sessionColumns(projectRow);
    assert.deepEqual(await sessionColumns(recentRow), project, "project and recent rows share the title and avatar columns");
    for (const row of [projectRow, recentRow]) {
      assert.equal(await row.locator(".session-tree-meta").count(), 0, "an idle row leaves the trailing space to its title");
      assert.match(await row.locator(".session-tree-main").getAttribute("title"), / · .+(前|后)$/);
    }
    const projectLabel = await projectToggle.locator(".session-tree-group-name").boundingBox();
    assert.ok(project.title > projectLabel.x, "session titles are indented under their project");
    const archiveCount = await archiveEntry.locator(".sidebar-archive-entry-count").boundingBox();
    assert.equal(archiveCount.x + archiveCount.width, project.trailingEdge, "archive counts and session rows share a trailing edge");
    assert.equal(project.avatarWidth, pixels ? 16 : 0);
    if (pixels) assert.match(project.image, /sunbeam-avatars\.png/);
    for (const section of [projectToggle, toggle]) {
      const visible = await section.locator("svg").first().evaluate(svg => ({
        pixel: getComputedStyle(svg.querySelector(".sidebar-icon-pixel")).display !== "none",
        stroke: getComputedStyle(svg.firstElementChild).display !== "none",
      }));
      assert.deepEqual(visible, { pixel: pixels, stroke: !pixels }, "section icons follow the active palette");
    }
    assert.equal(await recentRow.locator(".session-tree-actions").count(), 0, "the shortcut keeps its single session link");
  };
  const columns = async button => button.evaluate(el => {
    const icon = el.firstElementChild.getBoundingClientRect();
    const label = el.querySelector(".session-tree-group-name, .session-tree-section-label").getBoundingClientRect();
    const arrow = el.querySelector(".session-tree-disclosure-chevron")?.getBoundingClientRect();
    return { icon: Math.round(icon.x), label: Math.round(label.x), arrow: arrow && Math.round(arrow.x + arrow.width / 2) };
  });
  const checkCreateProjectColumn = async () => {
    const create = await createProject.boundingBox();
    assert.equal(Math.round(create.x + create.width / 2), (await columns(projectToggle)).arrow, "create button and disclosure chevrons share a column");
  };
  assert.deepEqual(await columns(projectToggle), await columns(toggle), "project and recent icon, label and arrow columns align");
  await checkCreateProjectColumn();
  const projectArrow = (await columns(projectToggle)).arrow;
  await projectToggle.hover();
  assert.equal((await columns(projectToggle)).arrow, projectArrow, "project actions do not move its arrow");
  const initialProjectExpanded = await projectToggle.getAttribute("aria-expanded");
  await projectToggle.press("Enter");
  assert.equal(await projectToggle.getAttribute("aria-expanded"), initialProjectExpanded === "true" ? "false" : "true");
  await projectToggle.press("Space");
  assert.equal(await projectToggle.getAttribute("aria-expanded"), initialProjectExpanded);
  await toggle.hover();
  await page.waitForFunction(() => getComputedStyle(document.querySelector(".session-tree-recents-toggle")).backgroundColor !== "rgba(0, 0, 0, 0)");
  await toggle.click({ position: { x: 200, y: 12 } });
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  assert.equal(await page.evaluate(() => localStorage.getItem("pi-web:sidebar-recents-collapsed")), "true");
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => document.querySelector(".session-tree-recents-toggle")?.getAttribute("aria-expanded") === "false");
  await toggle.press("Enter");
  assert.equal(await toggle.getAttribute("aria-expanded"), "true");
  await toggle.press("Space");
  assert.equal(await toggle.getAttribute("aria-expanded"), "false");
  await toggle.press("Enter");
  await checkSessionColumns(false);
  await page.screenshot({ path: resolve(artifacts, "desktop.png") });
  await page.evaluate(() => { document.documentElement.dataset.theme = "sunbeam"; });
  assert.deepEqual(await columns(projectToggle), await columns(toggle), "Pixel disclosure columns align");
  await checkSessionColumns(true);
  await page.screenshot({ path: resolve(artifacts, "desktop-sunbeam.png"), animations: "disabled" });

  const more = home.getByRole("button", { name: "查看更多", exact: true });
  await more.press("Enter");
  assert.equal(await home.locator(".home-session").count(), 16);
  await more.press("Space");
  assert.equal(await home.locator(".home-session").count(), 17);
  const less = home.getByRole("button", { name: "收起", exact: true });
  assert.equal(await less.evaluate(el => el === document.activeElement), true);
  await less.press("Enter");
  assert.equal(await home.locator(".home-session").count(), 8);
  assert.equal(await more.evaluate(el => el === document.activeElement), true);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.locator(".workspace-sidebar-toggle").click();
  await toggle.waitFor({ state: "visible" });
  await page.screenshot({ path: resolve(artifacts, "mobile-sidebar-dark.png"), animations: "disabled" });
  assert.deepEqual(await columns(projectToggle), await columns(toggle), "mobile disclosure columns align");
  await checkCreateProjectColumn();
  assert.ok((await toggle.boundingBox()).x >= 0, "mobile disclosure stays inside the viewport");
  await checkSessionColumns(false);
  await page.evaluate(() => { document.documentElement.dataset.theme = "sunbeam-pink"; });
  await checkSessionColumns(true);
  await page.screenshot({ path: resolve(artifacts, "mobile-sidebar-pixel.png"), animations: "disabled" });
  await page.evaluate(() => { document.documentElement.dataset.theme = "dark"; });
  await page.locator(".sidebar-overlay-backdrop").click({ position: { x: 380, y: 450 } });
  await more.click();
  assert.equal(await home.locator(".home-session").count(), 16);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: resolve(artifacts, "mobile-dark.png") });
  await home.locator(".home-session").nth(15).click();
  await page.waitForURL(`**/?session=${sessions[15].id}`);

  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(() => { document.documentElement.dataset.theme = "breeze"; });
  const selectedRow = page.locator(`[data-row-key="session:group:${sessions[15].id}"].is-selected`);
  const selectedLink = selectedRow.locator(".session-tree-main");
  const selectedMenu = selectedRow.locator(".session-tree-more-action");
  await selectedLink.waitFor();
  await page.mouse.move(400, 60);
  const menuOpacity = () => selectedMenu.evaluate(el => getComputedStyle(el).opacity);
  assert.equal(await menuOpacity(), "0", "the idle desktop selection gives its full width to the title");
  const selectedAppearance = await selectedRow.evaluate(el => ({
    background: getComputedStyle(el).backgroundColor,
    weight: getComputedStyle(el.querySelector(".session-tree-title")).fontWeight,
  }));
  assert.notEqual(selectedAppearance.background, "rgba(0, 0, 0, 0)");
  assert.equal(selectedAppearance.weight, "500");
  await page.locator(".session-tree-inner").screenshot({ path: resolve(artifacts, "sidebar-breeze.png"), animations: "disabled" });
  await selectedRow.hover();
  assert.equal(await menuOpacity(), "1");
  await page.mouse.move(400, 60);
  await selectedLink.press("ArrowRight");
  assert.equal(await menuOpacity(), "1");
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  assert.equal(await selectedMenu.evaluate(el => el === document.activeElement), true, "Tab reaches the revealed menu");

  catalog = sessions.slice(0, 2);
  await page.goto(`${base}/?home=1`, { waitUntil: "domcontentloaded" });
  await home.locator(".home-session").first().waitFor();
  assert.equal(await home.locator(".home-session").count(), 2);
  assert.equal(await home.locator(".home-recent-more").count(), 0);
  catalog = [];
  await page.reload({ waitUntil: "domcontentloaded" });
  await home.locator(".home-empty").waitFor();
  assert.equal(await home.locator(".home-recent-more").count(), 0);
  assert.equal(await toggle.locator(".session-tree-section-count").textContent(), "0");
  assert.equal(await toggle.isDisabled(), true);
  assert.equal(commands.some(type => type === "prompt" || type === "abort"), false);
  assert.deepEqual(errors, []);
  console.log("PASS: full-row hover/disclosure, keyboard and persisted collapse; 8/16/17 recent tasks, stable focus, session links, short/empty lists and mobile/dark; no prompts/aborts or browser errors.");
} catch (error) {
  await page.screenshot({ path: resolve(artifacts, "failure.png") }).catch(() => {});
  console.error({ errors });
  throw error;
} finally {
  await context.close();
  await browser.close();
}
