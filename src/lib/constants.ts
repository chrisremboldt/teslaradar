/**
 * Lean path only: poll getCurrentPosition. Never watchPosition.
 * 4s keeps track heading and range rings alive; polls may await a ≤3s
 * cached reading instead of a new lock.
 */
export const LOCATION_POLL_MS = 4_000;
/** @deprecated Use LOCATION_POLL_MS — the lean poll is the only cadence. */
export const TESLA_LOCATION_POLL_MS = LOCATION_POLL_MS;
/** Always request a fresh fix so a 1-minute poll is not served a stale 30s+ reading. */
export const GEO_MAXIMUM_AGE_MS = 0;
/**
 * Tesla polls accept a recent reading so we do not re-lock GPS every 4s.
 * After two stationary polls the next request is fresh so pull-away is not
 * served the parked cache (Refresh still always uses maximumAge 0).
 */
export const GEO_TESLA_MAXIMUM_AGE_MS = 3_000;
/** watchPosition may reuse a ~1s reading so follow camera can tick without a new GPS lock every time. */
export const GEO_WATCH_MAXIMUM_AGE_MS = 1_000;
export const GEO_TIMEOUT_MS = 15_000;
/** Modest GPS hops and teleports both jump (no easeTo). */
export const FOLLOW_JUMP_METERS = 500;
/** Follow jumpTo at most 0.5 Hz so highway GPS cannot spin WebGL every fix. */
export const FOLLOW_JUMP_MIN_MS = 2_000;
/** Rotate heading-up only when course changes this much (or the jump interval elapses). */
export const FOLLOW_BEARING_MIN_DEG = 6;
/** Persist last GPS at most this often — 1 Hz JSON.stringify OOMs Qt Chromium. */
export const GPS_SAVE_MIN_MS = 20_000;
export const MAP_PIXEL_RATIO = 1;
export const MAP_TILE_CACHE_SIZE = 8;
export const MAP_TILE_CACHE_ZOOM_LEVELS = 1;
export const MAP_MAX_CANVAS_SIZE: [number, number] = [2048, 2048];
/** Tesla touch jitter / accidental contact below this does not turn Follow off. */
export const USER_PAN_MIN_PX = 16;
/** Rolling window for ownship track heading. */
export const TRACK_WINDOW_MS = 5 * 60 * 1000;
/**
 * Range rings follow recent motion so a stoplight hide/show does not wait on
 * the 5-minute heading window (or get diluted by the stop-to-go hop).
 */
export const TRACK_RECENT_WINDOW_MS = 45_000;
/** Net displacement / path window for parked-vs-moving (not one pairwise hop). */
export const TRACK_MOTION_WINDOW_MS = 24_000;
/** Stay moving until speed/displacement stay quiet this long (stoplight flicker). */
export const TRACK_HOLD_MOVING_MS = 4_000;
/** From parked, require this much evidence before flipping (except native speed). */
export const TRACK_HOLD_PARKED_MS = 1_500;
/** Ignore native coords.speed / heading older than this. */
export const TRACK_NATIVE_STALE_MS = 15_000;
/** Tesla overlay: cap move-driven paints (~8 fps). Frame/settle always draw. */
export const TESLA_OVERLAY_MIN_DRAW_MS = 125;
/** Two Tesla polls this close mean we are stopped — next poll must be fresh. */
export const GEO_STATIONARY_M = 15;
/** Ignore GPS jitter shorter than this when averaging course. */
export const TRACK_MIN_SEGMENT_M = 20;
/** Drop fixes whose reported accuracy is this poor. */
export const TRACK_MAX_ACCURACY_M = 200;
/** Hide range rings below a crawl — parked jitter must not draw giant circles. */
export const TRACK_MIN_SPEED_MPS = 0.75;
/** Discard a hop faster than this (m/s); ~250 km/h is not a car GPS sample. */
export const TRACK_MAX_SPEED_MPS = 70;
export const RANGE_RING_5_MS = 5 * 60 * 1000;
export const RANGE_RING_30_MS = 30 * 60 * 1000;
/** Catalog refresh while the tab is visible (~RainViewer 10-min cadence). Hidden tabs skip. */
export const RADAR_REFRESH_MS = 2 * 60 * 1000;
/** Fraction of a mercator tile — wide enough that highway hops reuse the PNG. */
export const RADAR_ANCHOR_SLOP = 0.5;
/** Decoded RainViewer bitmaps. Paused keeps only the latest playhead. */
export const RADAR_IMAGE_CACHE_LIMIT = 1;
/**
 * Play preloads the current past window (~13 × 512²). Released on Pause.
 * 16 leaves a little room if RainViewer adds a frame mid-loop.
 */
export const RADAR_IMAGE_CACHE_LIMIT_ANIMATED = 16;
/** Neighbors on each side that must decode before the playhead steps (or timeout). */
export const RADAR_PLAY_WARM_RADIUS = 1;
/** Do not stall Play if a neighbor PNG is slow or 404s. */
export const RADAR_PLAY_WARM_TIMEOUT_MS = 2_000;
export const LOCATION_STORAGE_KEY = "teslaradar:last-gps";
export const PREFS_STORAGE_KEY = "teslaradar:prefs";
/** v2: cold loads follow; older blobs with followMe:false from a pan are migrated once. */
export const CURRENT_PREFS_VERSION = 2;
export const PLACE_CACHE_STORAGE_KEY = "teslaradar:places";
/** ~1.1 km — stable town label while driving, fewer Nominatim hits. */
export const PLACE_CACHE_DECIMALS = 2;

export const RAINVIEWER_API = "https://api.rainviewer.com/public/weather-maps.json";
/** Coordinate-centered RainViewer image (256 or 512). 512 stays sharp on car screens. */
export const RADAR_IMAGE_SIZE = 512;
/** Universal Blue — common RainViewer example scheme. */
export const RADAR_COLOR_SCHEME = 2;
/** smoothed + snow colors */
export const RADAR_OPTIONS = "1_1";
export const RADAR_MAX_NATIVE_ZOOM = 7;
/** RainViewer requires a decimal point in lat/lon (e.g. 36.8139). */
export const RADAR_COORD_DECIMALS = 4;
export const RADAR_FRAME_MS = 420;
export const RADAR_HOLD_LAST_MS = 900;
export const MAP_MIN_ZOOM = 3;
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

/** OSM raster tiles (openstreetmap.de). Darkened in MapLibre paint. No token. */
export const OSM_RASTER_TILES = [
  "https://tile.openstreetmap.de/{z}/{x}/{y}.png",
];
export const OSM_ATTRIBUTION =
  '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>';
export const NOMINATIM_ATTRIBUTION = "Places © OpenStreetMap (Nominatim)";
export const RADAR_LAYER_OPACITY = 0.78;
