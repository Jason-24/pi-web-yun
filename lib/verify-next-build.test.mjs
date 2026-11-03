import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import test from "node:test";

const require = createRequire(import.meta.url);
const { verifyNextBuild } = require("../bin/verify-next-build.js");

function fixture(t, { installed = "16.4.4", built = installed, separate = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-web-build-check-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const write = (file, value) => {
    const target = path.join(dir, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, typeof value === "string" ? value : JSON.stringify(value));
  };
  write("package.json", { version: "0.2.5", dependencies: { next: "16.4.4" } });
  write("node_modules/next/package.json", { version: installed });
  write("node_modules/next/dist/shared/lib/constants.js",
    `module.exports = ${JSON.stringify(separate ? { PREVIEW_PROPS_MANIFEST: "preview-props.json" } : {})};`);
  write(".next/diagnostics/framework.json", { name: "Next.js", version: built });
  write(".next/required-server-files.json", { config: { env: { NEXT_PUBLIC_APP_VERSION: "0.2.5" } } });
  write(".next/BUILD_ID", "test-build");
  write(".next/routes-manifest.json", {});
  write(".next/prerender-manifest.json", {});
  if (separate) write(".next/server/preview-props.json", {});
  return { dir, write };
}

test("rejects building or packing with dependencies older than package.json", (t) => {
  const { dir } = fixture(t, { installed: "16.3.8" });
  for (const dependenciesOnly of [true, false]) {
    assert.throws(() => verifyNextBuild(dir, { dependenciesOnly }), /requires 16\.4\.4.*contains 16\.3\.8.*npm ci/);
  }
});

test("rejects an old build even after installing the declared dependencies", (t) => {
  const { dir } = fixture(t, { built: "16.3.8" });
  assert.throws(() => verifyNextBuild(dir), /Stale Next\.js build.*16\.3\.8.*16\.4\.4/);
  assert.doesNotThrow(() => verifyNextBuild(dir, { dependenciesOnly: true }));
});

test("requires the preview-props file when the installed Next.js runtime needs it", (t) => {
  const { dir } = fixture(t);
  fs.unlinkSync(path.join(dir, ".next/server/preview-props.json"));
  assert.throws(() => verifyNextBuild(dir), /Missing build artifact .next\/server\/preview-props\.json/);
});

test("accepts matching complete builds with either Next.js manifest layout", (t) => {
  for (const separate of [true, false]) {
    const { dir } = fixture(t, { separate });
    assert.doesNotThrow(() => verifyNextBuild(dir));
  }
});

test("rejects missing diagnostics, incomplete output, and stale app versions", (t) => {
  for (const file of ["diagnostics/framework.json", "BUILD_ID", "routes-manifest.json", "prerender-manifest.json"]) {
    const { dir } = fixture(t);
    fs.unlinkSync(path.join(dir, ".next", file));
    assert.throws(() => verifyNextBuild(dir), /Missing (?:or invalid|build artifact)/);
  }
  const { dir, write } = fixture(t);
  write(".next/required-server-files.json", { config: { env: { NEXT_PUBLIC_APP_VERSION: "0.2.4" } } });
  assert.throws(() => verifyNextBuild(dir), /Stale application build/);
});

test("build and package lifecycles run the release checks", () => {
  const { scripts } = require("../package.json");
  assert.equal(scripts.prebuild, "node bin/verify-next-build.js --dependencies-only");
  assert.equal(scripts.prepack, "node bin/verify-next-build.js");
  assert.match(scripts.release, /^npm ci && npm version patch .* && npm run build && npm publish$/);
});
