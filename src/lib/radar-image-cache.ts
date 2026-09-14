/** Image-shaped object so Node tests do not need a real HTMLImageElement. */
export type RadarCacheImage = {
  src: string;
  onload?: unknown;
  onerror?: unknown;
};

export type RadarImageCache<T extends RadarCacheImage = RadarCacheImage> = Map<string, T>;

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

/** Tesla: playhead ±1 only (3). Phone: a hard cap so a catalog never piles up. */
export function radarImageCacheLimit(tesla: boolean, preloadCount = tesla ? 3 : 16): number {
  if (tesla) return Math.min(3, Math.max(1, preloadCount));
  return Math.max(1, Math.min(16, preloadCount));
}
