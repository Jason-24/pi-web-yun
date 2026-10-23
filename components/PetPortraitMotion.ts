// Aligned, authored poses retain their facial features. Never paint or stretch the eyes.
export type PortraitPose = "idle" | "wave" | "happy" | "thinking" | "cheer" | "sleep";
export type PortraitMotion = { setPose(pose: PortraitPose): void; setLook(x: number): void; dispose(): void };

export function mountPortraitMotion(canvas: HTMLCanvasElement, ready: () => void, unavailable: () => void): PortraitMotion {
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Portrait canvas unavailable");
  const poses: PortraitPose[] = ["idle", "wave", "happy", "thinking", "cheer", "sleep"];
  const images = new Map<PortraitPose, HTMLImageElement>();
  let disposed = false, frame = 0, previous = 0, elapsed = 0, announced = false;
  let current: PortraitPose = "idle", from: PortraitPose = "idle", target: PortraitPose = "idle", transition = 1;
  let targetX = 0, lookX = 0;
  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
  const resize = () => {
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(canvas.clientWidth * ratio));
    canvas.height = Math.max(1, Math.round(canvas.clientHeight * ratio));
  };
  const observer = new ResizeObserver(resize); observer.observe(canvas); resize();
  const draw = (now: number) => {
    if (disposed || document.hidden) return;
    frame = requestAnimationFrame(draw);
    if (now - previous < 1000 / 30) return;
    const dt = Math.min((now - previous) / 1000, 0.05); previous = now; elapsed += dt;
    if (target !== current && images.get(target)?.naturalWidth && transition >= 1) {
      from = current; current = target; transition = reduced.matches ? 1 : 0;
    }
    transition = Math.min(1, transition + dt / 0.16);
    const amount = transition * transition * (3 - 2 * transition);
    const image = images.get(current);
    if (!image?.naturalWidth) return;
    lookX += ((reduced.matches || current === "sleep" ? 0 : targetX) - lookX) * -Math.expm1(-4 * dt);
    const breath = reduced.matches ? 0 : Math.sin(elapsed * (current === "sleep" ? 1.1 : 1.5));
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    // Less than one source pixel of breathing, pivoted at the feet; the face stays intact.
    context.translate(canvas.width * 0.5, canvas.height * 0.965);
    context.rotate(lookX * 0.005);
    context.scale(1, 1 + breath * 0.0013);
    context.translate(-canvas.width * 0.5, -canvas.height * 0.965);
    if (amount < 1) {
      const before = images.get(from);
      if (before?.naturalWidth) { context.globalAlpha = 1 - amount; context.drawImage(before, 0, 0, canvas.width, canvas.height); }
    }
    context.globalAlpha = amount; context.drawImage(image, 0, 0, canvas.width, canvas.height);
    context.restore();
    canvas.dataset.pose = current;
    canvas.dataset.frame = elapsed.toFixed(2);
    canvas.dataset.motion = reduced.matches ? "reduced" : "gentle";
    if (!announced) { announced = true; ready(); }
  };
  const resume = () => {
    cancelAnimationFrame(frame); previous = performance.now();
    if (!disposed && !document.hidden) frame = requestAnimationFrame(draw);
  };
  const lost = () => { cancelAnimationFrame(frame); unavailable(); };
  canvas.addEventListener("contextlost", lost); document.addEventListener("visibilitychange", resume);
  poses.forEach((pose) => {
    const image = new Image(); images.set(pose, image);
    image.onload = () => { if (!disposed) resume(); };
    image.onerror = () => { if (pose === target || pose === "idle") unavailable(); };
    image.src = `/pets/lin-yue/${pose}.webp`;
  });
  return {
    setPose(pose) { target = pose; },
    setLook(x) { targetX = Math.max(-1, Math.min(1, x)); },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      images.forEach((image) => { image.onload = null; image.onerror = null; });
      document.removeEventListener("visibilitychange", resume); canvas.removeEventListener("contextlost", lost);
    },
  };
}
