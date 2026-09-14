/** Minimal catalog shape so Node tests do not need path aliases. */
export type RadarCatalogFrames<T extends { path: string }> = {
  host: string;
  generated: number;
  frames: T[];
};

/** Playhead ± radius, wrapping. A non-finite radius means every frame. */
export function radarFramesToPreload<T>(frames: T[], index: number, radius: number): T[] {
  if (frames.length === 0) return [];
  if (!Number.isFinite(radius) || radius >= frames.length) return frames;
  const clamped = Math.max(0, Math.floor(radius));
  const out: T[] = [];
  const seen = new Set<number>();
  for (let delta = -clamped; delta <= clamped; delta += 1) {
    const i = ((index + delta) % frames.length + frames.length) % frames.length;
    if (seen.has(i)) continue;
    seen.add(i);
    const frame = frames[i];
    if (frame !== undefined) out.push(frame);
  }
  return out;
}

/**
 * Swap in a new RainViewer catalog without blanking Play.
 * Paused (and first load) land on newest. Playing keeps the current path
 * so the loop finishes on the new latest frame instead of jumping.
 */
export function mergeRainViewerCatalog<T extends { path: string }>(
  prev: RadarCatalogFrames<T> | null,
  next: RadarCatalogFrames<T>,
  currentIndex: number,
  animate: boolean,
): { catalog: RadarCatalogFrames<T>; frameIndex: number } {
  const last = next.frames.length ? next.frames.length - 1 : 0;
  if (!animate || !prev?.frames.length || !next.frames.length) {
    return { catalog: next, frameIndex: last };
  }
  const current = prev.frames[currentIndex];
  const mapped = current
    ? next.frames.findIndex((frame) => frame.path === current.path)
    : -1;
  if (mapped >= 0) return { catalog: next, frameIndex: mapped };
  const clamped = Math.min(Math.max(0, currentIndex), last);
  return { catalog: next, frameIndex: clamped };
}
