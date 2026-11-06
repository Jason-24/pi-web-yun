import assert from "node:assert/strict";
import { test } from "node:test";
import { CARE_KINDS, careDay, configureCareHabit, controlCareFocus, createPetCareState, parsePetCareState, respondToCareNotice, startCareFocus, tickPetCare } from "./pet-care.ts";

const day = "2026-11-03";
const tick = (state, activeMs, extra = {}) => tickPetCare(state, { now: 100_000, day, activeMs, canDeliver: true, owner: "page", ...extra }, () => 0.5);
const enabled = (...kinds) => kinds.reduce((state, kind) => configureCareHabit(state, kind, { enabled: true, minutes: 1 }), createPetCareState());

test("reminders are opt-in and use the chosen active-time interval", () => {
  assert.equal(tick(createPetCareState(), 3_600_000).notice, null);
  let state = tick(enabled("water"), 59_000);
  assert.equal(state.notice, null);
  state = tick(state, 1000);
  assert.deepEqual(state.notice.kinds, ["water"]);
  assert.equal(state.habits.water.elapsedMs, 0);
});
test("simultaneous reminders merge and ignored notices do not keep nagging", () => {
  const delivered = tick(enabled(...CARE_KINDS), 60_000);
  assert.deepEqual(delivered.notice.kinds, CARE_KINDS);
  const expired = tick(delivered, 21_000, { now: 121_001 });
  assert.equal(expired.notice, null);
  assert.equal(tick(expired, 40_000, { now: 161_001 }).notice, null, "The cooldown prevents an immediate follow-up");
});
test("input and confirmation blocking holds one due batch, without a backlog", () => {
  const held = tick(enabled(...CARE_KINDS), 3_600_000, { canDeliver: false });
  assert.equal(held.notice, null);
  const resumed = tick(held, 0);
  assert.deepEqual(resumed.notice.kinds, CARE_KINDS);
  assert.equal(tick(resumed, 0).notice.id, resumed.notice.id);
});
test("away time does not advance reminders", () => {
  let state = tick(enabled("movement"), 30_000);
  state = tick(state, 0, { now: 6 * 3_600_000, canDeliver: false });
  assert.equal(state.habits.movement.elapsedMs, 30_000);
  assert.equal(state.notice, null);
  assert.ok(tick(state, 30_000).notice);
});
test("snooze schedules one reminder five active minutes later", () => {
  const first = tick(enabled("posture"), 60_000);
  let state = respondToCareNotice(first, first.notice.id, "snooze", day);
  state = tick(state, 299_999);
  assert.equal(state.notice, null);
  assert.deepEqual(tick(state, 1).notice.kinds, ["posture"]);
});
test("skip today survives storage and restarts from a full interval tomorrow", () => {
  const first = tick(enabled(...CARE_KINDS), 60_000);
  let state = respondToCareNotice(first, first.notice.id, "today", day);
  state = parsePetCareState(JSON.stringify(state));
  assert.equal(tick(state, 10_000_000).notice, null);
  state = tick(state, 0, { day: "2026-11-04" });
  assert.equal(state.notice, null);
  assert.deepEqual(tick(state, 60_000, { day: "2026-11-04" }).notice.kinds, CARE_KINDS);
});
test("today can be restored without affecting another reminder", () => {
  let state = enabled("water", "posture");
  state.habits.water.pausedOn = day;
  state = configureCareHabit(state, "water", { restoreToday: true });
  assert.equal(state.habits.water.pausedOn, "");
  assert.equal(state.habits.posture.enabled, true);
});
test("focus defers ordinary care, supports pause/resume, and merges the end reminder", () => {
  let state = startCareFocus(enabled("movement"), 2, 100_000);
  state = tick(state, 60_000, { now: 160_000 });
  assert.equal(state.focus.remainingMs, 60_000); assert.equal(state.notice, null);
  state = controlCareFocus(state, "pause", 160_000);
  state = tick(state, 30_000, { now: 190_000, canDeliver: false });
  assert.equal(state.focus.remainingMs, 60_000);
  state = controlCareFocus(state, "resume", 190_000);
  state = tick(state, 60_000, { now: 250_000 });
  assert.equal(state.notice.focusDone, true); assert.deepEqual(state.notice.kinds, ["movement"]);
  state = respondToCareNotice(state, state.notice.id, "ack", day);
  assert.equal(state.focus.phase, "idle"); assert.equal(state.focus.pending, false);
});
test("focus ending during a dialog waits safely, and stop creates no end celebration", () => {
  let state = tick(startCareFocus(createPetCareState(), 1, 100_000), 0, { now: 160_000, canDeliver: false });
  assert.equal(state.focus.phase, "done"); assert.equal(state.notice, null);
  state = tick(state, 0); assert.equal(state.notice.focusDone, true);
  state = controlCareFocus(startCareFocus(state, 1), "stop");
  assert.equal(tick(state, 60_000).notice, null);
});
test("focus deadline survives storage and advances without active foreground time", () => {
  let state = startCareFocus(createPetCareState(), 1, 100_000);
  state = parsePetCareState(JSON.stringify(state));
  state = tick(state, 0, { now: 130_000, canDeliver: false });
  assert.equal(state.focus.remainingMs, 30_000);
  state = tick(state, 0, { now: 200_000, canDeliver: false });
  assert.equal(state.focus.phase, "done");
  assert.equal(state.focus.pending, true);
  assert.equal(state.notice, null);
  assert.equal(tick(state, 0, { now: 201_000 }).notice.focusDone, true);
});
test("stale reminder buttons cannot dismiss a newer notice", () => {
  const state = tick(enabled("water"), 60_000);
  assert.deepEqual(respondToCareNotice(state, "old", "today", day), state);
});
test("storage parsing validates types, bounds durations, and defaults safely", () => {
  for (const raw of [null, "bad", "null", "[]"]) assert.deepEqual(parsePetCareState(raw), createPetCareState());
  const state = parsePetCareState('{"habits":{"water":{"enabled":true,"minutes":9999}},"focus":{"minutes":-4,"phase":"made-up"}}');
  assert.equal(state.habits.water.minutes, 180); assert.equal(state.focus.minutes, 1); assert.equal(state.focus.phase, "idle");
  assert.equal(careDay(new Date(2026, 10, 3, 23, 59)), day);
});
