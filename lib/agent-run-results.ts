import { randomUUID } from "node:crypto";

export type AgentRunResult = { id: string; sessionId: string; kind: "complete" | "error" | "stopped"; at: number };
const MAX_RESULTS = 128;
const MAX_AGE_MS = 30 * 60_000;

// Display metadata only. No text, session files, additional sessions or timers.
export function createAgentRunResults() {
  const results = new Map<string, AgentRunResult>();
  const read = (now = Date.now()) => {
    for (const [id, result] of results) if (now - result.at > MAX_AGE_MS) results.delete(id);
    return [...results.values()];
  };
  return {
    read,
    record(sessionId: string, kind: AgentRunResult["kind"], now = Date.now()) {
      read(now);
      const result = { id: randomUUID(), sessionId, kind, at: now };
      results.set(result.id, result);
      while (results.size > MAX_RESULTS) results.delete(results.keys().next().value!);
      return result;
    },
  };
}

const shared = globalThis as typeof globalThis & { __piAgentRunResults?: ReturnType<typeof createAgentRunResults> };
export const agentRunResults = shared.__piAgentRunResults ??= createAgentRunResults();
