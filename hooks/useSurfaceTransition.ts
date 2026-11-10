"use client";

import { useLayoutEffect, useRef, type RefObject } from "react";

/** Fade a changed view without remounting it, moving its layout or delaying input. */
export function useSurfaceTransition<T extends HTMLElement>(
  ref: RefObject<T | null>,
  viewKey: string | null,
  { desktopOnly = false }: { desktopOnly?: boolean } = {},
) {
  const previousKey = useRef(viewKey);
  const activeAnimation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => { activeAnimation.current?.cancel(); activeAnimation.current = null; };
    const onPreferenceChange = () => { if (media.matches) cancel(); };
    media.addEventListener("change", onPreferenceChange);
    return () => { media.removeEventListener("change", onPreferenceChange); cancel(); };
  }, []);

  useLayoutEffect(() => {
    if (previousKey.current === viewKey) return;
    previousKey.current = viewKey;
    const element = ref.current;
    const previous = activeAnimation.current;
    // Continue an interrupted entrance from its current opacity instead of flashing again.
    const opacity = previous?.playState === "running" && element ? getComputedStyle(element).opacity : .72;
    previous?.cancel();
    activeAnimation.current = null;
    if (viewKey === null || !element || typeof element.animate !== "function" || document.hidden
      || element.closest('[hidden], [inert], [aria-hidden="true"]')
      || window.matchMedia("(prefers-reduced-motion: reduce)").matches
      || (desktopOnly && window.matchMedia("(max-width: 640px)").matches)) return;

    const animation = element.animate([{ opacity }, { opacity: 1 }], {
      duration: 160, easing: "cubic-bezier(.2, .8, .2, 1)",
    });
    activeAnimation.current = animation;
    animation.onfinish = () => { if (activeAnimation.current === animation) activeAnimation.current = null; };
  }, [desktopOnly, ref, viewKey]);
}
