"use client";

import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { formatCompactCount } from "@/lib/session-stats-format";
import styles from "./ContextUsageIndicator.module.css";

type Usage = { percent: number | null; contextWindow: number; tokens: number | null };

export function ContextUsageIndicator({ usage, onClick, expanded }: { usage: Usage; onClick: () => void; expanded: boolean }) {
  const { t } = useI18n();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [position, setPosition] = useState<{ left: number; top: number } | null>(null);
  const percent = usage.percent === null ? null : Math.max(0, Math.min(100, usage.percent));
  const color = percent !== null && percent > 90 ? "#ef4444" : percent !== null && percent > 70 ? "#d9a323" : "var(--text-muted)";
  const summary = percent === null ? t("session.contextUnknown") : t("session.contextPercent", { used: Math.round(percent), remaining: 100 - Math.round(percent) });
  const counts = t("session.contextTokens", { used: usage.tokens === null ? "?" : formatCompactCount(usage.tokens), total: formatCompactCount(usage.contextWindow) });
  const close = () => { clearTimeout(timer.current); setPosition(null); };
  const show = () => {
    clearTimeout(timer.current);
    const rect = trigger.current?.getBoundingClientRect();
    if (rect) setPosition({ left: Math.max(118, Math.min(window.innerWidth - 118, rect.left + rect.width / 2)), top: rect.top - 9 });
  };
  const leave = () => { timer.current = setTimeout(close, 120); };

  useEffect(() => {
    const dismiss = () => setPosition(null);
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.stopPropagation(); dismiss(); }
    };
    if (position) {
      window.addEventListener("resize", dismiss);
      document.addEventListener("scroll", dismiss, true);
      document.addEventListener("keydown", keydown, true);
    }
    return () => {
      window.removeEventListener("resize", dismiss);
      document.removeEventListener("scroll", dismiss, true);
      document.removeEventListener("keydown", keydown, true);
    };
  }, [position]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return <>
    <button ref={trigger} type="button" className={styles.trigger} data-context-usage=""
      aria-label={`${t("session.contextWindow")}: ${summary}; ${counts}`}
      aria-describedby={position ? id : undefined} aria-expanded={expanded} aria-controls="workspace-usage-page"
      onPointerEnter={show} onPointerLeave={leave} onFocus={show} onBlur={close}
      onClick={() => { close(); onClick(); }}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2.5" opacity="0.2" />
        <circle cx="12" cy="12" r="9" stroke={color} strokeWidth="2.5" pathLength="100"
          strokeDasharray={`${percent ?? 0} 100`} strokeLinecap="round" transform="rotate(-90 12 12)" />
      </svg>
    </button>
    {position && createPortal(<div id={id} role="tooltip" className={styles.tooltip}
      style={{ left: position.left, top: position.top }} onPointerEnter={() => clearTimeout(timer.current)} onPointerLeave={leave}>
      <span>{t("session.contextWindow")}</span>
      <strong>{summary}</strong>
      <span className={styles.counts}>{counts}</span>
    </div>, document.body)}
  </>;
}
