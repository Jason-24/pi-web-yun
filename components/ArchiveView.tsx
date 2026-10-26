"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { filterArchivedSessions, type ArchiveSnapshot } from "@/lib/session-archive";
import { sessionDisplayTitle } from "@/lib/session-fork-name";
import { isPlainActivation, sessionDeepLink } from "@/lib/session-links";
import type { SessionInfo } from "@/lib/types";
import { focusIfLost } from "@/lib/stacked-dialog";
import { ArchiveIcon, FolderIcon, RestoreIcon, SearchIcon, TrashIcon } from "./SidebarIcons";

interface Props {
  snapshot: ArchiveSnapshot;
  projectKey: string | null;
  onProjectChange(projectKey: string | null): void;
  onSelectSession(session: SessionInfo): void;
  onRestore(sessionId: string): Promise<boolean>;
  onDelete(sessionId: string): Promise<boolean>;
  onRefresh(): void;
}

export function ArchiveView({ snapshot, projectKey, onProjectChange, onSelectSession, onRestore, onDelete, onRefresh }: Props) {
  const { t, locale } = useI18n();
  const [query, setQuery] = useState("");
  const [pending, setPending] = useState<ReadonlyMap<string, "restore" | "delete">>(() => new Map());
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [errors, setErrors] = useState<ReadonlyMap<string, string>>(() => new Map());
  const searchRef = useRef<HTMLInputElement>(null);
  const regionRef = useRef<HTMLDivElement>(null);
  const actionFinishedRef = useRef(false);
  const projects = useMemo(() => [...new Map(snapshot.entries.map((entry) => [entry.project.key, entry.project])).values()], [snapshot.entries]);
  const visible = useMemo(() => filterArchivedSessions(snapshot.entries, query, projectKey), [snapshot.entries, query, projectKey]);
  const groups = useMemo(() => {
    const grouped = new Map<string, typeof visible>();
    for (const entry of visible) {
      const group = grouped.get(entry.project.key);
      if (group) group.push(entry);
      else grouped.set(entry.project.key, [entry]);
    }
    return [...grouped.values()];
  }, [visible]);
  const dateFormat = useMemo(() => new Intl.DateTimeFormat(locale, { year: "numeric", month: "short", day: "numeric" }), [locale]);
  useEffect(() => {
    if (snapshot.loaded && projectKey && !projects.some((project) => project.key === projectKey)) onProjectChange(null);
  }, [snapshot.loaded, projectKey, projects, onProjectChange]);
  useLayoutEffect(() => {
    if (pending.size || actionFinishedRef.current) focusIfLost(document, window.matchMedia?.("(pointer: coarse)").matches ? regionRef.current : searchRef.current);
    actionFinishedRef.current = false;
  }, [pending, snapshot.entries]);
  useEffect(() => { setConfirmDeleteId(null); }, [query, projectKey]);
  useEffect(() => {
    if (confirmDeleteId && !snapshot.entries.some((entry) => entry.session.id === confirmDeleteId)) setConfirmDeleteId(null);
  }, [snapshot.entries, confirmDeleteId]);

  const restore = async (sessionId: string) => {
    if (pending.has(sessionId)) return;
    setPending((current) => new Map(current).set(sessionId, "restore"));
    setErrors((current) => { const next = new Map(current); next.delete(sessionId); return next; });
    try {
      if (!await onRestore(sessionId)) throw new Error("restore failed");
    } catch {
      setErrors((current) => new Map(current).set(sessionId, t("archive.restoreFailed")));
    } finally {
      actionFinishedRef.current = true;
      setPending((current) => { const next = new Map(current); next.delete(sessionId); return next; });
    }
  };

  const cancelDelete = (sessionId: string) => {
    setConfirmDeleteId(null);
    regionRef.current?.querySelector<HTMLButtonElement>(`[data-archived-session="${CSS.escape(sessionId)}"] .archive-workspace-delete`)?.focus();
  };
  const remove = async (sessionId: string) => {
    if (pending.has(sessionId)) return;
    setPending((current) => new Map(current).set(sessionId, "delete"));
    setErrors((current) => { const next = new Map(current); next.delete(sessionId); return next; });
    try {
      if (!await onDelete(sessionId)) throw new Error("delete failed");
      setConfirmDeleteId(null);
    } catch {
      setErrors((current) => new Map(current).set(sessionId, t("archive.deleteFailed")));
    } finally {
      actionFinishedRef.current = true;
      setPending((current) => { const next = new Map(current); next.delete(sessionId); return next; });
    }
  };

  return <div className="archive-workspace" ref={regionRef} tabIndex={-1}>
    <div className="archive-workspace-toolbar">
      <label className="archive-workspace-search"><SearchIcon size={16} />
        <input ref={searchRef} type="search" value={query} onChange={(event) => setQuery(event.target.value)} maxLength={200}
          placeholder={t("archive.search")} aria-label={t("archive.search")}
          onKeyDown={(event) => {
            if (event.key === "Escape" && query && !event.nativeEvent.isComposing && event.keyCode !== 229) {
              event.stopPropagation(); event.preventDefault(); setQuery("");
            }
          }} />
      </label>
      <select value={projectKey ?? ""} onChange={(event) => onProjectChange(event.target.value || null)} aria-label={t("archive.projectFilter")}>
        <option value="">{t("archive.allProjects")}</option>
        {projects.map((project) => <option key={project.key} value={project.key}>{project.name}</option>)}
      </select>
      <span className="archive-workspace-count" role="status">{t("archive.count", { count: visible.length })}</span>
    </div>
    <p className="archive-workspace-description">{t("archive.description")}</p>
    {snapshot.error && <div className="archive-workspace-error" role="alert">{t("archive.loadFailed")}
      <button type="button" onClick={onRefresh}>{t("i18n.refresh")}</button>
    </div>}
    {!snapshot.loaded ? <p className="archive-workspace-empty" role="status">{t("archive.loading")}</p>
      : visible.length ? groups.map((entries) => <section className="archive-workspace-group" key={entries[0].project.key} aria-label={entries[0].project.name}>
        <h2 title={entries[0].project.root}><FolderIcon size={16} /><span>{entries[0].project.name}</span><small>{entries.length}</small></h2>
        {entries.map(({ session, archivedAt }) => {
          const title = sessionDisplayTitle(session);
          return <div className="archive-workspace-row" data-archived-session={session.id} key={session.id}>
            <a href={sessionDeepLink(session.id)} title={title} onClick={(event) => {
              if (!isPlainActivation(event)) return;
              event.preventDefault(); onSelectSession(session);
            }}><ArchiveIcon size={16} /><span className="archive-workspace-title">{title}</span>
              <time dateTime={new Date(archivedAt).toISOString()} title={t("archive.archivedOn")}>{dateFormat.format(archivedAt)}</time>
            </a>
            <button type="button" className="archive-workspace-restore" onClick={() => void restore(session.id)} disabled={pending.has(session.id)}
              aria-label={t("archive.restoreSession", { title })}>
              <RestoreIcon size={15} />{t(pending.get(session.id) === "restore" ? "archive.restoring" : "sidebar.restore")}
            </button>
            <button type="button" className="archive-workspace-delete" disabled={pending.has(session.id)}
              aria-label={t("archive.deleteSession", { title })} aria-expanded={confirmDeleteId === session.id}
              onClick={() => {
                setErrors((current) => { const next = new Map(current); next.delete(session.id); return next; });
                setConfirmDeleteId(session.id);
              }}><TrashIcon size={15} />{t("sidebar.delete")}</button>
            {confirmDeleteId === session.id && <div className="archive-delete-confirmation" role="group" aria-label={t("sidebar.deleteSession", { title })}
              onKeyDown={(event) => {
                if (event.key === "Escape" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                  event.preventDefault(); event.stopPropagation();
                  if (!pending.has(session.id)) cancelDelete(session.id);
                }
              }}>
              <div><strong>{t("sidebar.deleteSession", { title })}</strong><p>{t("archive.deleteWarning")}</p></div>
              <button type="button" autoFocus disabled={pending.has(session.id)} onClick={() => cancelDelete(session.id)}>{t("sidebar.cancel")}</button>
              <button type="button" className="is-danger" disabled={pending.has(session.id)} onClick={() => void remove(session.id)}>
                {t(pending.get(session.id) === "delete" ? "archive.deleting" : "sidebar.delete")}
              </button>
            </div>}
            {errors.has(session.id) && <p className="archive-workspace-row-error" role="alert">{errors.get(session.id)}</p>}
          </div>;
        })}
      </section>) : !snapshot.error && <p className="archive-workspace-empty">{t(snapshot.entries.length ? "archive.noMatches" : "sidebar.noArchived")}</p>}
  </div>;
}
