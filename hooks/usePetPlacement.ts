"use client";

import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import { choosePetPlacement, type PetObstacle, type PetPosition } from "@/lib/pet-placement";

const OBSTACLES = '.chat-input-shell, [role="dialog"]';

export function usePetPlacement(petRef: RefObject<HTMLDivElement | null>, {
  visible, preferred, small, frozen, dragging,
}: { visible: boolean; preferred: PetPosition | null; small: boolean; frozen: boolean; dragging: boolean }) {
  const [placement, setPlacement] = useState<{ position: PetPosition; compact: boolean } | null>(null);
  const placementRef = useRef(placement);
  placementRef.current = placement;
  const defaultPositionRef = useRef<PetPosition | null>(null);

  useLayoutEffect(() => {
    const pet = petRef.current;
    if (!visible || !pet || frozen) return;
    let frame: number | null = null;
    const observed = new Set<Element>();
    const schedule = () => { if (frame === null) frame = requestAnimationFrame(update); };
    const observer = new ResizeObserver(schedule);
    const update = () => {
      frame = null;
      const bounds = pet.getBoundingClientRect();
      const character = pet.querySelector("button")?.getBoundingClientRect();
      const style = getComputedStyle(pet);
      const figureHeight = parseFloat(style.getPropertyValue("--preferred-figure-height"));
      if (!character || !Number.isFinite(figureHeight)) return;
      defaultPositionRef.current ??= { x: bounds.x, y: bounds.y };
      const viewport = window.visualViewport;
      const available = { x: viewport?.offsetLeft ?? 0, y: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight };
      const elements = new Set<Element>([pet, ...document.querySelectorAll(OBSTACLES)]);
      const obstacles: PetObstacle[] = [];
      for (const element of elements) {
        if (!observed.has(element)) { observer.observe(element); observed.add(element); }
        if (element === pet || element.closest("[data-pet-companion]")) continue;
        const rect = element.getBoundingClientRect();
        if (!rect.width || !rect.height || getComputedStyle(element).visibility === "hidden"
          || rect.bottom <= available.y || rect.top >= available.y + available.height
          || rect.right <= available.x || rect.left >= available.x + available.width) continue;
        obstacles.push({ x: rect.x, y: rect.y, width: rect.width, height: rect.height,
          priority: element.matches(".chat-input-shell") ? 3 : 1 });
      }
      for (const element of observed) if (!elements.has(element)) { observer.unobserve(element); observed.delete(element); }
      const speechHeight = bounds.height - character.height;
      const next = choosePetPlacement(preferred ?? defaultPositionRef.current,
        { width: bounds.width, height: speechHeight + figureHeight },
        { width: bounds.width, height: speechHeight + Math.min(96, figureHeight) }, available, obstacles, placementRef.current ?? undefined);
      setPlacement((current) => current?.compact === next.compact
        && Math.abs(current.position.x - next.position.x) < 1 && Math.abs(current.position.y - next.position.y) < 1 ? current : next);
    };
    // Watch obstacle insertion/removal, not the streamed text or portrait frames.
    const relevant = (node: Node) => node instanceof Element && (node.matches(OBSTACLES) || node.querySelector(OBSTACLES));
    const mutation = new MutationObserver((records) => {
      if (records.some((record) => record.type === "attributes"
        ? record.target instanceof Element && !pet.contains(record.target)
          && (record.target.matches(OBSTACLES) || [...observed].some((element) => element !== pet && record.target.contains(element)))
        : [...record.addedNodes, ...record.removedNodes].some(relevant))) schedule();
    });
    update();
    mutation.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "hidden"] });
    window.addEventListener("resize", schedule);
    window.addEventListener("scroll", schedule, true);
    window.visualViewport?.addEventListener("resize", schedule);
    window.visualViewport?.addEventListener("scroll", schedule);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      observer.disconnect(); mutation.disconnect();
      window.removeEventListener("resize", schedule); window.removeEventListener("scroll", schedule, true);
      window.visualViewport?.removeEventListener("resize", schedule); window.visualViewport?.removeEventListener("scroll", schedule);
    };
  }, [visible, preferred, small, frozen, petRef]);

  return { position: dragging ? preferred ?? placement?.position : placement?.position ?? preferred, compact: placement?.compact ?? false };
}
