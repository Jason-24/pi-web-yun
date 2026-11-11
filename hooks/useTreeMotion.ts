"use client";

import { useCallback, useLayoutEffect, useRef, type MouseEvent, type RefObject } from "react";

const FOLD_CONTROLS = ".session-tree-group-toggle, .session-tree-pinned-toggle, .session-tree-recents-toggle";

/** Animate only the mounted rows affected by an explicit fold; never a poll or scroll. */
export function useTreeMotion(ref: RefObject<HTMLDivElement | null>, dragging: boolean) {
  const pending = useRef<{ tops: Map<string, number>; scrollTop: number } | null>(null);
  const animations = useRef(new Set<Animation>());
  const expiry = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancel = useCallback(() => {
    for (const animation of animations.current) animation.cancel();
    animations.current.clear();
    pending.current = null;
    if (expiry.current !== null) clearTimeout(expiry.current);
    expiry.current = null;
  }, []);

  useLayoutEffect(() => {
    const root = ref.current;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onPreference = () => { if (media.matches) cancel(); };
    const onVisibility = () => { if (document.hidden) cancel(); };
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(cancel);
    if (root) observer?.observe(root);
    root?.addEventListener("scroll", cancel, { passive: true });
    media.addEventListener("change", onPreference);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      root?.removeEventListener("scroll", cancel);
      media.removeEventListener("change", onPreference);
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      cancel();
    };
  }, [cancel, ref]);

  const capture = useCallback((event: MouseEvent) => {
    const root = ref.current;
    if (!root || dragging || event.defaultPrevented || !(event.target instanceof Element)
      || !event.target.closest(FOLD_CONTROLS) || document.hidden
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const tops = new Map<string, number>();
    const bounds = root.getBoundingClientRect();
    root.querySelectorAll<HTMLElement>("[data-row-key]").forEach(row => {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > bounds.top && rect.top < bounds.bottom) tops.set(row.dataset.rowKey!, rect.top);
    });
    // Read before canceling so another fold can continue from the displayed positions.
    cancel();
    pending.current = { tops, scrollTop: root.scrollTop };
    expiry.current = setTimeout(() => { pending.current = null; expiry.current = null; }, 0);
  }, [cancel, dragging, ref]);

  useLayoutEffect(() => {
    if (dragging) { cancel(); return; }
    const snapshot = pending.current;
    const root = ref.current;
    if (!snapshot || !root) return;
    pending.current = null;
    // A large fold can clamp the virtual scroller. Its new viewport takes precedence.
    if (Math.abs(root.scrollTop - snapshot.scrollTop) > 1 || !root.getClientRects().length) return;
    const bounds = root.getBoundingClientRect();
    const moves: { row: HTMLElement; delta: number; entering: boolean }[] = [];
    root.querySelectorAll<HTMLElement>("[data-row-key]").forEach(row => {
      if (typeof row.animate !== "function") return;
      const rect = row.getBoundingClientRect();
      if (rect.bottom <= bounds.top || rect.top >= bounds.bottom) return;
      const previousTop = snapshot.tops.get(row.dataset.rowKey!);
      const delta = previousTop === undefined ? -4 : previousTop - rect.top;
      if (Math.abs(delta) < .5) return;
      moves.push({ row, delta, entering: previousTop === undefined });
    });
    // Read all positions before starting animations; avoid alternating reads and writes.
    for (const { row, delta, entering } of moves) {
      const animation = row.animate([
        { transform: `translateY(${delta}px)`, opacity: entering ? .84 : 1 },
        { transform: "translateY(0)", opacity: 1 },
      ], { duration: 200, easing: "cubic-bezier(.2, .8, .2, 1)" });
      animations.current.add(animation);
      animation.onfinish = () => { animations.current.delete(animation); };
    }
  });

  return capture;
}
