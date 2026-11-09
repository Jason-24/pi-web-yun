"use client";

import { useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

/** Validate the response before offering it as a download. */
export function SessionExportButton({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const request = useRef<AbortController | null>(null);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);

  const download = async () => {
    if (request.current) return;
    const controller = new AbortController();
    request.current = controller;
    const timer = setTimeout(() => controller.abort(), 45_000);
    setBusy(true);
    setError(false);
    try {
      const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export`, { signal: controller.signal, cache: "no-store" });
      if (!response.ok || !response.headers.get("Content-Type")?.includes("text/html")) throw new Error("Export failed");
      const blob = await response.blob();
      if (!blob.size) throw new Error("Empty export");
      if (request.current !== controller) return;
      const encoded = response.headers.get("Content-Disposition")?.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      let name = `pi-session-${sessionId}.html`;
      if (encoded) { try { name = decodeURIComponent(encoded); } catch { /* Keep the fallback. */ } }
      name = name.replace(/[\\/\r\n]/g, "_");
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      try { link.click(); } finally { link.remove(); setTimeout(() => URL.revokeObjectURL(url), 60_000); }
    } catch {
      if (request.current === controller) setError(true);
    } finally {
      clearTimeout(timer);
      if (request.current === controller) { request.current = null; setBusy(false); }
    }
  };
  return <span className="session-export-action">
    <button type="button" className="workspace-page-export" disabled={busy} onClick={() => void download()}>
      {busy ? t("history.exporting") : t("navigation.exportHistory")}
    </button>
    {error && <span className="session-export-error" role="alert">{t("history.exportFailed")}</span>}
  </span>;
}
