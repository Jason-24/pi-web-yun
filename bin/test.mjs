import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Keep tests away from the operator's credentials and settings. Expand Windows
// 8.3 aliases before passing paths to pi: its ancestor trust scan must recognize
// the actual home directory and ignore the user's own .agents/skills there.
const root = mkdtempSync(join(realpathSync.native(tmpdir()), "pi-yun-tests-"));
const temp = join(root, "tmp");
const agent = join(root, "agent");
mkdirSync(temp);
mkdirSync(agent);
const patterns = ["app/**/*.test.mjs", "components/**/*.test.mjs", "hooks/**/*.test.mjs", "lib/**/*.test.mjs", "public/**/*.test.mjs"];
const args = process.argv.slice(2);
const child = spawn(process.execPath, ["--experimental-strip-types", "--test", "--test-concurrency=4", ...args, ...(args.some((arg) => arg.endsWith(".test.mjs")) ? [] : patterns)], {
  stdio: "inherit",
  env: { ...process.env, PI_CODING_AGENT_DIR: agent, TMPDIR: temp, TEMP: temp, TMP: temp },
});
child.on("error", (error) => { console.error(error); process.exitCode = 1; });
child.on("close", (code) => {
  try { rmSync(root, { recursive: true, force: true, maxRetries: 3 }); }
  catch (error) { console.error("Could not remove the test directory:", error.message); process.exitCode = 1; }
  process.exitCode ||= code ?? 1;
});
