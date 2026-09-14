import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FOLLOW_BEARING_MIN_DEG,
  FOLLOW_JUMP_MIN_MS,
  GEO_TESLA_MAXIMUM_AGE_MS,
  GPS_SAVE_MIN_MS,
  LOCATION_POLL_MS,
  MAP_PIXEL_RATIO,
  MAP_TILE_CACHE_SIZE,
  MAP_TILE_CACHE_ZOOM_LEVELS,
  RADAR_ANCHOR_SLOP,
  RADAR_IMAGE_CACHE_LIMIT,
  RADAR_IMAGE_CACHE_LIMIT_ANIMATED,
  RADAR_REFRESH_MS,
  TESLA_LOCATION_POLL_MS,
} from "./constants.ts";
import {
  applyTeslaDocumentClass,
  isTeslaBrowser,
  mapMaxCanvasSize,
  mapMaxTileCacheSize,
  mapMaxTileCacheZoomLevels,
  mapPixelRatioForBrowser,
  overlayPixelRatioForBrowser,
  preferJumpFollow,
  radarImageCacheLimitForBrowser,
  radarPreloadRadius,
  shouldWatchGeolocation,
  teslaQueryEnabled,
  teslaUserAgent,
} from "./tesla-browser.ts";

test("lean path is unconditional — UA and ?tesla= never flip modes", () => {
  assert.equal(
    teslaUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36",
    ),
    true,
  );
  assert.equal(teslaUserAgent("Mozilla/5.0 Tesla/2020.48.26 QtCarBrowser"), true);
  assert.equal(teslaQueryEnabled("?tesla=1"), true);
  assert.equal(teslaQueryEnabled("?tesla=0"), true);
  assert.equal(teslaQueryEnabled(""), true);
  assert.equal(isTeslaBrowser({ userAgent: "Chrome", search: "" }), true);
  assert.equal(isTeslaBrowser({ userAgent: "Chrome", search: "?tesla=0" }), true);
});

test("constrained ⇒ no watch, jump only, 1× pixels, tiny tile cache", () => {
  assert.equal(shouldWatchGeolocation(), false);
  assert.equal(shouldWatchGeolocation(false), false);
  assert.equal(preferJumpFollow(), true);
  assert.equal(preferJumpFollow(false), true);
  assert.equal(mapPixelRatioForBrowser(false, 3), MAP_PIXEL_RATIO);
  assert.equal(mapPixelRatioForBrowser(true, 2), 1);
  assert.equal(overlayPixelRatioForBrowser(true, 2), 1);
  assert.equal(radarPreloadRadius(true, false), 0);
  assert.equal(radarPreloadRadius(true, true), 1);
  assert.equal(radarImageCacheLimitForBrowser(true, false), RADAR_IMAGE_CACHE_LIMIT);
  assert.equal(radarImageCacheLimitForBrowser(true, true), RADAR_IMAGE_CACHE_LIMIT_ANIMATED);
  assert.equal(radarImageCacheLimitForBrowser(false, false), 1);
  assert.equal(radarImageCacheLimitForBrowser(false, true), 3);
  assert.equal(mapMaxTileCacheSize(), MAP_TILE_CACHE_SIZE);
  assert.equal(mapMaxTileCacheSize(false), 8);
  assert.equal(mapMaxTileCacheZoomLevels(), 1);
  assert.deepEqual(mapMaxCanvasSize(), [2048, 2048]);
  assert.equal(LOCATION_POLL_MS, 4_000);
  assert.equal(TESLA_LOCATION_POLL_MS, LOCATION_POLL_MS);
  assert.equal(GEO_TESLA_MAXIMUM_AGE_MS, 3_000);
  assert.ok(GEO_TESLA_MAXIMUM_AGE_MS < LOCATION_POLL_MS);
  assert.equal(FOLLOW_JUMP_MIN_MS, 2_000);
  assert.equal(FOLLOW_BEARING_MIN_DEG, 6);
  assert.equal(GPS_SAVE_MIN_MS, 20_000);
  assert.equal(RADAR_REFRESH_MS, 8 * 60 * 1000);
  assert.equal(RADAR_ANCHOR_SLOP, 0.5);
  assert.equal(MAP_TILE_CACHE_ZOOM_LEVELS, 1);
});

test("applyTeslaDocumentClass always adds html.tesla-browser", () => {
  const classList = {
    on: false,
    add(name: string) {
      if (name === "tesla-browser") this.on = true;
    },
    toggle() {
      throw new Error("lean path must add, not toggle off");
    },
  };
  applyTeslaDocumentClass(false, { classList });
  assert.equal(classList.on, true);
  applyTeslaDocumentClass(true, { classList });
  assert.equal(classList.on, true);
});
