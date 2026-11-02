import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { createJiti } from "jiti";
const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");
const { agentRunResults } = await jiti.import("./agent-run-results.ts");

function createWrapper(t, options = {}) {
  let listener;
  const inner = { sessionId: randomUUID(), isStreaming: false, isCompacting: false, isBashRunning: false,
    agent: { state: {} }, sessionManager: { getCwd: () => process.cwd(), getSessionName: () => "fixture" },
    subscribe: (fn) => { listener = fn; return () => {}; }, dispose() {} };
  const wrapper = new AgentSessionWrapper(inner, options);
  wrapper.start(); t.after(() => wrapper.destroy());
  return { emit: (event) => listener(event), results: () => agentRunResults.read().filter((result) => result.sessionId === inner.sessionId) };
}
test("the real wrapper distinguishes failure, stopped turns and successful retries", (t) => {
  const fixture = createWrapper(t);
  fixture.emit({ type: "agent_start" });
  fixture.emit({ type: "message_end", message: { role: "assistant", stopReason: "error" } });
  fixture.emit({ type: "agent_settled" });
  fixture.emit({ type: "agent_settled" });
  assert.deepEqual(fixture.results().map((result) => result.kind), ["error"]);
  fixture.emit({ type: "agent_start" });
  fixture.emit({ type: "message_end", message: { role: "assistant", stopReason: "error" } });
  fixture.emit({ type: "message_end", message: { role: "assistant", stopReason: "stop" } });
  fixture.emit({ type: "agent_settled" });
  fixture.emit({ type: "agent_start" }); fixture.emit({ type: "agent_settled", aborted: true });
  assert.deepEqual(fixture.results().map((result) => result.kind), ["error", "complete", "stopped"]);
});
test("hidden child sessions and non-run commands create no pet result", (t) => {
  const hidden = createWrapper(t, { suppressCompletionNotifications: true });
  hidden.emit({ type: "agent_start" }); hidden.emit({ type: "agent_settled" });
  assert.deepEqual(hidden.results(), []);
  const idle = createWrapper(t); idle.emit({ type: "agent_settled" });
  assert.deepEqual(idle.results(), []);
});
