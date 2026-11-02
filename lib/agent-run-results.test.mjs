import assert from "node:assert/strict";
import { test } from "node:test";
import { createAgentRunResults } from "./agent-run-results.ts";

test("retains separate actual outcomes, with no transcript data", () => {
  const store = createAgentRunResults();
  for (const kind of ["complete", "error", "stopped"]) store.record("session", kind, 100);
  const records = store.read(100);
  assert.deepEqual(records.map((item) => item.kind), ["complete", "error", "stopped"]);
  assert.equal(new Set(records.map((item) => item.id)).size, 3);
  assert.deepEqual(Object.keys(records[0]).sort(), ["at", "id", "kind", "sessionId"]);
});
test("bounds history and prunes old metadata without timers", () => {
  const store = createAgentRunResults();
  for (let i = 0; i < 200; i++) store.record(`${i}`, "complete", i);
  assert.equal(store.read(200).length, 128);
  assert.deepEqual(store.read(31 * 60_000), []);
});
