import assert from "node:assert/strict";
import { test } from "node:test";
import { GEO_WATCH_MAXIMUM_AGE_MS, LOCATION_POLL_MS } from "./constants.ts";
import { shouldSkipPoll } from "./geolocation-watch.ts";

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
