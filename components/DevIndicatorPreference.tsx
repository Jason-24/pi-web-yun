"use client";

import { useEffect } from "react";

/** Hide Next's corner badge, including its issue count, without hiding error details. */
export function DevIndicatorPreference() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "development") return;

    // devIndicators: false still shows an issues badge in Next 16. The badge
    // lives in a shadow root, so application styles cannot reach it directly.
    const styles = new Set<HTMLStyleElement>();
    const hideBadge = () => {
      document.querySelectorAll("nextjs-portal").forEach((portal) => {
        const root = portal.shadowRoot;
        if (!root || root.getElementById("yun-dev-badge-preference")) return;
        const style = document.createElement("style");
        style.id = "yun-dev-badge-preference";
        style.textContent = "[data-nextjs-toast] { display: none !important; }";
        root.appendChild(style);
        styles.add(style);
      });
    };

    hideBadge();
    const observer = new MutationObserver(hideBadge);
    observer.observe(document.body, { childList: true });
    return () => {
      observer.disconnect();
      styles.forEach((style) => style.remove());
    };
  }, []);

  return null;
}
