"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import styles from "./PetWidget.module.css";
import { PetLivingPortrait } from "./PetLivingPortrait";
import type { PortraitPose as Pose } from "./PetPortraitMotion";
import { petChatActivity } from "@/lib/pet-chat-activity";
import { createPetReplyPicker } from "@/lib/pet-replies";
import { isPlainActivation, sessionDeepLink } from "@/lib/session-links";
import type { SessionInfo } from "@/lib/types";
import { useIsMobile } from "@/hooks/useIsMobile";
import { usePetPlacement } from "@/hooks/usePetPlacement";
import { usePetActivity } from "@/hooks/usePetActivity";
import { usePetPreferences } from "@/hooks/usePetPreferences";
import { PetPreferencesControls } from "./PetPreferencesControls";

const VISIBLE_KEY = "pi-yun-pet-visible";
const POSITION_KEY = "pi-yun-pet-pos";
const SMALL_KEY = "pi-yun-pet-small";
type Mood = "idle" | "busy" | "waiting";
type Position = { x: number; y: number };
type PetIcon = "paw" | "wave" | "heart" | "cheer" | "moon" | "size" | "close" | "more";

function Icon({ name }: { name: PetIcon }) {
  const paths: Record<PetIcon, React.ReactNode> = {
    paw: <>
      <ellipse cx="8.5" cy="5.5" rx="1.8" ry="2.5" transform="rotate(-15 8.5 5.5)" />
      <ellipse cx="15.5" cy="5.5" rx="1.8" ry="2.5" transform="rotate(15 15.5 5.5)" />
      <ellipse cx="4.5" cy="10" rx="1.6" ry="2.2" transform="rotate(-30 4.5 10)" />
      <ellipse cx="19.5" cy="10" rx="1.6" ry="2.2" transform="rotate(30 19.5 10)" />
      <path d="M12 11c-2 0-2.8 2.1-4.7 3.7C4.7 17 6 20.6 9 19.5a8.4 8.4 0 0 1 6 0c3 1.1 4.3-2.5 1.7-4.8C14.8 13.1 14 11 12 11Z" />
    </>,
    wave: <path d="m8 12-2-5a1.5 1.5 0 0 1 3-1l2 5-1-7a1.5 1.5 0 0 1 3 0l1 7 1-5a1.5 1.5 0 0 1 3 .5L17 14l2-2c2-2 4 0 2 2l-4 6c-4 4-9 1-11-2l-3-5c-1-2 1-3 2-2l3 3M3 3 1 1m19 3 2-2" />,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    cheer: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
    moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />,
    size: <path d="M9 3H3v6m12 12h6v-6M3 3l6 6m12 12-6-6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  };
  const size = name === "paw" ? 20 : 17;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "paw" ? 1.7 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function storePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Private browsing still works. */ }
}

export interface PetWidgetProps {
  sessions: readonly SessionInfo[];
  onSelectSession(session: SessionInfo): void;
}

export function PetWidget({ sessions, onSelectSession }: PetWidgetProps) {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const mobile = useIsMobile();
  const [smallPreference, setSmallPreference] = useState<boolean | null>(null);
  const small = smallPreference ?? mobile;
  const { preferences, updatePreferences } = usePetPreferences();
  const petName = preferences.name || t("pet.name");
  const activity = useSyncExternalStore(petChatActivity.subscribe, petChatActivity.getSnapshot, petChatActivity.getServerSnapshot);
  const { background, results, dismissResult } = usePetActivity(visible, activity.sessionId);
  // Live state owns the selected chat; stale polls must never re-add its old wait.
  const waitingIds = [...new Set([
    ...(activity.phase === "waiting" && activity.sessionId ? [activity.sessionId] : []),
    ...background.waiting.filter((id) => id !== activity.sessionId).sort(),
  ])];
  const waitingSessionId = waitingIds[0] ?? null;
  const workingSessionId = activity.phase !== "idle" ? activity.sessionId
    : background.running.find((id) => id !== activity.sessionId) ?? null;
  const mood: Mood = waitingSessionId ? "waiting" : activity.phase !== "idle"
    || background.running.some((id) => id !== activity.sessionId) ? "busy" : "idle";
  const [resting, setResting] = useState(false);
  const [action, setAction] = useState<Pose | null>(null);
  const [greeting, setGreeting] = useState("");
  const [greetingKey, setGreetingKey] = useState("");
  const [greetingSessionId, setGreetingSessionId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuTab, setMenuTab] = useState<"actions" | "notices" | "preferences">("actions");
  const [dragging, setDragging] = useState(false);
  const [reaction, setReaction] = useState(0);
  const [hop, setHop] = useState(0);
  const [menuSide, setMenuSide] = useState<"left" | "right" | "inside">("inside");
  const petRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; origin: Position; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const previousMoodRef = useRef<Mood>("idle");
  const previousPhaseRef = useRef(activity.phase);
  const previousOwnerRef = useRef(activity.owner);
  const previousSessionRef = useRef(activity.sessionId);
  const previousResultRef = useRef<number | undefined>(undefined);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const replyPickerRef = useRef<ReturnType<typeof createPetReplyPicker> | null>(null);
  const automaticGreetingRef = useRef(false);
  const placement = usePetPlacement(petRef, { visible, preferred: position, small, frozen: dragging || menuOpen, dragging });

  const speak = useCallback((key: string, pose?: Pose, sessionId: string | null = null, automatic = false) => {
    clearTimeout(bubbleTimerRef.current);
    replyPickerRef.current ??= createPetReplyPicker();
    automaticGreetingRef.current = automatic && key !== "pet.failed";
    const line = automaticGreetingRef.current && preferences.quiet ? "" : t(replyPickerRef.current(key), { name: petName });
    setGreeting(line);
    setGreetingKey(key);
    setGreetingSessionId(sessionId);
    // Longer lines get enough reading time in Chinese as well as English.
    if (line) bubbleTimerRef.current = setTimeout(() => setGreeting(""), Math.min(8000, Math.max(4500, Array.from(line).length * 130)));
    if (pose) {
      clearTimeout(actionTimerRef.current);
      setAction(pose);
      actionTimerRef.current = setTimeout(() => setAction(null), 2800);
    }
  }, [t, petName, preferences.quiet]);

  useEffect(() => {
    if (preferences.quiet && automaticGreetingRef.current) {
      clearTimeout(bubbleTimerRef.current); setGreeting(""); setGreetingSessionId(null);
    }
  }, [preferences.quiet]);

  useEffect(() => {
    try {
      setVisible(localStorage.getItem(VISIBLE_KEY) === "1");
      const savedSize = localStorage.getItem(SMALL_KEY);
      if (savedSize === "1" || savedSize === "0") setSmallPreference(savedSize === "1");
      const stored = JSON.parse(localStorage.getItem(POSITION_KEY) || "null") as Position | null;
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) setPosition(stored);
    } catch { /* Ignore unavailable storage or malformed coordinates. */ }
  }, []);

  // The selected chat updates immediately on send; the poll only supplies other sessions.
  useEffect(() => {
    if (!visible) { previousResultRef.current = activity.result?.sequence; return; }
    const contextChanged = activity.owner !== previousOwnerRef.current || activity.sessionId !== previousSessionRef.current;
    const changed = mood !== previousMoodRef.current || activity.phase !== previousPhaseRef.current || contextChanged;
    if (changed && mood !== "idle") {
      setResting(false); clearTimeout(actionTimerRef.current); setAction(null);
    }
    const started = activity.phase !== "idle" && activity.phase !== "waiting"
      && (previousPhaseRef.current === "idle" || contextChanged);
    // Speak once at the start, never on reply/tool switches or after confirmation.
    if (!waitingSessionId && (started || (mood === "busy" && previousMoodRef.current === "idle"))) {
      speak(activity.phase === "sending" ? "pet.received" : "pet.greetRun", undefined, workingSessionId, true);
    } else if (waitingSessionId || (previousMoodRef.current === "waiting" && mood !== "waiting")) {
      clearTimeout(bubbleTimerRef.current); setGreeting(""); setGreetingSessionId(null);
    }
    previousMoodRef.current = mood; previousPhaseRef.current = activity.phase;
    previousOwnerRef.current = activity.owner; previousSessionRef.current = activity.sessionId;
    if (activity.phase === "idle" && activity.result && activity.result.sequence !== previousResultRef.current) {
      previousResultRef.current = activity.result.sequence;
      setResting(false);
      const kind = activity.result.kind;
      if (!waitingSessionId) {
        setHop(0);
        speak(kind === "complete" ? "pet.greetDone" : kind === "stopped" ? "pet.stopped" : "pet.failed", kind === "complete" ? "happy" : "wave", activity.sessionId, true);
      }
    }
  }, [visible, mood, waitingSessionId, workingSessionId, activity.owner, activity.sessionId, activity.phase, activity.result, speak]);

  useEffect(() => {
    if (!visible) {
      clearTimeout(bubbleTimerRef.current); clearTimeout(actionTimerRef.current);
      setGreeting(""); setAction(null); setMenuOpen(false); setDragging(false);
      dragRef.current = null;
      return;
    }
    return () => { clearTimeout(bubbleTimerRef.current); clearTimeout(actionTimerRef.current); };
  }, [visible]);

  useEffect(() => {
    if (!visible || !menuOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!petRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault(); event.stopPropagation(); setMenuOpen(false);
      menuButtonRef.current?.focus();
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", onKey, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", onKey, true); };
  }, [visible, menuOpen]);

  useEffect(() => {
    if (!visible || !menuOpen) return;
    const place = () => {
      const rect = petRef.current?.getBoundingClientRect();
      setMenuSide(rect && rect.left >= 240 ? "left" : rect && window.innerWidth - rect.right >= 240 ? "right" : "inside");
    };
    place(); window.addEventListener("resize", place);
    return () => window.removeEventListener("resize", place);
  }, [visible, menuOpen, placement.position, small]);

  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!visible || !menuOpen || !menu) return;
    const fit = () => {
      const viewport = window.visualViewport;
      const top = (viewport?.offsetTop ?? 0) + 8;
      const bottom = (viewport?.offsetTop ?? 0) + (viewport?.height ?? innerHeight) - 8;
      menu.style.maxHeight = `${Math.max(80, bottom - top)}px`;
      menu.style.removeProperty("translate");
      const rect = menu.getBoundingClientRect();
      menu.style.translate = `0 ${Math.max(top - rect.top, Math.min(0, bottom - rect.bottom))}px`;
    };
    fit();
    window.addEventListener("resize", fit); window.visualViewport?.addEventListener("resize", fit);
    return () => { window.removeEventListener("resize", fit); window.visualViewport?.removeEventListener("resize", fit); };
  }, [visible, menuOpen, menuTab, menuSide, petName, results.length, waitingIds.length, placement.position]);

  const wake = () => {
    setResting(false);
  };
  const hide = () => {
    setVisible(false); storePreference(VISIBLE_KEY, "0"); toggleRef.current?.focus();
  };
  const interact = (pose: Pose) => {
    wake(); setMenuOpen(false);
    if (pose === "cheer" || pose === "happy") setHop((value) => value + 1);
    if (menuOpen) menuButtonRef.current?.focus();
    if (pose === "happy") {
      setReaction((value) => value + 1);
      speak("pet.patReply1", "happy");
    } else speak(pose === "wave" ? "pet.helloReply" : "pet.cheerReply", pose);
  };

  const onDragStart = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!event.isPrimary || event.button !== 0 || !petRef.current) return;
    wake();
    const rect = petRef.current.getBoundingClientRect();
    dragRef.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, origin: { x: rect.left, y: rect.top }, moved: false };
    suppressClickRef.current = false;
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const onDragMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !petRef.current) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) < 6) return;
    drag.moved = true; setDragging(true); setMenuOpen(false);
    const rect = petRef.current.getBoundingClientRect();
    setPosition({
      x: Math.max(8, Math.min(drag.origin.x + dx, window.innerWidth - rect.width - 8)),
      y: Math.max(8, Math.min(drag.origin.y + dy, window.innerHeight - rect.height - 8)),
    });
  };
  const finishDrag = (event: ReactPointerEvent<HTMLButtonElement>, cancelled = false) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    suppressClickRef.current = cancelled || drag.moved;
    dragRef.current = null; setDragging(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
    if (drag.moved && position) storePreference(POSITION_KEY, JSON.stringify(position));
  };

  const asleep = mood === "idle" && resting;
  const pose: Pose = asleep ? "sleep" : action ?? (mood === "busy" ? "thinking" : mood === "waiting" ? "wave" : "idle");
  const status = asleep ? "sleeping" : mood;
  const pending = [
    ...waitingIds.map((sessionId) => ({ sessionId, kind: "waiting" as const })),
    ...results.filter((result) => !waitingIds.includes(result.sessionId)),
  ];
  const resultNotice = results.find((result) => result.kind === "error") ?? (preferences.quiet ? undefined : results[0]);
  const bubbleResult = waitingSessionId || (greeting && greetingKey === "pet.failed") ? undefined : resultNotice;
  const bubbleSessionId = waitingSessionId ?? bubbleResult?.sessionId ?? greetingSessionId;
  const bubbleSession = sessions.find((session) => session.id === bubbleSessionId);
  const sessionLabel = bubbleSession?.name?.trim() || bubbleSession?.firstMessage?.trim()
    || t("pet.unnamedSession", { id: bubbleSessionId?.slice(0, 8) ?? "" });
  const labelForSession = (id: string) => {
    const session = sessions.find((session) => session.id === id);
    return session?.name?.trim() || session?.firstMessage?.trim() || t("pet.unnamedSession", { id: id.slice(0, 8) });
  };
  const openSession = (event: React.MouseEvent<HTMLAnchorElement>, id: string) => {
    if (!isPlainActivation(event)) return;
    const session = sessions.find((session) => session.id === id);
    if (!session) return;
    event.preventDefault(); setMenuOpen(false); dismissResult(id); onSelectSession(session);
  };

  return <>
    <button ref={toggleRef} type="button" className="workbench-view-button" data-workspace-action="pet" onClick={() => {
      if (visible) { hide(); return; }
      wake(); setVisible(true); storePreference(VISIBLE_KEY, "1"); speak("pet.welcome", "wave");
    }} title={t("pet.title")} aria-label={t("pet.title")} aria-pressed={visible}>
      <Icon name="paw" /><span className="workbench-settings-label">{t("pet.title")}</span>
    </button>
    {visible && createPortal(
      <div ref={petRef} className={`${styles.pet} ${small ? styles.small : ""}`} data-pet-companion="" data-pose={pose} data-status={status} data-chat-phase={activity.phase} data-menu-side={menuSide} data-compact={placement.compact} data-dragging={dragging}
        style={placement.position ? { left: placement.position.x, top: placement.position.y, right: "auto", bottom: "auto" } : undefined}>
        <div className={styles.speech} role="status" aria-live="polite" aria-atomic="true">
          {(waitingSessionId || bubbleResult || greeting) && <div key={waitingSessionId ?? bubbleResult?.id ?? greeting} className={styles.bubble} data-pet-notice={waitingSessionId ? "waiting" : bubbleResult ? "result" : "transient"}>
            <span>{waitingSessionId ? t("pet.attention") : bubbleResult ? t(`pet.background.${bubbleResult.kind}`) : greeting}</span>
            {waitingIds.length > 1 && <span className={styles.waitingCount}>{t("pet.moreWaiting", { count: waitingIds.length - 1 })}</span>}
            {(pending.length > 1 || bubbleResult) && <button type="button" className={styles.noticeCount} onClick={() => { setMenuTab("notices"); setMenuOpen(true); }} aria-controls="pet-actions" aria-expanded={menuOpen && menuTab === "notices"}>{t("pet.noticesCount", { count: pending.length })}</button>}
            {bubbleSessionId && <a className={styles.sessionLink} href={sessionDeepLink(bubbleSessionId)} title={sessionLabel}
              onClick={(event) => openSession(event, bubbleSessionId)}><span>{sessionLabel}</span><span aria-hidden="true"> →</span><span className={styles.linkHint}>{t("pet.viewSession")}</span></a>}
          </div>}
        </div>
        <button type="button" data-pet-character="" className={styles.character} aria-label={t("pet.interact", { name: petName })} title={t("pet.hint")}
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
          onLostPointerCapture={() => { dragRef.current = null; setDragging(false); }}
          onClick={(event) => {
            if (suppressClickRef.current && event.detail !== 0) { suppressClickRef.current = false; return; }
            interact("happy");
          }} onDoubleClick={() => interact("wave")}
          onKeyDown={(event) => {
            const offset: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
            if (!offset[event.key] || !petRef.current) return;
            event.preventDefault();
            const rect = petRef.current.getBoundingClientRect(), [dx, dy] = offset[event.key];
            const next = { x: Math.max(8, Math.min(rect.left + dx, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(rect.top + dy, window.innerHeight - rect.height - 8)) };
            setPosition(next); storePreference(POSITION_KEY, JSON.stringify(next));
          }}>
          <span className={styles.ground} aria-hidden="true" />
          <PetLivingPortrait pose={pose} dragging={dragging} hop={hop} />
          {asleep && <span className={styles.zzz} aria-hidden="true">z <span>z</span> Z</span>}
          {reaction > 0 && <span key={reaction} className={styles.hearts} aria-hidden="true">{[0, 1, 2].map((item) => <span key={item} style={{ "--i": item } as CSSProperties}><svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 21 3.5 12.7C-2 7.3 5.8-.5 11.2 4.9l.8.8.8-.8C18.2-.5 26 7.3 20.5 12.7Z" /></svg></span>)}</span>}
        </button>
        <button ref={menuButtonRef} type="button" className={styles.more} aria-label={t("pet.actions")} title={t("pet.actions")}
            aria-expanded={menuOpen} aria-controls="pet-actions" onClick={() => {
              const rect = petRef.current?.getBoundingClientRect();
              setMenuSide(rect && rect.left >= 240 ? "left" : rect && window.innerWidth - rect.right >= 240 ? "right" : "inside");
              setMenuOpen((value) => !value);
            }}><Icon name="more" />{pending.length > 0 && <span className={styles.badge} aria-hidden="true">{pending.length}</span>}</button>
        {menuOpen && <div ref={menuRef} id="pet-actions" className={styles.actions} role="group" aria-label={t("pet.actions")}>
          <div className={styles.actionHeading}><div>{t("pet.menuTitle", { name: petName })}<span>{t("pet.menuHint")}</span></div>
            <button type="button" aria-label={t("pet.closeActions")} onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }}><Icon name="close" /></button>
          </div>
          <div className={styles.menuTabs} role="group" aria-label={t("pet.menuSections")}>
            {(["actions", "notices", "preferences"] as const).map((tab) => <button key={tab} type="button" aria-pressed={menuTab === tab} onClick={() => setMenuTab(tab)}>{t(`pet.tab.${tab}`)}{tab === "notices" && pending.length > 0 ? ` (${pending.length})` : ""}</button>)}
          </div>
          {menuTab === "notices" && <div className={styles.notices}>
            {pending.length === 0 && <p>{t("pet.noNotices")}</p>}
            {pending.map((notice) => <div key={notice.sessionId} className={styles.noticeRow}>
              <a href={sessionDeepLink(notice.sessionId)} onClick={(event) => openSession(event, notice.sessionId)} title={labelForSession(notice.sessionId)}><span>{t(`pet.notice.${notice.kind}`)}</span><strong>{labelForSession(notice.sessionId)}</strong></a>
              {notice.kind !== "waiting" && <button type="button" onClick={() => dismissResult(notice.sessionId)} aria-label={t("pet.dismissResult", { session: labelForSession(notice.sessionId) })}><Icon name="close" /></button>}
            </div>)}
          </div>}
          {menuTab === "preferences" && <PetPreferencesControls preferences={preferences} defaultName={t("pet.name")} onChange={updatePreferences} />}
          {menuTab === "actions" && <div className={styles.actionGrid}>
            <button type="button" onClick={() => interact("wave")}><Icon name="wave" />{t("pet.hello")}</button>
            <button type="button" onClick={() => interact("happy")}><span className={styles.patIcon}><Icon name="heart" /></span>{t("pet.pat")}</button>
            <button type="button" onClick={() => interact("cheer")}><Icon name="cheer" />{t("pet.encourage")}</button>
            <button type="button" onClick={() => {
              setResting(!asleep); setMenuOpen(false);
              menuButtonRef.current?.focus();
              speak(asleep ? "pet.wakeReply" : "pet.sleepReply", asleep ? "wave" : "sleep");
            }}><Icon name="moon" />{t(asleep ? "pet.wake" : "pet.rest")}</button>
          </div>}
          <div className={styles.actionFooter}>
            <button type="button" onClick={() => { setSmallPreference(!small); storePreference(SMALL_KEY, small ? "0" : "1"); }}><Icon name="size" />{t(small ? "pet.enlarge" : "pet.shrink")}</button>
            <button type="button" onClick={hide}><Icon name="close" />{t("pet.hide")}</button>
          </div>
        </div>}
      </div>, document.body,
    )}
  </>;
}
