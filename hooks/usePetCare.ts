"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CARE_KINDS, PET_CARE_KEY, careDay, configureCareHabit, controlCareFocus, createPetCareState,
  parsePetCareState, respondToCareNotice, startCareFocus, tickPetCare, type CareKind, type PetCareState } from "@/lib/pet-care";
import { showBrowserNotification } from "@/lib/browser-notifications";
import { useI18n } from "@/hooks/useI18n";

function viewKey(state: PetCareState) {
  return JSON.stringify([CARE_KINDS.map((kind) => {
    const habit = state.habits[kind];
    return [habit.enabled, habit.minutes, habit.pausedOn, Math.ceil(Math.max(0, habit.targetMs - habit.elapsedMs) / 1000)];
  }), state.focus.phase, state.focus.minutes, Math.ceil(state.focus.remainingMs / 1000), state.notice?.id, state.notice?.expiresAt, state.day]);
}
const editable = (target: EventTarget | null) => target instanceof Element && !!target.closest('input, textarea, [contenteditable="true"]');

export function usePetCare(visible: boolean, blocked: boolean) {
  const { t } = useI18n();
  const [state, setState] = useState(createPetCareState);
  const [noticeAllowed, setNoticeAllowed] = useState(false);
  const stateRef = useRef(state);
  const blockedRef = useRef(blocked); blockedRef.current = blocked;
  const ownerRef = useRef("");
  const lastTickRef = useRef(0);
  const lastActivityRef = useRef(0);
  const lastTypingRef = useRef(0);
  const composingRef = useRef(false);

  const read = useCallback(() => {
    try { const raw = localStorage.getItem(PET_CARE_KEY); if (raw !== null) return parsePetCareState(raw); } catch { /* Page memory works without storage. */ }
    return stateRef.current;
  }, []);
  const publish = useCallback((next: PetCareState, persist: boolean) => {
    stateRef.current = next;
    if (persist) try { localStorage.setItem(PET_CARE_KEY, JSON.stringify(next)); } catch { /* Keep page memory. */ }
    setState((current) => viewKey(current) === viewKey(next) ? current : next);
  }, []);
  const change = useCallback((update: (current: PetCareState) => PetCareState) => {
    const now = Date.now();
    lastActivityRef.current = now; lastTickRef.current = now;
    const next = update(read());
    next.leaseOwner = ownerRef.current; next.leaseUntil = now + 3000;
    publish(next, true);
  }, [publish, read]);

  useEffect(() => {
    ownerRef.current ||= globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    publish(read(), false);
    const sync = (event: StorageEvent) => {
      if (event.key === PET_CARE_KEY || event.key === null) publish(event.newValue === null ? createPetCareState() : read(), false);
    };
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [publish, read]);

  useEffect(() => {
    if (!visible) return;
    lastTickRef.current = Date.now(); lastActivityRef.current = Date.now();
    const activity = () => { lastActivityRef.current = Date.now(); };
    const typing = (event: Event) => { activity(); if (editable(event.target)) lastTypingRef.current = Date.now(); };
    const compositionStart = () => { composingRef.current = true; activity(); };
    const compositionEnd = () => { composingRef.current = false; lastTypingRef.current = Date.now(); activity(); };
    const release = () => {
      lastTickRef.current = Date.now();
      const current = read();
      if (current.leaseOwner === ownerRef.current) publish({ ...current, leaseOwner: "", leaseUntil: 0 }, true);
      setNoticeAllowed(false);
    };
    const visibility = () => {
      lastTickRef.current = Date.now();
      if (document.hidden) release(); else activity();
    };
    const tick = () => {
      const now = Date.now(), previousTick = lastTickRef.current;
      lastTickRef.current = now;
      const active = !document.hidden && document.hasFocus() && now - lastActivityRef.current < 5 * 60_000;
      const hasDialog = [...document.querySelectorAll('[role="dialog"], [aria-modal="true"]')].some((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden";
      });
      const canDeliver = active && !blockedRef.current && !hasDialog && !composingRef.current && now - lastTypingRef.current >= 8000;
      setNoticeAllowed((current) => current === canDeliver ? current : canDeliver);
      const current = read();
      if (!active || (current.leaseOwner !== ownerRef.current && current.leaseUntil > now)) return;
      const activeMs = current.leaseOwner === ownerRef.current && now - previousTick <= 5000 ? Math.max(0, now - previousTick) : 0;
      const next = tickPetCare(current, { now, day: careDay(), activeMs, canDeliver, owner: ownerRef.current });
      next.leaseOwner = ownerRef.current; next.leaseUntil = now + 3000;
      const enabled = CARE_KINDS.some((kind) => next.habits[kind].enabled) || next.focus.phase !== "idle" || next.notice;
      if (enabled) publish(next, true);
    };
    document.addEventListener("pointerdown", activity, true);
    document.addEventListener("pointermove", activity, { passive: true });
    document.addEventListener("scroll", activity, { passive: true, capture: true });
    document.addEventListener("keydown", typing, true); document.addEventListener("input", typing, true);
    document.addEventListener("focusin", typing, true);
    document.addEventListener("compositionstart", compositionStart, true); document.addEventListener("compositionend", compositionEnd, true);
    document.addEventListener("visibilitychange", visibility); window.addEventListener("blur", release); window.addEventListener("focus", visibility);
    const timer = setInterval(tick, 1000);
    tick();
    return () => {
      clearInterval(timer); release();
      document.removeEventListener("pointerdown", activity, true); document.removeEventListener("pointermove", activity);
      document.removeEventListener("scroll", activity, true); document.removeEventListener("keydown", typing, true); document.removeEventListener("input", typing, true);
      document.removeEventListener("focusin", typing, true);
      document.removeEventListener("compositionstart", compositionStart, true); document.removeEventListener("compositionend", compositionEnd, true);
      document.removeEventListener("visibilitychange", visibility); window.removeEventListener("blur", release); window.removeEventListener("focus", visibility);
    };
  }, [visible, publish, read]);

  // A hidden tab still observes the deadline. The persisted claim and Web Lock
  // keep multiple tabs from sending the same notification when available.
  useEffect(() => {
    let disposed = false;
    const check = () => {
      if (!document.hidden && document.hasFocus()) return;
      const claim = () => {
        if (disposed) return;
        const current = read(), now = Date.now();
        if (current.focus.phase !== "running" || !current.focus.endsAt || current.focus.endsAt > now) return;
        const next = tickPetCare(current, { now, day: careDay(), activeMs: 0, canDeliver: false, owner: ownerRef.current });
        const notify = !current.focus.notified && typeof Notification !== "undefined" && Notification.permission === "granted";
        if (notify) next.focus.notified = true;
        publish(next, true);
        if (notify) void showBrowserNotification({ title: t("pet.care.focusDone"), body: t("pet.care.focusRest"), sessionUrl: window.location.href, onClick: () => window.focus(), tag: `pet-focus-${current.focus.endsAt}` });
      };
      if (navigator.locks) void navigator.locks.request("pi-yun-pet-focus-notification", { ifAvailable: true }, (lock) => { if (lock) claim(); });
      else claim();
    };
    const timer = window.setInterval(check, 1000);
    document.addEventListener("visibilitychange", check);
    window.addEventListener("blur", check);
    return () => { disposed = true; clearInterval(timer); document.removeEventListener("visibilitychange", check); window.removeEventListener("blur", check); };
  }, [publish, read, t]);

  const configure = useCallback((kind: CareKind, patch: { enabled?: boolean; minutes?: number; restoreToday?: boolean }) => change((current) => configureCareHabit(current, kind, patch)), [change]);
  const startFocus = useCallback((minutes: number) => change((current) => startCareFocus(current, minutes)), [change]);
  const controlFocus = useCallback((action: "pause" | "resume" | "stop") => change((current) => controlCareFocus(current, action)), [change]);
  const respond = useCallback((id: string, action: "ack" | "snooze" | "today") => change((current) => respondToCareNotice(current, id, action, careDay())), [change]);
  const notice = visible && !blocked && noticeAllowed && state.notice?.owner === ownerRef.current && state.notice.expiresAt > lastTickRef.current ? state.notice : null;
  return { state, notice, configure, startFocus, controlFocus, respond, focusing: state.focus.phase === "running" };
}
