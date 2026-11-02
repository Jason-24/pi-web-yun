"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { petResultInbox, readPetResults } from "@/lib/pet-notifications";

export function usePetActivity(visible: boolean, activeSessionId: string | null) {
  const [background, setBackground] = useState<{ running: string[]; waiting: string[] }>({ running: [], waiting: [] });
  const results = useSyncExternalStore(petResultInbox.subscribe, petResultInbox.getSnapshot, petResultInbox.getServerSnapshot);
  const activeRef = useRef(activeSessionId);
  activeRef.current = activeSessionId;
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const controller = new AbortController();
    const ids = (value: unknown): string[] => Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
    const tick = async () => {
      if (!document.hidden) try {
        const response = await fetch("/api/agent/running", { cache: "no-store", signal: controller.signal });
        if (response.ok) {
          const body = await response.json();
          if (cancelled) return;
          setBackground({ running: [...new Set([...ids(body.runningSessionIds), ...ids(body.subagentsActiveSessionIds)])], waiting: ids(body.awaitingInputSessionIds) });
          petResultInbox.reconcile(readPetResults(body.recentRunResults), activeRef.current,
            [...ids(body.runningSessionIds), ...ids(body.subagentsActiveSessionIds)]);
        }
      } catch { /* Keep the last known metadata while offline. */ }
      if (!cancelled) timer = setTimeout(tick, 2500);
    };
    void tick();
    return () => { cancelled = true; controller.abort(); clearTimeout(timer); };
  }, [visible]);
  const dismissResult = petResultInbox.dismiss;
  useEffect(() => { if (activeSessionId) dismissResult(activeSessionId); }, [activeSessionId, dismissResult]);
  return { background, results, dismissResult };
}
