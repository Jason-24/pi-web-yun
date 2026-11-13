import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET } = await jiti.import("./[id]/export/route.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../lib/session-reader.ts");

test("current SDK exports download as HTML, including deep sessions and Unicode filenames", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-export-test-"));
  const id = randomUUID();
  const file = join(dir, "历史会话.jsonl");
  t.after(async () => {
    invalidateSessionPathCache(id);
    await rm(dir, { recursive: true, force: true });
  });
  const timestamp = "2026-11-09T00:00:00Z";
  const entries = Array.from({ length: 6000 }, (_, index) => ({
    type: "message", id: `entry-${index}`, parentId: index ? `entry-${index - 1}` : null, timestamp,
    message: { role: "user", content: `历史记录 ${index}`, timestamp: Date.parse(timestamp) },
  }));
  const original = [{ type: "session", version: 3, id, timestamp, cwd: dir }, ...entries].map(JSON.stringify).join("\n") + "\n";
  await writeFile(file, original);
  cacheSessionPath(id, file);

  for (const inline of [false, true]) {
    const response = await GET(new Request(`http://localhost/api/sessions/${id}/export${inline ? "?inline=1" : ""}`), { params: Promise.resolve({ id }) });
    assert.equal(response.status, 200, await response.clone().text().then(text => text.slice(0, 200)));
    assert.equal(response.headers.get("Content-Type"), "text/html; charset=utf-8");
    const disposition = response.headers.get("Content-Disposition");
    assert.ok(disposition.startsWith(inline ? "inline;" : "attachment;"));
    assert.ok(disposition.includes(`filename*=UTF-8''${encodeURIComponent("pi-session-历史会话.html")}`));
    assert.equal(response.headers.get("X-Frame-Options"), "DENY");
    const html = await response.text();
    assert.match(html, /<!DOCTYPE html>/i);
    const encoded = html.match(/<script[^>]*id="session-data"[^>]*>([\s\S]*?)<\/script>/)?.[1];
    assert.ok(encoded, "The export embeds its session data");
    const data = JSON.parse(Buffer.from(encoded.trim(), "base64").toString("utf8"));
    assert.equal(data.header.id, id);
    assert.equal(data.entries.length, entries.length);
    assert.equal(data.entries.at(-1).message.content, "历史记录 5999");
  }
  assert.equal(await readFile(file, "utf8"), original, "Export must not change the session file");
});

const source = await readFile(new URL("./[id]/export/route.ts", import.meta.url), "utf8");

test("session export uses a private per-request temp directory", () => {
  assert.match(source, /mkdtempSync\(join\(tmpdir\(\), "pi-web-export-"\)\)/);
  assert.doesNotMatch(source, /join\(tmpdir\(\), "pi-web-export"\)/);
  assert.match(source, /rmSync\(tempDir, \{ recursive: true, force: true \}\)/);
});
