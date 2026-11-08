import { homedir } from "node:os";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getGlobalSkillsLockPath } from "./skill-lock";
import type { SkillInfo } from "./api-types";
import { requireUnlinkedDirectory, samePath, statIfPresent } from "./skill-file-paths";

/** Remove just this installation, preserving it outside all skill search roots. */
export async function removeInstalledSkill(
  skill: SkillInfo,
  cwd: string,
  agentDir: string,
  homeDir = homedir(),
): Promise<{ backupPath: string }> {
  const install = skill.install;
  if (!install || !/^[a-z0-9][a-z0-9_-]*$/.test(skill.name)) throw new Error("Unsupported skill installation");
  if (install.scope === "project" && samePath(await realpath(cwd), await realpath(homeDir))) throw new Error("Project and global skill roots overlap");
  const roots = install.scope === "global"
    ? [path.join(homeDir, ".agents", "skills"), path.join(agentDir, "skills")]
    : [path.join(cwd, ".agents", "skills"), path.join(cwd, ".pi", "skills")];
  if (!roots.some((root) => samePath(path.join(root, skill.name, "SKILL.md"), skill.filePath))) throw new Error("Skill path does not match its installation");
  const lockPath = install.scope === "global" ? getGlobalSkillsLockPath({ homeDir }) : path.join(cwd, "skills-lock.json");
  const lockStat = await lstat(lockPath);
  if (!lockStat.isFile() || lockStat.isSymbolicLink()) throw new Error("Unsupported skill lock file");
  await requireUnlinkedDirectory(path.dirname(lockPath));
  const release = await lockfile.lock(lockPath, { realpath: false, retries: { retries: 5, minTimeout: 50, maxTimeout: 200 } });
  try {
    const originalLock = await readFile(lockPath, "utf8");
    const lock = JSON.parse(originalLock) as { skills?: Record<string, { source?: unknown }>; [key: string]: unknown };
    if (!lock.skills || Array.isArray(lock.skills) || typeof lock.skills !== "object") throw new Error("Invalid skill lock file");
    const entry = lock.skills[skill.name];
    if (!entry || typeof entry.source !== "string") throw new Error("Skill installation record no longer exists");
    const source = entry.source.replace(/^git\+/, "").replace(/^https?:\/\/github\.com\//, "").replace(/^git@github\.com:/, "").replace(/\.git$/, "").replace(/\/$/, "");
    if (source !== install.source && entry.source.replace(/\/$/, "") !== install.source) throw new Error("Skill source changed; refresh before uninstalling");
    const candidates: string[] = [];
    for (const root of roots) {
      if (!(await statIfPresent(root))) continue;
      await requireUnlinkedDirectory(root);
      const candidate = path.join(root, skill.name);
      const stat = await statIfPresent(candidate);
      if (stat) {
        if (!stat.isDirectory() && !stat.isSymbolicLink()) throw new Error("Skill is not a directory");
        if (!candidates.some((existing) => samePath(existing, candidate))) candidates.push(candidate);
      }
    }
    if (candidates.length === 0) throw new Error("Skill directory no longer exists");
    const targets = await Promise.all(candidates.map((candidate) => realpath(candidate)));
    if (targets.some((target) => !samePath(target, targets[0]))) throw new Error("Different skills share this name; uninstall requires manual review");
    const trashRoot = path.join(path.dirname(path.dirname(candidates[0])), ".pi-web-skill-trash");
    await mkdir(trashRoot, { recursive: true });
    await requireUnlinkedDirectory(trashRoot);
    const backupPath = await mkdtemp(path.join(trashRoot, `${skill.name}-`));
    const moved: { original: string; backup: string }[] = [];
    const tempLock = `${lockPath}.${randomUUID()}.tmp`;
    try {
      await writeFile(path.join(backupPath, "lock.json"), originalLock, { flag: "wx", mode: 0o600 });
      const moves = candidates.map((original, index) => ({ original, backup: path.join(backupPath, `skill-${index}`) }));
      await writeFile(path.join(backupPath, "manifest.json"), JSON.stringify({ name: skill.name, scope: install.scope, lockPath, moves }, null, 2), { flag: "wx", mode: 0o600 });
      // Move links first so the canonical path is still resolvable while moving.
      moves.sort((a, b) => Number(samePath(a.original, targets[0])) - Number(samePath(b.original, targets[0])));
      for (const move of moves) { await rename(move.original, move.backup); moved.push(move); }
      if (await readFile(lockPath, "utf8") !== originalLock) throw new Error("Skill installation records changed; try again");
      delete lock.skills[skill.name];
      await writeFile(tempLock, `${JSON.stringify(lock, null, 2)}\n`, { flag: "wx", mode: lockStat.mode & 0o777 });
      await rename(tempLock, lockPath);
    } catch (error) {
      const failures: string[] = [];
      for (const move of moved.reverse()) {
        try { await rename(move.backup, move.original); } catch { failures.push(move.original); }
      }
      if (failures.length) throw new Error(`Uninstall failed; recover files from ${backupPath}`);
      throw error;
    } finally { await unlink(tempLock).catch(() => undefined); }
    return { backupPath };
  } finally { await release(); }
}
