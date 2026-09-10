/** Defaults match `TRACK_*` / `RANGE_*` in constants.ts so this module stays import-free for Node tests. */
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MIN_SEGMENT_M = 20;
const DEFAULT_MAX_ACCURACY_M = 200;
const DEFAULT_MIN_SPEED_MPS = 0.75;
const DEFAULT_MAX_SPEED_MPS = 70;
const DEFAULT_RING_5_MS = 5 * 60 * 1000;
const DEFAULT_RING_30_MS = 30 * 60 * 1000;

export type TrackPoint = {
  lat: number;
  lon: number;
  timestamp: number;
  accuracy: number | null;
};

const EARTH_RADIUS_M = 6_371_000;
/** Treat a single hop this large as a teleport and reset the track. */
const TRACK_RESET_JUMP_M = 50_000;

function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function haversineMeters(
  from: Pick<TrackPoint, "lat" | "lon">,
  to: Pick<TrackPoint, "lat" | "lon">,
): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δφ = ((to.lat - from.lat) * Math.PI) / 180;
  const Δλ = ((to.lon - from.lon) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

export function initialBearingDegrees(
  from: Pick<TrackPoint, "lat" | "lon">,
  to: Pick<TrackPoint, "lat" | "lon">,
): number {
  const φ1 = (from.lat * Math.PI) / 180;
  const φ2 = (to.lat * Math.PI) / 180;
  const Δλ = ((to.lon - from.lon) * Math.PI) / 180;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return normalizeHeading((Math.atan2(y, x) * 180) / Math.PI);
}

export function pruneTrack(
  points: TrackPoint[],
  now: number,
  windowMs = DEFAULT_WINDOW_MS,
): TrackPoint[] {
  return points.filter((point) => now - point.timestamp <= windowMs);
}

function isSamePoint(a: TrackPoint, b: TrackPoint): boolean {
  return a.timestamp === b.timestamp && a.lat === b.lat && a.lon === b.lon;
}

export function appendTrackPoint(
  points: TrackPoint[],
  next: TrackPoint,
  now = next.timestamp,
  windowMs = DEFAULT_WINDOW_MS,
): TrackPoint[] {
  const pruned = pruneTrack(points, now, windowMs);
  if (pruned.some((point) => isSamePoint(point, next))) return pruned;
  const last = pruned.at(-1);
  if (last && haversineMeters(last, next) > TRACK_RESET_JUMP_M) {
    return [next];
  }
  return [...pruned, next];
}

function isAccurateEnough(point: TrackPoint, maxAccuracyM: number): boolean {
  return point.accuracy == null || point.accuracy <= maxAccuracyM;
}

export type TrackSegment = {
  dist: number;
  dtMs: number;
  bearing: number;
};

export type TrackFilterOptions = {
  windowMs?: number;
  minSegmentM?: number;
  maxAccuracyM?: number;
  minSpeedMps?: number;
  maxSpeedMps?: number;
};

function resolveFilters(options?: TrackFilterOptions) {
  return {
    windowMs: options?.windowMs ?? DEFAULT_WINDOW_MS,
    minSegmentM: options?.minSegmentM ?? DEFAULT_MIN_SEGMENT_M,
    maxAccuracyM: options?.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M,
    minSpeedMps: options?.minSpeedMps ?? DEFAULT_MIN_SPEED_MPS,
    maxSpeedMps: options?.maxSpeedMps ?? DEFAULT_MAX_SPEED_MPS,
  };
}

/** Same junk filters for heading and speed: tiny hops, huge accuracy, teleport speeds. */
export function goodTrackSegments(
  points: TrackPoint[],
  now = Date.now(),
  options?: TrackFilterOptions,
): TrackSegment[] {
  const { windowMs, minSegmentM, maxAccuracyM, maxSpeedMps } = resolveFilters(options);
  const usable = pruneTrack(points, now, windowMs).filter((point) =>
    isAccurateEnough(point, maxAccuracyM),
  );

  const segments: TrackSegment[] = [];
  for (let i = 1; i < usable.length; i += 1) {
    const dist = haversineMeters(usable[i - 1], usable[i]);
    const dtMs = usable[i].timestamp - usable[i - 1].timestamp;
    if (dist < minSegmentM || dtMs <= 0) continue;
    const speed = dist / (dtMs / 1000);
    if (speed > maxSpeedMps) continue;
    segments.push({
      dist,
      dtMs,
      bearing: initialBearingDegrees(usable[i - 1], usable[i]),
    });
  }
  return segments;
}

/**
 * Distance-weighted circular mean of segment bearings over the last window.
 * Returns null until two good points span a meaningful move (not parked jitter).
 */
export function averageTrackHeading(
  points: TrackPoint[],
  now = Date.now(),
  options?: TrackFilterOptions,
): number | null {
  const { minSegmentM } = resolveFilters(options);
  const segments = goodTrackSegments(points, now, options);

  let sumSin = 0;
  let sumCos = 0;
  let totalDist = 0;
  for (const segment of segments) {
    const rad = (segment.bearing * Math.PI) / 180;
    sumSin += Math.sin(rad) * segment.dist;
    sumCos += Math.cos(rad) * segment.dist;
    totalDist += segment.dist;
  }

  if (segments.length < 1 || totalDist < minSegmentM) return null;
  return normalizeHeading((Math.atan2(sumSin, sumCos) * 180) / Math.PI);
}

/** Average ground speed (m/s) over good segments in the same 5-minute window. */
export function averageTrackSpeedMps(
  points: TrackPoint[],
  now = Date.now(),
  options?: TrackFilterOptions,
): number | null {
  const { minSegmentM, minSpeedMps } = resolveFilters(options);
  const segments = goodTrackSegments(points, now, options);
  let totalDist = 0;
  let totalDtMs = 0;
  for (const segment of segments) {
    totalDist += segment.dist;
    totalDtMs += segment.dtMs;
  }
  if (segments.length < 1 || totalDist < minSegmentM || totalDtMs <= 0) return null;
  const speed = totalDist / (totalDtMs / 1000);
  if (speed < minSpeedMps) return null;
  return speed;
}

export function rangeRingMeters(
  speedMps: number | null,
  durationMs: number,
  minRadiusM = DEFAULT_MIN_SEGMENT_M,
): number | null {
  if (speedMps == null || speedMps <= 0 || durationMs <= 0) return null;
  const radius = speedMps * (durationMs / 1000);
  if (radius < minRadiusM) return null;
  return radius;
}

export function rangeRingRadii(
  speedMps: number | null,
  options?: { fiveMs?: number; thirtyMs?: number; minRadiusM?: number },
): { range5m: number | null; range30m: number | null } {
  const fiveMs = options?.fiveMs ?? DEFAULT_RING_5_MS;
  const thirtyMs = options?.thirtyMs ?? DEFAULT_RING_30_MS;
  const minRadiusM = options?.minRadiusM ?? DEFAULT_MIN_SEGMENT_M;
  return {
    range5m: rangeRingMeters(speedMps, fiveMs, minRadiusM),
    range30m: rangeRingMeters(speedMps, thirtyMs, minRadiusM),
  };
}
