import assert from "node:assert/strict";
import { test } from "node:test";
import { TESLA_LOCATION_POLL_MS } from "./constants.ts";
import {
  applyTeslaDocumentClass,
  isTeslaBrowser,
  mapMaxCanvasSize,
  mapMaxTileCacheSize,
  mapPixelRatioForBrowser,
  overlayPixelRatioForBrowser,
  preferJumpFollow,
  radarPreloadRadius,
  shouldWatchGeolocation,
  teslaQueryEnabled,
  teslaUserAgent,
} from "./tesla-browser.ts";

test("detects Tesla and QtCarBrowser user agents", () => {
  assert.equal(
    teslaUserAgent(
      "Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 Chromium/79.0.3945.130 Chrome/79.0.3945.130 Safari/537.36 Tesla/2020.48.26-e3178ea250ba",
    ),
    true,
  );
  assert.equal(
    teslaUserAgent(
      "Mozilla/5.0 (X11; GNU/Linux) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/73.0.3683.101 Chrome/73.0.3683.101 Safari/537.36 Tesla QtCarBrowser",
    ),
    true,
  );
  assert.equal(
    teslaUserAgent(
      "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/128.0.0.0 Mobile Safari/537.36",
    ),
    false,
  );
});

test("?tesla=1 opts in; other query values do not", () => {
  assert.equal(teslaQueryEnabled("?tesla=1"), true);
  assert.equal(teslaQueryEnabled("heading=247&tesla=1"), true);
  assert.equal(teslaQueryEnabled("?tesla=0"), false);
  assert.equal(teslaQueryEnabled(""), false);
  assert.equal(isTeslaBrowser({ userAgent: "Chrome", search: "?tesla=1" }), true);
  assert.equal(isTeslaBrowser({ userAgent: "Chrome", search: "" }), false);
});

test("Tesla profile is poll-only, jump-only, and 1× pixels", () => {
  assert.equal(shouldWatchGeolocation(true), false);
  assert.equal(shouldWatchGeolocation(false), true);
  assert.equal(preferJumpFollow(true), true);
  assert.equal(preferJumpFollow(false), false);
  assert.equal(mapPixelRatioForBrowser(true, 2), 1);
  assert.equal(mapPixelRatioForBrowser(false, 3), 2);
  assert.equal(overlayPixelRatioForBrowser(true, 2), 1);
  assert.equal(radarPreloadRadius(true), 1);
  assert.equal(radarPreloadRadius(false), Number.POSITIVE_INFINITY);
  assert.equal(mapMaxTileCacheSize(true), 24);
  assert.equal(mapMaxTileCacheSize(false), undefined);
  assert.deepEqual(mapMaxCanvasSize(true), [2048, 2048]);
  assert.equal(TESLA_LOCATION_POLL_MS, 15_000);
});

test("applyTeslaDocumentClass toggles html.tesla-browser", () => {
  const classList = {
    on: false,
    toggle(name: string, force?: boolean) {
      if (name !== "tesla-browser") return;
      this.on = Boolean(force);
    },
  };
  applyTeslaDocumentClass(true, { classList });
  assert.equal(classList.on, true);
  applyTeslaDocumentClass(false, { classList });
  assert.equal(classList.on, false);
});
