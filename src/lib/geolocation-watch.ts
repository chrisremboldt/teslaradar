import { GEO_STATIONARY_M } from "./constants";
import { haversineMeters } from "./track-heading";

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

export type GeoPoint = { lat: number; lon: number };

/**
 * After two Tesla polls sit still, the next tick must not reuse a cached
 * stopped fix — otherwise pull-away never enters the track until Refresh.
 */
export function shouldUseCachedTeslaPoll(input: {
  previous: GeoPoint | null;
  current: GeoPoint | null;
  stationaryM?: number;
}): boolean {
  if (!input.previous || !input.current) return true;
  const limit = input.stationaryM ?? GEO_STATIONARY_M;
  return haversineMeters(input.previous, input.current) >= limit;
}
