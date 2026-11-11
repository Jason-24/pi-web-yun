"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import { sameOverviewDirectory, type OverviewSources } from "@/lib/session-overview";
import type { GitStatusResponse } from "@/lib/git-types";
import type { TerminalTab } from "./terminal-tab-state";
import { placeSidebarMenu } from "./SidebarMenu";
import { ImagePreview } from "./ImagePreview";
import { getFileIcon } from "./FileIcons";
import styles from "./SessionOverview.module.css";

interface Props {
  cwd: string | null;
  sessionId: string | null;
  leafId: string | null;
  mobile: boolean;
  covered?: boolean;
  refreshKey: string;
  terminals: TerminalTab[];
  onOpenFile(path: string, diff?: boolean): void;
  onOpenTerminal(id: string): void;
}
type Remote<T> = { data: T | null; loading: boolean; error: boolean; url?: string };
const initial = { data: null, loading: true, error: false };
const PREVIEW_LIMIT = 3;

export function SessionOverview({ cwd, sessionId, leafId, mobile, covered, refreshKey, terminals, onOpenFile, onOpenTerminal }: Props) {
  const { t } = useI18n();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const closeButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = useRef(true);
  const [open, setOpen] = useState(false);
  const [reload, setReload] = useState(0);
  const [allFiles, setAllFiles] = useState(false);
  const [allSources, setAllSources] = useState(false);
  const [git, setGit] = useState<Remote<GitStatusResponse>>(initial);
  const [sources, setSources] = useState<Remote<OverviewSources>>(initial);
  const currentTerminals = terminals.filter(tab => !tab.closing && cwd && sameOverviewDirectory(tab.cwd, cwd));
  const sourceUrl = sessionId ? `/api/sessions/${encodeURIComponent(sessionId)}/sources${leafId ? `?leafId=${encodeURIComponent(leafId)}` : ""}` : null;

  useEffect(() => {
    if (!open || !cwd) return;
    const controller = new AbortController();
    const load = <T,>(url: string, set: Dispatch<SetStateAction<Remote<T>>>) => {
      set(previous => ({ data: previous.url === url ? previous.data : null, url, loading: true, error: false }));
      fetch(url, { signal: controller.signal }).then(async response => {
        if (!response.ok) throw new Error("read failed");
        const data = await response.json() as T;
        if (!controller.signal.aborted) set({ data, url, loading: false, error: false });
      }).catch(() => {
        if (!controller.signal.aborted) set(previous => ({ ...previous, loading: false, error: true }));
      });
    };
    load(`/api/git/status?cwd=${encodeURIComponent(cwd)}`, setGit);
    if (sourceUrl) load(sourceUrl, setSources);
    else setSources({ data: { sources: [], total: 0 }, loading: false, error: false });
    const focus = () => setReload(value => value + 1);
    window.addEventListener("focus", focus);
    return () => { controller.abort(); window.removeEventListener("focus", focus); };
  }, [open, cwd, sourceUrl, refreshKey, reload]);

  useLayoutEffect(() => {
    const panel = dialog.current;
    if (!open || !panel) return;
    const opener = trigger.current;
    panel.showModal();
    closeButton.current?.focus({ preventScroll: true });
    return () => {
      if (panel.open) panel.close();
      if (restoreFocus.current && opener?.isConnected) opener.focus({ preventScroll: true });
    };
  }, [open]);

  useLayoutEffect(() => {
    const panel = dialog.current;
    const opener = trigger.current;
    if (!open || !panel || !opener) return;
    const viewport = window.visualViewport;
    const position = () => {
      const width = viewport?.width ?? innerWidth;
      const height = viewport?.height ?? innerHeight;
      const left = viewport?.offsetLeft ?? 0;
      const top = viewport?.offsetTop ?? 0;
      panel.style.maxHeight = `${Math.max(120, height - (mobile ? 16 : 24))}px`;
      panel.style.width = `${Math.min(mobile ? width : 370, width - (mobile ? 0 : 16))}px`;
      const box = panel.getBoundingClientRect();
      const location = mobile ? { left, top: top + height - box.height }
        : placeSidebarMenu({ kind: "rect", rect: opener.getBoundingClientRect(), align: "end" }, box, { left, top, width, height });
      panel.style.left = `${location.left}px`;
      panel.style.top = `${location.top}px`;
    };
    position();
    const observer = new ResizeObserver(position);
    observer.observe(panel);
    window.addEventListener("resize", position);
    viewport?.addEventListener("resize", position);
    viewport?.addEventListener("scroll", position);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", position);
      viewport?.removeEventListener("resize", position);
      viewport?.removeEventListener("scroll", position);
    };
  }, [open, mobile, allFiles, allSources, git, sources]);

  const close = (restore = true) => { restoreFocus.current = restore; setOpen(false); };
  const failure = <p role="alert">{t("overview.loadFailed")} <button className={styles.more} onClick={() => setReload(value => value + 1)}>{t("overview.retry")}</button></p>;
  const retry = <T,>(remote: Remote<T>, empty: string) => remote.loading ? <p role="status">{t("overview.loading")}</p>
    : remote.error ? failure
      : <p>{empty}</p>;
  const files = git.data?.files ?? [];
  const items = sources.data?.sources ?? [];
  return <>
    <button ref={trigger} type="button" className={styles.trigger} disabled={!cwd || covered} tabIndex={covered ? -1 : undefined}
      aria-label={t("overview.title")} title={t("overview.title")} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? id : undefined}
      onClick={() => { restoreFocus.current = true; setAllFiles(false); setAllSources(false); setOpen(true); }}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
        <circle cx="5" cy="6" r="2" /><circle cx="5" cy="18" r="2" /><path d="M11 6h10M11 18h10M3 12h18" />
      </svg>
    </button>
    {open && createPortal(<dialog ref={dialog} id={id} className={styles.panel} data-sheet={mobile || undefined} aria-label={t("overview.title")} aria-modal="true"
      onCancel={event => { event.preventDefault(); event.stopPropagation(); close(); }}
      onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); if (!event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) { event.preventDefault(); close(); } } }}
      onClick={event => { if (event.target === event.currentTarget) close(); }}>
      <div className={styles.card}>
        <header className={styles.header}>
          <div><h2>{t("overview.title")}</h2><span title={cwd ?? ""}>{cwd ? getFileName(cwd) || cwd : ""}</span></div>
          <button type="button" className={styles.icon} onClick={() => setReload(value => value + 1)} aria-busy={git.loading || sources.loading} aria-label={t("overview.refresh")} title={t("overview.refresh")}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2 6M20 4v7h-7" /></svg>
          </button>
          <button ref={closeButton} type="button" className={styles.icon} onClick={() => close()} aria-label={t("overview.close")} title={t("overview.close")}>×</button>
        </header>
        <section className={styles.section} aria-label={t("overview.changes")}>
          <div className={styles.heading}><h3>{t("overview.changes")}</h3>{git.data?.isGitRepository && <span className={styles.counts}><span>+{git.data.additions}</span><span>−{git.data.deletions}</span></span>}</div>
          <p className={styles.hint}>{t("overview.changesHint")}</p>
          {git.error && files.length > 0 && failure}
          {files.length ? <>
            {(allFiles ? files : files.slice(0, PREVIEW_LIMIT)).map(file => <button key={file.filePath} type="button" className={styles.row} onClick={() => { close(false); onOpenFile(file.filePath, true); }} title={file.filePath}>
              {getFileIcon(getFileName(file.filePath))}<span>{getRelativeFilePath(file.filePath, cwd ?? undefined)}</span><small>{file.code}</small>
            </button>)}
            {files.length > PREVIEW_LIMIT && <button className={styles.more} aria-expanded={allFiles} onClick={() => setAllFiles(value => !value)}>{t(allFiles ? "overview.showLess" : "overview.showAll", { count: files.length })}</button>}
          </> : retry(git, t(git.data && !git.data.isGitRepository ? "overview.notGit" : "overview.noChanges"))}
        </section>
        <section className={styles.section} aria-label={t("overview.terminals")}>
          <div className={styles.heading}><h3>{t("overview.terminals")}</h3><small>{currentTerminals.length}</small></div>
          {currentTerminals.length ? currentTerminals.map((tab, index) => <button key={tab.id} type="button" className={styles.row} onClick={() => { close(false); onOpenTerminal(tab.id); }} title={tab.cwd}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true"><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></svg>
            <span>{t("overview.terminal", { number: index + 1 })}<small>{tab.cwd}</small></span>
          </button>) : <p>{t("overview.noTerminals")}</p>}
        </section>
        <section className={styles.section} aria-label={t("overview.sources")}>
          <div className={styles.heading}><h3>{t("overview.sources")}</h3>{sources.data && <small>{sources.data.total}</small>}</div>
          {sources.error && items.length > 0 && failure}
          {items.length ? <>
            {(allSources ? items : items.slice(0, PREVIEW_LIMIT)).map(source => source.kind === "file" ? <button key={source.id} type="button" className={styles.row} title={source.path} onClick={() => { close(false); onOpenFile(source.path); }}>
              {getFileIcon(source.name)}<span>{source.name}{getRelativeFilePath(source.path, cwd ?? undefined) !== source.name && <small>{getRelativeFilePath(source.path, cwd ?? undefined)}</small>}</span>
            </button> : <ImagePreview key={source.id} className={styles.row} style={{ display: "flex" }} alt={t("overview.image", { number: source.number })}
              src={`${sourceUrl}${sourceUrl?.includes("?") ? "&" : "?"}image=${encodeURIComponent(source.id)}`}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img loading="lazy" width="36" height="36" src={`${sourceUrl}${sourceUrl?.includes("?") ? "&" : "?"}image=${encodeURIComponent(source.id)}`} alt="" />
              <span>{t("overview.image", { number: source.number })}</span>
            </ImagePreview>)}
            {items.length > PREVIEW_LIMIT && <button className={styles.more} aria-expanded={allSources} onClick={() => setAllSources(value => !value)}>{t(allSources ? "overview.showLess" : "overview.showAll", { count: items.length })}</button>}
            {sources.data!.total > items.length && <p>{t("overview.limited", { count: items.length, total: sources.data!.total })}</p>}
          </> : retry(sources, t("overview.noSources"))}
        </section>
      </div>
    </dialog>, document.body)}
  </>;
}
