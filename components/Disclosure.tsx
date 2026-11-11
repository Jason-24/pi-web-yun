"use client";

import { useLayoutEffect, useRef, useState, type ReactNode } from "react";

/** Mount lazily, retain the body only while closing, then release it. */
export function Disclosure({ open, children }: { open: boolean; children: ReactNode | (() => ReactNode) }) {
  const [retained, setRetained] = useState(open);
  const ref = useRef<HTMLDivElement>(null);
  const previous = useRef(open);
  const animation = useRef<Animation | null>(null);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || previous.current === open) return;
    previous.current = open;
    const height = animation.current ? element.getBoundingClientRect().height : open ? 0 : element.scrollHeight;
    const opacity = animation.current ? getComputedStyle(element).opacity : open ? .84 : 1;
    animation.current?.cancel();
    animation.current = null;
    let observer: ResizeObserver | undefined;
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const finish = () => {
      observer?.disconnect();
      animation.current?.cancel();
      animation.current = null;
      element.style.overflow = "";
      setRetained(open);
    };
    if (media.matches || document.hidden || typeof element.animate !== "function") {
      finish();
      return;
    }
    if (open) setRetained(true);
    element.style.overflow = "hidden";
    const motion = element.animate([
      { height: `${height}px`, opacity },
      { height: `${open ? element.scrollHeight : 0}px`, opacity: open ? 1 : 0 },
    ], { duration: 200, easing: "cubic-bezier(.2, .8, .2, 1)", fill: "both" });
    animation.current = motion;
    motion.onfinish = finish;
    // A folder's first listing or deferred content may arrive during its entrance.
    if (open && typeof ResizeObserver !== "undefined" && element.firstElementChild) {
      let targetHeight = element.scrollHeight;
      observer = new ResizeObserver(() => {
        const nextHeight = element.firstElementChild?.getBoundingClientRect().height ?? 0;
        if (Math.abs(nextHeight - targetHeight) < 1 || animation.current !== motion) return;
        targetHeight = nextHeight;
        const currentHeight = element.getBoundingClientRect().height;
        const currentOpacity = getComputedStyle(element).opacity;
        (motion.effect as KeyframeEffect).setKeyframes([
          { height: `${currentHeight}px`, opacity: currentOpacity },
          { height: `${targetHeight}px`, opacity: 1 },
        ]);
        motion.currentTime = 0;
      });
      observer.observe(element.firstElementChild);
    }
    const onPreferenceChange = () => { if (media.matches) finish(); };
    const onVisibilityChange = () => { if (document.hidden) finish(); };
    media.addEventListener("change", onPreferenceChange);
    document.addEventListener("visibilitychange", onVisibilityChange);
    // Leave the running animation available for a rapid reversal to sample.
    return () => {
      observer?.disconnect();
      media.removeEventListener("change", onPreferenceChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      motion.onfinish = null;
    };
  }, [open]);

  useLayoutEffect(() => () => { animation.current?.cancel(); }, []);

  return (
    <div ref={ref} className="ui-disclosure" hidden={!open && !retained} inert={!open} aria-hidden={!open || undefined}>
      {(open || retained) && <div className="ui-disclosure-body">{typeof children === "function" ? children() : children}</div>}
    </div>
  );
}
