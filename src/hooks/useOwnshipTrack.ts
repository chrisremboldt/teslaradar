"use client";

import { useEffect, useReducer, useState } from "react";
import {
  RANGE_RING_30_MS,
  RANGE_RING_5_MS,
  TRACK_HOLD_MOVING_MS,
  TRACK_HOLD_PARKED_MS,
  TRACK_MAX_ACCURACY_M,
  TRACK_MAX_SPEED_MPS,
  TRACK_MIN_SEGMENT_M,
  TRACK_MIN_SPEED_MPS,
  TRACK_MOTION_WINDOW_MS,
  TRACK_NATIVE_STALE_MS,
  TRACK_RECENT_WINDOW_MS,
  TRACK_WINDOW_MS,
} from "@/lib/constants";
import {
  decideOwnshipMotion,
  type MotionHysteresis,
} from "@/lib/ownship-motion";
import { appendTrackPoint, type TrackPoint } from "@/lib/track-heading";
import type { GeoFix } from "@/lib/types";

/** Cheap Date.now() tick so hysteresis can expire without a new GPS sample. */
const RECOMPUTE_MS = 2_000;

export type OwnshipTrack = {
  heading: number | null;
  speedMps: number | null;
  range5m: number | null;
  range30m: number | null;
};

const EMPTY_TRACK: OwnshipTrack = {
  heading: null,
  speedMps: null,
  range5m: null,
  range30m: null,
};

function toTrackPoint(fix: GeoFix): TrackPoint {
  return {
    lat: fix.lat,
    lon: fix.lon,
    timestamp: fix.timestamp,
    accuracy: fix.accuracy,
  };
}

function fixKey(fix: GeoFix | null): string {
  if (!fix || fix.source === "demo") return "demo";
  return `${fix.lat}:${fix.lon}:${fix.timestamp}:${fix.speedMps ?? ""}:${fix.courseDeg ?? ""}`;
}

const MOTION_OPTIONS = {
  windowMs: TRACK_WINDOW_MS,
  recentWindowMs: TRACK_RECENT_WINDOW_MS,
  motionWindowMs: TRACK_MOTION_WINDOW_MS,
  minSegmentM: TRACK_MIN_SEGMENT_M,
  maxAccuracyM: TRACK_MAX_ACCURACY_M,
  minSpeedMps: TRACK_MIN_SPEED_MPS,
  maxSpeedMps: TRACK_MAX_SPEED_MPS,
  holdMovingMs: TRACK_HOLD_MOVING_MS,
  holdParkedMs: TRACK_HOLD_PARKED_MS,
  nativeStaleMs: TRACK_NATIVE_STALE_MS,
  fiveMs: RANGE_RING_5_MS,
  thirtyMs: RANGE_RING_30_MS,
};

type OwnshipState = {
  key: string;
  points: TrackPoint[];
  now: number;
  hysteresis: MotionHysteresis | null;
  track: OwnshipTrack;
  nativeSpeedMps: number | null;
  nativeCourseDeg: number | null;
  fixTimestamp: number | null;
  isDemo: boolean;
};

type OwnshipAction =
  | { type: "fix"; fix: GeoFix | null; now: number }
  | { type: "tick"; now: number };

const INITIAL_STATE: OwnshipState = {
  key: "",
  points: [],
  now: 0,
  hysteresis: null,
  track: EMPTY_TRACK,
  nativeSpeedMps: null,
  nativeCourseDeg: null,
  fixTimestamp: null,
  isDemo: true,
};

function reduceOwnship(state: OwnshipState, action: OwnshipAction): OwnshipState {
  const now = action.now;
  let { key, points, hysteresis, nativeSpeedMps, nativeCourseDeg, fixTimestamp, isDemo } = state;

  if (action.type === "fix") {
    const nextKey = fixKey(action.fix);
    isDemo = !action.fix || action.fix.source === "demo";
    nativeSpeedMps = action.fix?.speedMps ?? null;
    nativeCourseDeg = action.fix?.courseDeg ?? null;
    fixTimestamp = action.fix?.timestamp ?? null;
    if (nextKey !== key) {
      key = nextKey;
      if (isDemo) {
        points = [];
        hysteresis = null;
      } else if (action.fix) {
        points = appendTrackPoint(points, toTrackPoint(action.fix));
      }
    }
  }

  if (isDemo) {
    return {
      key,
      points,
      now,
      hysteresis: null,
      track: EMPTY_TRACK,
      nativeSpeedMps,
      nativeCourseDeg,
      fixTimestamp,
      isDemo,
    };
  }

  const decision = decideOwnshipMotion({
    now,
    fixTimestamp: fixTimestamp ?? undefined,
    nativeSpeedMps,
    nativeCourseDeg,
    points,
    hysteresis,
    options: MOTION_OPTIONS,
  });
  return {
    key,
    points,
    now,
    hysteresis: decision.hysteresis,
    track: {
      heading: decision.heading,
      speedMps: decision.speedMps,
      range5m: decision.range5m,
      range30m: decision.range30m,
    },
    nativeSpeedMps,
    nativeCourseDeg,
    fixTimestamp,
    isDemo,
  };
}

/**
 * Session-only rolling GPS track. Demo fixes are ignored so labeled cities
 * never invent a course or range rings.
 *
 * A reducer applies each GPS key (and the 2s aging tick). That replaces the
 * old render-time setState append, which was unsafe under React 18/19.
 */
export function useOwnshipTrack(fix: GeoFix | null): OwnshipTrack {
  const [now, setNow] = useState(() => Date.now());
  const [state, dispatch] = useReducer(reduceOwnship, INITIAL_STATE);

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), RECOMPUTE_MS);
    return () => window.clearInterval(timer);
  }, []);

  const key = fixKey(fix);
  if (key !== state.key) {
    dispatch({ type: "fix", fix, now });
  } else if (now !== state.now) {
    dispatch({ type: "tick", now });
  }

  return state.track;
}
