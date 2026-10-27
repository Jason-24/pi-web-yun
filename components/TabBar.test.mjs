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

function renderTabBar(count) {
  const tabs = Array.from({ length: count }, (_, index) => ({ id: `t${index}`, label: `file-${index}.ts`, filePath: `/p/file-${index}.ts` }));
  return renderToStaticMarkup(React.createElement(I18nProvider, null,
    React.createElement(TabBar, { tabs, activeTabId: "t0", onSelectTab() {}, onCloseTab() {} })));
}

function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const [, declarations] = css.match(new RegExp(`${escaped}\\s*\\{([^}]+)\\}`));
  return Object.fromEntries(declarations.split(";").filter(declaration => declaration.trim()).map((declaration) => {
      const colon = declaration.indexOf(":");
      return [declaration.slice(0, colon).trim(), declaration.slice(colon + 1).trim()];
    }));
}

test("the tabs fill the bar above its scrollbar instead of overflowing it upward", () => {
  // A native horizontal scrollbar reserves room inside the bar; fixed-height
  // tabs aligned to its end were pushed up and clipped (#1225).
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
