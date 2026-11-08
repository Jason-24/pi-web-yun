import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { loadSkillsFromDir } from "@earendil-works/pi-coding-agent";
const { removeInstalledSkill } = await createJiti(import.meta.url).import("./skill-remove.ts");
const oldXdg = process.env.XDG_STATE_HOME;
delete process.env.XDG_STATE_HOME;
after(() => { if (oldXdg !== undefined) process.env.XDG_STATE_HOME = oldXdg; });

function fixture(t, scope = "project") {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-remove-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, "project"), home = path.join(root, "home"), agent = path.join(home, ".pi", "agent");
  fs.mkdirSync(cwd); fs.mkdirSync(home);
  const skillsRoot = path.join(scope === "global" ? home : cwd, ".agents", "skills");
  const dir = path.join(skillsRoot, "example");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: example\ndescription: example\n---\nInstructions\n");
  const lockPath = scope === "global" ? path.join(home, ".agents", ".skill-lock.json") : path.join(cwd, "skills-lock.json");
  const lock = { version: 3, extra: "preserve", skills: { example: { source: "owner/repo", arbitrary: 42 }, other: { source: "other/repo" } } };
  fs.writeFileSync(lockPath, JSON.stringify(lock));
  const skill = { name: "example", filePath: path.join(dir, "SKILL.md"), install: { scope, source: "owner/repo", package: "owner/repo@example" } };
  return { cwd, home, agent, skillsRoot, dir, lockPath, lock, skill, root };
}
for (const scope of ["project", "global"]) test(`${scope} uninstall removes the skill from SDK discovery and keeps a recoverable backup`, async (t) => {
  const f = fixture(t, scope);
  assert.equal(loadSkillsFromDir({ dir: f.skillsRoot, source: scope }).skills.length, 1);
  const { backupPath } = await removeInstalledSkill(f.skill, f.cwd, f.agent, f.home);
  assert.equal(fs.existsSync(f.dir), false);
  assert.equal(loadSkillsFromDir({ dir: f.skillsRoot, source: scope }).skills.length, 0);
  const updated = JSON.parse(fs.readFileSync(f.lockPath));
  assert.deepEqual(updated, { version: 3, extra: "preserve", skills: { other: { source: "other/repo" } } });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(backupPath, "lock.json"))), f.lock);
  const manifest = JSON.parse(fs.readFileSync(path.join(backupPath, "manifest.json")));
  assert.match(fs.readFileSync(path.join(manifest.moves[0].backup, "SKILL.md"), "utf8"), /Instructions/);
});
test("refuses changed source, arbitrary paths, malformed locks and different same-name directories without changing files", async (t) => {
  const f = fixture(t);
  await assert.rejects(removeInstalledSkill({ ...f.skill, filePath: path.join(f.root, "SKILL.md") }, f.cwd, f.agent, f.home));
  await assert.rejects(removeInstalledSkill({ ...f.skill, name: "../example" }, f.cwd, f.agent, f.home));
  await assert.rejects(removeInstalledSkill({ ...f.skill, install: { ...f.skill.install, source: "changed/repo" } }, f.cwd, f.agent, f.home));
  fs.writeFileSync(f.lockPath, "broken");
  await assert.rejects(removeInstalledSkill(f.skill, f.cwd, f.agent, f.home));
  fs.writeFileSync(f.lockPath, JSON.stringify(f.lock));
  fs.mkdirSync(path.join(f.cwd, ".pi", "skills", "example"), { recursive: true });
  await assert.rejects(removeInstalledSkill(f.skill, f.cwd, f.agent, f.home), /Different skills/);
  assert.ok(fs.existsSync(f.skill.filePath));
  assert.deepEqual(JSON.parse(fs.readFileSync(f.lockPath)), f.lock);
});
test("moves a skill link without removing its external source", async (t) => {
  const f = fixture(t);
  const source = path.join(f.root, "source");
  fs.renameSync(f.dir, source);
  fs.symlinkSync(source, f.dir, process.platform === "win32" ? "junction" : "dir");
  await removeInstalledSkill(f.skill, f.cwd, f.agent, f.home);
  assert.ok(fs.existsSync(path.join(source, "SKILL.md")));
  assert.equal(fs.existsSync(f.dir), false);
});
test("removes both the canonical directory and a Pi link to it", async (t) => {
  const f = fixture(t);
  const legacy = path.join(f.cwd, ".pi", "skills", "example");
  fs.mkdirSync(path.dirname(legacy), { recursive: true });
  fs.symlinkSync(f.dir, legacy, process.platform === "win32" ? "junction" : "dir");
  await removeInstalledSkill(f.skill, f.cwd, f.agent, f.home);
  assert.equal(fs.existsSync(legacy), false);
  assert.equal(fs.existsSync(f.dir), false);
});
test("refuses a project skill root redirected to a global directory", async (t) => {
  const f = fixture(t);
  const redirected = path.join(f.home, "shared-skills");
  fs.renameSync(f.skillsRoot, redirected);
  fs.symlinkSync(redirected, f.skillsRoot, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(removeInstalledSkill(f.skill, f.cwd, f.agent, f.home), /Linked skill roots/);
  assert.ok(fs.existsSync(path.join(redirected, "example", "SKILL.md")));
});
test("concurrent removals preserve other lock entries", async (t) => {
  const f = fixture(t);
  const otherDir = path.join(f.skillsRoot, "other");
  fs.mkdirSync(otherDir);
  fs.writeFileSync(path.join(otherDir, "SKILL.md"), "---\nname: other\ndescription: other\n---\nOther\n");
  const other = { name: "other", filePath: path.join(otherDir, "SKILL.md"), install: { scope: "project", source: "other/repo", package: "other/repo@other" } };
  await Promise.all([removeInstalledSkill(f.skill, f.cwd, f.agent, f.home), removeInstalledSkill(other, f.cwd, f.agent, f.home)]);
  assert.deepEqual(JSON.parse(fs.readFileSync(f.lockPath)).skills, {});
});
test("restores the moved skill when Windows refuses the atomic lock replacement", { skip: process.platform !== "win32" }, async (t) => {
  const f = fixture(t);
  fs.chmodSync(f.lockPath, 0o444);
  try {
    await assert.rejects(removeInstalledSkill(f.skill, f.cwd, f.agent, f.home));
    assert.ok(fs.existsSync(f.skill.filePath));
    assert.deepEqual(JSON.parse(fs.readFileSync(f.lockPath)), f.lock);
  } finally { fs.chmodSync(f.lockPath, 0o666); }
});
