"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { getPiWebReleaseUrl, isNewerStableVersion } from "@/lib/app-update";
import { SidebarMenu, type SidebarMenuAnchor } from "./SidebarMenu";
import styles from "./AppUpdateButton.module.css";

const APP_VERSION = process.env.NEXT_PUBLIC_APP_VERSION ?? "0.0.0";
const PI_VERSION = process.env.NEXT_PUBLIC_PI_VERSION ?? "unknown";
const PACKAGE_NAME = process.env.NEXT_PUBLIC_APP_NAME ?? "pi-yun";
const RECHECK_MS = 12 * 60 * 60 * 1000;

export function AppUpdateButton({ mobile }: { mobile: boolean }) {
  const { t } = useI18n();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const lastCheckRef = useRef(0);
  const [anchor, setAnchor] = useState<SidebarMenuAnchor | null>(null);
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [failed, setFailed] = useState(false);

  const check = useCallback(async () => {
    if (requestRef.current) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setChecking(true);
    setFailed(false);
    try {
      const response = await fetch("/api/app-update", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Update check failed");
      const body = await response.json() as { latestVersion?: unknown };
      if (typeof body.latestVersion !== "string" || !getPiWebReleaseUrl(body.latestVersion)) {
        throw new Error("Invalid version");
      }
      if (!controller.signal.aborted) {
        setLatestVersion(body.latestVersion);
        lastCheckRef.current = Date.now();
      }
    } catch {
      if (!controller.signal.aborted) setFailed(true);
    } finally {
      if (!controller.signal.aborted) setChecking(false);
      if (requestRef.current === controller) requestRef.current = null;
    }
  }, []);

  useEffect(() => {
    void check();
    const recheck = () => {
      if (!document.hidden && Date.now() - lastCheckRef.current >= RECHECK_MS) void check();
    };
    window.addEventListener("focus", recheck);
    document.addEventListener("visibilitychange", recheck);
    const timer = setInterval(recheck, RECHECK_MS);
    return () => {
      requestRef.current?.abort();
      requestRef.current = null;
      clearInterval(timer);
      window.removeEventListener("focus", recheck);
      document.removeEventListener("visibilitychange", recheck);
    };
  }, [check]);

  const available = latestVersion !== null && isNewerStableVersion(latestVersion, APP_VERSION);
  const releaseUrl = available ? getPiWebReleaseUrl(latestVersion) : null;
  const status = checking ? t("appUpdate.checking") : failed ? t("appUpdate.failed")
    : available ? t("appUpdate.available", { version: latestVersion }) : t("appUpdate.current");
  const label = t("appUpdate.title");

  return <>
    <button ref={triggerRef} type="button"
      className={`workbench-view-button workbench-utility-start ${styles.trigger}${available ? ` ${styles.available}` : ""}`}
      data-workspace-action="update" data-update-available={available}
      aria-label={available ? `${label} · ${t("appUpdate.available", { version: latestVersion })}` : label}
      title={`${PACKAGE_NAME} v${APP_VERSION} · pi v${PI_VERSION}\n${status}`}
      aria-haspopup="dialog" aria-expanded={Boolean(anchor)} onClick={() => {
        if (anchor) { setAnchor(null); return; }
        const rect = triggerRef.current?.getBoundingClientRect();
        if (rect) setAnchor({ kind: "rect", rect, align: "start" });
        if (failed || Date.now() - lastCheckRef.current >= RECHECK_MS) void check();
      }}>
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M12 3v12m-4-4 4 4 4-4M5 16v4h14v-4" />
      </svg>
      <span className="workbench-settings-label">{t("i18n.update")}</span>
    </button>
    <SidebarMenu open={Boolean(anchor)} anchor={anchor} sheet={mobile} ariaLabel={label} title={label}
      width={300} cancelLabel={t("sidebar.cancel")} onClose={() => setAnchor(null)} returnFocusTo={triggerRef.current}>
      <div className={styles.panel}>
        {!mobile && <strong>{label}</strong>}
        <dl className={styles.versions}><dt>{PACKAGE_NAME}</dt><dd>v{APP_VERSION}</dd><dt>pi</dt><dd>v{PI_VERSION}</dd></dl>
        <p role="status">{status}</p>
        {releaseUrl && <a href={releaseUrl} target="_blank" rel="noopener noreferrer">{t("appUpdate.releaseNotes")}</a>}
        <p>{t("appUpdate.installHint")}</p>
        <code className={styles.command}>npm install -g {PACKAGE_NAME}@latest</code>
        <p>{t("appUpdate.restartHint")}</p>
        <button type="button" className={styles.check} disabled={checking} onClick={() => void check()}>{t("appUpdate.check")}</button>
      </div>
    </SidebarMenu>
  </>;
}
