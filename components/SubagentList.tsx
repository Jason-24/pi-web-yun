"use client";

import { useI18n } from "@/hooks/useI18n";
import { subagentTitle } from "@/lib/session-family";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { SubagentFlower } from "./SubagentSummary";
import { AgentsIcon } from "./SidebarIcons";
import styles from "./SubagentList.module.css";

const groups = ["active", "completed", "failed", "aborted", "interrupted"] as const;
const activeStatuses: SubagentSessionStatus[] = ["running", "starting", "queued"];

export function SubagentList({ subagents, runningSessionIds, sessionId, onOpen, onOpenCollaboration }: {
  subagents: readonly SessionInfo[];
  runningSessionIds: ReadonlySet<string>;
  sessionId: string | null;
  onOpen: (id: string, label: string) => void;
  onOpenCollaboration: () => void;
}) {
  const { t } = useI18n();
  const children = subagents.filter(session => session.relation?.kind === "subagent")
    .sort((a, b) => a.created.localeCompare(b.created) || a.id.localeCompare(b.id))
    .map((session, index) => ({ session, index, status: runningSessionIds.has(session.id) ? "running" as const
      : session.relation?.kind === "subagent" ? session.relation.status : "interrupted" as const }));
  return <div className={styles.list} data-subagent-list="" role="region" aria-label={t("agentSummary.title")}>
    {groups.map(group => {
      const items = children.filter(({ status }) => group === "active" ? activeStatuses.includes(status) : status === group);
      if (items.length === 0 && group !== "active" && group !== "completed") return null;
      const heading = group === "active" ? t("agentList.active") : t(`agentSwitcher.status.${group}`);
      return <section key={group} className={styles.group} aria-label={heading}>
        <div className={styles.heading}><h3>{heading} · {items.length}</h3>
          {group === "active" && <button type="button" className={styles.collaboration} onClick={onOpenCollaboration}
            aria-label={t("collaboration.title")} title={t("collaboration.title")}><AgentsIcon size={17} /></button>}
        </div>
        {items.length === 0 && <p>{t(group === "active" ? "agentList.noActive" : "agentList.noCompleted")}</p>}
        {items.map(({ session, index, status }) => {
          const title = subagentTitle(session);
          const current = session.id === sessionId;
          return <button key={session.id} type="button" className={styles.row} data-subagent-id={session.id}
            disabled={current} aria-current={current ? "true" : undefined}
            title={current ? t("agentSwitcher.current") : title} onClick={() => onOpen(session.id, title)}>
            <SubagentFlower identity={session.id} index={index} running={status === "running" || status === "starting"} />
            <span className={styles.name}>{title}</span>
            {(current || activeStatuses.includes(status)) && <small>{t(current ? "agentSwitcher.current" : `agentSwitcher.status.${status}`)}</small>}
          </button>;
        })}
      </section>;
    })}
  </div>;
}
