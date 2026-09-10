/** Unix seconds ~1e9; Unix milliseconds ~1e12. Values below this are treated as seconds. */
const UNIX_SECONDS_MAX = 1e11;
const MAX_FUTURE_DRIFT_MS = 2 * 60 * 1000;
const MAX_PAST_MS = 2 * 365.25 * 24 * 60 * 60 * 1000;

/**
 * Normalize a GPS / epoch timestamp to milliseconds.
 * Tesla Chromium (and some WebViews) report `GeolocationPosition.timestamp`
 * as Unix seconds; the spec says milliseconds. Seconds-looking values are
 * multiplied by 1000. Absurd past/future values collapse to `now` so a live
 * fix can never render as hundreds of thousands of hours ago.
 */
export function normalizeEpochMs(value: number, now = Date.now()): number {
  if (!Number.isFinite(value) || value <= 0) return now;
  const ms = value < UNIX_SECONDS_MAX ? value * 1000 : value;
  if (ms > now + MAX_FUTURE_DRIFT_MS) return now;
  if (now - ms > MAX_PAST_MS) return now;
  return ms;
}
