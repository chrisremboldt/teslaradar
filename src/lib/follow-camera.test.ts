import assert from "node:assert/strict";
import { test } from "node:test";
import { FOLLOW_JUMP_METERS, USER_PAN_MIN_PX } from "./constants.ts";
import {
  isCameraOnTarget,
  planFollowCamera,
  shouldTreatAsUserPan,
} from "./follow-camera.ts";

const NASHVILLE = { lat: 36.1627, lon: -86.7816 };

function northOf(lat: number, meters: number): number {
  return lat + meters / 110_540;
}

test("FOLLOW_JUMP_METERS and USER_PAN_MIN_PX stay in the classic-nav range", () => {
  assert.equal(FOLLOW_JUMP_METERS, 500);
  assert.equal(USER_PAN_MIN_PX, 16);
});

test("followMe recenters on a new GPS fix (ease for a modest hop)", () => {
  const ownship = { lat: northOf(NASHVILLE.lat, 120), lon: NASHVILLE.lon };
  const plan = planFollowCamera({
    followMe: true,
    ownship,
    mapCenter: NASHVILLE,
    bearing: 0,
    firstLock: false,
    positionChanged: true,
    followJustEnabled: false,
    jumpMeters: FOLLOW_JUMP_METERS,
  });
  assert.equal(plan.mode, "ease");
  assert.deepEqual(plan.center, [ownship.lon, ownship.lat]);
  assert.equal(plan.bearing, 0);
});

test("followMe jumps on first lock or a teleport", () => {
  const far = { lat: northOf(NASHVILLE.lat, 8_000), lon: NASHVILLE.lon };
  const first = planFollowCamera({
    followMe: true,
    ownship: NASHVILLE,
    mapCenter: NASHVILLE,
    bearing: 12,
    firstLock: true,
    positionChanged: false,
    followJustEnabled: false,
  });
  assert.equal(first.mode, "jump");
  assert.deepEqual(first.center, [NASHVILLE.lon, NASHVILLE.lat]);

  const teleport = planFollowCamera({
    followMe: true,
    ownship: far,
    mapCenter: NASHVILLE,
    bearing: 0,
    firstLock: false,
    positionChanged: true,
    followJustEnabled: false,
    jumpMeters: FOLLOW_JUMP_METERS,
  });
  assert.equal(teleport.mode, "jump");
  assert.deepEqual(teleport.center, [far.lon, far.lat]);
});

test("followMe false never chases ownship (bearing-only)", () => {
  const ownship = { lat: northOf(NASHVILLE.lat, 2_000), lon: NASHVILLE.lon };
  const plan = planFollowCamera({
    followMe: false,
    ownship,
    mapCenter: NASHVILLE,
    bearing: 90,
    firstLock: false,
    positionChanged: true,
    followJustEnabled: false,
  });
  assert.equal(plan.mode, "bearing-only");
  assert.equal(plan.center, undefined);
  assert.equal(plan.bearing, 90);
});

test("heading-up while following keeps ownship in the camera center", () => {
  const plan = planFollowCamera({
    followMe: true,
    ownship: NASHVILLE,
    mapCenter: NASHVILLE,
    bearing: 247,
    firstLock: false,
    positionChanged: false,
    followJustEnabled: false,
  });
  assert.equal(plan.mode, "jump");
  assert.deepEqual(plan.center, [NASHVILLE.lon, NASHVILLE.lat]);
  assert.equal(plan.bearing, 247);
});

test("re-enabling Following after a pan recenters on ownship", () => {
  const panned = { lat: northOf(NASHVILLE.lat, 3_000), lon: NASHVILLE.lon };
  const plan = planFollowCamera({
    followMe: true,
    ownship: NASHVILLE,
    mapCenter: panned,
    bearing: 0,
    firstLock: false,
    positionChanged: false,
    followJustEnabled: true,
    jumpMeters: FOLLOW_JUMP_METERS,
  });
  assert.ok(plan.center);
  assert.deepEqual(plan.center, [NASHVILLE.lon, NASHVILLE.lat]);
  assert.ok(plan.mode === "ease" || plan.mode === "jump");
});

test("isCameraOnTarget skips a no-op follow jump", () => {
  const plan = planFollowCamera({
    followMe: true,
    ownship: NASHVILLE,
    mapCenter: NASHVILLE,
    bearing: 0,
    firstLock: true,
    positionChanged: false,
    followJustEnabled: false,
  });
  assert.equal(
    isCameraOnTarget({
      mapCenter: NASHVILLE,
      mapBearing: 0,
      plan,
    }),
    true,
  );
  assert.equal(
    isCameraOnTarget({
      mapCenter: { lat: northOf(NASHVILLE.lat, 80), lon: NASHVILLE.lon },
      mapBearing: 0,
      plan,
    }),
    false,
  );
});

test("programmatic camera moves and Tesla jitter do not count as a user pan", () => {
  const start = { x: 100, y: 100 };
  assert.equal(
    shouldTreatAsUserPan({
      programmatic: true,
      hasOriginalEvent: true,
      start,
      end: { x: 180, y: 180 },
    }),
    false,
  );
  assert.equal(
    shouldTreatAsUserPan({
      programmatic: false,
      hasOriginalEvent: false,
      start,
      end: { x: 180, y: 180 },
    }),
    false,
  );
  assert.equal(
    shouldTreatAsUserPan({
      programmatic: false,
      hasOriginalEvent: true,
      start,
      end: { x: 104, y: 103 },
      minPixels: USER_PAN_MIN_PX,
    }),
    false,
  );
  assert.equal(
    shouldTreatAsUserPan({
      programmatic: false,
      hasOriginalEvent: true,
      start,
      end: { x: 140, y: 100 },
      minPixels: USER_PAN_MIN_PX,
    }),
    true,
  );
});
