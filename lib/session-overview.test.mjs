import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url);
const { collectOverviewSources, readOverviewImage, sameOverviewDirectory } = await jiti.import("./session-overview.ts");

const entry = (id, content, role = "user") => ({ type: "message", id, parentId: null, message: { role, content } });
const image = { type: "image", data: "aGVsbG8=", mimeType: "image/png" };

test("sources are user images and explicit local references, deduplicated by resolved path", () => {
  const list = collectOverviewSources([
    entry("first", [image, { type: "text", text: '@"brief notes.pdf" @src/a.ts:12-20 @folder/ [brief](brief%20notes.pdf) [external](https://example.com/file.pdf)' }]),
    entry("tool", [{ type: "text", text: "@secret.txt" }, image], "toolResult"),
    entry("last", '@src/A.ts @https://example.com/a.pdf [directory](./folder/)'),
  ], "C:/Project");
  assert.equal(list.total, 3);
  assert.deepEqual(list.sources.filter(s => s.kind === "file").map(s => s.path), ["C:/Project/src/A.ts", "C:/Project/brief notes.pdf"]);
  assert.deepEqual(list.sources.at(-1), { kind: "image", id: "first:0", entryId: "first", blockIndex: 0, number: 1 });
  assert.equal(JSON.stringify(list).includes(image.data), false, "metadata never embeds image bytes");
});

test("expanded skill instructions, remote images and unsupported image formats are excluded", () => {
  const text = '<skill name="writing" location="/skills/writing/SKILL.md">\nReferences are relative to /skills/writing.\n\nRead @internal.md\n</skill>\n\nUse @request.txt';
  const list = collectOverviewSources([entry("u", [{ type: "text", text }, { type: "image", source: { type: "url", url: "https://example.com/pixel.png" } }, { ...image, mimeType: "image/svg+xml" }])], "/project");
  assert.deepEqual(list.sources.map(s => s.path), ["/project/request.txt"]);
  assert.equal(readOverviewImage({ type: "image", source: { type: "base64", data: image.data, media_type: "image/png" } }).data, image.data);
});

test("source metadata is bounded and terminal matching respects Windows and POSIX casing", () => {
  const list = collectOverviewSources([entry("u", Array.from({ length: 210 }, (_, i) => `@file-${i}.txt`).join(" "))], "/project");
  assert.equal(list.total, 210);
  assert.equal(list.sources.length, 200);
  assert.equal(list.sources[0].name, "file-209.txt");
  assert.equal(sameOverviewDirectory("C:\\Project\\", "c:/project"), true);
  assert.equal(sameOverviewDirectory("/Project", "/project"), false);
});
