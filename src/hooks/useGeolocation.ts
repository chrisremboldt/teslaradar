"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_DEMO,
  DEMO_LOCATIONS,
  GEO_MAXIMUM_AGE_MS,
  GEO_TESLA_MAXIMUM_AGE_MS,
  GEO_TIMEOUT_MS,
  LOCATION_POLL_MS,
  type DemoLocationId,
} from "@/lib/constants";
import { shouldSkipPoll, shouldUseCachedTeslaPoll } from "@/lib/geolocation-watch";
import { shouldWatchGeolocation } from "@/lib/tesla-browser";
import {
  getCachedGpsSnapshot,
  saveCachedGps,
  subscribeCachedGps,
} from "@/lib/storage";
import { readNativeCourseDeg, readNativeSpeedMps } from "@/lib/ownship-motion";
import { normalizeEpochMs } from "@/lib/time";
import type { GeoFix, LocationErrorKind } from "@/lib/types";

// Future (not v1): Tesla Fleet API vehicle location could replace or
// supplement navigator.geolocation after OAuth. v1 is Chromium browser
// geolocation only — no Tesla tokens, no backend store.

export const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: GEO_TIMEOUT_MS,
  maximumAge: GEO_MAXIMUM_AGE_MS,
};

/** Interval ticks: reuse a ≤3s reading instead of a full GPS lock. */
export const GEO_TESLA_POLL_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: GEO_TIMEOUT_MS,
  maximumAge: GEO_TESLA_MAXIMUM_AGE_MS,
};

export type GeoRequestMode = "poll" | "fresh";

export type UseGeolocationOptions = {
  /** Ignored — lean path never starts watchPosition. */
  continuous?: boolean;
};

function classifyError(error: GeolocationPositionError | null): LocationErrorKind {
  if (!error) return "unavailable";
  if (error.code === error.PERMISSION_DENIED) return "denied";
  if (error.code === error.TIMEOUT) return "timeout";
  return "unavailable";
}

export function useGeolocation() {
  const pollIntervalMs = LOCATION_POLL_MS;
  const continuous = shouldWatchGeolocation();
  const cached = useSyncExternalStore(
    subscribeCachedGps,
    getCachedGpsSnapshot,
    () => null,
  );
  const [live, setLive] = useState<GeoFix | null>(null);
  const [error, setError] = useState<LocationErrorKind | null>(null);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [hasResolved, setHasResolved] = useState(false);
  const mounted = useRef(true);
  const liveRef = useRef<GeoFix | null>(null);
  const lastWatchAtRef = useRef<number | null>(null);
  const watchActiveRef = useRef(false);
  const lastGpsRef = useRef<{ lat: number; lon: number } | null>(null);
  const teslaStationaryRef = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const applyGps = useCallback((position: GeolocationPosition) => {
    const next: GeoFix = {
      lat: position.coords.latitude,
      lon: position.coords.longitude,
      accuracy:
        typeof position.coords.accuracy === "number" ? position.coords.accuracy : null,
      timestamp: normalizeEpochMs(position.timestamp || Date.now()),
      source: "gps",
      speedMps: readNativeSpeedMps(position.coords.speed),
      courseDeg: readNativeCourseDeg(position.coords.heading),
    };
    saveCachedGps(next);
    const previous = lastGpsRef.current;
    lastGpsRef.current = { lat: next.lat, lon: next.lon };
    teslaStationaryRef.current = !shouldUseCachedTeslaPoll({
      previous,
      current: lastGpsRef.current,
    });
    if (!mounted.current) return;
    liveRef.current = next;
    setLive(next);
    setError(null);
    setHasResolved(true);
    setIsRefreshing(false);
  }, []);

  const applyDemo = useCallback((id: DemoLocationId = DEFAULT_DEMO.id) => {
    const demo = DEMO_LOCATIONS[id];
    const next: GeoFix = {
      lat: demo.lat,
      lon: demo.lon,
      accuracy: null,
      timestamp: Date.now(),
      source: "demo",
      demoLabel: demo.label,
    };
    liveRef.current = next;
    setLive(next);
    setHasResolved(true);
    setIsRefreshing(false);
  }, []);

  const fail = useCallback((kind: LocationErrorKind) => {
    if (!mounted.current) return;
    setError(kind);
    setIsRefreshing(false);
    setHasResolved(true);
    if (liveRef.current) return;
    const stored = getCachedGpsSnapshot();
    if (stored) return;
    const demo = DEFAULT_DEMO;
    const next: GeoFix = {
      lat: demo.lat,
      lon: demo.lon,
      accuracy: null,
      timestamp: Date.now(),
      source: "demo",
      demoLabel: demo.label,
    };
    liveRef.current = next;
    setLive(next);
  }, []);

  const requestPosition = useCallback(
    (mode: GeoRequestMode = "fresh") => {
      if (typeof navigator === "undefined" || !navigator.geolocation) {
        fail("unsupported");
        return;
      }
      setIsRefreshing(true);
      const reuseCached = mode === "poll" && !teslaStationaryRef.current;
      navigator.geolocation.getCurrentPosition(
        applyGps,
        (geoError) => fail(classifyError(geoError)),
        reuseCached ? GEO_TESLA_POLL_OPTIONS : GEO_OPTIONS,
      );
    },
    [applyGps, fail],
  );

  useEffect(() => {
    const start = window.setTimeout(() => requestPosition("fresh"), 0);
    const interval = window.setInterval(() => {
      if (
        shouldSkipPoll({
          watchActive: watchActiveRef.current,
          lastWatchAt: lastWatchAtRef.current,
          now: Date.now(),
          pollIntervalMs,
        })
      ) {
        return;
      }
      requestPosition("poll");
    }, pollIntervalMs);
    const onVisibility = () => {
      if (document.visibilityState === "visible") requestPosition("fresh");
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [pollIntervalMs, requestPosition]);

  const fix = live ?? cached;

  return {
    fix,
    error,
    isRefreshing,
    hasResolved: hasResolved || Boolean(cached),
    refresh: requestPosition,
    applyDemo,
    watching: continuous,
    pollIntervalMs,
    tesla: true,
  };
}
