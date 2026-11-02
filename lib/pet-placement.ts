export type PetPosition = { x: number; y: number };
export type PetSize = { width: number; height: number };
export type PetRect = PetPosition & PetSize;
export type PetObstacle = PetRect & { priority?: number };
export type PetPlacement = { position: PetPosition; compact: boolean };

const MARGIN = 8;
const GAP = 12;

/** Find the nearest free spot; when space runs out, minimise covered controls. */
export function placePet(preferred: PetPosition, size: PetSize, viewport: PetRect, obstacles: readonly PetObstacle[]) {
  const minX = viewport.x + MARGIN, minY = viewport.y + MARGIN;
  const maxX = Math.max(minX, viewport.x + viewport.width - size.width - MARGIN);
  const maxY = Math.max(minY, viewport.y + viewport.height - size.height - MARGIN);
  const clampX = (x: number) => Math.max(minX, Math.min(x, maxX));
  const clampY = (y: number) => Math.max(minY, Math.min(y, maxY));
  const padded = obstacles.map((rect) => ({ ...rect, x: rect.x - GAP, y: rect.y - GAP,
    width: rect.width + GAP * 2, height: rect.height + GAP * 2 }));
  const xs = new Set([clampX(preferred.x), minX, maxX]);
  const ys = new Set([clampY(preferred.y), minY, maxY]);
  for (const rect of padded) {
    xs.add(clampX(rect.x - size.width)); xs.add(clampX(rect.x + rect.width));
    ys.add(clampY(rect.y - size.height)); ys.add(clampY(rect.y + rect.height));
  }
  let best = { position: { x: minX, y: minY }, overlap: Infinity, distance: Infinity };
  for (const x of xs) for (const y of ys) {
    const overlap = padded.reduce((sum, rect) => sum
      + Math.max(0, Math.min(x + size.width, rect.x + rect.width) - Math.max(x, rect.x))
      * Math.max(0, Math.min(y + size.height, rect.y + rect.height) - Math.max(y, rect.y))
      * (rect.priority ?? 1), 0);
    const distance = (x - preferred.x) ** 2 + (y - preferred.y) ** 2;
    if (overlap < best.overlap || (overlap === best.overlap && distance < best.distance)) {
      best = { position: { x, y }, overlap, distance };
    }
  }
  return best;
}

export function choosePetPlacement(preferred: PetPosition, normal: PetSize, compact: PetSize,
  viewport: PetRect, obstacles: readonly PetObstacle[], current?: PetPlacement) {
  const full = placePet(preferred, normal, viewport, obstacles);
  const fits = normal.width <= viewport.width - MARGIN * 2 && normal.height <= viewport.height - MARGIN * 2;
  let next: PetPlacement = { position: full.position, compact: false };
  if (full.overlap !== 0 || !fits) {
    const smaller = placePet(preferred, compact, viewport, obstacles);
    if (smaller.overlap < full.overlap || !fits) next = { position: smaller.position, compact: true };
  }
  // Keep a safe temporary spot while controls resize, then return to the preference.
  if (current?.compact === next.compact) {
    const size = next.compact ? compact : normal;
    const desired = placePet(preferred, size, viewport, []).position;
    if (next.position.x !== desired.x || next.position.y !== desired.y) {
      const stable = placePet(current.position, size, viewport, obstacles);
      if (stable.overlap === 0 && stable.distance === 0) return current;
    }
  }
  return next;
}
