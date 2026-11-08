import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";
import { loadSkills } from "@earendil-works/pi-coding-agent";
const { previewSkillTransfer, transferInstalledSkill, undoSkillTransfer } = await createJiti(import.meta.url).import("./skill-transfer.ts");
const previousXdg = process.env.XDG_STATE_HOME;
delete process.env.XDG_STATE_HOME;
after(() => { if (previousXdg !== undefined) process.env.XDG_STATE_HOME = previousXdg; });
function fixture(t, scope = "global", splitDrives = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-transfer-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const home = path.join(root, "home"); fs.mkdirSync(home);
  let cwd = path.join(root, "project");
  if (splitDrives) {
    fs.mkdirSync(path.resolve("test-results"), { recursive: true });
    cwd = fs.mkdtempSync(path.resolve("test-results", "skill-transfer-"));
    t.after(() => fs.rmSync(cwd, { recursive: true, force: true }));
  } else fs.mkdirSync(cwd);
  const agent = path.join(home, ".pi", "agent");
  const sourceRoot = path.join(scope === "global" ? home : cwd, ".agents", "skills");
  const targetRoot = path.join(scope === "global" ? cwd : home, ".agents", "skills");
  const sourceDir = path.join(sourceRoot, "example");
  fs.mkdirSync(path.join(sourceDir, "guides"), { recursive: true });
  fs.writeFileSync(path.join(sourceDir, "SKILL.md"), "---\nname: example\ndescription: Example\ndisable-model-invocation: true\n---\nInstructions\n");
  fs.writeFileSync(path.join(sourceDir, "guides", "intro.md"), "Local edits must survive.");
  const sourceLock = scope === "global" ? path.join(home, ".agents", ".skill-lock.json") : path.join(cwd, "skills-lock.json");
  const targetLock = scope === "global" ? path.join(cwd, "skills-lock.json") : path.join(home, ".agents", ".skill-lock.json");
  const entry = { source: "owner/repo", sourceType: "github", skillPath: "skills/example/SKILL.md", skillFolderHash: "snapshot", computedHash: "project-hash", custom: 42 };
  const lock = { version: scope === "global" ? 3 : 1, skills: { example: entry, other: { source: "keep/other" } }, custom: "keep" };
  fs.writeFileSync(sourceLock, JSON.stringify(lock));
  const skill = { name: "example", filePath: path.join(sourceDir, "SKILL.md"), baseDir: sourceDir, description: "Example", disableModelInvocation: true, sourceInfo: { scope: scope === "global" ? "user" : "project" }, install: { scope, source: "owner/repo", package: "owner/repo@example", versionHash: "original-hash" } };
  return { root, cwd, home, agent, sourceRoot, targetRoot, sourceDir, targetDir: path.join(targetRoot, "example"), sourceLock, targetLock, entry, lock, skill };
}
const read = file => JSON.parse(fs.readFileSync(file, "utf8"));
for (const scope of ["global", "project"]) for (const mode of ["move", "copy"]) test(`${scope} ${mode}: preserves content, updates only the selected records, and undoes`, async (t) => {
  const f = fixture(t, scope);
  const preview = await previewSkillTransfer(f.skill, f.cwd, f.agent, f.home);
  assert.equal(preview.targetPath, path.join(f.targetDir, "SKILL.md"));
  assert.equal(fs.existsSync(f.targetRoot), false, "preview never creates directories");
  const result = await transferInstalledSkill(f.skill, mode, f.cwd, f.agent, f.home);
  assert.equal(fs.readFileSync(path.join(f.targetDir, "guides", "intro.md"), "utf8"), "Local edits must survive.");
  assert.match(fs.readFileSync(result.targetPath, "utf8"), /disable-model-invocation: true/);
  assert.equal(fs.existsSync(f.sourceDir), mode === "copy");
  assert.equal(Boolean(read(f.sourceLock).skills.example), mode === "copy");
  assert.equal(read(f.sourceLock).custom, "keep");
  assert.deepEqual(read(f.sourceLock).skills.other, { source: "keep/other" });
  assert.equal(read(f.targetLock).skills.example.piWebVersionHash, "original-hash");
  assert.equal(read(f.targetLock).skills.example.skillFolderHash, undefined);
  const discovered = loadSkills({ cwd: f.cwd, agentDir: f.agent, skillPaths: [f.sourceRoot, f.targetRoot], includeDefaults: false });
  assert.equal(discovered.skills.length, 1);
  assert.equal(discovered.diagnostics.some(d => d.collision?.resourceType === "skill"), mode === "copy");
  // A later unrelated installation must survive undo.
  const targetLock = read(f.targetLock); targetLock.skills.later = { source: "later/repo" }; fs.writeFileSync(f.targetLock, JSON.stringify(targetLock));
  const undone = await undoSkillTransfer(result.undoToken, f.cwd);
  assert.equal(undone.targetPath, f.skill.filePath);
  assert.ok(fs.existsSync(f.skill.filePath));
  assert.equal(fs.existsSync(f.targetDir), false);
  assert.deepEqual(read(f.sourceLock).skills.example, f.entry);
  assert.equal(read(f.targetLock).skills.example, undefined);
  assert.deepEqual(read(f.targetLock).skills.later, { source: "later/repo" });
});
test("refuses same-name targets, including a dangling link, without touching the source", async (t) => {
  const f = fixture(t);
  fs.mkdirSync(f.targetRoot, { recursive: true });
  fs.symlinkSync(path.join(f.root, "missing"), f.targetDir, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(transferInstalledSkill(f.skill, "move", f.cwd, f.agent, f.home), error => error.code === "conflict");
  assert.ok(fs.existsSync(f.skill.filePath));
  assert.deepEqual(read(f.sourceLock), f.lock);
});
test("refuses escaped roots and nested links", async (t) => {
  const f = fixture(t);
  fs.symlinkSync(f.home, path.join(f.sourceDir, "outside"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(transferInstalledSkill(f.skill, "copy", f.cwd, f.agent, f.home), error => error.code === "linked-files");
  assert.equal(fs.existsSync(f.targetDir), false);
});
test("undo refuses edits or a new source installation", async (t) => {
  const f = fixture(t);
  const result = await transferInstalledSkill(f.skill, "move", f.cwd, f.agent, f.home);
  fs.appendFileSync(result.targetPath, "User edits");
  await assert.rejects(undoSkillTransfer(result.undoToken, f.cwd), error => error.code === "undo-changed");
  assert.ok(fs.existsSync(result.targetPath));
});
test("Windows lock write failure restores the source and removes the target installation", { skip: process.platform !== "win32" }, async (t) => {
  const f = fixture(t);
  fs.chmodSync(f.sourceLock, 0o444);
  try {
    await assert.rejects(transferInstalledSkill(f.skill, "move", f.cwd, f.agent, f.home));
    assert.ok(fs.existsSync(f.skill.filePath));
    assert.equal(fs.existsSync(f.targetDir), false);
    assert.deepEqual(read(f.sourceLock), f.lock);
    assert.deepEqual(read(f.targetLock).skills, {});
  } finally { fs.chmodSync(f.sourceLock, 0o666); }
});
test("move and undo work across the home and workspace volumes", async (t) => {
  const f = fixture(t, "global", true);
  const result = await transferInstalledSkill(f.skill, "move", f.cwd, f.agent, f.home);
  assert.ok(fs.existsSync(result.targetPath));
  await undoSkillTransfer(result.undoToken, f.cwd);
  assert.ok(fs.existsSync(f.skill.filePath));
});
