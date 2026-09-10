"use client";

import { useEffect, useState } from "react";
import type { GeoFix } from "@/lib/types";
import {
  appendTrackPoint,
  averageTrackHeading,
  type TrackPoint,
} from "@/lib/track-heading";

const RECOMPUTE_MS = 30_000;

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

/**
 * Session-only rolling GPS track. Demo fixes are ignored so labeled cities
 * never invent a course.
 */
export function useTrackHeading(fix: GeoFix | null): number | null {
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

  if (!fix || fix.source === "demo") return null;
  return averageTrackHeading(track, now);
}
