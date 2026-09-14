import assert from "node:assert/strict";
import { test } from "node:test";
import { CURRENT_PREFS_VERSION, GPS_SAVE_MIN_MS } from "./constants.ts";
import { DEFAULT_GPS_SAVE_MIN_MS, shouldPersistCachedGps } from "./gps-persist.ts";

test("cold-load radar is paused; GPS persist interval is 20s", () => {
  assert.equal(DEFAULT_GPS_SAVE_MIN_MS, GPS_SAVE_MIN_MS);
  assert.equal(GPS_SAVE_MIN_MS, 20_000);
  assert.equal(CURRENT_PREFS_VERSION, 2);
});

test("GPS localStorage writes are ≤1 / 20s after the first persist", () => {
  assert.equal(GPS_SAVE_MIN_MS, 20_000);
  assert.equal(shouldPersistCachedGps(null, 1_000), true);
  assert.equal(shouldPersistCachedGps(1_000, 1_000 + 5_000), false);
  assert.equal(shouldPersistCachedGps(1_000, 1_000 + GPS_SAVE_MIN_MS), true);
  assert.equal(shouldPersistCachedGps(1_000, 1_000 + GPS_SAVE_MIN_MS - 1), false);
});
