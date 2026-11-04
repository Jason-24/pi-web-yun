"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getFileName, getRelativeFilePath } from "@/lib/file-paths";
import type { GitStatusResponse } from "@/lib/git-types";
import type { PanelTool } from "@/lib/panel-tools";
import { SidebarMenu, type SidebarMenuAnchor } from "./SidebarMenu";
import { getFileIcon } from "./FileIcons";
import type { Tab } from "./TabBar";

export function PanelToolIcon({ tool, size = 20 }: { tool: PanelTool | "launcher"; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {tool === "files" ? <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
      : tool === "side" ? <path d="M21 11a8 8 0 0 1-8 8H5l-3 3v-10a9 9 0 0 1 19-1Z" />
        : tool === "terminal" ? <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="m7 9 3 3-3 3m6 0h4" /></>
          : tool === "changes" ? <><rect x="5" y="3" width="14" height="18" rx="3" /><path d="M9 9h6m-3-3v6m-3 4h6" /></>
            : <path d="M12 4v16M4 12h16" />}
  </svg>;
}

const TOOLS: { tool: PanelTool; label: string; shortcut: string }[] = [
  { tool: "changes", label: "panel.changes", shortcut: "Ctrl+Shift+G" },
  { tool: "terminal", label: "panel.terminal", shortcut: "Ctrl+`" },
  { tool: "side", label: "sideChat.title", shortcut: "Ctrl+Alt+S" },
  { tool: "files", label: "panel.files", shortcut: "Ctrl+P" },
];

export function PanelToolLauncher({ cwd, sideDisabled, onOpen }: {
  cwd: string | null; sideDisabled: string | null; onOpen(tool: PanelTool): void | Promise<string | null>;
}) {
  const { t } = useI18n();
  const [pending, setPending] = useState(false);
  const pendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const open = async (tool: PanelTool) => {
    if (pendingRef.current) return;
    pendingRef.current = true;
    setPending(true); setError(null);
    try {
      const result = await onOpen(tool);
      if (alive.current && result) setError(result);
    } catch {
      if (alive.current) setError(t("panel.openFailed"));
    } finally {
      pendingRef.current = false;
      if (alive.current) setPending(false);
    }
  };
  return <div className="panel-tool-launcher" aria-label={t("panel.tools")}>
    <header><h2>{t("panel.tools")}</h2>{cwd && <p title={cwd}>{getFileName(cwd) || cwd}</p>}</header>
    <div className="panel-tool-grid">
      {TOOLS.map(({ tool, label, shortcut }) => <div key={tool}>
        <button type="button" data-panel-tool={tool} disabled={pending || !cwd || (tool === "side" && Boolean(sideDisabled))} onClick={() => void open(tool)}>
          <PanelToolIcon tool={tool} /><span>{t(label)}</span><kbd>{shortcut}</kbd>
        </button>
        {tool === "side" && sideDisabled && <p className="panel-tool-unavailable">{sideDisabled}</p>}
      </div>)}
    </div>
    {pending && <p role="status">{t("panel.opening")}</p>}
    {error && <p role="alert" className="panel-tool-error">{error}</p>}
    {!cwd && <p>{t("panel.chooseProject")}</p>}
  </div>;
}

export function PanelTabSwitcher({ tabs, activeId, mobile, covered, onSelect, onNew }: {
  tabs: Tab[]; activeId: string | null; mobile: boolean; covered: boolean;
  onSelect(id: string): void; onNew(): void;
}) {
  const { t } = useI18n();
  const trigger = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<SidebarMenuAnchor | null>(null);
  return <>
    <button ref={trigger} type="button" className="workspace-files-toggle panel-tab-switcher" disabled={covered}
      tabIndex={covered ? -1 : undefined} aria-hidden={covered || undefined}
      title={t(tabs.length ? "panel.openTabsCount" : "panel.newTab", { count: tabs.length })}
      aria-label={t(tabs.length ? "panel.openTabsCount" : "panel.newTab", { count: tabs.length })}
      aria-haspopup={tabs.length ? (mobile ? "dialog" : "menu") : undefined} aria-expanded={tabs.length ? Boolean(anchor) : undefined}
      data-mobile-toolbar-file={mobile ? "true" : undefined}
      onClick={event => {
        if (!tabs.length) { onNew(); return; }
        setAnchor(anchor ? null : { kind: "rect", rect: event.currentTarget.getBoundingClientRect(), align: "end" });
      }}>
      {tabs.length ? <span className="panel-tab-count" aria-hidden="true">{tabs.length}</span> : <PanelToolIcon tool="launcher" />}
    </button>
    <SidebarMenu open={Boolean(anchor)} anchor={anchor} sheet={mobile} ariaLabel={t("panel.openTabs")} title={t("panel.openTabs")}
      width={300} cancelLabel={t("chat.close")} returnFocusTo={trigger.current} onClose={() => setAnchor(null)} items={[
        { type: "header", id: "heading", label: t("panel.openTabs") },
        ...tabs.map(tab => ({ type: "item" as const, id: tab.id, label: tab.label, title: tab.filePath || tab.label,
          checked: activeId === tab.id, disabled: tab.closing,
          onSelect: () => onSelect(tab.id) })),
        { type: "separator", id: "separator" },
        { type: "item", id: "new", label: t("panel.newTab"), icon: <PanelToolIcon tool="launcher" size={16} />, onSelect: onNew },
      ]} />
  </>;
}

/** A list of working-directory changes; file selection delegates to the existing diff viewer. */
export function PanelChanges({ cwd, refreshKey, onOpenFile }: { cwd: string; refreshKey: number; onOpenFile(path: string): void }) {
  const { t } = useI18n();
  const [state, setState] = useState<{ data?: GitStatusResponse; error?: boolean }>({});
  const [reload, setReload] = useState(0);
  const [visible, setVisible] = useState(50);
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    fetch(`/api/git/status?cwd=${encodeURIComponent(cwd)}`, { signal: controller.signal }).then(async response => {
      if (!response.ok) throw new Error("read failed");
      const data = await response.json() as GitStatusResponse;
      if (!controller.signal.aborted) setState({ data });
    }).catch(() => { if (!controller.signal.aborted) setState({ error: true }); });
    const focus = () => setReload(value => value + 1);
    window.addEventListener("focus", focus);
    return () => { controller.abort(); window.removeEventListener("focus", focus); };
  }, [cwd, refreshKey, reload]);
  const files = state.data?.files ?? [];
  return <section className="panel-changes" aria-label={t("panel.changes")}>
    <header><h2>{t("panel.changes")}</h2><button type="button" onClick={() => setReload(value => value + 1)}>{t("overview.refresh")}</button></header>
    <p>{t("overview.changesHint")}</p>
    {state.error ? <p role="alert">{t("overview.loadFailed")} <button onClick={() => setReload(value => value + 1)}>{t("overview.retry")}</button></p>
      : !state.data ? <p role="status">{t("overview.loading")}</p>
        : !state.data.isGitRepository ? <p>{t("overview.notGit")}</p>
          : !files.length ? <p>{t("overview.noChanges")}</p>
            : <><div className="panel-change-summary"><span>{files.length}</span><span>+{state.data.additions} −{state.data.deletions}</span></div>
              {files.slice(0, visible).map(file => <button className="panel-change-row" key={file.filePath} type="button" title={file.filePath} onClick={() => onOpenFile(file.filePath)}>
                {getFileIcon(getFileName(file.filePath))}<span>{getRelativeFilePath(file.filePath, cwd)}</span><small>{file.code}</small>
              </button>)}
              {files.length > visible && <button onClick={() => setVisible(count => count + 50)}>{t("panel.moreChanges")}</button>}
            </>}
  </section>;
}
