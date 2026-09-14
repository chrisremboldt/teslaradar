export const DEFAULT_TESLA_MIN_DRAW_MS = 125;

export type OverlayDrawReason = "move" | "frame" | "settle" | "resize" | "preload" | "force";

/**
 * Tesla: never paint a hidden tab; never rAF-draw every MapLibre `move`.
 * Frame swaps, camera settle, resize, and preload always paint.
 * Continuous `move` is capped (~8 fps) so a 1920×1200 2D canvas cannot
 * track jumpTo/ease storms.
 */
export function shouldDrawRadarOverlay(input: {
  tesla: boolean;
  reason: OverlayDrawReason;
  lastDrawAt: number | null;
  now: number;
  hidden?: boolean;
  minIntervalMs?: number;
}): boolean {
  if (input.hidden) return false;
  if (!input.tesla) return true;
  if (input.reason !== "move") return true;
  const min = input.minIntervalMs ?? DEFAULT_TESLA_MIN_DRAW_MS;
  if (input.lastDrawAt == null) return true;
  return input.now - input.lastDrawAt >= min;
}

/** Tesla follow: skip jumpTo when the hop is smaller than a pixel. */
export function isSubpixelCameraHop(
  from: { x: number; y: number },
  to: { x: number; y: number },
  minPixels = 1.25,
): boolean {
  return Math.hypot(to.x - from.x, to.y - from.y) < minPixels;
}
