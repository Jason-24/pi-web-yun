"use client";

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "@/hooks/useI18n";
import type { NewSessionTarget, ProjectChoice } from "@/lib/new-session-context";
import { projectNameOf } from "@/lib/session-tree";
import { MAX_PROJECT_NAME_LENGTH, projectDisplayName } from "@/lib/session-ui-state-shared";
import { focusModalPanel } from "@/lib/stacked-dialog";
import { DirectoryPicker } from "./DirectoryPicker";
import { FolderIcon, FolderPlusIcon, PlusIcon } from "./SidebarIcons";
import styles from "./CreateProjectDialog.module.css";

interface Props {
  projects: readonly ProjectChoice[];
  initialPath?: string;
  onCancel(): void;
  /** Save before selecting the cwd; a refused save leaves the draft open. */
  onCreate(target: NewSessionTarget, name: string): Promise<boolean>;
}

export function CreateProjectDialog({ projects, initialPath, onCancel, onCreate }: Props) {
  const { t } = useI18n();
  const titleId = useId();
  const nameId = useId();
  const sourceId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const browseRef = useRef<HTMLButtonElement>(null);
  const [portalTarget, setPortalTarget] = useState<HTMLElement | null>(null);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const nameEdited = useRef(false);
  const pending = useRef(false);
  const latest = useRef({ browsing, onCancel });
  latest.current = { browsing, onCancel };

  useEffect(() => { setPortalTarget(document.body); }, []);
  useLayoutEffect(() => {
    if (!portalTarget) return;
    const restore = focusModalPanel(document, panelRef.current);
    nameRef.current?.focus({ preventScroll: true });
    // Yield Escape completely to the nested directory picker.
    const handleEscape = (event: KeyboardEvent) => {
      if (latest.current.browsing || event.key !== "Escape") return;
      event.stopPropagation();
      if (event.isComposing || event.keyCode === 229) return;
      event.preventDefault();
      if (!pending.current) latest.current.onCancel();
    };
    document.addEventListener("keydown", handleEscape, true);
    return () => {
      document.removeEventListener("keydown", handleEscape, true);
      restore();
    };
  }, [portalTarget]);

  function selectFolder(path: string) {
    setFolder(path);
    if (!nameEdited.current) {
      const existing = projects.find(project => project.root === path);
      setName(existing?.alias ?? projectNameOf(path));
    }
    setError(null);
    setBrowsing(false);
    requestAnimationFrame(() => browseRef.current?.focus({ preventScroll: true }));
  }

  async function handleDefaultDirectory() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/default-cwd", { method: "POST" });
      const data = await response.json() as { cwd?: string; error?: string };
      if (!response.ok || data.error || !data.cwd) throw new Error(data.error ?? `HTTP ${response.status}`);
      selectFolder(data.cwd);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  async function createProject() {
    const displayName = projectDisplayName(name);
    if (pending.current || !displayName || !folder) return;
    pending.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/cwd/validate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: folder }),
      });
      const data = await response.json() as { cwd?: string; projectRoot?: string; projectKey?: string; error?: string };
      if (!response.ok || data.error || !data.cwd || !data.projectRoot || !data.projectKey) {
        throw new Error(data.error ?? `HTTP ${response.status}`);
      }
      const saved = await onCreate({ cwd: data.cwd, projectRoot: data.projectRoot, projectKey: data.projectKey }, displayName);
      if (!saved) setError(t("projectCreate.saveFailed"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }

  const validName = Boolean(projectDisplayName(name));
  if (!portalTarget) return null;
  return createPortal(<>
    <div className={styles.backdrop} onClick={event => {
      if (event.target === event.currentTarget && !pending.current) onCancel();
    }}>
      <div ref={panelRef} className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby={titleId}
        aria-busy={busy} tabIndex={-1} inert={browsing} aria-hidden={browsing || undefined}
        onKeyDown={event => {
          if (event.key !== "Tab") return;
          const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled), input:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
          )).filter(element => element.getClientRects().length > 0);
          const first = controls[0];
          const last = controls[controls.length - 1];
          if (!first) { event.preventDefault(); return; }
          if (event.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
            event.preventDefault(); last.focus();
          } else if (!event.shiftKey && document.activeElement === last) {
            event.preventDefault(); first.focus();
          }
        }}>
        <header className={styles.header}>
          <h2 id={titleId}>{t("projectCreate.title")}</h2>
          <button className={styles.close} type="button" onClick={onCancel} disabled={busy} aria-label={t("i18n.close")}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg>
          </button>
        </header>
        <form onSubmit={event => { event.preventDefault(); void createProject(); }}>
          <label className={styles.nameField} htmlFor={nameId}>
            <span className={styles.nameIcon}><FolderIcon size={23} /></span>
            <input ref={nameRef} id={nameId} value={name} placeholder={t("projectCreate.name")}
              aria-label={t("projectCreate.name")} disabled={busy} autoComplete="off"
              onChange={event => { nameEdited.current = true; setName(event.target.value); setError(null); }} />
          </label>
          {name.trim() && !validName && <p className={styles.error} role="alert">{t("projectCreate.invalidName", { max: MAX_PROJECT_NAME_LENGTH })}</p>}
          <section className={styles.sources} aria-labelledby={sourceId}>
            <h3 id={sourceId}>{t("projectCreate.sourceFolder")}</h3>
            <div className={`${styles.sourceCard}${folder ? ` ${styles.hasFolder}` : ""}`}>
              {folder ? <>
                <div className={styles.folderRow}>
                  <FolderIcon size={25} />
                  <div className={styles.folderText}><strong>{projectNameOf(folder)}</strong><span>{folder}</span></div>
                  <button type="button" className={styles.close} disabled={busy} aria-label={t("projectCreate.removeFolder")}
                    onClick={() => { setFolder(""); setError(null); if (!nameEdited.current) setName(""); }}>×</button>
                </div>
                <button ref={browseRef} className={styles.add} type="button" disabled={busy} onClick={() => setBrowsing(true)}>
                  <FolderIcon size={18} />{t("projectCreate.changeFolder")}
                </button>
              </> : <>
                <p>{t("projectCreate.addOnComputer")}</p>
                <button ref={browseRef} className={styles.add} type="button" disabled={busy} onClick={() => setBrowsing(true)}>
                  <FolderPlusIcon size={21} />{t("projectCreate.addFolder")}
                </button>
              </>}
            </div>
            <div className={styles.sourceOptions}>
              <button type="button" disabled={busy} onClick={() => void handleDefaultDirectory()}>{t("sidebar.useDefaultDirectory")}</button>
              {projects.length > 0 && <label className={styles.recent}>
                <PlusIcon size={14} />
                <select aria-label={t("projectCreate.existingFolder")} disabled={busy} value="" onChange={event => selectFolder(event.target.value)}>
                  <option value="" disabled>{t("projectCreate.existingFolder")}</option>
                  {projects.map(project => <option key={project.key} value={project.root}>{project.alias ?? projectNameOf(project.root)} — {project.root}</option>)}
                </select>
              </label>}
            </div>
            <p className={styles.hint}>{t("projectCreate.folderHint")}</p>
          </section>
          {error && <p className={styles.error} role="alert">{error}</p>}
          <footer className={styles.footer}>
            <button className={styles.cancel} type="button" disabled={busy} onClick={onCancel}>{t("i18n.cancel")}</button>
            <button className={styles.submit} type="submit" disabled={busy || !folder || !validName}>{busy ? t("projectCreate.creating") : t("projectCreate.title")}</button>
          </footer>
        </form>
      </div>
    </div>
    {browsing && <DirectoryPicker initialPath={folder || initialPath} onSelect={selectFolder} onCancel={() => {
      setBrowsing(false);
      requestAnimationFrame(() => browseRef.current?.focus({ preventScroll: true }));
    }} />}
  </>, portalTarget);
}
