/** First GPS always persists; later writes wait this long. */
export const DEFAULT_GPS_SAVE_MIN_MS = 20_000;

export function shouldPersistCachedGps(
  lastSavedAt: number | null,
  now: number,
  minIntervalMs = DEFAULT_GPS_SAVE_MIN_MS,
): boolean {
  if (lastSavedAt == null) return true;
  return now - lastSavedAt >= minIntervalMs;
}
