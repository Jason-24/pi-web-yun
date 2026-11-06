export const PET_CARE_KEY = "pi-yun-pet-care-v1";
export const CARE_KINDS = ["movement", "water", "posture"] as const;
export type CareKind = typeof CARE_KINDS[number];
export type CareNotice = { id: string; owner: string; kinds: CareKind[]; focusDone: boolean; expiresAt: number; variant: number };
type Habit = { enabled: boolean; minutes: number; elapsedMs: number; targetMs: number; pausedOn: string };
export type PetCareState = {
  habits: Record<CareKind, Habit>;
  focus: { minutes: number; remainingMs: number; phase: "idle" | "running" | "paused" | "done"; pending: boolean; snoozeMs: number; endsAt?: number; notified?: boolean };
  notice: CareNotice | null;
  cooldownMs: number;
  day: string;
  leaseOwner: string;
  leaseUntil: number;
};
const MINUTE = 60_000;
const defaults: Record<CareKind, number> = { movement: 60, water: 45, posture: 30 };
const bounded = (value: unknown, fallback: number, min: number, max: number) =>
  typeof value === "number" && Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
export const careMinutes = (value: unknown, fallback: number, max = 180) => Math.round(bounded(value, fallback, 1, max));
export function careDay(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
export function createPetCareState(): PetCareState {
  return {
    habits: Object.fromEntries(CARE_KINDS.map((kind) => [kind, { enabled: false, minutes: defaults[kind], elapsedMs: 0, targetMs: defaults[kind] * MINUTE, pausedOn: "" }])) as PetCareState["habits"],
    focus: { minutes: 25, remainingMs: 0, phase: "idle", pending: false, snoozeMs: 0 },
    notice: null, cooldownMs: 0, day: "", leaseOwner: "", leaseUntil: 0,
  };
}
export function parsePetCareState(raw: string | null): PetCareState {
  const state = createPetCareState();
  try {
    const value = JSON.parse(raw ?? "null");
    for (const kind of CARE_KINDS) {
      const habit = value?.habits?.[kind];
      if (!habit || typeof habit !== "object") continue;
      const minutes = careMinutes(habit.minutes, defaults[kind]);
      state.habits[kind] = { enabled: habit.enabled === true, minutes,
        elapsedMs: bounded(habit.elapsedMs, 0, 0, 190 * MINUTE),
        targetMs: bounded(habit.targetMs, minutes * MINUTE, MINUTE / 2, 190 * MINUTE),
        pausedOn: typeof habit.pausedOn === "string" ? habit.pausedOn.slice(0, 10) : "" };
    }
    const focus = value?.focus;
    if (focus && typeof focus === "object") state.focus = {
      minutes: careMinutes(focus.minutes, 25, 120), remainingMs: bounded(focus.remainingMs, 0, 0, 120 * MINUTE),
      phase: ["idle", "running", "paused", "done"].includes(focus.phase) ? focus.phase : "idle",
      pending: focus.pending === true, snoozeMs: bounded(focus.snoozeMs, 0, 0, 5 * MINUTE),
      endsAt: bounded(focus.endsAt, 0, 0, Number.MAX_SAFE_INTEGER), notified: focus.notified === true,
    };
    state.day = typeof value?.day === "string" ? value.day.slice(0, 10) : "";
    state.cooldownMs = bounded(value?.cooldownMs, 0, 0, 2 * MINUTE);
    state.leaseOwner = typeof value?.leaseOwner === "string" ? value.leaseOwner : "";
    state.leaseUntil = bounded(value?.leaseUntil, 0, 0, Number.MAX_SAFE_INTEGER);
    const notice = value?.notice;
    if (notice && typeof notice.id === "string" && typeof notice.owner === "string" && Array.isArray(notice.kinds)
      && typeof notice.expiresAt === "number" && Number.isFinite(notice.expiresAt)) {
      const kinds = [...new Set<CareKind>(notice.kinds.filter((kind: unknown) => CARE_KINDS.includes(kind as CareKind)))];
      if (kinds.length || notice.focusDone === true) state.notice = { id: notice.id, owner: notice.owner, kinds,
        focusDone: notice.focusDone === true, expiresAt: notice.expiresAt, variant: Math.round(bounded(notice.variant, 0, 0, 2)) };
    }
  } catch { /* Corrupt or unavailable storage starts with opt-in defaults. */ }
  return state;
}
export function copyCareState(state: PetCareState): PetCareState {
  return { ...state, habits: Object.fromEntries(CARE_KINDS.map((kind) => [kind, { ...state.habits[kind] }])) as PetCareState["habits"], focus: { ...state.focus }, notice: state.notice ? { ...state.notice, kinds: [...state.notice.kinds] } : null };
}
export function configureCareHabit(state: PetCareState, kind: CareKind, patch: { enabled?: boolean; minutes?: number; restoreToday?: boolean }): PetCareState {
  const next = copyCareState(state), habit = next.habits[kind];
  if (patch.enabled !== undefined) habit.enabled = patch.enabled;
  if (patch.minutes !== undefined) habit.minutes = careMinutes(patch.minutes, habit.minutes);
  if (patch.restoreToday || patch.enabled === true) habit.pausedOn = "";
  habit.elapsedMs = 0; habit.targetMs = habit.minutes * MINUTE;
  if (next.notice?.kinds.includes(kind)) {
    next.notice.kinds = next.notice.kinds.filter((item) => item !== kind);
    if (!next.notice.kinds.length && !next.notice.focusDone) next.notice = null;
  }
  return next;
}
export function startCareFocus(state: PetCareState, minutes = state.focus.minutes, now = Date.now()): PetCareState {
  const next = copyCareState(state), duration = careMinutes(minutes, state.focus.minutes, 120);
  next.focus = { minutes: duration, remainingMs: duration * MINUTE, phase: "running", pending: false, snoozeMs: 0, endsAt: now + duration * MINUTE, notified: false };
  next.notice = null;
  return next;
}
export function controlCareFocus(state: PetCareState, action: "pause" | "resume" | "stop", now = Date.now()): PetCareState {
  const next = copyCareState(state);
  if (action === "pause" && next.focus.phase === "running") {
    next.focus.remainingMs = next.focus.endsAt ? Math.max(0, next.focus.endsAt - now) : next.focus.remainingMs;
    if (next.focus.remainingMs === 0) { next.focus.phase = "done"; next.focus.pending = true; }
    else next.focus.phase = "paused";
    next.focus.endsAt = 0;
  }
  if (action === "resume" && next.focus.phase === "paused") { next.focus.phase = "running"; next.focus.endsAt = now + next.focus.remainingMs; }
  if (action === "stop") { next.focus = { ...next.focus, remainingMs: 0, phase: "idle", pending: false, snoozeMs: 0, endsAt: 0 }; next.notice = null; }
  return next;
}
/** Habits use active time; focus uses its wall-clock deadline. */
export function tickPetCare(state: PetCareState, options: { now: number; day: string; activeMs: number; canDeliver: boolean; owner: string }, random = Math.random): PetCareState {
  const next = copyCareState(state), delta = Math.max(0, options.activeMs);
  if (next.day !== options.day) {
    for (const kind of CARE_KINDS) if (next.habits[kind].pausedOn) {
      next.habits[kind].elapsedMs = 0; next.habits[kind].targetMs = next.habits[kind].minutes * MINUTE;
      next.habits[kind].pausedOn = "";
    }
    next.day = options.day;
    next.cooldownMs = 0;
  }
  if (next.notice && next.notice.expiresAt <= options.now) next.notice = null;
  next.cooldownMs = Math.max(0, next.cooldownMs - delta);
  for (const kind of CARE_KINDS) {
    const habit = next.habits[kind];
    if (habit.enabled && habit.pausedOn !== options.day) habit.elapsedMs = Math.min(habit.targetMs, habit.elapsedMs + delta);
  }
  if (next.focus.phase === "running") {
    if (!next.focus.endsAt) next.focus.endsAt = options.now + next.focus.remainingMs;
    next.focus.remainingMs = Math.max(0, next.focus.endsAt - options.now);
    if (!next.focus.remainingMs) { next.focus.phase = "done"; next.focus.pending = true; }
  }
  next.focus.snoozeMs = Math.max(0, next.focus.snoozeMs - delta);
  if (!options.canDeliver || next.focus.phase === "running" || next.notice) return next;
  const focusDone = next.focus.pending && !next.focus.snoozeMs;
  const due = CARE_KINDS.filter((kind) => {
    const habit = next.habits[kind];
    return habit.enabled && habit.pausedOn !== options.day && habit.elapsedMs >= habit.targetMs;
  });
  if ((!due.length || next.cooldownMs > 0) && !focusDone) return next;
  // Merge nearby due habits, so reminders do not arrive one after another.
  const kinds = CARE_KINDS.filter((kind) => {
    const habit = next.habits[kind];
    return habit.enabled && habit.pausedOn !== options.day && habit.targetMs - habit.elapsedMs <= 10_000;
  });
  for (const kind of kinds) {
    const habit = next.habits[kind];
    habit.elapsedMs = 0; habit.targetMs = habit.minutes * MINUTE * (0.95 + random() * 0.1);
  }
  if (focusDone) next.focus.pending = false;
  next.notice = { id: `${options.owner}:${options.now}`, owner: options.owner, kinds, focusDone, expiresAt: options.now + 20_000, variant: Math.min(2, Math.floor(random() * 3)) };
  next.cooldownMs = 2 * MINUTE;
  return next;
}
export function respondToCareNotice(state: PetCareState, noticeId: string, action: "ack" | "snooze" | "today", day: string): PetCareState {
  const next = copyCareState(state), notice = next.notice;
  if (!notice || notice.id !== noticeId) return next;
  for (const kind of notice.kinds) {
    const habit = next.habits[kind];
    habit.elapsedMs = 0;
    if (action === "today") habit.pausedOn = day;
    habit.targetMs = action === "snooze" ? 5 * MINUTE : habit.minutes * MINUTE;
  }
  if (notice.focusDone) {
    next.focus.pending = action === "snooze";
    next.focus.snoozeMs = action === "snooze" ? 5 * MINUTE : 0;
    if (action !== "snooze") next.focus.phase = "idle";
  }
  next.notice = null;
  return next;
}
