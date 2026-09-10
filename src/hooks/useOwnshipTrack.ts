"use client";

import { useEffect, useState } from "react";
import {
  RANGE_RING_30_MS,
  RANGE_RING_5_MS,
  TRACK_MAX_ACCURACY_M,
  TRACK_MAX_SPEED_MPS,
  TRACK_MIN_SEGMENT_M,
  TRACK_MIN_SPEED_MPS,
  TRACK_RECENT_WINDOW_MS,
  TRACK_WINDOW_MS,
} from "@/lib/constants";
import type { GeoFix } from "@/lib/types";
import {
  appendTrackPoint,
  averageTrackHeading,
  rangeRingRadii,
  recentTrackSpeedMps,
  type TrackPoint,
} from "@/lib/track-heading";

const RECOMPUTE_MS = 10_000;

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

function fixKey(fix: GeoFix | null): string | null {
  if (!fix || fix.source === "demo") return null;
  return `${fix.lat}:${fix.lon}:${fix.timestamp}`;
}

const TRACK_OPTIONS = {
  windowMs: TRACK_WINDOW_MS,
  minSegmentM: TRACK_MIN_SEGMENT_M,
  maxAccuracyM: TRACK_MAX_ACCURACY_M,
  minSpeedMps: TRACK_MIN_SPEED_MPS,
  maxSpeedMps: TRACK_MAX_SPEED_MPS,
};

const SPEED_OPTIONS = {
  ...TRACK_OPTIONS,
  recentWindowMs: TRACK_RECENT_WINDOW_MS,
};

/**
 * Session-only rolling GPS track. Demo fixes are ignored so labeled cities
 * never invent a course or range rings.
 */
export function useOwnshipTrack(fix: GeoFix | null): OwnshipTrack {
  const [points, setPoints] = useState<TrackPoint[]>([]);
  const [seenKey, setSeenKey] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), RECOMPUTE_MS);
    return () => window.clearInterval(timer);
  }, []);

  const key = fixKey(fix);
  let track = points;
  if (key !== seenKey) {
    setSeenKey(key);
    if (key && fix) {
      track = appendTrackPoint(points, toTrackPoint(fix));
      setPoints(track);
    }
  }

  if (!fix || fix.source === "demo") return EMPTY_TRACK;
  const heading = averageTrackHeading(track, now, TRACK_OPTIONS);
  const speedMps = recentTrackSpeedMps(track, now, SPEED_OPTIONS);
  const rings = rangeRingRadii(speedMps, {
    fiveMs: RANGE_RING_5_MS,
    thirtyMs: RANGE_RING_30_MS,
    minRadiusM: TRACK_MIN_SEGMENT_M,
  });
  return { heading, speedMps, ...rings };
}
