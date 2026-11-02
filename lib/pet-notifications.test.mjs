import assert from "node:assert/strict";
import { test } from "node:test";
import { createPetResultInbox, createPetResultTracker, mergePetResults, readPetResults } from "./pet-notifications.ts";

const result = (id, sessionId = id, kind = "complete", at = 1) => ({ id, sessionId, kind, at });
test("ignores history on first connection, detects short runs and never invents success", () => {
  const track = createPetResultTracker();
  assert.deepEqual(track([result("old")], null), []);
  const fresh = [result("old"), result("failed", "other", "error"), result("stop", "third", "stopped"), result("selected", "current")];
  assert.deepEqual(track(fresh, "current"), fresh.slice(1, 3));
  assert.deepEqual(track(fresh, null), []);
});
test("keeps the latest outcome per conversation and bounds unread results", () => {
  const outcomes = mergePetResults([result("before", "same")], [result("after", "same", "error", 2)]);
  assert.equal(outcomes.length, 1); assert.equal(outcomes[0].kind, "error");
  const many = mergePetResults([], Array.from({ length: 30 }, (_, i) => result(`${i}`, `${i}`, "complete", i)));
  assert.equal(many.length, 12); assert.equal(many[0].id, "29");
});
test("rejects malformed result metadata", () => {
  assert.deepEqual(readPetResults([null, {}, result("x", "y", "unknown"), result("x", "y", "error", Infinity)]), []);
  assert.deepEqual(readPetResults([result("ok")]), [result("ok")]);
});

test("an inbox survives subscriber remounts, clears read/restarted sessions and keeps snapshots stable", () => {
  const inbox = createPetResultInbox();
  inbox.reconcile([], null, []);
  inbox.reconcile([result("a"), result("b")], null, []);
  const snapshot = inbox.getSnapshot();
  const unsubscribe = inbox.subscribe(() => {}); unsubscribe(); inbox.subscribe(() => {});
  inbox.reconcile([result("a"), result("b")], null, []);
  assert.equal(inbox.getSnapshot(), snapshot);
  inbox.reconcile([result("a"), result("b")], null, ["b"]);
  assert.deepEqual(inbox.getSnapshot().map((result) => result.sessionId), ["a"]);
  inbox.dismiss("a");
  inbox.reconcile([result("a"), result("b")], null, []);
  assert.deepEqual(inbox.getSnapshot(), []);
});
