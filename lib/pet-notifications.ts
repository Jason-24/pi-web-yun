import type { AgentRunResult } from "./agent-run-results";

export type PetResult = AgentRunResult;
export const PET_MAX_RESULTS = 12;

export function readPetResults(value: unknown): PetResult[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is PetResult => item !== null && typeof item === "object"
    && typeof item.id === "string" && typeof item.sessionId === "string"
    && (item.kind === "complete" || item.kind === "error" || item.kind === "stopped")
    && typeof item.at === "number" && Number.isFinite(item.at));
}

export function createPetResultTracker() {
  let initial = true;
  const seen = new Set<string>();
  return (results: readonly PetResult[], activeSessionId: string | null) => {
    const fresh = initial ? [] : results.filter((result) => !seen.has(result.id) && result.sessionId !== activeSessionId);
    initial = false;
    for (const result of results) seen.add(result.id);
    while (seen.size > 256) seen.delete(seen.values().next().value!);
    return fresh;
  };
}

export function mergePetResults(current: readonly PetResult[], fresh: readonly PetResult[]) {
  const bySession = new Map(current.map((result) => [result.sessionId, result]));
  for (const result of fresh) { bySession.delete(result.sessionId); bySession.set(result.sessionId, result); }
  return [...bySession.values()].reverse().sort((a, b) => b.at - a.at).slice(0, PET_MAX_RESULTS);
}

export function createPetResultInbox() {
  const empty: readonly PetResult[] = [];
  let snapshot = empty;
  const track = createPetResultTracker();
  const listeners = new Set<() => void>();
  const publish = (next: readonly PetResult[]) => {
    if (next.length === snapshot.length && next.every((result, index) => result.id === snapshot[index].id)) return;
    snapshot = next; listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => empty,
    reconcile(results: readonly PetResult[], active: string | null, running: readonly string[]) {
      const fresh = track(results, active);
      // No reordering of an unchanged inbox, especially for equal timestamps.
      const merged = fresh.length ? mergePetResults(snapshot, fresh) : snapshot;
      publish(merged.filter((result) => result.sessionId !== active && !running.includes(result.sessionId)));
    },
    dismiss(sessionId: string) { publish(snapshot.filter((result) => result.sessionId !== sessionId)); },
  };
}

// Page lifetime: the rail moves between parents at the mobile breakpoint.
export const petResultInbox = createPetResultInbox();
