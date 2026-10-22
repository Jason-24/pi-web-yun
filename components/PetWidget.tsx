"use client";

// 页面内桌宠：左侧图标栏开关显隐，宠物本体常驻右下角，可拖动。
// 状态来自轮询 /api/agent/running；渲染走 three.js（懒加载），WebGL
// 不可用时回退到内置 SVG。不依赖 react-three-fiber 等额外包。
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import styles from "./PetWidget.module.css";
import type { PetSceneHandle } from "./Pet3DScene";

const POLL_MS = 1000;
const SLEEP_AFTER_MS = 30000;
const VISIBLE_KEY = "pi-yun-pet-visible";
const POSITION_KEY = "pi-yun-pet-pos";

type PetMood = "idle" | "busy" | "waiting";

type PetPosition = { x: number; y: number };

function readStoredPosition(): PetPosition | null {
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return null;
    const pos = JSON.parse(raw) as PetPosition;
    if (typeof pos?.x === "number" && typeof pos?.y === "number") return pos;
  } catch { /* 坏数据按默认位置处理 */ }
  return null;
}

// 2D 回退形象：一朵带笑脸的白云。
function PetFace({ mood, sleepy }: { mood: PetMood; sleepy: boolean }) {
  const eye = mood === "busy" || sleepy ? "line" : mood === "waiting" ? "star" : "round";
  const accent = "var(--accent)";
  return (
    <>
      {/* 云朵：三个圆弧堆出的积云轮廓 */}
      <path
        d="M14 40 a10 10 0 0 1 2.2-19.7 A13 13 0 0 1 41 18.5 A10.5 10.5 0 0 1 50 40 a4 4 0 0 1-1.5.3 H17.5 A10 10 0 0 1 14 40 z"
        fill="#fff"
        stroke="var(--border)"
        strokeWidth="2.5"
        strokeLinejoin="round"
      />
      {eye === "round" && <>
        <circle cx="27" cy="30" r="2" fill="var(--text)" />
        <circle cx="37" cy="30" r="2" fill="var(--text)" />
      </>}
      {eye === "line" && <>
        <line x1="24" y1="30" x2="30" y2="30" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" />
        <line x1="36" y1="30" x2="42" y2="30" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" />
      </>}
      {eye === "star" && <>
        <path d="M27 26 l1.8 2.1 2.7-0.5-1.1 2.2 1.4 1.9-2.5 0.3-1 2.4-1.1-2.2-2.5-0.3 1.6-2.1-1-2.2 2.4 0.5z" fill={accent} />
        <path d="M37 26 l1.8 2.1 2.7-0.5-1.1 2.2 1.4 1.9-2.5 0.3-1 2.4-1.1-2.8-2.5-0.3 1.6-2.1-1-2.2 2.4 0.5z" fill={accent} />
      </>}
      {mood === "busy"
        ? <line x1="30" y1="35" x2="34" y2="35" stroke="var(--text)" strokeWidth="2" strokeLinecap="round" />
        : <path d="M29 34 q3 2.5 6 0" fill="none" stroke="var(--text)" strokeWidth="2.2" strokeLinecap="round" />}
    </>
  );
}

export function PetWidget() {
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [mood, setMood] = useState<PetMood>("idle");
  const [position, setPosition] = useState<PetPosition | null>(null);
  // 3D 初始化失败（无 WebGL 等）时保留 2D SVG。
  const [render3D, setRender3D] = useState(true);
  const [sceneHandle, setSceneHandle] = useState<PetSceneHandle | null>(null);
  const [sleepy, setSleepy] = useState(false);
  const [greeting, setGreeting] = useState("");
  const [hearts, setHearts] = useState<number[]>([]);
  const bubbleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 拖动期间记录起始指针/元素坐标，移动时按差值更新；latestPos 供结束时落盘。
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: PetPosition } | null>(null);
  const latestPosRef = useRef<PetPosition | null>(null);
  const petRef = useRef<HTMLDivElement | null>(null);
  const canvasHostRef = useRef<HTMLDivElement | null>(null);
  const moodRef = useRef<PetMood>("idle");
  const heartIdRef = useRef(0);
  const movedRef = useRef(false); // 拖动超过阈值就不再算点击
  const lastActivityRef = useRef(Date.now());

  useEffect(() => {
    moodRef.current = mood;
  }, [mood]);

  // 恢复上一次的显隐与位置；挂载前不渲染，避免水合不一致。
  useEffect(() => {
    try {
      setVisible(window.localStorage.getItem(VISIBLE_KEY) === "1");
      setPosition(readStoredPosition());
    } catch { /* localStorage 不可用时用默认值 */ }
  }, []);

  // 只在可见时轮询；关掉 = 零开销。
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      try {
        const res = await fetch("/api/agent/running", { cache: "no-store" });
        if (res.ok && !cancelled) {
          const body = await res.json() as { runningSessionIds?: unknown; awaitingInputSessionIds?: unknown };
          const running = Array.isArray(body.runningSessionIds) ? body.runningSessionIds.length : 0;
          const waiting = Array.isArray(body.awaitingInputSessionIds) ? body.awaitingInputSessionIds.length : 0;
          const nextMood = running > 0 ? "busy" : waiting > 0 ? "waiting" : "idle";
          // 状态变化沿：开工/完成/收工时说一句。
          if (nextMood !== moodRef.current) {
            setGreeting(
              nextMood === "busy"
                ? t("pet.greetRun")
                : nextMood === "waiting"
                  ? t("pet.greetDone")
                  : moodRef.current === "busy" ? t("pet.greetRest") : "",
            );
            if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
            bubbleTimerRef.current = setTimeout(() => setGreeting(""), 2500);
          }
          setMood(nextMood);
          setSleepy(running === 0 && waiting === 0 && Date.now() - lastActivityRef.current > SLEEP_AFTER_MS);
        }
      } catch {
        // 网络失败保持上一次状态即可。
      }
      if (!cancelled) timer = setTimeout(tick, POLL_MS);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
    };
  }, [visible, t]);

  // 挂载/卸载 3D 场景：three.js 只在此时动态加载。
  useEffect(() => {
    if (!visible || !render3D) return;
    let disposed = false;
    let handle: PetSceneHandle | null = null;
    let wheelTarget: HTMLElement | null = null;
    // 滚轮旋转：非 passive 监听，阻止页面跟着滚动。
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      handle?.rotate(event.deltaY * 0.01);
    };
    void (async () => {
      try {
        const { mountPetScene } = await import("./Pet3DScene");
        if (disposed || !canvasHostRef.current) return;
        handle = mountPetScene(canvasHostRef.current, {
          // 转回正面时打个招呼（随机三选一）。
          onGreet: () => {
            const greetings = [t("pet.greet1"), t("pet.greet2"), t("pet.greet3")];
            setGreeting(greetings[Math.floor(Math.random() * greetings.length)]);
          },
        });
        handle.setMood(moodRef.current);
        setSceneHandle(handle);
        wheelTarget = petRef.current;
        wheelTarget?.addEventListener("wheel", onWheel, { passive: false });
      } catch {
        // WebGL 不可用或模块加载失败：退回 2D SVG。
        if (!disposed) setRender3D(false);
      }
    })();
    return () => {
      disposed = true;
      wheelTarget?.removeEventListener("wheel", onWheel);
      handle?.dispose();
      setSceneHandle(null);
      setGreeting("");
    };
  }, [visible, render3D, t]);

  useEffect(() => {
    sceneHandle?.setMood(mood);
  }, [mood, sceneHandle]);

  useEffect(() => {
    sceneHandle?.setSleepy(sleepy);
  }, [sleepy, sceneHandle]);

  // 每隔 1.5~3 分钟主动说句话：空闲时关怀提醒，忙碌时打气；瞌睡时闭嘴。
  useEffect(() => {
    if (!visible || sleepy) return;
    let timer: ReturnType<typeof setTimeout>;
    const schedule = () => {
      timer = setTimeout(() => {
        const pool = mood === "busy"
          ? [t("pet.cheer1"), t("pet.cheer2"), t("pet.cheer3")]
          : [t("pet.chill1"), t("pet.chill2"), t("pet.chill3"), t("pet.chill4"), t("pet.chill5")];
        setGreeting(pool[Math.floor(Math.random() * pool.length)]);
        if (bubbleTimerRef.current) clearTimeout(bubbleTimerRef.current);
        bubbleTimerRef.current = setTimeout(() => setGreeting(""), 3000);
        schedule();
      }, 90000 + Math.random() * 90000);
    };
    schedule();
    return () => clearTimeout(timer);
  }, [visible, sleepy, mood, t]);

  const toggle = () => {
    setVisible((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(VISIBLE_KEY, next ? "1" : "0");
      } catch { /* 隐私模式等场景下忽略 */ }
      return next;
    });
  };

  const clampToViewport = (x: number, y: number): PetPosition => {
    const rect = petRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 140;
    const height = rect?.height ?? 190;
    return {
      x: Math.min(Math.max(x, 8), Math.max(8, window.innerWidth - width - 8)),
      y: Math.min(Math.max(y, 8), Math.max(8, window.innerHeight - height - 8)),
    };
  };

  const onDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!petRef.current) return;
    lastActivityRef.current = Date.now();
    movedRef.current = false;
    const rect = petRef.current.getBoundingClientRect();
    // 从当前渲染位置起算（默认停靠右下角，或上次拖动后的位置）。
    const origin: PetPosition = position ?? { x: rect.left, y: rect.top };
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin };
    latestPosRef.current = origin;
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY) > 6) {
      movedRef.current = true;
    }
    const next = clampToViewport(
      drag.origin.x + (event.clientX - drag.startX),
      drag.origin.y + (event.clientY - drag.startY),
    );
    latestPosRef.current = next;
    setPosition(next);
  };

  const onDragEnd = () => {
    const wasDragged = Boolean(dragRef.current) && movedRef.current;
    dragRef.current = null;
    const pos = latestPosRef.current;
    if (pos) {
      try {
        window.localStorage.setItem(POSITION_KEY, JSON.stringify(pos));
      } catch { /* 存不上就下次回到默认位置 */ }
    }
    // 点一下（没拖动）= 摸摸头：蹦一下 + 冒爱心。
    if (!wasDragged) {
      sceneHandle?.poke();
      lastActivityRef.current = Date.now();
      const id = ++heartIdRef.current;
      setHearts((h) => [...h, id]);
      window.setTimeout(() => setHearts((h) => h.filter((x) => x !== id)), 900);
    }
  };

  // 眼神跟随：把指针位置换算成 -1..1 告诉场景；鼠标动过就算一次互动。
  const updateLook = (event: React.PointerEvent<HTMLDivElement>) => {
    lastActivityRef.current = Date.now();
    const rect = petRef.current?.getBoundingClientRect();
    if (!rect) return;
    const nx = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((event.clientY - rect.top) / rect.height) * 2 - 1;
    sceneHandle?.setLook(Math.max(-1, Math.min(1, nx)), Math.max(-1, Math.min(1, -ny)));
  };

  return (
    <>
      <button
        type="button"
        onClick={toggle}
        title={t("pet.title")}
        aria-label={t("pet.title")}
        aria-pressed={visible}
      >
        <svg width="19" height="19" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" />
        </svg>
        <span className="workbench-settings-label">{t("pet.title")}</span>
      </button>
      {visible && createPortal(
        <div
          ref={petRef}
          className={styles.pet}
          style={{ touchAction: "none", ...(position ? { left: position.x, top: position.y, right: "auto", bottom: "auto" } : {}) }}
          onDoubleClick={() => sceneHandle?.spin()}
          onPointerDown={onDragStart}
          onPointerMove={(event) => { updateLook(event); onDragMove(event); }}
          onPointerLeave={() => sceneHandle?.setLook(0, 0)}
          onPointerUp={onDragEnd}
          onPointerCancel={onDragEnd}
        >
          {greeting && <div className={styles.bubble}>{greeting}</div>}
          {sleepy && (
            <div className={styles.zzz}>
              <span>z</span>
              <span>z</span>
              <span>Z</span>
            </div>
          )}
          {/* 3D 场景的宿主；three 加载完成前显示 2D SVG。 */}
          <div ref={canvasHostRef} className={render3D ? styles.canvasHost : undefined}>
            {hearts.map((id) => (
              <span key={id} className={styles.heart} style={{ left: `${28 + ((id * 23) % 44)}%` }}>💗</span>
            ))}
            {!render3D && (
              <svg className={styles.mascot} viewBox="0 0 64 64" role="img" aria-label={t("pet.title")}>
                <PetFace mood={mood} sleepy={sleepy} />
              </svg>
            )}
          </div>
        </div>,
        // 挂到 body 上，避开侧边栏的 overflow 裁剪：fixed 定位才能真正全屏拖动。
        document.body,
      )}
    </>
  );
}
