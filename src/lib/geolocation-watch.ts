/**
 * Poll is the fallback when watchPosition is off or silent.
 * While a watch is delivering fixes, skip the redundant 1-minute getCurrentPosition.
 */
export function shouldSkipPoll(input: {
  watchActive: boolean;
  lastWatchAt: number | null;
  now: number;
  pollIntervalMs: number;
}): boolean {
  if (!input.watchActive || input.lastWatchAt == null) return false;
  return input.now - input.lastWatchAt < input.pollIntervalMs;
}
