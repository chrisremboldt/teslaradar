"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  DEFAULT_DEMO,
  DEMO_LOCATIONS,
  LOCATION_POLL_MS,
  type DemoLocationId,
} from "@/lib/constants";
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

const GEO_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  timeout: 15_000,
  maximumAge: 30_000,
};

function classifyError(error: GeolocationPositionError | null): LocationErrorKind {
  if (!error) return "unavailable";
  if (error.code === error.PERMISSION_DENIED) return "denied";
  if (error.code === error.TIMEOUT) return "timeout";
  return "unavailable";
}

export function useGeolocation() {
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
    const start = window.setTimeout(() => requestPosition(), 0);
    const interval = window.setInterval(requestPosition, LOCATION_POLL_MS);
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
