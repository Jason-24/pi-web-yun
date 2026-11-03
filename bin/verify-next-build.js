"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("node:fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("node:path");

function readJson(pkgDir, file) {
  try {
    return JSON.parse(fs.readFileSync(path.join(pkgDir, file), "utf8"));
  } catch {
    throw new Error(`Missing or invalid ${file}. Rebuild in a clean release checkout before publishing.`);
  }
}

function verifyNextBuild(pkgDir, { dependenciesOnly = false } = {}) {
  const pkg = readJson(pkgDir, "package.json");
  const nextPackage = require.resolve("next/package.json", { paths: [pkgDir] });
  const installed = JSON.parse(fs.readFileSync(nextPackage, "utf8")).version;
  if (installed !== pkg.dependencies.next) {
    throw new Error(`Next.js version mismatch: package.json requires ${pkg.dependencies.next}, but node_modules contains ${installed}. Run npm ci before building a release.`);
  }
  if (dependenciesOnly) return;

  const framework = readJson(pkgDir, ".next/diagnostics/framework.json");
  if (framework.version !== installed) {
    throw new Error(`Stale Next.js build: .next was built with ${framework.version}, but the installed runtime is ${installed}. Rebuild in a clean release checkout before publishing.`);
  }

  const serverFiles = readJson(pkgDir, ".next/required-server-files.json");
  if (serverFiles.config?.env?.NEXT_PUBLIC_APP_VERSION !== pkg.version) {
    throw new Error(`Stale application build: .next does not match package version ${pkg.version}. Rebuild in a clean release checkout before publishing.`);
  }

  // Use the installed runtime's constants instead of guessing which Next.js
  // versions require the separate preview-props file (introduced in 16.4).
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { PREVIEW_PROPS_MANIFEST } = require(require.resolve("next/dist/shared/lib/constants", { paths: [pkgDir] }));
  const files = ["BUILD_ID", "routes-manifest.json", "prerender-manifest.json"];
  if (PREVIEW_PROPS_MANIFEST) files.push(`server/${PREVIEW_PROPS_MANIFEST}`);
  for (const file of files) {
    const relative = `.next/${file}`;
    try {
      if (!fs.statSync(path.join(pkgDir, relative)).isFile()) throw new Error();
    } catch {
      throw new Error(`Missing build artifact ${relative}. Rebuild in a clean release checkout before publishing.`);
    }
  }
}

if (require.main === module) {
  try {
    verifyNextBuild(path.join(__dirname, ".."), {
      dependenciesOnly: process.argv.includes("--dependencies-only"),
    });
  } catch (error) {
    console.error(`[pi-web] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = { verifyNextBuild };
