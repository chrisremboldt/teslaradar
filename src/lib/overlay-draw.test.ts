import assert from "node:assert/strict";
import { test } from "node:test";
import { TESLA_OVERLAY_MIN_DRAW_MS } from "./constants.ts";
import { isSubpixelCameraHop, shouldDrawRadarOverlay } from "./overlay-draw.ts";

test("TESLA_OVERLAY_MIN_DRAW_MS is ~8 fps", () => {
  assert.equal(TESLA_OVERLAY_MIN_DRAW_MS, 125);
});

test("hidden tab never paints", () => {
  assert.equal(
    shouldDrawRadarOverlay({
      reason: "frame",
      lastDrawAt: null,
      now: 1,
      hidden: true,
    }),
    false,
  );
});

test("move is throttled; frame/settle/preload always draw", () => {
  assert.equal(
    shouldDrawRadarOverlay({
      tesla: false,
      reason: "move",
      lastDrawAt: 1_000,
      now: 1_000 + 40,
      minIntervalMs: TESLA_OVERLAY_MIN_DRAW_MS,
    }),
    false,
  );
  assert.equal(
    shouldDrawRadarOverlay({
      reason: "move",
      lastDrawAt: 1_000,
      now: 1_000 + TESLA_OVERLAY_MIN_DRAW_MS,
      minIntervalMs: TESLA_OVERLAY_MIN_DRAW_MS,
    }),
    true,
  );
  for (const reason of ["frame", "settle", "resize", "preload", "force"] as const) {
    assert.equal(
      shouldDrawRadarOverlay({
        reason,
        lastDrawAt: 1_000,
        now: 1_010,
      }),
      true,
      reason,
    );
  }
});

test("subpixel camera hops are ignored", () => {
  assert.equal(isSubpixelCameraHop({ x: 10, y: 10 }, { x: 10.4, y: 10.3 }), true);
  assert.equal(isSubpixelCameraHop({ x: 10, y: 10 }, { x: 14, y: 10 }), false);
});
