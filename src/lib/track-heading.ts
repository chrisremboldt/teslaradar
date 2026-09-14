/** Defaults match `TRACK_*` / `RANGE_*` in constants.ts so this module stays import-free for Node tests. */
const DEFAULT_WINDOW_MS = 5 * 60 * 1000;
const DEFAULT_RECENT_WINDOW_MS = 45_000;
const DEFAULT_MIN_SEGMENT_M = 20;
const DEFAULT_MAX_ACCURACY_M = 200;
const DEFAULT_MIN_SPEED_MPS = 0.75;
const DEFAULT_MAX_SPEED_MPS = 70;
const DEFAULT_RING_5_MS = 5 * 60 * 1000;
const DEFAULT_RING_30_MS = 30 * 60 * 1000;
const DEFAULT_MOTION_WINDOW_MS = 24_000;
const DEFAULT_DEGRADED_ACCURACY_M = 500;
const DEFAULT_HOLD_MOVING_MS = 4_000;
const DEFAULT_HOLD_PARKED_MS = 1_500;
const DEFAULT_NATIVE_STALE_MS = 15_000;
const DEFAULT_NET_MOVE_M = 24;
const DEFAULT_PARKED_NET_M = 12;
const DEFAULT_EXIT_SPEED_MPS = 0.45;

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
  endTimestamp: number;
};

export type TrackFilterOptions = {
  windowMs?: number;
  /** When set, speed only uses segments that end inside this recent window. */
  recentWindowMs?: number;
  minSegmentM?: number;
  maxAccuracyM?: number;
  minSpeedMps?: number;
  maxSpeedMps?: number;
};

function resolveFilters(options?: TrackFilterOptions) {
  return {
    windowMs: options?.windowMs ?? DEFAULT_WINDOW_MS,
    recentWindowMs: options?.recentWindowMs,
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
      endTimestamp: usable[i].timestamp,
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
  const { minSegmentM, minSpeedMps, recentWindowMs } = resolveFilters(options);
  const segments = goodTrackSegments(points, now, options);
  const cutoff = recentWindowMs != null ? now - recentWindowMs : null;
  let totalDist = 0;
  let totalDtMs = 0;
  let used = 0;
  for (const segment of segments) {
    if (cutoff != null && segment.endTimestamp < cutoff) continue;
    const hopSpeed = segment.dist / (segment.dtMs / 1000);
    // Drop crawl / stoplight bridges so a fresh pull-away hop can stand alone.
    if (hopSpeed < minSpeedMps) continue;
    totalDist += segment.dist;
    totalDtMs += segment.dtMs;
    used += 1;
  }
  if (used < 1 || totalDist < minSegmentM || totalDtMs <= 0) return null;
  const speed = totalDist / (totalDtMs / 1000);
  if (speed < minSpeedMps) return null;
  return speed;
}

/** Speed for range rings: recent fast hops only, so parked ↔ moving can flip. */
export function recentTrackSpeedMps(
  points: TrackPoint[],
  now = Date.now(),
  options?: TrackFilterOptions,
): number | null {
  return averageTrackSpeedMps(points, now, {
    ...options,
    recentWindowMs: options?.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS,
  });
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

export type MotionHysteresis = {
  moving: boolean;
  quietSince: number | null;
  evidenceSince: number | null;
  heldSpeedMps: number | null;
};

export type OwnshipDecision = {
  moving: boolean;
  speedMps: number | null;
  heading: number | null;
  range5m: number | null;
  range30m: number | null;
  hysteresis: MotionHysteresis;
};

export function readNativeSpeedMps(speed: unknown): number | null {
  if (typeof speed !== "number" || !Number.isFinite(speed) || speed < 0) return null;
  return speed;
}

export function readNativeCourseDeg(heading: unknown): number | null {
  if (typeof heading !== "number" || !Number.isFinite(heading) || heading < 0) return null;
  return ((heading % 360) + 360) % 360;
}

export type TrackWindowMetrics = {
  pathM: number;
  netM: number;
  dtMs: number;
  count: number;
  bearing: number | null;
};

/**
 * Path + net displacement over a short window. A single awful accuracy
 * reading is dropped when other good points remain; if the recent window
 * would otherwise be empty, degraded points are kept so one spike cannot
 * starve rings.
 */
export function trackWindowMetrics(
  points: TrackPoint[],
  now: number,
  options?: TrackFilterOptions & {
    motionWindowMs?: number;
    degradedAccuracyM?: number;
  },
): TrackWindowMetrics {
  const windowMs = options?.motionWindowMs ?? DEFAULT_MOTION_WINDOW_MS;
  const maxAccuracyM = options?.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M;
  const degradedAccuracyM = options?.degradedAccuracyM ?? DEFAULT_DEGRADED_ACCURACY_M;
  const maxSpeedMps = options?.maxSpeedMps ?? DEFAULT_MAX_SPEED_MPS;
  const recent = pruneTrack(points, now, windowMs);
  const good = recent.filter(
    (point) => point.accuracy == null || point.accuracy <= maxAccuracyM,
  );
  const usable =
    good.length >= 2
      ? good
      : recent.filter(
          (point) => point.accuracy == null || point.accuracy <= degradedAccuracyM,
        );

  const empty: TrackWindowMetrics = { pathM: 0, netM: 0, dtMs: 0, count: usable.length, bearing: null };
  if (usable.length < 2) return empty;

  let pathM = 0;
  let dtMs = 0;
  for (let i = 1; i < usable.length; i += 1) {
    const dist = haversineMeters(usable[i - 1], usable[i]);
    const hopDt = usable[i].timestamp - usable[i - 1].timestamp;
    if (hopDt <= 0) continue;
    const speed = dist / (hopDt / 1000);
    if (speed > maxSpeedMps) continue;
    pathM += dist;
    dtMs += hopDt;
  }

  const first = usable[0];
  const last = usable[usable.length - 1];
  const netM = haversineMeters(first, last);
  const spanMs = last.timestamp - first.timestamp;
  const bearing = netM >= 8 ? initialBearingDegrees(first, last) : null;
  return { pathM, netM, dtMs: spanMs > 0 ? spanMs : dtMs, count: usable.length, bearing };
}

export function derivedWindowSpeedMps(
  metrics: TrackWindowMetrics,
  minSpeedMps = DEFAULT_MIN_SPEED_MPS,
  parkedNetM = DEFAULT_PARKED_NET_M,
): number | null {
  if (metrics.dtMs <= 0 || metrics.netM < parkedNetM) return null;
  if (metrics.pathM > 0 && metrics.netM / metrics.pathM < 0.35 && metrics.netM < 40) {
    return null;
  }
  const speed = metrics.netM / (metrics.dtMs / 1000);
  if (speed < minSpeedMps) return null;
  return speed;
}

export function pickOwnshipHeading(input: {
  trackHeading: number | null;
  windowBearing: number | null;
  nativeCourseDeg: number | null;
  netM: number;
  minNetM?: number;
}): number | null {
  const minNetM = input.minNetM ?? DEFAULT_NET_MOVE_M;
  if (input.trackHeading != null) return input.trackHeading;
  if (input.windowBearing != null && input.netM >= minNetM) return input.windowBearing;
  return input.nativeCourseDeg;
}

/** Parked vs moving + rings + chevron. One function used by useOwnshipTrack. */
export function decideOwnshipMotion(input: {
  now: number;
  fixTimestamp?: number;
  nativeSpeedMps: number | null;
  nativeCourseDeg: number | null;
  points: TrackPoint[];
  hysteresis?: MotionHysteresis | null;
  options?: TrackFilterOptions & {
    motionWindowMs?: number;
    holdMovingMs?: number;
    holdParkedMs?: number;
    nativeStaleMs?: number;
    netMoveM?: number;
    parkedNetM?: number;
    exitSpeedMps?: number;
    fiveMs?: number;
    thirtyMs?: number;
  };
}): OwnshipDecision {
  const minSpeedMps = input.options?.minSpeedMps ?? DEFAULT_MIN_SPEED_MPS;
  const holdMovingMs = input.options?.holdMovingMs ?? DEFAULT_HOLD_MOVING_MS;
  const holdParkedMs = input.options?.holdParkedMs ?? DEFAULT_HOLD_PARKED_MS;
  const nativeStaleMs = input.options?.nativeStaleMs ?? DEFAULT_NATIVE_STALE_MS;
  const netMoveM = input.options?.netMoveM ?? DEFAULT_NET_MOVE_M;
  const parkedNetM = input.options?.parkedNetM ?? DEFAULT_PARKED_NET_M;
  const exitSpeedMps = input.options?.exitSpeedMps ?? DEFAULT_EXIT_SPEED_MPS;
  const motionWindowMs = input.options?.motionWindowMs ?? DEFAULT_MOTION_WINDOW_MS;

  const age = input.fixTimestamp != null ? input.now - input.fixTimestamp : 0;
  const nativeFresh =
    input.nativeSpeedMps != null && (input.fixTimestamp == null || age <= nativeStaleMs);
  const nativeSpeed = nativeFresh ? input.nativeSpeedMps : null;
  const nativeCourse =
    input.nativeCourseDeg != null && (input.fixTimestamp == null || age <= nativeStaleMs)
      ? input.nativeCourseDeg
      : null;

  const trackOptions: TrackFilterOptions = {
    windowMs: input.options?.windowMs ?? DEFAULT_WINDOW_MS,
    recentWindowMs: input.options?.recentWindowMs ?? DEFAULT_RECENT_WINDOW_MS,
    minSegmentM: input.options?.minSegmentM ?? DEFAULT_MIN_SEGMENT_M,
    maxAccuracyM: input.options?.maxAccuracyM ?? DEFAULT_MAX_ACCURACY_M,
    minSpeedMps,
    maxSpeedMps: input.options?.maxSpeedMps ?? DEFAULT_MAX_SPEED_MPS,
  };

  const trackHeading = averageTrackHeading(input.points, input.now, trackOptions);
  const trackSpeed = recentTrackSpeedMps(input.points, input.now, trackOptions);
  const metrics = trackWindowMetrics(input.points, input.now, {
    ...trackOptions,
    motionWindowMs,
  });
  const windowSpeed = derivedWindowSpeedMps(metrics, minSpeedMps, parkedNetM);

  let evidenceSpeed: number | null = null;
  let wantMoving = false;
  if (nativeSpeed != null) {
    evidenceSpeed = nativeSpeed;
    wantMoving = nativeSpeed >= minSpeedMps;
  } else {
    evidenceSpeed = windowSpeed ?? trackSpeed;
    const netOk = metrics.netM >= netMoveM;
    wantMoving = evidenceSpeed != null && evidenceSpeed >= minSpeedMps && netOk;
    if (!wantMoving && windowSpeed != null && metrics.netM >= netMoveM) {
      wantMoving = true;
      evidenceSpeed = windowSpeed;
    }
  }

  const prior: MotionHysteresis = input.hysteresis ?? {
    moving: false,
    quietSince: null,
    evidenceSince: null,
    heldSpeedMps: null,
  };

  let moving = prior.moving;
  let quietSince = prior.quietSince;
  let evidenceSince = prior.evidenceSince;
  let heldSpeedMps = prior.heldSpeedMps;

  if (wantMoving) {
    quietSince = null;
    if (!prior.moving) {
      const clearGo =
        (nativeSpeed != null && nativeSpeed >= minSpeedMps) ||
        (evidenceSpeed != null && evidenceSpeed >= 2.5 && metrics.netM >= 20);
      if (clearGo) {
        moving = true;
        evidenceSince = null;
      } else {
        evidenceSince = evidenceSince ?? input.now;
        if (input.now - evidenceSince >= holdParkedMs) {
          moving = true;
          evidenceSince = null;
        }
      }
    } else {
      moving = true;
      evidenceSince = null;
    }
    if (evidenceSpeed != null && evidenceSpeed > 0) heldSpeedMps = evidenceSpeed;
  } else {
    evidenceSince = null;
    const clearlyStopped = nativeSpeed != null ? nativeSpeed <= exitSpeedMps : true;
    if (prior.moving && clearlyStopped) {
      quietSince = quietSince ?? input.now;
      if (input.now - quietSince >= holdMovingMs) {
        moving = false;
        quietSince = null;
        heldSpeedMps = null;
      }
    } else if (!prior.moving) {
      moving = false;
      quietSince = null;
    }
  }

  const liveSpeed =
    evidenceSpeed != null && evidenceSpeed > 0 ? evidenceSpeed : heldSpeedMps;
  const speedMps = moving ? liveSpeed : null;
  const heading = pickOwnshipHeading({
    trackHeading,
    windowBearing: metrics.bearing,
    nativeCourseDeg: nativeCourse,
    netM: metrics.netM,
    minNetM: netMoveM,
  });
  const rings = rangeRingRadii(speedMps, {
    fiveMs: input.options?.fiveMs,
    thirtyMs: input.options?.thirtyMs,
    minRadiusM: DEFAULT_MIN_SEGMENT_M,
  });

  return {
    moving,
    speedMps,
    heading,
    range5m: rings.range5m,
    range30m: rings.range30m,
    hysteresis: { moving, quietSince, evidenceSince, heldSpeedMps },
  };
}
