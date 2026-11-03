/** Enter the embedded settings workspace through desktop or phone navigation. */
export async function openSettings(page, section = "General") {
  const showSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
  if (await showSidebar.isVisible()) await showSidebar.click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  await settings.waitFor();
  await settings.getByRole("button", { name: section, exact: true }).filter({ visible: true }).click();
  return settings;
}

/** Desktop settings use workspace navigation; phones retain their close button. */
export async function closeSettings(page) {
  const settings = page.getByRole("region", { name: "Settings", exact: true });
  const close = settings.getByRole("button", { name: "Close", exact: true });
  if (await close.isVisible()) await close.click();
  else await page.locator('[data-workspace-view="chat"]').filter({ visible: true }).click();
  await settings.waitFor({ state: "hidden" });
}
