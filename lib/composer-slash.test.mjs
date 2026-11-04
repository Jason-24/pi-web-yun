import assert from "node:assert/strict";
import test from "node:test";
import { extractComposerSlashQuery, completeComposerSlash } from "./composer-slash.ts";

const skill = { name: "skill:writing", source: "skill" };

test("slash searches at the caret after prose, a newline or Chinese without a space", () => {
  for (const prefix of ["", " ", "Please polish this ", "请润色这段话", "请润色：", "第一段\n"]) {
    const text = prefix + "/Wri";
    assert.deepEqual(extractComposerSlashQuery(text), {
      start: prefix.length, end: text.length, query: "wri", inline: Boolean(prefix.trim()),
    });
  }
});

test("URLs, paths, shell commands and selected text do not open slash completion", () => {
  for (const text of ["https://example.com/", "https://example.com/中文/", "Look at ./src/", "Look at C:/src/", "Open foo/bar", "Open /src/file", "Open ~/", "Open \\server\\share/", "!cat /", "  !!echo /"]) {
    assert.equal(extractComposerSlashQuery(text), null, text);
  }
  assert.equal(extractComposerSlashQuery("请用 /wri", 5, 7), null);
  assert.equal(extractComposerSlashQuery("Read /src/file", 7), null);
  assert.equal(extractComposerSlashQuery("请用 /SKILL:writing").query, "skill:writing");
});

test("inline skill completion keeps both sides of a draft and makes the SDK directive first", () => {
  const text = "第一段\n请润色 /wri 保留结尾";
  const caret = text.indexOf(" 保留");
  const completion = completeComposerSlash(text, extractComposerSlashQuery(text, caret), skill);
  assert.equal(completion.text, "/skill:writing 第一段\n请润色  保留结尾");
  assert.equal(completion.text.slice(completion.cursor), " 保留结尾");
  assert.equal(completeComposerSlash("帮我/", extractComposerSlashQuery("帮我/"), skill).text, "/skill:writing 帮我");
  for (const source of ["builtin", "extension", "prompt"]) {
    assert.equal(completeComposerSlash(text, extractComposerSlashQuery(text, caret), { name: "reload", source }), null);
  }
});

test("completion inside a token replaces its tail while retaining the request", () => {
  const text = "/skill:old-name existing request";
  const token = extractComposerSlashQuery(text, 9);
  assert.equal(token.query, "skill:ol");
  const completion = completeComposerSlash(text, token, skill);
  assert.equal(completion.text, "/skill:writing  existing request");
  assert.equal(completion.cursor, "/skill:writing ".length);
  const builtin = completeComposerSlash("/co", extractComposerSlashQuery("/co"), { name: "compact", source: "builtin" });
  assert.equal(builtin.text, "/compact ");
});
