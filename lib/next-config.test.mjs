import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { PHASE_DEVELOPMENT_SERVER, PHASE_PRODUCTION_BUILD, PHASE_PRODUCTION_SERVER } from "next/constants.js";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loadConfig = await createJiti(import.meta.url).import("../next.config.ts", { default: true });

function sizeLimitToBytes(value) {
  if (typeof value === "number") return value;
  const match = /^(\d+(?:\.\d+)?)\s*(b|kb|mb|gb)$/i.exec(value.trim());
  assert.ok(match, `unparseable SizeLimit: ${value}`);
  const units = { b: 1, kb: 1024, mb: 1024 ** 2, gb: 1024 ** 3 };
  return Number(match[1]) * units[match[2].toLowerCase()];
}

test("scopes Next.js output file tracing to the pi-web package", () => {
  const config = loadConfig(PHASE_PRODUCTION_BUILD);

  assert.equal(config.outputFileTracingRoot, projectRoot);
});

test("raises the proxy body buffer above the upload route's 100 MB request cap", () => {
  const config = loadConfig(PHASE_PRODUCTION_SERVER);

  assert.ok(sizeLimitToBytes(config.experimental.proxyClientMaxBodySize) > 100 * 1024 * 1024);
});

test("selects the build TypeScript config only during production builds", () => {
  assert.equal(loadConfig(PHASE_PRODUCTION_BUILD).typescript.tsconfigPath, "tsconfig.build.json");
  assert.equal(loadConfig(PHASE_DEVELOPMENT_SERVER).typescript?.tsconfigPath, undefined);
  assert.equal(loadConfig(PHASE_PRODUCTION_SERVER).typescript?.tsconfigPath, undefined);
});
