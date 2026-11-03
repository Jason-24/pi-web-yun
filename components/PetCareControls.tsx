"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { CARE_KINDS, careDay, careMinutes, type CareKind, type PetCareState } from "@/lib/pet-care";
import styles from "./PetWidget.module.css";

function HabitControl({ kind, state, onChange }: { kind: CareKind; state: PetCareState; onChange(patch: { enabled?: boolean; minutes?: number; restoreToday?: boolean }): void }) {
  const { t } = useI18n();
  const habit = state.habits[kind];
  const [minutes, setMinutes] = useState(String(habit.minutes));
  useEffect(() => setMinutes(String(habit.minutes)), [habit.minutes]);
  const paused = habit.pausedOn === careDay();
  return <div className={styles.careHabit}>
    <label className={styles.careHabitName} htmlFor={`pet-care-${kind}`}>{t(`pet.care.${kind}`)}</label>
    <label className={styles.careInterval}><input type="number" inputMode="numeric" min="1" max="180" value={minutes} aria-label={t("pet.care.intervalLabel", { habit: t(`pet.care.${kind}`) })}
      onChange={(event) => {
        const raw = event.target.value, value = Number(raw); setMinutes(raw);
        if (raw.trim() && Number.isInteger(value) && value >= 1 && value <= 180 && value !== habit.minutes) onChange({ minutes: value });
      }} onBlur={() => { const value = careMinutes(minutes.trim() ? Number(minutes) : NaN, habit.minutes); setMinutes(String(value)); if (value !== habit.minutes) onChange({ minutes: value }); }}
      onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />{t("pet.care.minutes")}</label>
    <label className={styles.careToggle}>
      <input id={`pet-care-${kind}`} type="checkbox" aria-label={t(`pet.care.${kind}`)} checked={habit.enabled} onChange={(event) => onChange({ enabled: event.target.checked })} />
      <span aria-hidden="true" />
    </label>
    {paused && <button type="button" className={styles.careRestore} onClick={() => onChange({ restoreToday: true })}>{t("pet.care.restoreToday")}</button>}
  </div>;
}

export function PetCareControls({ state, configure, startFocus, controlFocus }: {
  state: PetCareState;
  configure(kind: CareKind, patch: { enabled?: boolean; minutes?: number; restoreToday?: boolean }): void;
  startFocus(minutes: number): void; controlFocus(action: "pause" | "resume" | "stop"): void;
}) {
  const { t } = useI18n();
  const [minutes, setMinutes] = useState(String(state.focus.minutes));
  useEffect(() => setMinutes(String(state.focus.minutes)), [state.focus.minutes]);
  const seconds = Math.max(0, Math.ceil(state.focus.remainingMs / 1000));
  const timing = state.focus.phase === "running" || state.focus.phase === "paused";
  return <div className={styles.careControls}>
    <div className={styles.careHabits}>{CARE_KINDS.map((kind) => <HabitControl key={kind} kind={kind} state={state} onChange={(patch) => configure(kind, patch)} />)}</div>
    <section className={styles.careFocus} aria-label={t("pet.care.focus")}>
      <div className={styles.careFocusHeader}><strong>{t("pet.care.focus")}</strong>
        {timing && <div className={styles.careClock} role="timer" aria-live="off" aria-label={t("pet.care.remaining")}>{String(Math.floor(seconds / 60)).padStart(2, "0")}:{String(seconds % 60).padStart(2, "0")}</div>}
      </div>
      {timing ? <>
        <div className={styles.careButtons}>
          <button type="button" onClick={() => controlFocus(state.focus.phase === "paused" ? "resume" : "pause")}>{t(state.focus.phase === "paused" ? "pet.care.resume" : "pet.care.pause")}</button>
          <button type="button" onClick={() => controlFocus("stop")}>{t("pet.care.end")}</button>
        </div>
      </> : <div className={styles.careFocusStart}>
        <label className={styles.careInterval}><input type="number" inputMode="numeric" min="1" max="120" value={minutes} aria-label={t("pet.care.focusDuration")} onChange={(event) => setMinutes(event.target.value)} />{t("pet.care.minutes")}</label>
        <button type="button" onClick={() => { const value = careMinutes(minutes.trim() ? Number(minutes) : NaN, 25, 120); setMinutes(String(value)); startFocus(value); }}>{t("pet.care.start")}</button>
      </div>}
    </section>
    <details className={styles.careHelp}><summary>{t("pet.care.help")}</summary><p>{t("pet.care.timingHint")}</p></details>
  </div>;
}
