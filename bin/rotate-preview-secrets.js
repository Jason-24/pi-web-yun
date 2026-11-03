"use strict";

// The published npm tarball ships the build's preview-mode secrets in
// `.next/server/preview-props.json` (Next 16.4+) and/or the `preview` block
// of `.next/prerender-manifest.json`. One of them,
// `previewModeId`, is the value Next compares against the `x-prerender-revalidate`
// request header: when they match, Next treats the request as an on-demand
// revalidation and skips middleware/proxy entirely (see next-server.js
// `runMiddleware`). Because the value is baked into every published version, an
// attacker who reads the tarball can send that header and bypass `proxy.ts` —
// the central password gate and the Host/Origin/Fetch-Metadata checks.
//
// `next start` reads these secrets from these files (there is no runtime env
// override) and never regenerates them, so we rewrite the three preview secrets
// with fresh random values before launching Next. That makes the published
// values useless and unique per launch. Done at startup rather than in a
// postinstall hook so it runs on the guaranteed launch path and cannot be
// skipped with `--ignore-scripts`.

// eslint-disable-next-line @typescript-eslint/no-require-imports
const crypto = require("crypto");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const PRERENDER_MANIFEST = "prerender-manifest.json";
const PREVIEW_PROPS = path.join("server", "preview-props.json");

function freshPreviewSecrets() {
  return {
    // Lengths mirror what Next generates at build time.
    previewModeId: crypto.randomBytes(16).toString("hex"),
    previewModeSigningKey: crypto.randomBytes(32).toString("hex"),
    previewModeEncryptionKey: crypto.randomBytes(32).toString("hex"),
  };
}

/**
 * Rewrite the preview-mode secrets in either Next.js manifest layout with the
 * same fresh random values. Never throws: returns a status the caller can surface so a
 * read-only install (where the rewrite cannot happen) is visible rather than a
 * silent bypass.
 *
 * @param {string} nextDir absolute path to the package's `.next` directory
 * @returns {{ ok: boolean, reason?: string, error?: Error }}
 */
function rotatePreviewSecrets(nextDir) {
  const targets = [];
  for (const file of [PREVIEW_PROPS, PRERENDER_MANIFEST]) {
    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(path.join(nextDir, file), "utf8"));
    } catch (error) {
      if (error && error.code === "ENOENT") continue;
      return { ok: false, reason: "unreadable", error };
    }
    const isSeparate = file === PREVIEW_PROPS;
    // Newer prerender manifests can omit preview entirely; the separate file
    // remains authoritative. Never fall back from a malformed separate file.
    if (!isSeparate && manifest && typeof manifest === "object"
      && !Array.isArray(manifest) && !("preview" in manifest) && targets.length) continue;
    const preview = isSeparate ? manifest : manifest?.preview;
    if (!preview || typeof preview !== "object" || Array.isArray(preview)
      || !["previewModeId", "previewModeSigningKey", "previewModeEncryptionKey"]
        .every((key) => typeof preview[key] === "string")) {
      return { ok: false, reason: "unexpected-shape" };
    }
    targets.push({ file, manifest, isSeparate });
  }
  if (!targets.length) return { ok: false, reason: "missing" };
  const secrets = freshPreviewSecrets();

  // Write to a sibling temp file and rename so a concurrent `next start` never
  // reads a half-written manifest.
  for (const { file, manifest, isSeparate } of targets) {
    const updated = isSeparate
      ? { ...manifest, ...secrets }
      : { ...manifest, preview: { ...manifest.preview, ...secrets } };
    const manifestPath = path.join(nextDir, file);
    const tempPath = `${manifestPath}.${process.pid}.tmp`;
    try {
      fs.writeFileSync(tempPath, JSON.stringify(updated));
      fs.renameSync(tempPath, manifestPath);
    } catch (error) {
      try {
        fs.rmSync(tempPath, { force: true });
      } catch {
        // Best effort: leaving a stray temp file is harmless.
      }
      return { ok: false, reason: "unwritable", error };
    }
  }

  return { ok: true };
}

function getRotationWarning(reason) {
  const detail =
    reason === "unwritable"
      ? "the install directory is not writable"
      : reason === "missing"
        ? "its preview manifests are missing"
        : reason === "unreadable"
          ? "a preview manifest could not be read"
          : "a preview manifest has an unexpected format";
  return [
    `Warning: could not rotate pi-web's preview-mode secrets because ${detail}.`,
    "This instance may keep the published preview id, so a client that knows it can",
    "bypass the proxy's authentication and Host/Origin checks via the",
    "x-prerender-revalidate header. Run from a writable install, or restrict",
    "network access to this instance.",
  ].join("\n");
}

module.exports = {
  PRERENDER_MANIFEST,
  PREVIEW_PROPS,
  rotatePreviewSecrets,
  getRotationWarning,
};
