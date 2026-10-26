"use client";

import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

/** A temporary desktop preview, separate from the saved expanded/collapsed state. */
export function useSidebarPeek(enabled: boolean, panel: RefObject<HTMLElement | null>, trigger: RefObject<HTMLElement | null>) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const cancel = useCallback(() => { clearTimeout(timer.current); timer.current = undefined; }, []);
  const dismiss = useCallback(() => { cancel(); setOpen(false); }, [cancel]);
  const show = useCallback(() => {
    cancel();
    if (!enabled || open) return;
    timer.current = setTimeout(() => setOpen(true), 120);
  }, [cancel, enabled, open]);
  const scheduleHide = useCallback(() => {
    cancel();
    if (!enabled) return;
    timer.current = setTimeout(() => {
      const active = document.activeElement;
      if (document.querySelector(".sidebar-menu, .sidebar-sheet")) return;
      if (active && panel.current?.contains(active) && active.matches("input, textarea, [contenteditable=true], :focus-visible")) return;
      setOpen(false);
    }, 280);
  }, [cancel, enabled, panel]);

  useEffect(() => {
    if (!enabled) dismiss();
  }, [enabled, dismiss]);
  useEffect(() => cancel, [cancel]);
  useEffect(() => {
    if (!enabled || !open) return;
    const inside = (target: EventTarget | null) => target instanceof Element && (
      panel.current?.contains(target) || trigger.current?.contains(target) || target.closest(".sidebar-menu, .sidebar-sheet, [data-sidebar-restore]")
    );
    const move = (event: PointerEvent) => { if (inside(event.target)) cancel(); else scheduleHide(); };
    const outside = (event: PointerEvent) => { if (!inside(event.target)) dismiss(); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || document.querySelector(".sidebar-menu, .sidebar-sheet")) return;
      event.preventDefault(); event.stopPropagation(); dismiss(); trigger.current?.focus({ preventScroll: true });
    };
    document.addEventListener("pointermove", move);
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape, true);
    return () => {
      document.removeEventListener("pointermove", move);
      document.removeEventListener("pointerdown", outside, true);
      document.removeEventListener("keydown", escape, true);
    };
  }, [cancel, dismiss, enabled, open, panel, scheduleHide, trigger]);

  return { open: enabled && open, show, cancel, scheduleHide, dismiss };
}
