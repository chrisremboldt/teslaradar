"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_DEMO,
  DEMO_LOCATIONS,
  GEO_MAXIMUM_AGE_MS,
  GEO_TIMEOUT_MS,
  GEO_WATCH_MAXIMUM_AGE_MS,
  LOCATION_POLL_MS,
  type DemoLocationId,
} from "@/lib/constants";
import { shouldSkipPoll } from "@/lib/geolocation-watch";
import {
  getCachedGpsSnapshot,
  saveCachedGps,
  subscribeCachedGps,
} from "@/lib/storage";
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

export const GEO_WATCH_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: GEO_TIMEOUT_MS,
  maximumAge: GEO_WATCH_MAXIMUM_AGE_MS,
};

export type UseGeolocationOptions = {
  /** While Following, use watchPosition so the camera can track at GPS cadence. */
  continuous?: boolean;
};

function classifyError(error: GeolocationPositionError | null): LocationErrorKind {
  if (!error) return "unavailable";
  if (error.code === error.PERMISSION_DENIED) return "denied";
  if (error.code === error.TIMEOUT) return "timeout";
  return "unavailable";
}

export function useGeolocation(options: UseGeolocationOptions = {}) {
  const continuous = Boolean(options.continuous);
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
    };
    saveCachedGps(next);
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

  const requestPosition = useCallback(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      fail("unsupported");
      return;
    }
    setIsRefreshing(true);
    navigator.geolocation.getCurrentPosition(
      applyGps,
      (geoError) => fail(classifyError(geoError)),
      GEO_OPTIONS,
    );
  }, [applyGps, fail]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      if (continuous) fail("unsupported");
      return;
    }
    if (!continuous) {
      watchActiveRef.current = false;
      lastWatchAtRef.current = null;
      return;
    }

    watchActiveRef.current = true;
    let watchId: number | null = null;
    try {
      watchId = navigator.geolocation.watchPosition(
        (position) => {
          lastWatchAtRef.current = Date.now();
          applyGps(position);
        },
        (geoError) => {
          if (geoError.code === geoError.PERMISSION_DENIED) {
            watchActiveRef.current = false;
            fail(classifyError(geoError));
          }
          // Timeout / unavailable: keep the watch; the poll covers gaps.
        },
        GEO_WATCH_OPTIONS,
      );
    } catch {
      watchActiveRef.current = false;
    }

    return () => {
      watchActiveRef.current = false;
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
    };
  }, [applyGps, continuous, fail]);

  useEffect(() => {
    const start = window.setTimeout(() => requestPosition(), 0);
    const interval = window.setInterval(() => {
      if (
        shouldSkipPoll({
          watchActive: watchActiveRef.current,
          lastWatchAt: lastWatchAtRef.current,
          now: Date.now(),
          pollIntervalMs: LOCATION_POLL_MS,
        })
      ) {
        return;
      }
      requestPosition();
    }, LOCATION_POLL_MS);
    const onVisibility = () => {
      if (document.visibilityState === "visible") requestPosition();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [requestPosition]);

  const fix = live ?? cached;

  return {
    fix,
    error,
    isRefreshing,
    hasResolved: hasResolved || Boolean(cached),
    refresh: requestPosition,
    applyDemo,
  };
}
