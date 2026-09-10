export const LOCATION_POLL_MS = 5 * 60 * 1000;
export const RADAR_REFRESH_MS = 2 * 60 * 1000;
export const LOCATION_STORAGE_KEY = "teslaradar:last-gps";
export const PREFS_STORAGE_KEY = "teslaradar:prefs";

export const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
export const RADAR_TILE_SIZE = 256;
/** Universal Blue — common RainViewer example scheme. */
export const RADAR_COLOR_SCHEME = 2;
/** smoothed + snow colors */
export const RADAR_OPTIONS = "1_1";
export const RADAR_MAX_NATIVE_ZOOM = 7;
export const MAP_MAX_ZOOM = 12;
export const MAP_DEFAULT_ZOOM = 6.5;

export const DEMO_LOCATIONS = {
  nashville: {
    id: "nashville" as const,
    label: "Nashville, TN",
    lat: 36.1627,
    lon: -86.7816,
  },
  traverse: {
    id: "traverse" as const,
    label: "Traverse City, MI",
    lat: 44.7631,
    lon: -85.6206,
  },
} as const;

export type DemoLocationId = keyof typeof DEMO_LOCATIONS;

export const DEFAULT_DEMO = DEMO_LOCATIONS.nashville;

export const CARTO_DARK_TILES = [
  "https://a.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  "https://b.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
  "https://c.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}@2x.png",
];
