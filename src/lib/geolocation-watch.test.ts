import assert from "node:assert/strict";
import { test } from "node:test";
import { GEO_STATIONARY_M, GEO_WATCH_MAXIMUM_AGE_MS, LOCATION_POLL_MS } from "./constants.ts";
import { shouldSkipPoll, shouldUseCachedTeslaPoll } from "./geolocation-watch.ts";

test("GEO_WATCH_MAXIMUM_AGE_MS is ~1s so follow can reuse a fresh reading", () => {
  assert.equal(GEO_WATCH_MAXIMUM_AGE_MS, 1_000);
  assert.ok(GEO_WATCH_MAXIMUM_AGE_MS < LOCATION_POLL_MS);
});

test("skip the 1-minute poll while watchPosition is delivering", () => {
  assert.equal(
    shouldSkipPoll({
      watchActive: true,
      lastWatchAt: 10_000,
      now: 10_000 + 5_000,
      pollIntervalMs: LOCATION_POLL_MS,
    }),
    true,
  );
});

test("poll when watch is off, failed, or stale", () => {
  assert.equal(
    shouldSkipPoll({
      watchActive: false,
      lastWatchAt: 10_000,
      now: 11_000,
      pollIntervalMs: LOCATION_POLL_MS,
    }),
    false,
  );
  assert.equal(
    shouldSkipPoll({
      watchActive: true,
      lastWatchAt: null,
      now: 11_000,
      pollIntervalMs: LOCATION_POLL_MS,
    }),
    false,
  );
  assert.equal(
    shouldSkipPoll({
      watchActive: true,
      lastWatchAt: 1_000,
      now: 1_000 + LOCATION_POLL_MS,
      pollIntervalMs: LOCATION_POLL_MS,
    }),
    false,
  );
});

test("Tesla polls stay cached while moving and go fresh after a stop", () => {
  assert.equal(GEO_STATIONARY_M, 15);
  const nashville = { lat: 36.1627, lon: -86.7816 };
  const east = {
    lat: 36.1627,
    lon: nashville.lon + 80 / (111_320 * Math.cos((nashville.lat * Math.PI) / 180)),
  };
  assert.equal(
    shouldUseCachedTeslaPoll({ previous: null, current: nashville }),
    true,
  );
  assert.equal(
    shouldUseCachedTeslaPoll({ previous: nashville, current: east }),
    true,
  );
  assert.equal(
    shouldUseCachedTeslaPoll({ previous: nashville, current: nashville }),
    false,
  );
});
