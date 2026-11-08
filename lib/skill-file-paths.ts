import { lstat } from "node:fs/promises";
import path from "node:path";

export function samePath(a: string, b: string): boolean {
  const normalize = (value: string) => process.platform === "win32" ? path.resolve(value).toLowerCase() : path.resolve(value);
  return normalize(a) === normalize(b);
}

export async function statIfPresent(target: string) {
  try { return await lstat(target); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

// Parent links can redirect a project removal into a global directory. Skill
// links themselves are fine: rename moves the link, never its external target.
export async function requireUnlinkedDirectory(target: string) {
  for (let current = path.resolve(target); ; current = path.dirname(current)) {
    const stat = await lstat(current);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("Linked skill roots cannot be uninstalled automatically");
    if (path.dirname(current) === current) break;
  }
}

