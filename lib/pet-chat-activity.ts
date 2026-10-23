// Only lifecycle metadata crosses this bridge; chat text and token chunks stay in the chat.
export type PetChatPhase = "idle" | "sending" | "replying" | "working" | "waiting";
type PetChatResult = "complete" | "stopped" | "error";
type Snapshot = {
  owner: symbol | null;
  sessionId: string | null;
  phase: PetChatPhase;
  result: { sequence: number; kind: PetChatResult } | null;
};
const empty: Snapshot = { owner: null, sessionId: null, phase: "idle", result: null };
let snapshot = empty;
let sequence = 0;
const listeners = new Set<() => void>();
function emit(next: Snapshot) {
  snapshot = next;
  listeners.forEach((listener) => listener());
}
export const petChatActivity = {
  subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  getSnapshot: () => snapshot,
  getServerSnapshot: () => empty,
  update(owner: symbol, sessionId: string | null, phase: PetChatPhase) {
    if (snapshot.owner === owner && snapshot.sessionId === sessionId && snapshot.phase === phase) return;
    const newRun = snapshot.phase === "idle" && phase !== "idle";
    emit({ owner, sessionId, phase, result: snapshot.owner !== owner || newRun ? null : snapshot.result });
  },
  finish(owner: symbol, kind: PetChatResult) {
    if (snapshot.owner !== owner || (snapshot.result?.kind === "error" && kind === "complete")) return;
    emit({ ...snapshot, result: { sequence: ++sequence, kind } });
  },
  release(owner: symbol) { if (snapshot.owner === owner) emit(empty); },
};
