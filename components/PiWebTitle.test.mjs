import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { BRAND_TEXT, PiWebTitle } = await jiti.import("./PiWebTitle.tsx");
const { I18nProvider } = await jiti.import("@/hooks/useI18n");

test("the navigation brand exposes an application menu without version numbers", () => {
  assert.equal(BRAND_TEXT, "PI-YUN");
  const html = renderToStaticMarkup(React.createElement(I18nProvider, null, React.createElement(PiWebTitle)));
  assert.match(html, /aria-label="PI-YUN menu" aria-haspopup="menu" aria-expanded="false"/);
  assert.match(html, /class="sidebar-brand-label">PI-YUN<\/span>/);
  assert.doesNotMatch(html, /is-version/);
});
