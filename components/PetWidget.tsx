"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import styles from "./PetWidget.module.css";
import { PetLivingPortrait } from "./PetLivingPortrait";
import type { PortraitPose as Pose } from "./PetPortraitMotion";
import { petChatActivity } from "@/lib/pet-chat-activity";

const VISIBLE_KEY = "pi-yun-pet-visible";
const POSITION_KEY = "pi-yun-pet-pos";
const SMALL_KEY = "pi-yun-pet-small";
type Mood = "idle" | "busy" | "waiting";
type Position = { x: number; y: number };
type PetIcon = "person" | "wave" | "heart" | "cheer" | "moon" | "size" | "close" | "more";

function Icon({ name }: { name: PetIcon }) {
  const paths: Record<PetIcon, React.ReactNode> = {
    person: <>
      <path d="M4 10a8 8 0 0 1 16 0v3a8 8 0 0 1-16 0Z" />
      <path d="M4 10c3.5 0 6-1.8 8-4 2 2.2 4.5 4 8 4" />
      <circle cx="9" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12.5" r="0.8" fill="currentColor" stroke="none" />
      <path d="M9.5 16q2.5 2 5 0" />
    </>,
    wave: <path d="m8 12-2-5a1.5 1.5 0 0 1 3-1l2 5-1-7a1.5 1.5 0 0 1 3 0l1 7 1-5a1.5 1.5 0 0 1 3 .5L17 14l2-2c2-2 4 0 2 2l-4 6c-4 4-9 1-11-2l-3-5c-1-2 1-3 2-2l3 3M3 3 1 1m19 3 2-2" />,
    heart: <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0l-1 1-1-1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8Z" />,
    cheer: <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9Z" />,
    moon: <path d="M20.9 13A9 9 0 0 1 11 3.1 9 9 0 1 0 20.9 13Z" />,
    size: <path d="M9 3H3v6m12 12h6v-6M3 3l6 6m12 12-6-6" />,
    close: <path d="m6 6 12 12M6 18 18 6" />,
    more: <><circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" /></>,
  };
  const size = name === "person" ? 20 : 17;
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={name === "person" ? 1.7 : 1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

function storePreference(key: string, value: string) {
  try { window.localStorage.setItem(key, value); } catch { /* Private browsing still works. */ }
}

export function PetWidget() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState<Position | null>(null);
  const [small, setSmall] = useState(false);
  const [background, setBackground] = useState<{ running: string[]; waiting: string[] }>({ running: [], waiting: [] });
  const activity = useSyncExternalStore(petChatActivity.subscribe, petChatActivity.getSnapshot, petChatActivity.getServerSnapshot);
  const backgroundMood: Mood = background.waiting.some((id) => id !== activity.sessionId) ? "waiting"
    : background.running.some((id) => id !== activity.sessionId) ? "busy" : "idle";
  const mood: Mood = activity.phase === "waiting" ? "waiting" : activity.phase !== "idle" ? "busy" : backgroundMood;
  const [sleepy, setSleepy] = useState(false);
  const [resting, setResting] = useState(false);
  const [action, setAction] = useState<Pose | null>(null);
  const [greeting, setGreeting] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [reaction, setReaction] = useState(0);
  const [hop, setHop] = useState(0);
  const [menuSide, setMenuSide] = useState<"left" | "right" | "inside">("inside");
  const petRef = useRef<HTMLDivElement>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const toggleRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ pointerId: number; x: number; y: number; origin: Position; moved: boolean } | null>(null);
  const suppressClickRef = useRef(false);
  const lastActivityRef = useRef(0);
  const previousMoodRef = useRef<Mood>("idle");
  const previousPhaseRef = useRef(activity.phase);
  const previousResultRef = useRef<number | undefined>(undefined);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const actionTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const interactionRef = useRef(0);

  const speak = useCallback((key: string, pose?: Pose) => {
    clearTimeout(bubbleTimerRef.current);
    setGreeting(t(key));
    bubbleTimerRef.current = setTimeout(() => setGreeting(""), 4500);
    if (pose) {
      clearTimeout(actionTimerRef.current);
      setAction(pose);
      actionTimerRef.current = setTimeout(() => setAction(null), 2800);
    }
  }, [t]);

  useEffect(() => {
    lastActivityRef.current = Date.now();
    try {
      setVisible(localStorage.getItem(VISIBLE_KEY) === "1");
      setSmall(localStorage.getItem(SMALL_KEY) === "1");
      const stored = JSON.parse(localStorage.getItem(POSITION_KEY) || "null") as Position | null;
      if (stored && Number.isFinite(stored.x) && Number.isFinite(stored.y)) setPosition(stored);
    } catch { /* Ignore unavailable storage or malformed coordinates. */ }
  }, []);

  // The body portal escapes sidebar clipping; clamp after restoring, resizing or changing size.
  useEffect(() => {
    if (!visible || !petRef.current) return;
    const keepInView = () => {
      const rect = petRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPosition((current) => {
        const x = Math.max(8, Math.min(current?.x ?? rect.left, window.innerWidth - rect.width - 8));
        const y = Math.max(8, Math.min(current?.y ?? rect.top, window.innerHeight - rect.height - 8));
        if (current?.x === x && current?.y === y) return current;
        storePreference(POSITION_KEY, JSON.stringify({ x, y }));
        return { x, y };
      });
    };
    keepInView();
    window.addEventListener("resize", keepInView);
    const observer = new ResizeObserver(keepInView);
    observer.observe(petRef.current);
    return () => { observer.disconnect(); window.removeEventListener("resize", keepInView); };
  }, [visible, small]);

  // Waiting sessions are also running: awaiting input must take precedence.
  // Closing the companion aborts its request; background tabs do not poll.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const tick = async () => {
      if (!document.hidden) {
        try {
          const response = await fetch("/api/agent/running", { cache: "no-store", signal: controller.signal });
          if (response.ok) {
            const body = await response.json() as { runningSessionIds?: unknown; awaitingInputSessionIds?: unknown };
            if (cancelled) return;
            setBackground({
              running: Array.isArray(body.runningSessionIds) ? body.runningSessionIds.filter((id): id is string => typeof id === "string") : [],
              waiting: Array.isArray(body.awaitingInputSessionIds) ? body.awaitingInputSessionIds.filter((id): id is string => typeof id === "string") : [],
            });
          }
        } catch { /* Preserve the last known state on a network failure. */ }
        if (!cancelled) setSleepy(Date.now() - lastActivityRef.current > 90000);
      }
      if (!cancelled) timer = setTimeout(tick, 2500);
    };
    void tick();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [visible]);

  // The selected chat updates immediately on send; the poll only supplies other sessions.
  useEffect(() => {
    if (!visible) { previousResultRef.current = activity.result?.sequence; return; }
    const changed = mood !== previousMoodRef.current || activity.phase !== previousPhaseRef.current;
    if (changed) {
      lastActivityRef.current = Date.now(); setSleepy(false);
      if (mood !== "idle") {
        setResting(false); clearTimeout(actionTimerRef.current); setAction(null);
        const key = mood === "waiting" ? "pet.attention" : activity.phase === "replying" ? "pet.replying"
          : activity.phase === "working" ? "pet.working" : activity.phase === "sending" ? "pet.received" : "pet.greetRun";
        speak(key, mood === "waiting" ? "wave" : "thinking");
      } else if (!activity.result) {
        clearTimeout(actionTimerRef.current); setAction(null); speak("pet.backToYou");
      }
    }
    previousMoodRef.current = mood; previousPhaseRef.current = activity.phase;
    if (activity.phase === "idle" && activity.result && activity.result.sequence !== previousResultRef.current) {
      previousResultRef.current = activity.result.sequence;
      lastActivityRef.current = Date.now(); setSleepy(false); setResting(false);
      const kind = activity.result.kind;
      speak(kind === "complete" ? "pet.greetDone" : kind === "stopped" ? "pet.stopped" : "pet.failed", kind === "complete" ? "cheer" : "wave");
      if (kind === "complete") setHop((value) => value + 1);
    }
  }, [visible, mood, activity.phase, activity.result, speak]);

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
  }, [visible, menuOpen, position, small]);

  const wake = () => {
    lastActivityRef.current = Date.now(); setSleepy(false); setResting(false);
  };
  const hide = () => {
    setVisible(false); storePreference(VISIBLE_KEY, "0"); toggleRef.current?.focus();
  };
  const interact = (pose: Pose) => {
    wake(); setMenuOpen(false); interactionRef.current++;
    if (pose === "cheer" || pose === "happy") setHop((value) => value + 1);
    if (menuOpen) menuButtonRef.current?.focus();
    if (pose === "happy") {
      setReaction((value) => value + 1);
      speak(interactionRef.current % 2 ? "pet.patReply1" : "pet.patReply2", "happy");
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

  const asleep = mood === "idle" && (resting || sleepy);
  const pose: Pose = asleep ? "sleep" : action ?? (mood === "busy" ? "thinking" : mood === "waiting" ? "wave" : "idle");
  const status = asleep ? "sleeping" : mood;

  return <>
    <button ref={toggleRef} type="button" onClick={() => {
      if (visible) { hide(); return; }
      wake(); setVisible(true); storePreference(VISIBLE_KEY, "1"); speak("pet.welcome", "wave");
    }} title={t("pet.title")} aria-label={t("pet.title")} aria-pressed={visible}>
      <Icon name="person" /><span className="workbench-settings-label">{t("pet.title")}</span>
    </button>
    {visible && createPortal(
      <div ref={petRef} className={`${styles.pet} ${small ? styles.small : ""}`} data-pet-companion="" data-pose={pose} data-status={status} data-chat-phase={activity.phase} data-menu-side={menuSide}
        style={position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : undefined}>
        <div className={styles.speech} role="status" aria-live="polite" aria-atomic="true">
          {greeting && <div key={greeting} className={styles.bubble}>{greeting}</div>}
        </div>
        <button type="button" className={styles.character} aria-label={t("pet.interact")} title={t("pet.hint")}
          onPointerDown={onDragStart} onPointerMove={onDragMove} onPointerUp={(event) => finishDrag(event)}
          onPointerCancel={(event) => finishDrag(event, true)}
          onLostPointerCapture={() => { dragRef.current = null; setDragging(false); }}
          onClick={(event) => {
            if (suppressClickRef.current && event.detail !== 0) { suppressClickRef.current = false; return; }
            interact("happy");
          }} onDoubleClick={() => interact("wave")}>
          <span className={styles.ground} aria-hidden="true" />
          <PetLivingPortrait pose={pose} dragging={dragging} hop={hop} />
          {asleep && <span className={styles.zzz} aria-hidden="true">z <span>z</span> Z</span>}
          {reaction > 0 && <span key={reaction} className={styles.hearts} aria-hidden="true">{[0, 1, 2].map((item) => <span key={item} style={{ "--i": item } as CSSProperties}>♡</span>)}</span>}
        </button>
        <div className={styles.nameplate}>
          <button className={styles.identity} type="button" aria-label={t("pet.move")} title={t("pet.moveHint")}
            onPointerDown={onDragStart} onPointerMove={onDragMove}
            onPointerUp={(event) => finishDrag(event)} onPointerCancel={(event) => finishDrag(event, true)}
            onLostPointerCapture={() => { dragRef.current = null; setDragging(false); }}
            onKeyDown={(event) => {
              const offset: Record<string, [number, number]> = { ArrowLeft: [-16, 0], ArrowRight: [16, 0], ArrowUp: [0, -16], ArrowDown: [0, 16] };
              if (!offset[event.key] || !petRef.current) return;
              event.preventDefault();
              const rect = petRef.current.getBoundingClientRect(), [dx, dy] = offset[event.key];
              const next = { x: Math.max(8, Math.min(rect.left + dx, window.innerWidth - rect.width - 8)), y: Math.max(8, Math.min(rect.top + dy, window.innerHeight - rect.height - 8)) };
              setPosition(next); storePreference(POSITION_KEY, JSON.stringify(next));
            }}>
            <span className={styles.statusDot} data-status={status} aria-hidden="true" />
            <span className={styles.name}>{t("pet.name")}</span><span className={styles.status}>{t(`pet.status.${status}`)}</span>
          </button>
          <button ref={menuButtonRef} type="button" className={styles.more} aria-label={t("pet.actions")} title={t("pet.actions")}
            aria-expanded={menuOpen} aria-controls="pet-actions" onClick={() => {
              lastActivityRef.current = Date.now();
              const rect = petRef.current?.getBoundingClientRect();
              setMenuSide(rect && rect.left >= 240 ? "left" : rect && window.innerWidth - rect.right >= 240 ? "right" : "inside");
              setMenuOpen((value) => !value);
            }}><Icon name="more" /></button>
        </div>
        {menuOpen && <div id="pet-actions" className={styles.actions} role="group" aria-label={t("pet.actions")}>
          <div className={styles.actionHeading}><div>{t("pet.menuTitle")}<span>{t("pet.menuHint")}</span></div>
            <button type="button" aria-label={t("pet.closeActions")} onClick={() => { setMenuOpen(false); menuButtonRef.current?.focus(); }}><Icon name="close" /></button>
          </div>
          <div className={styles.actionGrid}>
            <button type="button" onClick={() => interact("wave")}><Icon name="wave" />{t("pet.hello")}</button>
            <button type="button" onClick={() => interact("happy")}><Icon name="heart" />{t("pet.pat")}</button>
            <button type="button" onClick={() => interact("cheer")}><Icon name="cheer" />{t("pet.encourage")}</button>
            <button type="button" onClick={() => {
              lastActivityRef.current = Date.now(); setSleepy(false); setResting(!asleep); setMenuOpen(false);
              menuButtonRef.current?.focus();
              speak(asleep ? "pet.wakeReply" : "pet.sleepReply", asleep ? "wave" : "sleep");
            }}><Icon name="moon" />{t(asleep ? "pet.wake" : "pet.rest")}</button>
          </div>
          <div className={styles.actionFooter}>
            <button type="button" onClick={() => { setSmall(!small); storePreference(SMALL_KEY, small ? "0" : "1"); }}><Icon name="size" />{t(small ? "pet.enlarge" : "pet.shrink")}</button>
            <button type="button" onClick={hide}><Icon name="close" />{t("pet.hide")}</button>
          </div>
        </div>}
      </div>, document.body,
    )}
  </>;
}
