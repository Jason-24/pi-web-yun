"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { useIsMobile } from "@/hooks/useIsMobile";
import { sideChatTitle } from "@/lib/session-family";
import type { SessionUsageSummary } from "@/lib/session-stats";
import { formatActiveDuration, formatCompactCount, formatCostShort } from "@/lib/session-stats-format";
import type { SessionInfo, SubagentSessionStatus } from "@/lib/types";
import { DeleteConfirm } from "./SessionTree";
import { TrashIcon } from "./SidebarIcons";
import { SidebarMenu, type SidebarMenuAnchor } from "./SidebarMenu";
import styles from "./AgentSessionPanel.module.css";

interface Props {
  rootSession: SessionInfo;
  subagents: SessionInfo[];
  selectedSessionId: string;
  runningSessionIds: ReadonlySet<string>;
  onSelectSession: (session: SessionInfo) => void;
  /** Subagents with a viewer tab in the open right panel. */
  openSubagentTabIds: ReadonlySet<string>;
  /** Toggles the member's live chat tab in the right panel. */
  onToggleSubagentTab: (sessionId: string, label: string, side?: boolean) => void;
  /** Forks the main agent into a side chat and opens its tab; answers the refusal to show, or null. */
  onNewSideChat: () => Promise<string | null>;
  /** Deletes one side chat and its tab; answers the failure to show, or null. */
  onDeleteSideChat: (sessionId: string) => Promise<string | null>;
}

const STATS_POLL_MS = 3000;

/**
 * Usage of every agent in the family, as the toolbar's stats popover counts
 * it. Read on open and whenever a run starts or ends; polled while one runs,
 * on a visible page, one request at a time.
 */
function useAgentUsage(ids: readonly string[], runningKey: string): Record<string, SessionUsageSummary> {
  const [usage, setUsage] = useState<Record<string, SessionUsageSummary>>({});
  const idsKey = ids.join(",");
  useEffect(() => {
    const requested = idsKey ? idsKey.split(",") : [];
    if (requested.length === 0) return;
    const controller = new AbortController();
    let inFlight = false;
    const load = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const res = await fetch("/api/sessions/stats", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: requested }),
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json() as { stats?: Record<string, SessionUsageSummary> };
        if (!controller.signal.aborted && data.stats) setUsage(data.stats);
      } catch {
        /* best-effort: rows keep their last numbers */
      } finally {
        inFlight = false;
      }
    };
    void load();
    if (!runningKey) return () => controller.abort();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, STATS_POLL_MS);
    return () => {
      clearInterval(timer);
      controller.abort();
    };
  }, [idsKey, runningKey]);
  return usage;
}

function usageTooltip(usage: SessionUsageSummary, t: (key: string) => string, locale: string): string {
  const { tokens } = usage;
  return [
    `${t("session.totalActive")}: ${formatActiveDuration(usage.totalActiveMs)}`,
    `${t("session.input")}: ${tokens.input.toLocaleString(locale)}`,
    `${t("session.output")}: ${tokens.output.toLocaleString(locale)}`,
    ...(tokens.cacheRead > 0 ? [`${t("session.cacheRead")}: ${tokens.cacheRead.toLocaleString(locale)}`] : []),
    ...(tokens.cacheWrite > 0 ? [`${t("session.cacheWrite")}: ${tokens.cacheWrite.toLocaleString(locale)}`] : []),
    `${t("session.total")}: ${tokens.total.toLocaleString(locale)}`,
    ...(usage.cost > 0 ? [`${t("session.cost")}: $${usage.cost.toFixed(4)}`] : []),
    `${t("session.toolCalls")}: ${usage.toolCalls.toLocaleString(locale)}`,
  ].join("\n");
}

function UsageLine({ usage, style }: { usage: SessionUsageSummary; style?: React.CSSProperties }) {
  const { locale, t } = useI18n();
  const cost = formatCostShort(usage.cost);
  return (
    <span
      title={usageTooltip(usage, t, locale)}
      style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0, color: "var(--text-dim)", fontSize: 11, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", ...style }}
    >
      {usage.totalActiveMs > 0 && (
        <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" />
          </svg>
          {formatActiveDuration(usage.totalActiveMs)}
        </span>
      )}
      {usage.tokens.total > 0 && (
        <span>{t("agentSwitcher.tokens", { count: formatCompactCount(usage.tokens.total) })}</span>
      )}
      {cost && <span style={{ color: "var(--text-muted)" }}>{cost}</span>}
    </span>
  );
}

function hasUsage(usage: SessionUsageSummary | undefined): usage is SessionUsageSummary {
  return Boolean(usage && (usage.tokens.total > 0 || usage.totalActiveMs > 0));
}

function sessionTitle(session: SessionInfo): string {
  return session.name || session.firstMessage || session.id.slice(0, 12);
}

function formatRelativeTime(value: string, locale: string): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) return "";
  const elapsedSeconds = Math.round((timestamp - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
  if (Math.abs(elapsedSeconds) < 60) return formatter.format(elapsedSeconds, "second");
  const elapsedMinutes = Math.round(elapsedSeconds / 60);
  if (Math.abs(elapsedMinutes) < 60) return formatter.format(elapsedMinutes, "minute");
  const elapsedHours = Math.round(elapsedMinutes / 60);
  if (Math.abs(elapsedHours) < 24) return formatter.format(elapsedHours, "hour");
  return formatter.format(Math.round(elapsedHours / 24), "day");
}

export function statusColor(status: SubagentSessionStatus): string {
  if (status === "running" || status === "starting") return "var(--accent)";
  if (status === "completed") return "#16a34a";
  if (status === "failed") return "#dc2626";
  if (status === "aborted") return "#d97706";
  return "var(--text-dim)";
}

export function StatusIcon({ status }: { status: SubagentSessionStatus }) {
  if (status === "queued") return <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
  if (status === "running" || status === "starting") {
    return (
      <svg className="animate-spin" width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" opacity="0.25" />
        <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
      </svg>
    );
  }
  if (status === "failed") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" />
      </svg>
    );
  }
  if (status === "aborted" || status === "interrupted") {
    return (
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
        <circle cx="12" cy="12" r="9" /><path d="M9 9h6v6H9z" />
      </svg>
    );
  }
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" />
    </svg>
  );
}

function SessionIcon({ kind }: { kind: "main" | "side" | "subagent" }) {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {kind === "main" ? <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>
      : kind === "side" ? <path d="M21 12a8 8 0 0 1-8 8H5.5a2 2 0 0 1-1.4-3.4A8 8 0 1 1 21 12z" />
        : <><rect x="5" y="7" width="14" height="11" rx="2" /><path d="M9 11h.01M15 11h.01M9 15h6M12 7V4M10 4h4" /></>}
  </svg>;
}

function memberTitle(session: SessionInfo, t: (key: string) => string): string {
  return session.relation?.kind === "side" ? sideChatTitle(session, t("agentSwitcher.sideChat"))
    : session.relation?.kind === "subagent" ? session.relation.description || sessionTitle(session) : sessionTitle(session);
}

export function AgentSessionPanel({ rootSession, subagents, selectedSessionId, runningSessionIds, onSelectSession, openSubagentTabIds, onToggleSubagentTab, onNewSideChat, onDeleteSideChat }: Props) {
  const { t, locale } = useI18n();
  const mobile = useIsMobile();
  const [query, setQuery] = useState("");
  const [inspectedId, setInspectedId] = useState(selectedSessionId);
  const [newSideChatPending, setNewSideChatPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [menuAnchor, setMenuAnchor] = useState<SidebarMenuAnchor | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLDivElement>(null);

  const sorted = useMemo(() => [...subagents].sort((a, b) => {
    const live = Number(runningSessionIds.has(b.id)) - Number(runningSessionIds.has(a.id));
    return live || b.modified.localeCompare(a.modified);
  }), [subagents, runningSessionIds]);
  const normalizedQuery = query.trim().toLocaleLowerCase(locale);
  const visible = sorted.filter(session => {
    const relation = session.relation?.kind === "subagent" ? session.relation : null;
    return !normalizedQuery || [memberTitle(session, t), relation?.profile, session.firstMessage,
      session.relation?.kind === "side" ? t("agentSwitcher.sideChat") : t("agentSwitcher.subagent")]
      .some(value => value?.toLocaleLowerCase(locale).includes(normalizedQuery));
  });
  const sides = sorted.filter(session => session.relation?.kind === "side");
  const children = sorted.filter(session => session.relation?.kind !== "side");
  const visibleSides = visible.filter(session => session.relation?.kind === "side");
  const visibleChildren = visible.filter(session => session.relation?.kind !== "side");
  const listed = [rootSession, ...visibleSides, ...visibleChildren];
  const inspected = listed.find(session => session.id === inspectedId) ?? rootSession;
  const main = inspected.id === rootSession.id;
  const side = inspected.relation?.kind === "side";
  const relation = inspected.relation?.kind === "subagent" ? inspected.relation : null;
  const current = inspected.id === selectedSessionId;
  const running = runningSessionIds.has(inspected.id);
  const status = running ? "running" : relation?.status;
  const kind = main ? "main" : side ? "side" : "subagent";
  const title = memberTitle(inspected, t);
  const typeLabel = t(main ? "collaboration.mainSession" : side ? "agentSwitcher.sideChat" : "agentSwitcher.subagent");
  const familyIds = useMemo(() => [rootSession.id, ...subagents.map(session => session.id)], [rootSession.id, subagents]);
  const runningKey = familyIds.filter(id => runningSessionIds.has(id)).join(",");
  const usage = useAgentUsage(familyIds, runningKey);
  const detailUsage = usage[inspected.id];
  const familyUsage = useMemo(() => {
    const known = familyIds.map(id => usage[id]).filter((item): item is SessionUsageSummary => Boolean(item));
    if (!known.length) return null;
    return known.reduce<SessionUsageSummary>((total, item) => ({
      tokens: { input: total.tokens.input + item.tokens.input, output: total.tokens.output + item.tokens.output,
        cacheRead: total.tokens.cacheRead + item.tokens.cacheRead, cacheWrite: total.tokens.cacheWrite + item.tokens.cacheWrite,
        total: total.tokens.total + item.tokens.total },
      cost: total.cost + item.cost, toolCalls: total.toolCalls + item.toolCalls, totalActiveMs: total.totalActiveMs + item.totalActiveMs,
    }), { tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }, cost: 0, toolCalls: 0, totalActiveMs: 0 });
  }, [familyIds, usage]);
  const runningCount = familyIds.filter(id => runningSessionIds.has(id)).length;

  useEffect(() => {
    if (!confirmingId) return;
    const frame = requestAnimationFrame(() => confirmRef.current?.querySelector<HTMLButtonElement>(".session-tree-confirm-cancel")?.focus());
    return () => cancelAnimationFrame(frame);
  }, [confirmingId]);

  const inspect = (id: string) => { setInspectedId(id); setConfirmingId(null); setMenuAnchor(null); };
  const createSideChat = async () => {
    if (newSideChatPending) return;
    setNewSideChatPending(true); setError(null);
    try { setError(await onNewSideChat()); }
    catch (caught) { setError(caught instanceof Error ? caught.message : String(caught)); }
    finally { setNewSideChatPending(false); }
  };
  const cancelDelete = () => { setConfirmingId(null); menuButtonRef.current?.focus(); };
  const deleteSideChat = async (id: string) => {
    if (deletingId) return;
    setConfirmingId(null); setDeletingId(id); setError(null);
    try {
      const failure = await onDeleteSideChat(id);
      if (failure) setError(t("sidebar.deleteFailed", { error: failure }));
      else {
        setInspectedId(rootSession.id);
        listRef.current?.querySelector<HTMLButtonElement>("[data-collaboration-session]")?.focus();
      }
    } catch (caught) { setError(t("sidebar.deleteFailed", { error: caught instanceof Error ? caught.message : String(caught) })); }
    finally { setDeletingId(null); }
  };
  const toggleTab = () => onToggleSubagentTab(inspected.id, side ? t("sideChat.title") : title, side);
  const renderGroup = (label: string, members: SessionInfo[], count: number, empty?: string) => <section className={styles.group} key={label} aria-label={label}>
    <h2>{label}<span>{count}</span></h2>
    {members.map(session => {
      const isMain = session.id === rootSession.id;
      const isSide = session.relation?.kind === "side";
      const child = session.relation?.kind === "subagent" ? session.relation : null;
      const active = runningSessionIds.has(session.id);
      const model = usage[session.id]?.model;
      const level = usage[session.id]?.thinkingLevel;
      const metadata = [child?.profile, model?.modelId, level && level !== "off" ? level : null].filter(Boolean).join(" · ");
      return <button key={session.id} type="button" data-collaboration-session={session.id}
        className={styles.member} aria-pressed={inspected.id === session.id} aria-controls="collaboration-detail"
        onClick={() => inspect(session.id)} title={[memberTitle(session, t), model ? `${model.provider}/${model.modelId}` : "", metadata].filter(Boolean).join("\n")}>
        <span className={styles.memberIcon}><SessionIcon kind={isMain ? "main" : isSide ? "side" : "subagent"} /></span>
        <span className={styles.memberCopy}><strong>{memberTitle(session, t)}</strong>
          <span>{isMain ? t(session.id === selectedSessionId ? "collaboration.currentChat" : "agentSwitcher.main")
            : metadata || formatRelativeTime(session.modified, locale)}</span>
          {hasUsage(usage[session.id]) && <UsageLine usage={usage[session.id]} />}
        </span>
        {(active || child) && <span className={styles.memberStatus} style={{ color: statusColor(active ? "running" : child!.status) }}
          title={t(`agentSwitcher.status.${active ? "running" : child!.status}`)}><StatusIcon status={active ? "running" : child!.status} /></span>}
      </button>;
    })}
    {members.length === 0 && count === 0 && empty && <p className={styles.empty}>{empty}</p>}
  </section>;

  return <div className={styles.panel}>
    <div className={styles.toolbar}>
      <p>{t("collaboration.counts", { sides: sides.length, agents: children.length })}</p>
      <button type="button" className={`${styles.action} ${styles.primary}`} disabled={newSideChatPending} onClick={() => { void createSideChat(); }}>
        <span aria-hidden="true">+</span>{t("sideChat.new")}
      </button>
    </div>
    <div className={styles.summary}>
      <span title={t("collaboration.totalUsageHint")}>{t("collaboration.totalUsage")}</span>
      {familyUsage ? <UsageLine usage={familyUsage} /> : <span>—</span>}
      {runningCount > 0 && <span>{t("agentSwitcher.runningCount", { count: runningCount })}</span>}
    </div>
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.layout}>
      <nav className={styles.list} aria-label={t("collaboration.sessions")} ref={listRef} onKeyDown={event => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.nativeEvent.isComposing) return;
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !(event.target instanceof HTMLElement)
          || !event.target.closest("[data-collaboration-session]")) return;
        const buttons = [...event.currentTarget.querySelectorAll<HTMLButtonElement>("[data-collaboration-session]")];
        const index = buttons.findIndex(button => button === document.activeElement);
        const next = event.key === "Home" ? 0 : event.key === "End" ? buttons.length - 1
          : Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
        event.preventDefault(); buttons[next]?.focus();
        const id = buttons[next]?.dataset.collaborationSession;
        if (id) inspect(id);
      }}>
        {subagents.length > 8 && <input className={styles.search} type="search" value={query} onChange={event => setQuery(event.target.value)}
          placeholder={t("agentSwitcher.search")} aria-label={t("agentSwitcher.search")} />}
        {renderGroup(t("collaboration.mainSession"), [rootSession], 1)}
        {renderGroup(t("collaboration.sideChats"), visibleSides, sides.length, t("collaboration.noSides"))}
        {renderGroup(t("collaboration.subagents"), visibleChildren, children.length, t("collaboration.noSubagents"))}
        {normalizedQuery && !visible.length && <p className={styles.empty}>{t("agentSwitcher.noMatches")}</p>}
      </nav>
      <section id="collaboration-detail" className={styles.detail} aria-label={t("collaboration.details")}>
        <header className={styles.detailHeader}><SessionIcon kind={kind} /><div><h2>{title}</h2>
          <p>{typeLabel}{current && <span className={styles.current}>{t("collaboration.currentChat")}</span>}</p></div></header>
        <dl className={styles.fields}>
          <dt>{t("collaboration.status")}</dt><dd className={styles.status}>
            {status ? <><StatusIcon status={status} /><span>{t(`agentSwitcher.status.${status}`)}</span></> : t("collaboration.idle")}
          </dd>
          {relation?.profile && <><dt>{t("collaboration.profile")}</dt><dd>{relation.profile}</dd></>}
          {detailUsage?.model && <><dt>{t("collaboration.model")}</dt><dd title={`${detailUsage.model.provider}/${detailUsage.model.modelId}`}>{detailUsage.model.modelId}</dd></>}
          {detailUsage?.thinkingLevel && detailUsage.thinkingLevel !== "off" && <><dt>{t("collaboration.thinking")}</dt><dd>{detailUsage.thinkingLevel}</dd></>}
          <dt>{t("collaboration.updated")}</dt><dd><time dateTime={inspected.modified} title={new Date(inspected.modified).toLocaleString(locale)}>{formatRelativeTime(inspected.modified, locale) || "—"}</time></dd>
        </dl>
        <dl className={styles.fields} title={detailUsage ? usageTooltip(detailUsage, t, locale) : undefined}>
          <dt>{t("session.totalActive")}</dt><dd>{detailUsage ? formatActiveDuration(detailUsage.totalActiveMs) : "—"}</dd>
          <dt>{t("session.total")}</dt><dd>{detailUsage ? t("agentSwitcher.tokens", { count: formatCompactCount(detailUsage.tokens.total) }) : "—"}</dd>
          <dt>{t("session.cost")}</dt><dd>{detailUsage ? formatCostShort(detailUsage.cost) || "$0.00" : "—"}</dd>
          <dt>{t("session.toolCalls")}</dt><dd>{detailUsage ? detailUsage.toolCalls.toLocaleString(locale) : "—"}</dd>
        </dl>
        <div className={styles.actions}>
          <button type="button" className={styles.action} onClick={() => onSelectSession(inspected)}>{t(current ? "collaboration.continue" : "collaboration.openMain")}</button>
          {!main && <button type="button" className={styles.action} aria-pressed={openSubagentTabIds.has(inspected.id)} disabled={current} onClick={toggleTab}
            title={current ? t("agentSwitcher.openInMainChat") : undefined}>
            {t(openSubagentTabIds.has(inspected.id) ? "collaboration.closePanel" : "collaboration.openPanel")}
          </button>}
          {side && <button ref={menuButtonRef} type="button" className={`${styles.action} ${styles.more}`} aria-haspopup="menu" aria-expanded={Boolean(menuAnchor)}
            disabled={Boolean(deletingId)} onClick={() => {
              const rect = menuButtonRef.current?.getBoundingClientRect();
              if (rect) setMenuAnchor({ kind: "rect", rect, align: "end" });
            }}>{t("collaboration.more")}</button>}
        </div>
        {confirmingId === inspected.id && <div ref={confirmRef} className={styles.confirm} onKeyDown={event => {
          if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); cancelDelete(); }
        }}><DeleteConfirm label={t("sidebar.deleteSession", { title })} deleteLabel={t("sidebar.delete")} cancelLabel={t("sidebar.cancel")}
            onConfirm={() => { void deleteSideChat(inspected.id); }} onCancel={cancelDelete} /></div>}
      </section>
    </div>
    <SidebarMenu open={side && Boolean(menuAnchor)} anchor={menuAnchor} sheet={mobile} ariaLabel={t("collaboration.more")} title={title}
      cancelLabel={t("sidebar.cancel")} returnFocusTo={menuButtonRef.current} onClose={() => setMenuAnchor(null)} items={side ? [{
        type: "item", id: "delete", label: t("sidebar.delete"), icon: <TrashIcon size={14} />, danger: true,
        onSelect: () => setConfirmingId(inspected.id),
      }] : []} />
  </div>;
}
