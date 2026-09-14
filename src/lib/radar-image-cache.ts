/** Image-shaped object so Node tests do not need a real HTMLImageElement. */
export type RadarCacheImage = {
  src: string;
  onload?: unknown;
  onerror?: unknown;
};

export type RadarImageCache<T extends RadarCacheImage = RadarCacheImage> = Map<string, T>;

export type RadarPaintImage<T> = {
  image: T;
  url: string;
  held: boolean;
};

/**
 * Drop the decoded bitmap. Old Chromium (Tesla ~79) will not GC a loaded
 * <img> until src is cleared, even after the Map entry is deleted.
 */
export function releaseRadarImage(image: RadarCacheImage): void {
  image.onload = null;
  image.onerror = null;
  image.src = "";
}

export function evictRadarImages<T extends RadarCacheImage>(
  cache: RadarImageCache<T>,
  keep: Set<string>,
): number {
  let evicted = 0;
  for (const [key, image] of cache) {
    if (keep.has(key)) continue;
    releaseRadarImage(image);
    cache.delete(key);
    evicted += 1;
  }
  return evicted;
}

export function capRadarImageCache<T extends RadarCacheImage>(
  cache: RadarImageCache<T>,
  maxSize: number,
  keep?: Set<string>,
): number {
  const limit = Math.max(1, Math.floor(maxSize));
  let evicted = 0;
  while (cache.size > limit) {
    let victim: string | undefined;
    for (const key of cache.keys()) {
      if (keep?.has(key)) continue;
      victim = key;
      break;
    }
    victim ??= cache.keys().next().value;
    if (victim == null) break;
    const image = cache.get(victim);
    if (image) releaseRadarImage(image);
    cache.delete(victim);
    evicted += 1;
  }
  return evicted;
}

export function clearRadarImageCache<T extends RadarCacheImage>(cache: RadarImageCache<T>): void {
  for (const image of cache.values()) releaseRadarImage(image);
  cache.clear();
}

/**
 * Paused keeps 1. Play may keep the full past loop (capped by the animated
 * limit the caller passes as `preloadCount`).
 */
export function radarImageCacheLimit(_tesla?: boolean, preloadCount = 1): number {
  const n = Number.isFinite(preloadCount) ? Math.floor(preloadCount) : 1;
  return Math.max(1, n);
}

/** Pause: keep the latest playhead, `src=""` everything else. */
export function shrinkRadarImageCacheToPlayhead<T extends RadarCacheImage>(
  cache: RadarImageCache<T>,
  playheadUrl: string,
  pausedLimit = 1,
): number {
  const keep = playheadUrl ? new Set([playheadUrl]) : new Set<string>();
  const evicted = evictRadarImages(cache, keep);
  return evicted + capRadarImageCache(cache, pausedLimit, keep);
}

/**
 * Prefer the target frame; if it is not decoded yet, reuse the last good URL
 * so the overlay never clear-to-empties mid-loop.
 */
export function resolveRadarPaintImage<T>(
  images: Map<string, T>,
  url: string,
  lastUrl: string | null,
): RadarPaintImage<T> | null {
  if (url) {
    const current = images.get(url);
    if (current) return { image: current, url, held: false };
  }
  if (lastUrl) {
    const held = images.get(lastUrl);
    if (held) return { image: held, url: lastUrl, held: true };
  }
  return null;
}

export function isRadarPlayReady(flag: string | null | undefined): boolean {
  return flag === "1";
}

/**
 * Play waits until playhead±1 are decoded, then steps. A timeout keeps a
 * missing neighbor from stalling the loop forever.
 */
export function shouldAdvanceRadarPlayhead(input: {
  ready: boolean;
  elapsedMs: number;
  timeoutMs: number;
}): boolean {
  return input.ready || input.elapsedMs >= input.timeoutMs;
}
