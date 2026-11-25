"use client";

import { useI18n } from "@/hooks/useI18n";
import { useId } from "react";
import { subagentTitle } from "@/lib/session-family";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import styles from "./SubagentSummary.module.css";

const colors = ["#f38bc0", "#9cda78", "#ff8e96"];
const statusOrder: SubagentSessionStatus[] = ["running", "starting", "queued", "failed", "interrupted", "aborted", "completed"];

export function SubagentFlower({ identity, running, index }: { identity: string; running: boolean; index: number }) {
  const gradient = useId();
  const hash = [...identity].reduce((value, char) => (value * 31 + char.charCodeAt(0)) >>> 0, 0);
  return <svg className={`${styles.flower}${running ? ` ${styles.running}` : ""}`} width="25" height="25" viewBox="0 0 24 24" aria-hidden="true"
    style={{ color: colors[index % colors.length] }}>
    <defs><linearGradient id={gradient} x1="8" y1="2" x2="14" y2="12" gradientUnits="userSpaceOnUse">
      <stop stopColor="currentColor" stopOpacity=".5" /><stop offset=".65" stopColor="currentColor" /><stop offset="1" stopColor="currentColor" stopOpacity=".8" />
    </linearGradient></defs>
    <g transform={`rotate(${hash % 60} 12 12)`}>{[0, 60, 120, 180, 240, 300].map(angle => <g key={angle} transform={`rotate(${angle} 12 12)`}>
      <path d="M11.8 11.4C8.6 9.9 7.5 5.4 9.2 2.8C10.4 1 13 1.4 13.9 3.3C15 5.8 13.6 9.1 11.8 11.4Z" fill={`url(#${gradient})`} />
      <path d="M11.8 10.2C10.2 8.4 9.5 5.2 10.3 3.5" fill="none" stroke="white" strokeOpacity=".45" strokeWidth=".65" strokeLinecap="round" />
    </g>)}</g>
    <circle cx="12" cy="12" r="1.4" fill="currentColor" opacity=".65" />
  </svg>;
}

/** A compact entry into the child list; reads only the family catalogue. */
export function SubagentSummary({ subagents, runningSessionIds, onOpen }: {
  subagents: readonly SessionInfo[];
  runningSessionIds: ReadonlySet<string>;
  onOpen: () => void;
}) {
  const { t } = useI18n();
  const children = subagents.filter(session => session.relation?.kind === "subagent");
  if (children.length === 0) return null;
  const counts = new Map<SubagentSessionStatus, number>();
  for (const session of children) {
    if (session.relation?.kind !== "subagent") continue;
    const status = runningSessionIds.has(session.id) ? "running" : session.relation.status;
    counts.set(status, (counts.get(status) ?? 0) + 1);
  }
  const statusLabels = statusOrder.filter(status => counts.has(status)).map(status => t("agentSummary.countStatus", {
    count: counts.get(status)!, status: t(`agentSwitcher.status.${status}`),
  }));
  const summary = statusLabels.join(t("agentSummary.separator"));
  const preview = [...children].sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id)).slice(0, 3);
  return <div className={styles.container} data-subagent-summary="">
    <button type="button" className={styles.card} onClick={onOpen} aria-label={`${t("agentSummary.title")} · ${summary}`}>
      <span className={styles.heading}>{t("agentSummary.title")}</span>
      <span className={styles.row}>
        <span className={styles.avatars} aria-hidden="true">{preview.map((session, index) => <span key={session.id} title={subagentTitle(session)}>
          <SubagentFlower identity={session.id} index={index} running={runningSessionIds.has(session.id) || (session.relation?.kind === "subagent" && ["running", "starting"].includes(session.relation.status))} />
        </span>)}</span>
        <span className={styles.status}>{statusLabels.map(label => <span key={label}>{label}</span>)}</span>
        <svg className={styles.chevron} width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m9 5 7 7-7 7" /></svg>
      </span>
    </button>
  </div>;
}
