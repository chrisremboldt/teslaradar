import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GEO_MAXIMUM_AGE_MS,
  LOCATION_POLL_MS,
  TRACK_MIN_SEGMENT_M,
  TRACK_RECENT_WINDOW_MS,
  TRACK_WINDOW_MS,
} from "./constants.ts";
import {
  appendTrackPoint,
  averageTrackHeading,
  averageTrackSpeedMps,
  haversineMeters,
  initialBearingDegrees,
  pruneTrack,
  rangeRingRadii,
  recentTrackSpeedMps,
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

test("LOCATION_POLL_MS is 1 minute", () => {
  assert.equal(LOCATION_POLL_MS, 60_000);
});

test("GEO_MAXIMUM_AGE_MS is tighter than a stale 30s+ fix", () => {
  assert.equal(GEO_MAXIMUM_AGE_MS, 0);
  assert.ok(GEO_MAXIMUM_AGE_MS <= 60_000);
});

test("TRACK_WINDOW_MS is 5 minutes", () => {
  assert.equal(TRACK_WINDOW_MS, 5 * 60 * 1000);
});

test("eastward segments average near 90°", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [0, 80, 160, 240, 320].map((meters, i) =>
    point(lat, eastOf(lat, lon, meters), t0 + i * 60_000),
  );
  const heading = averageTrackHeading(points, t0 + 4 * 60_000);
  assert.ok(heading != null, "expected a track heading");
  assert.ok(Math.abs(heading - 90) < 3, `heading ${heading} should be ~90`);
});

test("northward segments average near 0°", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [0, 80, 160, 240].map((meters, i) =>
    point(northOf(lat, meters), lon, t0 + i * 60_000),
  );
  const heading = averageTrackHeading(points, t0 + 3 * 60_000);
  assert.ok(heading != null);
  assert.ok(heading < 3 || heading > 357, `heading ${heading} should be ~0`);
});

test("circular mean of east then slightly north stays near east", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [
    point(lat, lon, t0),
    point(lat, eastOf(lat, lon, 200), t0 + 60_000),
    point(northOf(lat, 40), eastOf(lat, lon, 400), t0 + 120_000),
  ];
  const heading = averageTrackHeading(points, t0 + 120_000);
  assert.ok(heading != null);
  assert.ok(heading > 75 && heading < 100, `heading ${heading} should stay near 90`);
});

test("parked jitter does not invent a heading", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [0, 1, 2, 3, 4].map((i) =>
    point(northOf(lat, (i % 2) * 4), eastOf(lat, lon, ((i + 1) % 2) * 6), t0 + i * 60_000),
  );
  assert.equal(averageTrackHeading(points, t0 + 4 * 60_000), null);
});

test("single point has no heading", () => {
  const t0 = 1_700_000_000_000;
  assert.equal(averageTrackHeading([point(36.16, -86.78, t0)], t0), null);
});

test("two points closer than the noise floor have no heading", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [
    point(lat, lon, t0),
    point(lat, eastOf(lat, lon, TRACK_MIN_SEGMENT_M - 5), t0 + 60_000),
  ];
  assert.ok(haversineMeters(points[0], points[1]) < TRACK_MIN_SEGMENT_M);
  assert.equal(averageTrackHeading(points, t0 + 60_000), null);
});

test("huge accuracy is ignored", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [
    point(lat, lon, t0, 12),
    point(lat, eastOf(lat, lon, 200), t0 + 60_000, 800),
    point(lat, eastOf(lat, lon, 400), t0 + 120_000, 900),
  ];
  assert.equal(averageTrackHeading(points, t0 + 120_000), null);
});

test("points older than 5 minutes are dropped", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const stale = [
    point(lat, lon, t0),
    point(lat, eastOf(lat, lon, 200), t0 + 60_000),
  ];
  const now = t0 + TRACK_WINDOW_MS + 90_000;
  assert.equal(pruneTrack(stale, now).length, 0);
  assert.equal(averageTrackHeading(stale, now), null);
});

test("appendTrackPoint resets after a teleport jump", () => {
  const t0 = 1_700_000_000_000;
  const nashville = point(36.1627, -86.7816, t0);
  const traverse = point(44.7631, -85.6206, t0 + 60_000);
  const next = appendTrackPoint([nashville], traverse);
  assert.equal(next.length, 1);
  assert.equal(next[0].lat, traverse.lat);
});

test("initialBearingDegrees east is ~90", () => {
  const bearing = initialBearingDegrees(
    { lat: 0, lon: 0 },
    { lat: 0, lon: 0.01 },
  );
  assert.ok(Math.abs(bearing - 90) < 1, `bearing ${bearing}`);
});

test("1 km per minute averages ~16.7 m/s and 5/30 min rings", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [0, 1000, 2000, 3000, 4000].map((meters, i) =>
    point(lat, eastOf(lat, lon, meters), t0 + i * 60_000),
  );
  const speed = averageTrackSpeedMps(points, t0 + 4 * 60_000);
  assert.ok(speed != null);
  assert.ok(Math.abs(speed - 1000 / 60) < 0.15, `speed ${speed}`);
  const rings = rangeRingRadii(speed);
  assert.ok(rings.range5m != null && rings.range30m != null);
  assert.ok(Math.abs(rings.range5m - speed * 5 * 60) < 1);
  assert.ok(Math.abs(rings.range30m - speed * 30 * 60) < 1);
  assert.ok(Math.abs(rings.range30m / rings.range5m - 6) < 0.01);
});

test("parked jitter does not invent speed or rings", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [0, 1, 2, 3, 4].map((i) =>
    point(northOf(lat, (i % 2) * 4), eastOf(lat, lon, ((i + 1) % 2) * 6), t0 + i * 60_000),
  );
  assert.equal(averageTrackSpeedMps(points, t0 + 4 * 60_000), null);
  const rings = rangeRingRadii(null);
  assert.equal(rings.range5m, null);
  assert.equal(rings.range30m, null);
});

test("TRACK_RECENT_WINDOW_MS is 45 seconds", () => {
  assert.equal(TRACK_RECENT_WINDOW_MS, 45_000);
  assert.ok(TRACK_RECENT_WINDOW_MS < TRACK_WINDOW_MS);
});

test("a stoplight bridge does not hide rings after the next fast hop", () => {
  const t = 1_700_000_300_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const stopped = [
    point(lat, lon, t - 299_000),
    point(lat, eastOf(lat, lon, 80), t - 4_000),
  ];
  assert.equal(
    recentTrackSpeedMps(stopped, t),
    null,
    "the long stop-to-go crawl is not recent motion",
  );
  const rolling = [
    ...stopped,
    point(lat, eastOf(lat, lon, 160), t),
  ];
  const recent = recentTrackSpeedMps(rolling, t);
  assert.ok(recent != null, "the 4s pull-away hop must restore moving speed");
  assert.ok(Math.abs(recent - 20) < 0.5, `recent speed ${recent}`);
  const rings = rangeRingRadii(recent);
  assert.ok(rings.range5m != null && rings.range30m != null);
});

test("recent speed hides rings after sitting with no new motion", () => {
  const t = 1_700_000_300_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [
    point(lat, lon, t - 90_000),
    point(lat, eastOf(lat, lon, 80), t - 86_000),
    point(lat, eastOf(lat, lon, 80), t - 40_000),
    point(lat, eastOf(lat, lon, 80), t),
  ];
  assert.ok(recentTrackSpeedMps(points, t - 86_000) != null);
  assert.equal(recentTrackSpeedMps(points, t), null);
});

test("implausible teleport hops are not used for speed", () => {
  const t0 = 1_700_000_000_000;
  const lat = 36.1627;
  const lon = -86.7816;
  const points = [
    point(lat, lon, t0),
    point(lat, eastOf(lat, lon, 8_000), t0 + 1_000),
  ];
  assert.equal(averageTrackSpeedMps(points, t0 + 1_000), null);
  assert.equal(averageTrackHeading(points, t0 + 1_000), null);
});
