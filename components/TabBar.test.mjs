import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");
const { TabBar } = await jiti.import("./TabBar.tsx");
const css = await readFile(new URL("../app/file-workspace.css", import.meta.url), "utf8");

function renderTabBar(count, onReorderTab) {
  const tabs = Array.from({ length: count }, (_, index) => ({ id: `t${index}`, label: `file-${index}.ts`, filePath: `/p/file-${index}.ts` }));
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TabBar, { tabs, activeTabId: "t0", onSelectTab() {}, onCloseTab() {}, onReorderTab })));
}

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const [, declarations] = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  return Object.fromEntries(declarations.split(";").filter(declaration => declaration.trim()).map((declaration) => {
      const colon = declaration.indexOf(":");
      return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
    }));
}

test("right-panel tabs can be dragged when a reorder handler is provided", () => {
  assert.match(renderTabBar(2, () => {}), /role="tab"[^>]*draggable="true"/);
  assert.doesNotMatch(renderTabBar(2), /role="tab"[^>]*draggable="true"/);
});

test("overflowing tabs keep the whole bar: the strip has no scrollbar", () => {
  // The app's 10px (6px on touch) scrollbar took its height out of the 36px
  // bar: 36px tabs were clipped (#1225), stretched ones squeezed to 26px.
  const html = renderTabBar(12);
  assert.equal([...html.matchAll(/role="tab" /g)].length, 12);
  const list = rule(".file-tab-list");
  assert.equal(list.height, "100%");
  assert.equal(list["overflow-x"], "auto");
  assert.equal(list["overflow-y"], "hidden");
  assert.equal(list["align-items"], "stretch");
  const tab = rule(".file-tab");
  assert.equal(tab.height, undefined);
  assert.equal(tab["align-items"], "center");
});
