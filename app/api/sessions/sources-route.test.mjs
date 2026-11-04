import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { alias: { "@": process.cwd() }, interopDefault: true });
const { GET } = await jiti.import("./[id]/sources/route.ts");
const { cacheSessionPath, invalidateSessionPathCache } = await jiti.import("../../../lib/session-reader.ts");
const { getRpcSession } = await jiti.import("../../../lib/rpc-manager.ts");
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("source reads follow only the selected branch and never create an agent; images are fetched separately", async t => {
  const dir = await mkdtemp(join(tmpdir(), "pi-web-sources-"));
  const id = "ab100000-0000-4000-8000-000000000001";
  const file = join(dir, `${id}.jsonl`);
  const timestamp = "2026-11-04T00:00:00Z";
  const message = (id, parentId, content, role = "user") => ({ type: "message", id, parentId, timestamp, message: { role, content } });
  const lines = [
    { type: "session", version: 3, id, timestamp, cwd: dir },
    message("u1", null, [{ type: "text", text: "@brief.pdf" }, { type: "image", data: PNG, mimeType: "image/png" }]),
    message("old", "u1", "@other-branch.txt"),
    message("leaf", "u1", "@current.txt"),
    message("bad", "u1", [{ type: "image", data: "====", mimeType: "image/png" }]),
    message("svg", "u1", [{ type: "image", data: PNG, mimeType: "image/svg+xml" }]),
  ];
  const original = lines.map(x => JSON.stringify(x)).join("\n") + "\n";
  await writeFile(file, original);
  cacheSessionPath(id, file);
  t.after(async () => { invalidateSessionPathCache(id); await rm(dir, { recursive: true, force: true }); });
  const read = query => GET(new Request(`http://localhost/api/sessions/${id}/sources${query}`), { params: Promise.resolve({ id }) });
  const response = await read("?leafId=leaf");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  const body = await response.json();
  assert.equal(body.total, 3);
  assert.equal(JSON.stringify(body).includes("other-branch"), false);
  assert.equal(JSON.stringify(body).includes(PNG), false);
  const image = await read("?leafId=leaf&image=u1:1");
  assert.equal(image.headers.get("Content-Type"), "image/png");
  assert.equal(image.headers.get("X-Content-Type-Options"), "nosniff");
  assert.deepEqual(Buffer.from(await image.arrayBuffer()), Buffer.from(PNG, "base64"));
  for (const [query, status] of [["?image=../../other:1", 400], ["?image=u1:0", 404], ["?leafId=missing", 404], ["?leafId=old&image=leaf:0", 404], ["?leafId=bad&image=bad:0", 413], ["?leafId=svg&image=svg:0", 404]]) {
    assert.equal((await read(query)).status, status, query);
  }
  assert.equal(getRpcSession(id), undefined, "browsing sources never starts the wrapper");
  assert.equal((await GET(new Request("http://localhost/api/sessions/bad/sources"), { params: Promise.resolve({ id: "bad" }) })).status, 400);
  const { readFile } = await import("node:fs/promises");
  assert.equal(await readFile(file, "utf8"), original);
});
