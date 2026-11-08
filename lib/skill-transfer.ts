import { cp, lstat, mkdir, mkdtemp, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { homedir } from "node:os";
import { createHash, randomUUID } from "node:crypto";
import lockfile from "proper-lockfile";
import { getGlobalSkillsLockPath } from "./skill-lock";
import { requireUnlinkedDirectory, samePath, statIfPresent } from "./skill-file-paths";
import type { SkillInfo, SkillInstallScope } from "./api-types";

type Entry = Record<string, unknown>;
type Lock = { version?: number; skills: Record<string, Entry>; [key: string]: unknown };
export type TransferMode = "move" | "copy";
export class SkillTransferError extends Error {
  constructor(readonly code: string, readonly targetPath?: string) { super(code); }
}
interface Paths { sourceDir: string; targetDir: string; sourceLock: string; targetLock: string; targetScope: SkillInstallScope; }
interface UndoRecord extends Paths {
  cwd: string; name: string; mode: TransferMode; sourceEntry: Entry; targetEntry: Entry;
  backupPath: string; stagingPath: string; targetHash: string; expires: number;
}
const undoKey = Symbol.for("pi-web.skill-transfer-undo");
const globals = globalThis as typeof globalThis & { [undoKey]?: Map<string, UndoRecord> };
const undos = globals[undoKey] ??= new Map<string, UndoRecord>();

function parseLock(text: string): Lock {
  const lock = JSON.parse(text) as Lock;
  if (!lock || typeof lock !== "object" || !lock.skills || typeof lock.skills !== "object" || Array.isArray(lock.skills)) throw new SkillTransferError("invalid-lock");
  return lock;
}
async function readLock(file: string, missing = false): Promise<Lock> {
  const stat = await statIfPresent(file);
  if (!stat && missing) return { version: 1, skills: {} };
  if (!stat?.isFile() || stat.isSymbolicLink()) throw new SkillTransferError("invalid-lock");
  return parseLock(await readFile(file, "utf8"));
}
function normalizedSource(value: string) {
  return value.trim().replace(/^git\+/, "").replace(/^https?:\/\/github\.com\//, "").replace(/^git@github\.com:/, "").replace(/\.git$/, "").replace(/\/$/, "");
}
function getPaths(skill: SkillInfo, cwd: string, agentDir: string, homeDir: string): Paths {
  if (!skill.install || !/^[a-z0-9][a-z0-9_-]*$/.test(skill.name)) throw new SkillTransferError("unsupported");
  const globalRoot = path.join(homeDir, ".agents", "skills");
  const projectRoot = path.join(cwd, ".agents", "skills");
  if (samePath(globalRoot, projectRoot)) throw new SkillTransferError("overlap");
  const globalLock = getGlobalSkillsLockPath({ homeDir });
  const projectLock = path.join(cwd, "skills-lock.json");
  const scope = skill.install.scope;
  const sourceDir = path.dirname(skill.filePath);
  const roots = scope === "global" ? [globalRoot, path.join(agentDir, "skills")] : [projectRoot, path.join(cwd, ".pi", "skills")];
  if (!roots.some((root) => samePath(path.join(root, skill.name, "SKILL.md"), skill.filePath))) throw new SkillTransferError("unsupported");
  return { sourceDir, targetDir: path.join(scope === "global" ? projectRoot : globalRoot, skill.name), sourceLock: scope === "global" ? globalLock : projectLock, targetLock: scope === "global" ? projectLock : globalLock, targetScope: scope === "global" ? "project" : "global" };
}
async function validate(skill: SkillInfo, paths: Paths, cwd: string, agentDir: string, homeDir: string) {
  await requireUnlinkedDirectory(paths.sourceDir);
  if (!(await lstat(path.join(paths.sourceDir, "SKILL.md"))).isFile()) throw new SkillTransferError("source-changed");
  const source = await readLock(paths.sourceLock);
  const entry = source.skills[skill.name];
  if (!entry || typeof entry.source !== "string" || normalizedSource(entry.source) !== normalizedSource(skill.install!.source)) throw new SkillTransferError("source-changed");
  const sourceAliases = skill.install!.scope === "project" ? [path.join(cwd, ".pi", "skills", skill.name), path.join(cwd, ".agents", "skills", skill.name)] : [path.join(agentDir, "skills", skill.name), path.join(homeDir, ".agents", "skills", skill.name)];
  for (const alias of sourceAliases) if (!samePath(alias, paths.sourceDir) && await statIfPresent(alias)) throw new SkillTransferError("conflict", alias);
  const target = await readLock(paths.targetLock, true);
  const aliases = paths.targetScope === "project" ? [path.join(cwd, ".pi", "skills", skill.name)] : [path.join(agentDir, "skills", skill.name)];
  for (const candidate of [paths.targetDir, ...aliases]) if (await statIfPresent(candidate)) throw new SkillTransferError("conflict", candidate);
  if (Object.keys(target.skills).some((key) => key.toLowerCase() === skill.name.toLowerCase())) throw new SkillTransferError("conflict", paths.targetDir);
  return { source, target, entry };
}
// Links anywhere in the tree can escape the skill folder. This first version
// accepts ordinary self-contained directories, preserving all file bytes.
export async function skillDirectoryHash(dir: string): Promise<string> {
  const hash = createHash("sha256");
  let files = 0, bytes = 0;
  async function walk(current: string, relative: string) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw new SkillTransferError("linked-files");
    hash.update(relative + "\0");
    if (stat.isDirectory()) {
      hash.update("dir\0");
      for (const name of (await readdir(current)).sort()) await walk(path.join(current, name), `${relative}/${name}`);
    } else if (stat.isFile()) {
      if (++files > 20000 || (bytes += stat.size) > 200 * 1024 * 1024) throw new SkillTransferError("too-large");
      hash.update("file\0").update(await readFile(current)).update("\0");
    } else throw new SkillTransferError("unsupported");
  }
  await walk(dir, "");
  return hash.digest("hex");
}
async function makeSafeDirectory(dir: string) {
  // Check the existing ancestor before recursive mkdir so a linked .agents
  // directory is never used to create folders outside the intended root.
  let ancestor = dir;
  while (!(await statIfPresent(ancestor))) ancestor = path.dirname(ancestor);
  await requireUnlinkedDirectory(ancestor);
  await mkdir(dir, { recursive: true });
  await requireUnlinkedDirectory(dir);
}
async function writeLock(file: string, value: Lock | string) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  try {
    const stat = await lstat(file);
    await writeFile(temporary, typeof value === "string" ? value : `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: stat.mode & 0o777 });
    await rename(temporary, file);
  } finally { await unlink(temporary).catch(() => undefined); }
}
async function withLocks<T>(files: string[], run: () => Promise<T>, createFile?: string): Promise<T> {
  const releases: (() => Promise<void>)[] = [];
  try {
    for (const file of [...new Set(files)].sort()) {
      await makeSafeDirectory(path.dirname(file));
      if (file === createFile) {
        try { await writeFile(file, JSON.stringify({ version: path.basename(file) === ".skill-lock.json" ? 3 : 1, skills: {} }) + "\n", { flag: "wx", mode: 0o600 }); } catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error; }
      }
      await readLock(file);
      releases.push(await lockfile.lock(file, { realpath: false, retries: { retries: 10, minTimeout: 50, maxTimeout: 200 } }));
    }
    return await run();
  } finally { for (const release of releases.reverse()) await release(); }
}
export async function previewSkillTransfer(skill: SkillInfo, cwd: string, agentDir: string, homeDir = homedir()) {
  const paths = getPaths(skill, cwd, agentDir, homeDir);
  await validate(skill, paths, cwd, agentDir, homeDir);
  await skillDirectoryHash(paths.sourceDir);
  return { targetPath: path.join(paths.targetDir, "SKILL.md"), targetScope: paths.targetScope };
}
export async function transferInstalledSkill(skill: SkillInfo, mode: TransferMode, cwd: string, agentDir: string, homeDir = homedir()) {
  const paths = getPaths(skill, cwd, agentDir, homeDir);
  // Read-only validation before creating destination folders or lock files.
  await validate(skill, paths, cwd, agentDir, homeDir);
  return withLocks([paths.sourceLock, paths.targetLock], async () => {
    const { source, target, entry } = await validate(skill, paths, cwd, agentDir, homeDir);
    const originalSource = await readFile(paths.sourceLock, "utf8");
    const originalTarget = await readFile(paths.targetLock, "utf8");
    const hash = await skillDirectoryHash(paths.sourceDir);
    const backupRoot = path.join(path.dirname(path.dirname(paths.sourceDir)), ".pi-web-skill-transfers");
    await makeSafeDirectory(backupRoot);
    const backupPath = await mkdtemp(path.join(backupRoot, `${skill.name}-`));
    const stagingRoot = path.join(path.dirname(path.dirname(paths.targetDir)), ".pi-web-skill-transfers");
    await makeSafeDirectory(stagingRoot);
    const stagingPath = await mkdtemp(path.join(stagingRoot, `${skill.name}-`));
    const staged = path.join(stagingPath, "target");
    await cp(paths.sourceDir, staged, { recursive: true, errorOnExist: true, force: false, preserveTimestamps: true });
    if (await skillDirectoryHash(staged) !== hash || await skillDirectoryHash(paths.sourceDir) !== hash) throw new SkillTransferError("source-changed");
    // CLI hashes have different meanings in project and global locks. Preserve
    // the displayed revision separately without enabling a false update check.
    const targetEntry: Entry = { ...entry, piWebVersionHash: skill.install?.versionHash };
    delete targetEntry.skillFolderHash;
    delete targetEntry.computedHash;
    target.skills[skill.name] = targetEntry;
    if (mode === "move") delete source.skills[skill.name];
    await writeFile(path.join(backupPath, "manifest.json"), JSON.stringify({ ...paths, mode, name: skill.name, sourceEntry: entry, targetEntry, stagingPath }, null, 2), { mode: 0o600 });
    await writeFile(path.join(backupPath, "source-lock.json"), originalSource, { mode: 0o600 });
    await writeFile(path.join(backupPath, "target-lock.json"), originalTarget, { mode: 0o600 });
    await makeSafeDirectory(path.dirname(paths.targetDir));
    let installed = false, sourceMoved = false, targetWritten = false, sourceWritten = false;
    try {
      if (await statIfPresent(paths.targetDir)) throw new SkillTransferError("conflict", paths.targetDir);
      if (await readFile(paths.sourceLock, "utf8") !== originalSource || await readFile(paths.targetLock, "utf8") !== originalTarget) throw new SkillTransferError("source-changed");
      await rename(staged, paths.targetDir); installed = true;
      if (mode === "move") { await rename(paths.sourceDir, path.join(backupPath, "source")); sourceMoved = true; }
      await writeLock(paths.targetLock, target); targetWritten = true;
      if (mode === "move") { await writeLock(paths.sourceLock, source); sourceWritten = true; }
    } catch (error) {
      try {
        if (sourceWritten) await writeLock(paths.sourceLock, originalSource);
        if (targetWritten) await writeLock(paths.targetLock, originalTarget);
        if (sourceMoved) await rename(path.join(backupPath, "source"), paths.sourceDir);
        if (installed) await rename(paths.targetDir, staged);
      } catch { throw new SkillTransferError("recover", backupPath); }
      throw error;
    }
    for (const [key, record] of undos) if (record.expires < Date.now()) undos.delete(key);
    if (undos.size >= 100) undos.delete(undos.keys().next().value!);
    const undoToken = randomUUID();
    undos.set(undoToken, { ...paths, cwd, name: skill.name, mode, sourceEntry: entry, targetEntry, backupPath, stagingPath, targetHash: hash, expires: Date.now() + 5 * 60_000 });
    return { ...paths, targetPath: path.join(paths.targetDir, "SKILL.md"), undoToken };
  }, paths.targetLock);
}
export async function undoSkillTransfer(token: string, cwd: string) {
  const record = undos.get(token);
  if (!record || record.expires < Date.now() || !samePath(record.cwd, cwd)) throw new SkillTransferError("undo-expired");
  return withLocks([record.sourceLock, record.targetLock], async () => {
    if (undos.get(token) !== record) throw new SkillTransferError("undo-expired");
    const source = await readLock(record.sourceLock), target = await readLock(record.targetLock);
    if (JSON.stringify(target.skills[record.name]) !== JSON.stringify(record.targetEntry)) throw new SkillTransferError("undo-changed");
    await requireUnlinkedDirectory(record.targetDir);
    if (await skillDirectoryHash(record.targetDir) !== record.targetHash) throw new SkillTransferError("undo-changed");
    if (record.mode === "move") {
      if (source.skills[record.name] || await statIfPresent(record.sourceDir)) throw new SkillTransferError("conflict", record.sourceDir);
      if (await skillDirectoryHash(path.join(record.backupPath, "source")) !== record.targetHash) throw new SkillTransferError("undo-changed");
    }
    await requireUnlinkedDirectory(path.dirname(record.sourceDir));
    await requireUnlinkedDirectory(record.backupPath);
    await requireUnlinkedDirectory(record.stagingPath);
    const targetText = await readFile(record.targetLock, "utf8");
    let targetMoved = false, sourceRestored = false, targetWritten = false;
    try {
      await rename(record.targetDir, path.join(record.stagingPath, "undone-target")); targetMoved = true;
      if (record.mode === "move") {
        await rename(path.join(record.backupPath, "source"), record.sourceDir); sourceRestored = true;
        source.skills[record.name] = record.sourceEntry;
      }
      delete target.skills[record.name];
      await writeLock(record.targetLock, target); targetWritten = true;
      if (record.mode === "move") await writeLock(record.sourceLock, source);
    } catch (error) {
      try {
        if (targetWritten) await writeLock(record.targetLock, targetText);
        if (sourceRestored) await rename(record.sourceDir, path.join(record.backupPath, "source"));
        if (targetMoved) await rename(path.join(record.stagingPath, "undone-target"), record.targetDir);
      } catch { throw new SkillTransferError("recover", record.backupPath); }
      throw error;
    }
    undos.delete(token);
    return { targetPath: path.join(record.sourceDir, "SKILL.md") };
  });
}
