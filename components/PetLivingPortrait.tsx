"use client";

import { useEffect, useRef, useState } from "react";
import type { PortraitMotion, PortraitPose } from "./PetPortraitMotion";
import styles from "./PetWidget.module.css";

export function PetLivingPortrait({ pose, dragging, hop }: { pose: PortraitPose; dragging: boolean; hop: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const portraitRef = useRef<HTMLSpanElement>(null);
  const hopRef = useRef<Animation | null>(null);
  const motionRef = useRef<PortraitMotion | null>(null);
  const poseRef = useRef(pose);
  const draggingRef = useRef(dragging);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    let disposed = false;
    void import("./PetPortraitMotion").then(({ mountPortraitMotion }) => {
      if (disposed || !canvasRef.current) return;
      motionRef.current = mountPortraitMotion(canvasRef.current, () => { if (!disposed) setReady(true); }, () => { if (!disposed) setReady(false); });
      motionRef.current.setPose(poseRef.current);
    }).catch(() => { /* The original portrait remains usable if acceleration is unavailable. */ });
    const look = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.buttons || draggingRef.current) return;
      const rect = canvasRef.current?.getBoundingClientRect();
      if (rect) motionRef.current?.setLook((event.clientX-rect.left-rect.width/2)/320);
    };
    const reset = () => motionRef.current?.setLook(0);
    window.addEventListener("pointermove",look,{ passive: true }); window.addEventListener("blur",reset);
    document.addEventListener("pointerleave",reset);
    return () => {
      disposed = true; motionRef.current?.dispose(); motionRef.current = null;
      window.removeEventListener("pointermove",look); window.removeEventListener("blur",reset); document.removeEventListener("pointerleave",reset);
    };
  }, []);
  useEffect(() => { poseRef.current = pose; motionRef.current?.setPose(pose); }, [pose]);
  useEffect(() => {
    if (!hop || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // A pat gets a soft little bounce; cheering gets a more buoyant hop.
    const height = poseRef.current === "happy" ? 5 : 12;
    hopRef.current?.cancel();
    hopRef.current = portraitRef.current?.animate([
      { transform: "translateY(0)", offset: 0, easing: "ease-in" },
      { transform: "translateY(1.5px)", offset: 0.16, easing: "cubic-bezier(0.2, 0.7, 0.3, 1)" },
      { transform: `translateY(-${height}px)`, offset: 0.43, easing: "cubic-bezier(0.55, 0, 0.85, 0.4)" },
      { transform: "translateY(1px)", offset: 0.72, easing: "ease-out" },
      { transform: "translateY(-1px)", offset: 0.86, easing: "ease-in-out" },
      { transform: "translateY(0)", offset: 1 },
    ], { duration: poseRef.current === "happy" ? 680 : 820 }) ?? null;
    return () => { hopRef.current?.cancel(); };
  }, [hop]);
  useEffect(() => { draggingRef.current = dragging; if (dragging) hopRef.current?.cancel(); }, [dragging]);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
    const stop = () => { if (reduced.matches) hopRef.current?.cancel(); };
    reduced.addEventListener("change", stop);
    return () => reduced.removeEventListener("change", stop);
  }, []);
  return <span ref={portraitRef} className={styles.portrait} data-dragging={dragging} data-living={ready}>
    {/* The selected authored pose remains usable without canvas acceleration. */}
    {/* eslint-disable-next-line @next/next/no-img-element */}
    <img src={`/pets/lin-yue/${pose}.webp`} alt="" width="280" height="536" draggable={false} />
    <canvas ref={canvasRef} aria-hidden="true" />
  </span>;
}
