import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createJiti } from "jiti";

test("management includes shadowed installations while the runtime catalog keeps one winner", async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "skill-management-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  const agent = path.join(root, "agent"), cwd = path.join(root, "project");
  process.env.PI_CODING_AGENT_DIR = agent;
  t.after(() => { if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR; else process.env.PI_CODING_AGENT_DIR = previous; fs.rmSync(root, { recursive: true, force: true }); });
  const winner = path.join(agent, "skills", "scope-fixture"), loser = path.join(cwd, ".agents", "skills", "scope-fixture");
  for (const dir of [winner, loser]) { fs.mkdirSync(dir, { recursive: true }); fs.writeFileSync(path.join(dir, "SKILL.md"), "---\nname: scope-fixture\ndescription: Fixture\n---\nBody\n"); }
  fs.writeFileSync(path.join(agent, "settings.json"), JSON.stringify({ skills: [loser] }));
  const { loadSkillsWithInstallInfo } = await createJiti(import.meta.url, { alias: { "@": process.cwd() } }).import("./skills-service.ts");
  const runtime = await loadSkillsWithInstallInfo(cwd);
  assert.equal(runtime.skills.filter(skill => skill.name === "scope-fixture").length, 1);
  const management = await loadSkillsWithInstallInfo(cwd, { includeShadowed: true });
  const both = management.skills.filter(skill => skill.name === "scope-fixture");
  assert.equal(both.length, 2);
  assert.equal(both.filter(skill => skill.loaded).length, 1);
  assert.equal(both.find(skill => skill.loaded).filePath, runtime.skills.find(skill => skill.name === "scope-fixture").filePath);
  assert.equal(both.find(skill => skill.loaded === false).filePath, management.diagnostics.find(item => item.collision?.name === "scope-fixture").collision.loserPath);
});
