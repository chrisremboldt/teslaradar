import {
  CURRENT_PREFS_VERSION,
  LOCATION_STORAGE_KEY,
  PREFS_STORAGE_KEY,
} from "@/lib/constants";
import { normalizeEpochMs } from "@/lib/time";
import type { GeoFix, UserPrefs } from "@/lib/types";

export const DEFAULT_PREFS: UserPrefs = {
  prefsVersion: CURRENT_PREFS_VERSION,
  followMe: true,
  headingUp: true,
  animateRadar: true,
};

/**
 * Prefs schema v2: follow-me is the cold-start / first-paint default.
 *
 * Older `teslaradar:prefs` blobs often have `followMe: false` because panning
 * persisted that choice. Returning drivers who hard-refreshed then landed
 * unfollowed even though `DEFAULT_PREFS.followMe` is true.
 *
 * On load, stored version < 2 is migrated once: `followMe` is forced true
 * (headingUp / animateRadar kept) and `prefsVersion` is written to 2. This
 * re-enables follow for drivers who had it stuck off.
 *
 * Every cold load also starts followed — `followMe: false` is a session
 * choice after the user pans or taps Follow me off, not a durable pref.
 * `savePrefs` still persists the off state so we do not fight mid-drive
 * (in-memory snapshot + `prefsHydrated`). A full reload recenters.
 */
export function storedPrefsVersion(parsed: Partial<UserPrefs>): number {
  return typeof parsed.prefsVersion === "number" && Number.isFinite(parsed.prefsVersion)
    ? parsed.prefsVersion
    : 1;
}

export function normalizeStoredPrefs(parsed: Partial<UserPrefs>): UserPrefs {
  return {
    prefsVersion: CURRENT_PREFS_VERSION,
    // Cold load / first paint / hard refresh always follow. v2 also forces
    // this once for older blobs that persisted followMe:false from a pan.
    // Session pans and “Follow me” off still persist via savePrefs after
    // hydrate — we do not flip follow back on mid-drive.
    followMe: true,
    headingUp: parsed.headingUp ?? DEFAULT_PREFS.headingUp,
    animateRadar: parsed.animateRadar ?? DEFAULT_PREFS.animateRadar,
  };
}

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
      timestamp:
        typeof parsed.timestamp === "number"
          ? normalizeEpochMs(parsed.timestamp)
          : Date.now(),
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
    const prefs = normalizeStoredPrefs(parsed);
    if (storedPrefsVersion(parsed) < CURRENT_PREFS_VERSION) {
      try {
        window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(prefs));
      } catch {
        // Quota or private mode — in-memory prefs still follow.
      }
    }
    return prefs;
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
  const next: UserPrefs = {
    ...DEFAULT_PREFS,
    ...prefs,
    prefsVersion: CURRENT_PREFS_VERSION,
  };
  prefsSnapshot = next;
  prefsHydrated = true;
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PREFS_STORAGE_KEY, JSON.stringify(next));
    emit(prefsListeners);
  } catch {
    emit(prefsListeners);
  }
}
