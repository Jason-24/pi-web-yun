import assert from "node:assert/strict";

/*
 * Desktop files live in the right dock. Below 1200px the inline explorer uses
 * the below or tab preference; phones show one tab at a time. The explorer
 * keeps the same panel id in every placement.
 */

/** Opens the desktop directory, the Files tab, or the inline files section. */
export async function showRightPanel(page) {
  const panel = page.locator("#file-panel");
  if (await panel.getAttribute("class").then(value => value.includes("right-panel-open"))) return;
  await page.locator(".panel-tab-switcher").first().click();
  const menu = page.getByRole("menu").filter({ has: page.locator('[role="menuitemradio"]') });
  if (await menu.isVisible()) {
    const selected = menu.getByRole("menuitemradio", { checked: true });
    if (await selected.count()) await selected.click();
    else await menu.getByRole("menuitem").last().click();
  }
  await page.locator("#file-panel.right-panel-open").waitFor();
  await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {}))));
}

export async function showSidebarFiles(page) {
  if (page.viewportSize().width >= 1200) {
    await showRightPanel(page);
    const panel = page.locator("#file-panel");
    if (!(await panel.getAttribute("class")).includes("is-file-picker") && !await panel.locator(".file-tree-toggle").isVisible()) {
      if (!await panel.locator(".panel-tool-launcher").isVisible()) await panel.locator(".file-tab-add").click();
      await panel.locator('[data-panel-tool="files"]').click();
    }
    await page.evaluate(() => Promise.all(document.getAnimations().filter(animation => animation instanceof CSSTransition).map(animation => animation.finished.catch(() => {}))));
    const directory = page.locator("#file-panel .file-tree-toggle");
    if (await directory.isVisible() && await directory.getAttribute("aria-expanded") !== "true") await directory.click();
    await page.waitForFunction(() => document.querySelector("#workbench-file-tree")?.getBoundingClientRect().width > 100);
    await page.locator("#workbench-file-tree #session-sidebar-panel-files").waitFor();
    return;
  }
  const files = page.locator("#session-sidebar-panel-files");
  const tab = page.getByRole("tab", { name: "Files", exact: true });
  const toggle = files.locator(".sidebar-files-section-toggle");
  await tab.or(toggle).first().waitFor();
  if (await tab.count()) {
    if (await tab.getAttribute("aria-selected") !== "true") await tab.click();
  } else if (await toggle.getAttribute("aria-expanded") !== "true") {
    await toggle.click();
  }
  await files.locator(".sidebar-files-body").waitFor({ state: "visible" });
}

/** Shows the session rows: the Sessions tab, or nothing to do below the files. */
export async function showSidebarSessions(page) {
  const tab = page.getByRole("tab", { name: "Sessions", exact: true });
  await tab.or(page.locator(".sidebar-brand")).first().waitFor();
  if (await tab.count() && await tab.getAttribute("aria-selected") !== "true") await tab.click();
  await page.locator("#session-sidebar-panel-sessions").waitFor({ state: "visible" });
}

/**
 * On an undocked desktop both regions show by default; the legacy preference
 * can still bring the tabs back, with the file tree mounted throughout: its
 * own root stays on the page and its file search keeps its query, which a
 * remount would lose (open folders would come back from the per-folder
 * memory, so they prove nothing).
 */
export async function checkFilesPlacement(page) {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  const sessions = page.getByRole("region", { name: "Sessions", exact: true });
  const files = page.getByRole("region", { name: "Files", exact: true });
  const tablist = page.getByRole("tablist", { name: "Sidebar view", exact: true });
  await sessions.waitFor();
  await files.waitFor();
  assert.equal(await tablist.count(), 0, "No tabs while the files sit below the sessions");
  await showSidebarFiles(page);
  await page.getByRole("separator", { name: "Resize file browser", exact: true }).waitFor();
  const fileSearch = files.getByRole("button", { name: "Search files", exact: true });
  const fileQuery = page.locator("#file-search-input");
  if (await fileSearch.getAttribute("aria-expanded") !== "true") await fileSearch.click();
  await fileQuery.fill("e2e-placement");
  // FileExplorer's root, not the scroll box the sidebar always renders around it.
  const tree = await page.locator("#session-sidebar-panel-files .sidebar-files-scroll > *").first().elementHandle();
  // The setting was retired from General. Exercise the compatibility store as
  // another browser tab would, without depending on the removed controls.
  const choose = async (placement) => {
    await page.evaluate((value) => {
      const key = "pi-web:sidebar-files-placement";
      const oldValue = localStorage.getItem(key);
      localStorage.setItem(key, value);
      window.dispatchEvent(new StorageEvent("storage", { key, oldValue, newValue: value, storageArea: localStorage }));
    }, placement);
  };

  await choose("tab");
  await tablist.waitFor();
  assert.equal(await tablist.getByRole("tab").count(), 2);
  assert.equal(await tablist.getByRole("tab", { name: "Files", exact: true }).count(), 1);
  assert.equal(await sessions.count() + await files.count(), 0, "The panels are the tabs' again");
  assert.equal(await page.locator(".sidebar-files-section").count(), 0);
  await showSidebarFiles(page);
  await page.getByRole("tabpanel", { name: "Files", exact: true }).waitFor();

  await choose("below");
  await sessions.waitFor();
  await files.waitFor();
  assert.equal(await tablist.count(), 0);
  assert.equal(await tree.evaluate((element) => element.isConnected), true, "Switching layouts keeps the file tree mounted");
  assert.equal(await fileQuery.inputValue(), "e2e-placement", "and its file search");
  await tree.dispose();
  await fileQuery.fill("");
  await fileSearch.click();
  await fileQuery.waitFor({ state: "detached" });
}
