import assert from "node:assert/strict";
import { test } from "node:test";
import {
  TRACK_HOLD_MOVING_MS,
  TRACK_MIN_SPEED_MPS,
  TRACK_MOTION_WINDOW_MS,
} from "./constants.ts";
import {
  decideOwnshipMotion,
  derivedWindowSpeedMps,
  pickOwnshipHeading,
  readNativeCourseDeg,
  readNativeSpeedMps,
  trackWindowMetrics,
  type MotionHysteresis,
  type TrackPoint,
} from "./track-heading.ts";

function point(
  lat: number,
  lon: number,
  timestamp: number,
  accuracy: number | null = 10,
): TrackPoint {
  return { lat, lon, timestamp, accuracy };
}

function eastOf(lat: number, lon: number, meters: number): number {
  return lon + meters / (111_320 * Math.cos((lat * Math.PI) / 180));
}

function northOf(lat: number, meters: number): number {
  return lat + meters / 110_540;
}

const LAT = 36.1627;
const LON = -86.7816;

test("native speed < 0 or non-finite is null (Geolocation spec)", () => {
  assert.equal(readNativeSpeedMps(-1), null);
  assert.equal(readNativeSpeedMps(Number.NaN), null);
  assert.equal(readNativeSpeedMps(null), null);
  assert.equal(readNativeSpeedMps(13.4), 13.4);
});

test("native heading 0–360 is kept; NaN / negative is null", () => {
  assert.equal(readNativeCourseDeg(90), 90);
  assert.equal(readNativeCourseDeg(360), 0);
  assert.equal(readNativeCourseDeg(-1), null);
  assert.equal(readNativeCourseDeg(Number.NaN), null);
});

test("native speed at crawl drives moving + 5/30 min rings", () => {
  const now = 1_700_000_000_000;
  const decision = decideOwnshipMotion({
    now,
    fixTimestamp: now,
    nativeSpeedMps: 13.4,
    nativeCourseDeg: 90,
    points: [point(LAT, LON, now)],
  });
  assert.equal(decision.moving, true);
  assert.equal(decision.speedMps, 13.4);
  assert.ok(decision.range5m != null && decision.range30m != null);
  assert.ok(Math.abs(decision.range5m - 13.4 * 5 * 60) < 1);
  assert.ok(Math.abs(decision.range30m - 13.4 * 30 * 60) < 1);
  assert.equal(decision.heading, 90);
});

test("native heading fills the chevron when track heading is absent", () => {
  const now = 1_700_000_000_000;
  const heading = pickOwnshipHeading({
    trackHeading: null,
    windowBearing: null,
    nativeCourseDeg: 247,
    netM: 0,
  });
  assert.equal(heading, 247);
  const decision = decideOwnshipMotion({
    now,
    nativeSpeedMps: 8,
    nativeCourseDeg: 247,
    points: [point(LAT, LON, now)],
  });
  assert.equal(decision.heading, 247);
});

test("null native speed falls back to track / window motion", () => {
  const t0 = 1_700_000_000_000;
  const points = [0, 1000, 2000, 3000].map((meters, i) =>
    point(LAT, eastOf(LAT, LON, meters), t0 + i * 60_000),
  );
  const moving = decideOwnshipMotion({
    now: t0 + 180_000,
    nativeSpeedMps: null,
    nativeCourseDeg: null,
    points,
    hysteresis: { moving: true, quietSince: null, evidenceSince: null, heldSpeedMps: 16 },
  });
  assert.equal(moving.moving, true);
  assert.ok(moving.speedMps != null && moving.speedMps > 10);
  assert.ok(moving.heading != null);
  assert.ok(Math.abs(moving.heading - 90) < 8);
});

test("urban 4s hops at ~10–15 mph detect moving without native speed", () => {
  const t0 = 1_700_000_200_000;
  // 12 mph ≈ 5.36 m/s → ~21.5 m per 4s (around the old 20 m pairwise floor).
  const hop = 21.5;
  const points = [0, 1, 2, 3].map((i) =>
    point(northOf(LAT, hop * i), LON, t0 + i * 4_000),
  );
  const metrics = trackWindowMetrics(points, t0 + 12_000, { motionWindowMs: TRACK_MOTION_WINDOW_MS });
  assert.ok(metrics.netM > 50, `net ${metrics.netM}`);
  const speed = derivedWindowSpeedMps(metrics);
  assert.ok(speed != null && speed > 4 && speed < 7, `speed ${speed}`);

  const decision = decideOwnshipMotion({
    now: t0 + 12_000,
    nativeSpeedMps: null,
    nativeCourseDeg: null,
    points,
  });
  assert.equal(decision.moving, true);
  assert.ok(decision.range5m != null && decision.range30m != null);
  assert.ok(decision.heading != null);
  assert.ok(decision.heading < 8 || decision.heading > 352, `heading ${decision.heading}`);
});

test("parked jitter stays parked and invents neither course nor rings", () => {
  const t0 = 1_700_000_000_000;
  const points = [0, 1, 2, 3, 4, 5].map((i) =>
    point(
      northOf(LAT, (i % 2) * 5),
      eastOf(LAT, LON, ((i + 1) % 2) * 6),
      t0 + i * 4_000,
    ),
  );
  const decision = decideOwnshipMotion({
    now: t0 + 20_000,
    nativeSpeedMps: null,
    nativeCourseDeg: null,
    points,
  });
  assert.equal(decision.moving, false);
  assert.equal(decision.speedMps, null);
  assert.equal(decision.range5m, null);
  assert.equal(decision.range30m, null);
  assert.equal(decision.heading, null);
});

test("stop → go hysteresis: stay moving after speed 0, then park", () => {
  const now = 1_700_000_400_000;
  const going = decideOwnshipMotion({
    now,
    fixTimestamp: now,
    nativeSpeedMps: 11,
    nativeCourseDeg: 0,
    points: [point(LAT, LON, now)],
  });
  assert.equal(going.moving, true);
  assert.ok(going.range5m != null);

  const justStopped = decideOwnshipMotion({
    now: now + 1_000,
    fixTimestamp: now + 1_000,
    nativeSpeedMps: 0,
    nativeCourseDeg: null,
    points: [point(LAT, LON, now + 1_000)],
    hysteresis: going.hysteresis,
  });
  assert.equal(justStopped.moving, true, "still moving during hold");
  assert.ok(justStopped.range5m != null, "rings hold while hysteresis is open");

  const parked = decideOwnshipMotion({
    now: now + 1_000 + TRACK_HOLD_MOVING_MS,
    fixTimestamp: now + 1_000 + TRACK_HOLD_MOVING_MS,
    nativeSpeedMps: 0,
    nativeCourseDeg: null,
    points: [point(LAT, LON, now + 1_000 + TRACK_HOLD_MOVING_MS)],
    hysteresis: justStopped.hysteresis,
  });
  assert.equal(parked.moving, false);
  assert.equal(parked.speedMps, null);
  assert.equal(parked.range5m, null);
});

test("from parked, native crawl flips moving immediately", () => {
  const now = 1_700_000_500_000;
  const decision = decideOwnshipMotion({
    now,
    nativeSpeedMps: TRACK_MIN_SPEED_MPS,
    nativeCourseDeg: 12,
    points: [point(LAT, LON, now)],
    hysteresis: { moving: false, quietSince: null, evidenceSince: null, heldSpeedMps: null },
  });
  assert.equal(decision.moving, true);
  assert.equal(decision.speedMps, TRACK_MIN_SPEED_MPS);
});

test("a single accuracy spike does not permanently kill rings", () => {
  const t = 1_700_000_600_000;
  const hop = 80;
  const points = [
    point(LAT, LON, t - 16_000, 12),
    point(northOf(LAT, hop), LON, t - 12_000, 12),
    point(northOf(LAT, hop * 2), LON, t - 8_000, 800),
    point(northOf(LAT, hop * 3), LON, t - 4_000, 12),
    point(northOf(LAT, hop * 4), LON, t, 12),
  ];
  const hysteresis: MotionHysteresis = {
    moving: true,
    quietSince: null,
    evidenceSince: null,
    heldSpeedMps: 20,
  };
  const decision = decideOwnshipMotion({
    now: t,
    nativeSpeedMps: null,
    nativeCourseDeg: null,
    points,
    hysteresis,
  });
  assert.equal(decision.moving, true);
  assert.ok(decision.speedMps != null && decision.speedMps > 10);
  assert.ok(decision.range5m != null);
});

test("TRACK_MOTION_WINDOW_MS is shorter than the 5-minute heading window", () => {
  assert.equal(TRACK_MOTION_WINDOW_MS, 24_000);
  assert.ok(TRACK_MOTION_WINDOW_MS < 5 * 60 * 1000);
});
