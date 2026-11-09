"use client";

import { useEffect, useState } from "react";
import { useI18n } from "@/hooks/useI18n";
import { injectSandboxedHtmlPolyfill } from "@/lib/html-sandbox-polyfill";

/** The SDK's complete, read-only history viewer, isolated from Pi Web's origin. */
export function SessionHistoryViewer({ sessionId }: { sessionId: string }) {
  const { t } = useI18n();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timer = setTimeout(() => controller.abort(), 45_000);
    setHtml(null);
    setError(null);
    void (async () => {
      try {
        const response = await fetch(`/api/sessions/${encodeURIComponent(sessionId)}/export?inline=1`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!response.ok) {
          const body = await response.json().catch(() => null) as { error?: string } | null;
          throw new Error(body?.error || `HTTP ${response.status}`);
        }
        if (!response.headers.get("Content-Type")?.includes("text/html")) throw new Error("Expected an HTML history export");
        const content = await response.text();
        if (!content.trim()) throw new Error("Empty history export");
        // Upstream supports this meta tag so Copy link points at the real
        // standalone export rather than the iframe's about:srcdoc address.
        const shareUrl = new URL(`/api/sessions/${encodeURIComponent(sessionId)}/export?inline=1`, window.location.href).href;
        const escapedUrl = shareUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
        const viewerHtml = content.replace(/<head(?:\s[^>]*)?>/i,
          head => `${head}<meta name="pi-share-base-url" content="${escapedUrl}">`);
        if (!cancelled) setHtml(injectSandboxedHtmlPolyfill(viewerHtml));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      controller.abort();
    };
  }, [sessionId, attempt]);

  if (error) return <div className="session-history-status workspace-empty" role="alert">
    <p>{t("history.unavailable")}</p>
    <details><summary>{t("i18n.showDetails")}</summary><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{error}</pre></details>
    <button type="button" className="workspace-page-back" onClick={() => setAttempt(value => value + 1)}>{t("i18n.refresh")}</button>
  </div>;
  if (html === null) return <div className="session-history-status workspace-empty" role="status">{t("history.loading")}</div>;
  return <iframe className="session-history-frame" title={t("history.full")} srcDoc={html}
    sandbox="allow-scripts allow-downloads" referrerPolicy="no-referrer" />;
}
