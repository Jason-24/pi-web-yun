// Unmocked, read-only smoke test against an existing dev server. Never applies
// a transfer or touches installation records; catches route-bundle import errors.
import assert from "node:assert/strict";
const base = process.env.E2E_BASE_URL || "http://127.0.0.1:30141";
const cwd = process.env.E2E_TRANSFER_CWD || process.cwd();
const name = process.env.E2E_TRANSFER_SKILL || "find-skills";
const listing = await fetch(`${base}/api/skills?cwd=${encodeURIComponent(cwd)}&management=1`);
assert.equal(listing.status, 200);
const data = await listing.json();
const skill = data.skills.find(item => item.name === name && item.install);
assert.ok(skill, `Install ${name} before running this read-only smoke test`);
const response = await fetch(`${base}/api/skills/transfer`, {
  method: "POST", headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ action: "preview", cwd, filePath: skill.filePath, package: skill.install.package }),
});
const result = await response.json();
assert.equal(response.status, 200, JSON.stringify(result));
assert.equal(typeof result.targetPath, "string");
assert.equal(result.targetScope, skill.install.scope === "global" ? "project" : "global");
console.log(`PASS real transfer preview: ${response.status}, ${result.targetScope}`);
