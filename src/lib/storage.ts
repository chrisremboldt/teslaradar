import { LOCATION_STORAGE_KEY, PREFS_STORAGE_KEY } from "@/lib/constants";
import type { GeoFix, UserPrefs } from "@/lib/types";

export const DEFAULT_PREFS: UserPrefs = {
  followMe: true,
  headingUp: true,
  animateRadar: true,
};

let prefsSnapshot: UserPrefs = DEFAULT_PREFS;
let prefsHydrated = false;
const prefsListeners = new Set<() => void>();

let gpsSnapshot: GeoFix | null = null;
let gpsHydrated = false;
const gpsListeners = new Set<() => void>();

function emit(listeners: Set<() => void>) {
  listeners.forEach((listener) => listener());
}

export function loadCachedGps(): GeoFix | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(LOCATION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<GeoFix>;
    if (typeof parsed.lat !== "number" || typeof parsed.lon !== "number") {
      return null;
    }
    return {
      lat: parsed.lat,
      lon: parsed.lon,
      accuracy: typeof parsed.accuracy === "number" ? parsed.accuracy : null,
      timestamp: typeof parsed.timestamp === "number" ? parsed.timestamp : Date.now(),
      source: "cached",
    };
  } catch {
    return null;
  }
}

export function subscribeCachedGps(listener: () => void): () => void {
  gpsListeners.add(listener);
  return () => {
    gpsListeners.delete(listener);
  };
}

export function getCachedGpsSnapshot(): GeoFix | null {
  if (!gpsHydrated && typeof window !== "undefined") {
    gpsSnapshot = loadCachedGps();
    gpsHydrated = true;
  }
  return gpsSnapshot;
}

export function saveCachedGps(fix: GeoFix): void {
  if (typeof window === "undefined") return;
  if (fix.source !== "gps") return;
  try {
    window.localStorage.setItem(
      LOCATION_STORAGE_KEY,
      JSON.stringify({
        lat: fix.lat,
        lon: fix.lon,
        accuracy: fix.accuracy,
        timestamp: fix.timestamp,
        source: "gps",
      }),
    );
    gpsSnapshot = {
      lat: fix.lat,
      lon: fix.lon,
      accuracy: fix.accuracy,
      timestamp: fix.timestamp,
      source: "cached",
    };
    gpsHydrated = true;
    emit(gpsListeners);
  } catch {
    // Quota or private mode — ignore.
  }
}

export function loadPrefs(): UserPrefs {
  if (typeof window === "undefined") return DEFAULT_PREFS;
  try {
    const raw = window.localStorage.getItem(PREFS_STORAGE_KEY);
    if (!raw) return DEFAULT_PREFS;
    const parsed = JSON.parse(raw) as Partial<UserPrefs>;
    return {
      followMe: parsed.followMe ?? DEFAULT_PREFS.followMe,
      headingUp: parsed.headingUp ?? DEFAULT_PREFS.headingUp,
      animateRadar: parsed.animateRadar ?? DEFAULT_PREFS.animateRadar,
    };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function subscribePrefs(listener: () => void): () => void {
  prefsListeners.add(listener);
  return () => {
    prefsListeners.delete(listener);
  };
}

export function getPrefsSnapshot(): UserPrefs {
  if (!prefsHydrated && typeof window !== "undefined") {
    prefsSnapshot = loadPrefs();
    prefsHydrated = true;
  }
  return prefsSnapshot;
}

export function savePrefs(prefs: UserPrefs): void {
  prefsSnapshot = prefs;
  prefsHydrated = true;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
    emit(prefsListeners);
  } catch {
    emit(prefsListeners);
  }
}
