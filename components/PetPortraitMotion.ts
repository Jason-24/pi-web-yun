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
  let targetX = 0, lookX = 0, lastLook = -10, poseAge = 0;
  let glance = 0, nextGlance = 5 + Math.random() * 4;
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
      from = current; current = target; transition = reduced.matches ? 1 : 0; poseAge = 0;
    }
    poseAge += dt;
    transition = Math.min(1, transition + dt / 0.3);
    const amount = transition * transition * (3 - 2 * transition);
    const image = images.get(current);
    if (!image?.naturalWidth) return;
    // Brief, irregular glances settle back to centre when the pointer rests.
    if (elapsed >= nextGlance) {
      glance = (Math.random() - 0.5) * 0.9;
      nextGlance = elapsed + 6 + Math.random() * 6;
    }
    const gaze = elapsed - lastLook < 2.5 ? targetX : glance;
    lookX += ((reduced.matches || current === "sleep" ? 0 : gaze) - lookX) * -Math.expm1(-2.8 * dt);
    glance *= Math.exp(-dt * 0.45);
    const breath = reduced.matches ? 0 : Math.sin(elapsed * (current === "sleep" ? 1.1 : 1.5));
    const awake = !reduced.matches && current !== "sleep";
    // Slow weight shifts and a single greeting/nod use rigid movement: no facial warping.
    const sway = awake ? Math.sin(elapsed * 0.72) * 0.004 + Math.sin(elapsed * 1.13 + 1) * 0.002 : 0;
    const envelope = awake && poseAge < 2.2 ? Math.sin(Math.PI * poseAge / 2.2) ** 2 : 0;
    const gesture = current === "wave" ? Math.sin(poseAge * 5.5) * 0.015 * envelope
      : current === "happy" ? Math.sin(poseAge * 3) * 0.009 * envelope
      : current === "thinking" ? -0.008 * envelope : 0;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.save();
    // Less than one source pixel of breathing, pivoted at the feet; the face stays intact.
    context.translate(canvas.width * 0.5, canvas.height * 0.965);
    context.rotate(lookX * 0.012 + sway + gesture);
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
    setLook(x) { targetX = Math.max(-1, Math.min(1, x)); lastLook = elapsed; },
    dispose() {
      disposed = true; cancelAnimationFrame(frame); observer.disconnect();
      images.forEach((image) => { image.onload = null; image.onerror = null; });
      document.removeEventListener("visibilitychange", resume); canvas.removeEventListener("contextlost", lost);
    },
  };
}
