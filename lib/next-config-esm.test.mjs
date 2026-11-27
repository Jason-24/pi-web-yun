import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { PHASE_PRODUCTION_BUILD } from "next/constants.js";

const configUrl = new URL("../next.config.ts", import.meta.url);
const source = await readFile(configUrl, "utf8");

test("resolves config paths without CommonJS globals", async () => {
  assert.doesNotMatch(source, /\b__dirname\b/);
  assert.match(source, /dirname\(fileURLToPath\(import\.meta\.url\)\)/);

  const { default: loadConfig } = await import(`${configUrl.href}?esm-test`);
  const config = loadConfig(PHASE_PRODUCTION_BUILD);
  assert.equal(typeof config.env.NEXT_PUBLIC_APP_VERSION, "string");
});
