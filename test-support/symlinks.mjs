import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Windows needs Developer Mode or a symlink privilege. Linux CI always runs
// these tests; only a proven missing Windows capability is a skip.
export const symlinkTestOptions = (() => {
  if (process.platform !== "win32") return {};
  const dir = mkdtempSync(join(tmpdir(), "pi-yun-symlink-probe-"));
  try {
    writeFileSync(join(dir, "target"), "test");
    symlinkSync(join(dir, "target"), join(dir, "link"));
    return {};
  } catch (error) {
    if (error.code !== "EPERM" && error.code !== "EACCES") throw error;
    return { skip: "Windows does not grant this process symbolic-link creation" };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
})();
