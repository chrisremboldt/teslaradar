export type LocationSource = "gps" | "cached" | "demo";

export type GeoFix = {
  lat: number;
  lon: number;
  accuracy: number | null;
  timestamp: number;
  source: LocationSource;
  demoLabel?: string;
  /** GeolocationCoordinates.speed (m/s). Null when the stack omits it or reports < 0. */
  speedMps?: number | null;
  /** GeolocationCoordinates.heading (deg). Null when missing / NaN / < 0. */
  courseDeg?: number | null;
};

export type LocationErrorKind = "denied" | "unavailable" | "timeout" | "unsupported";

export type CompassStatus =
  | "unknown"
  | "available"
  | "unavailable"
  | "needs-permission"
  | "simulated";

export type RadarFrame = {
  time: number;
  path: string;
};

export type RainViewerCatalog = {
  host: string;
  generated: number;
  frames: RadarFrame[];
};

export type UserPrefs = {
  /** Schema version for `teslaradar:prefs`. Missing / < 2 is treated as v1. */
  prefsVersion: number;
  followMe: boolean;
  headingUp: boolean;
  animateRadar: boolean;
};
