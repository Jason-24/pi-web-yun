import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { jsx: { runtime: "automatic" }, tsconfigPaths: true });
const React = await jiti.import("react");
const { renderToStaticMarkup } = await jiti.import("react-dom/server");
const { BRAND_TEXT, PiWebTitle } = await jiti.import("./PiWebTitle.tsx");

test("the navigation brand is static and exposes no version numbers", () => {
  assert.equal(BRAND_TEXT, "yun");
  const html = renderToStaticMarkup(React.createElement(PiWebTitle));
  assert.equal(html, '<span class="sidebar-brand">yun</span>');
});
