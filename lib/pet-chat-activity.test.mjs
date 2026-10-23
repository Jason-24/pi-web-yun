import assert from "node:assert/strict";
import { test } from "node:test";
import { petChatActivity as activity } from "./pet-chat-activity.ts";

test("chat activity follows short runs without a polling interval", () => {
  const owner = Symbol();
  const phases = [];
  const unsubscribe = activity.subscribe(() => phases.push(activity.getSnapshot().phase));
  activity.update(owner, "session", "sending");
  activity.update(owner, "session", "replying");
  activity.finish(owner, "complete");
  activity.update(owner, "session", "idle");
  assert.deepEqual(phases, ["sending", "replying", "replying", "idle"]);
  assert.equal(activity.getSnapshot().result.kind, "complete");
  unsubscribe(); activity.release(owner);
});

test("a previous chat cannot clear or finish its replacement", () => {
  const first = Symbol(), second = Symbol();
  activity.update(first, "one", "replying");
  activity.update(second, "two", "waiting");
  activity.release(first); activity.finish(first, "complete");
  assert.equal(activity.getSnapshot().sessionId, "two");
  assert.equal(activity.getSnapshot().phase, "waiting");
  assert.equal(activity.getSnapshot().result, null);
  activity.release(second);
});

test("failure and stopping are distinct from success; a new run clears old results", () => {
  const owner = Symbol();
  activity.update(owner, "session", "sending");
  activity.finish(owner, "error");
  activity.finish(owner, "complete");
  assert.equal(activity.getSnapshot().result.kind, "error");
  activity.update(owner, "session", "idle");
  activity.update(owner, "session", "sending");
  assert.equal(activity.getSnapshot().result, null);
  activity.finish(owner, "stopped");
  activity.update(owner, "session", "idle");
  assert.equal(activity.getSnapshot().result.kind, "stopped");
  activity.release(owner);
});
