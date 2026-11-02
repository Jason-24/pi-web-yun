import assert from "node:assert/strict";
import test from "node:test";
import { CLIPBOARD_FAILURE_EVENT, copyText } from "./clipboard.ts";

function environment(t, clipboard, copyResult) {
  const original = new Map(["navigator", "window", "document"].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const events = [];
  const textarea = { value: "", style: {}, selected: false, removed: false, select() { this.selected = true; }, remove() { this.removed = true; } };
  Object.defineProperty(globalThis, "navigator", { configurable: true, value: { clipboard } });
  Object.defineProperty(globalThis, "window", { configurable: true, value: { dispatchEvent(event) { events.push(event); } } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    createElement() { return textarea; }, body: { appendChild() {} },
    execCommand() { if (copyResult instanceof Error) throw copyResult; return copyResult; },
  } });
  t.after(() => { for (const [key, descriptor] of original) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return { events, textarea };
}

test("uses the clipboard API and reports only confirmed success", async (t) => {
  let copied;
  const { events } = environment(t, { writeText: async (text) => { copied = text; } });
  await copyText("hello");
  assert.equal(copied, "hello");
  assert.equal(events.length, 0);
});

test("reports API refusal without leaking copied content", async (t) => {
  const { events } = environment(t, { writeText: async () => { throw new Error("denied"); } });
  await assert.rejects(copyText("private text"), /denied/);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, CLIPBOARD_FAILURE_EVENT);
  assert.equal(events[0].detail, undefined);
});

test("legacy copy detects a false result and always removes its temporary field", async (t) => {
  const { events, textarea } = environment(t, undefined, false);
  await assert.rejects(copyText("hello"), /Clipboard copy failed/);
  assert.equal(textarea.selected, true);
  assert.equal(textarea.removed, true);
  assert.equal(events.length, 1);
});

test("legacy copy cleans up after a thrown error", async (t) => {
  const failed = environment(t, undefined, new Error("copy error"));
  await assert.rejects(copyText("hello"), /copy error/);
  assert.equal(failed.textarea.removed, true);
});

test("legacy copy accepts a confirmed success", async (t) => {
  const { events, textarea } = environment(t, undefined, true);
  await copyText("hello");
  assert.equal(textarea.removed, true);
  assert.equal(events.length, 0);
});
