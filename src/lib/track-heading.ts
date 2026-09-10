/** Defaults match `TRACK_*` in constants.ts so this module stays import-free for Node tests. */
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_MIN_SEGMENT_M = 20;
const DEFAULT_MAX_ACCURACY_M = 200;

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

/**
 * Distance-weighted circular mean of segment bearings over the last window.
 * Returns null until two good points span a meaningful move (not parked jitter).
 */
export function averageTrackHeading(
  points: TrackPoint[],
  now = Date.now(),
  options?: {
    windowMs?: number;
    minSegmentM?: number;
    maxAccuracyM?: number;
  },
): number | null {
  const windowMs = options?.windowMs ?? DEFAULT_WINDOW_MS;
  const minSegmentM = options?.minSegmentM ?? DEFAULT_MIN_SEGMENT_M;
  const maxAccuracyM = options?.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M;

  const usable = pruneTrack(points, now, windowMs).filter((point) =>
    isAccurateEnough(point, maxAccuracyM),
  );

  let sumSin = 0;
  let sumCos = 0;
  let totalDist = 0;
  let segments = 0;

  for (let i = 1; i < usable.length; i += 1) {
    const dist = haversineMeters(usable[i - 1], usable[i]);
    if (dist < minSegmentM) continue;
    const bearing = initialBearingDegrees(usable[i - 1], usable[i]);
    const rad = (bearing * Math.PI) / 180;
    sumSin += Math.sin(rad) * dist;
    sumCos += Math.cos(rad) * dist;
    totalDist += dist;
    segments += 1;
  }

  if (segments < 1 || totalDist < minSegmentM) return null;
  return normalizeHeading((Math.atan2(sumSin, sumCos) * 180) / Math.PI);
}
