import { expect, test, type Page } from "@playwright/test";

const NASHVILLE = { lat: 36.1627, lon: -86.7816 };
const CENTER_EPSILON_DEG = 0.0002;
const MARKER_CENTER_PX = 28;

type MockFix = {
  lat: number;
  lon: number;
  timestamp: number;
  accuracy?: number;
};

function northOf(lat: number, meters: number): number {
  return lat + meters / 110_540;
}

async function seedPrefs(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.setItem(
      "teslaradar:prefs",
      JSON.stringify({
        prefsVersion: 2,
        followMe: true,
        headingUp: false,
        animateRadar: false,
      }),
    );
  });
}

async function installPollGeo(page: Page, first: MockFix) {
  await page.addInitScript((seed) => {
    type Fix = { lat: number; lon: number; timestamp: number; accuracy?: number };
    let current: Fix = seed;
    let watchCalls = 0;

    const toPosition = (fix: Fix): GeolocationPosition =>
      ({
        coords: {
          latitude: fix.lat,
          longitude: fix.lon,
          accuracy: fix.accuracy ?? 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: fix.timestamp,
      }) as GeolocationPosition;

    (
      window as unknown as {
        __pushGeo: (fix: Fix) => void;
        __watchCalls: () => number;
      }
    ).__pushGeo = (fix) => {
      current = fix;
    };
    (window as unknown as { __watchCalls: () => number }).__watchCalls = () => watchCalls;

    navigator.geolocation.getCurrentPosition = (success) => {
      success(toPosition(current));
    };
    navigator.geolocation.watchPosition = () => {
      watchCalls += 1;
      return 1;
    };
    navigator.geolocation.clearWatch = () => undefined;
  }, first);
}

test.describe("Tesla browser survival", () => {
  test.use({
    viewport: { width: 1920, height: 1200 },
    isMobile: false,
    hasTouch: true,
    deviceScaleFactor: 2,
  });

  test("car profile skips watchPosition, stays 1×, and Following still recenters", async ({
    page,
  }) => {
    const seed = {
      lat: NASHVILLE.lat,
      lon: NASHVILLE.lon,
      timestamp: Date.now(),
      accuracy: 10,
    };
    await seedPrefs(page);
    await installPollGeo(page, seed);
    await page.context().grantPermissions(["geolocation"]);
    await page.goto("/?tesla=1");

    await expect(page.locator("[data-tesla-browser=on]").first()).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator("[data-geo-watch=off]")).toBeVisible();
    await expect.poll(() => page.locator("html").getAttribute("class")).toMatch(/tesla-browser/);
    await expect(page.getByText(/Location poll 15 s/)).toBeVisible();

    await expect(page.locator("[data-map-root][data-map-center-lat]")).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.locator("[data-map-root]")).toHaveAttribute("data-tesla-browser", "on");
    await expect(page.locator("[data-map-root]")).toHaveAttribute("data-map-pixel-ratio", "1");

    const watchCalls = await page.evaluate(
      () => (window as unknown as { __watchCalls: () => number }).__watchCalls(),
    );
    expect(watchCalls).toBe(0);

    await expect(page.locator(".radar-overlay-canvas")).toBeAttached();
    await expect(page.locator(".radar-overlay-canvas")).toHaveAttribute("data-pixel-ratio", "1");
    const canvasMetrics = await page.evaluate(() => {
      const overlay = document.querySelector(".radar-overlay-canvas") as HTMLCanvasElement | null;
      const gl = document.querySelector(".radar-map .maplibregl-canvas") as HTMLCanvasElement | null;
      return {
        overlayW: overlay?.width ?? 0,
        overlayCss: overlay?.clientWidth ?? 0,
        glW: gl?.width ?? 0,
        glCss: gl?.clientWidth ?? 0,
      };
    });
    expect(canvasMetrics.overlayW).toBeGreaterThan(100);
    expect(Math.abs(canvasMetrics.overlayW - canvasMetrics.overlayCss)).toBeLessThanOrEqual(2);
    expect(canvasMetrics.glW).toBeGreaterThan(100);
    expect(canvasMetrics.glW).toBeLessThanOrEqual(canvasMetrics.glCss + 2);

    const nextLat = northOf(NASHVILLE.lat, 4_000);
    await page.evaluate((fix) => {
      (window as unknown as { __pushGeo: (fix: MockFix) => void }).__pushGeo(fix);
    }, {
      lat: nextLat,
      lon: NASHVILLE.lon,
      timestamp: Date.now(),
      accuracy: 10,
    });
    await page.getByRole("button", { name: /Refresh now|Refreshing/ }).click();
    await expect(page.locator("[data-place]")).toHaveAttribute("data-lat", String(nextLat), {
      timeout: 15_000,
    });

    await expect.poll(async () => {
      const center = await page.evaluate(() => {
        const c = window.__TESLARADAR_MAP__?.getCenter();
        return { lat: c?.lat ?? Number.NaN, lon: c?.lng ?? Number.NaN };
      });
      return Math.abs(center.lat - nextLat);
    }, { timeout: 10_000 }).toBeLessThan(CENTER_EPSILON_DEG);

    const offset = await page.evaluate(() => {
      const root = document.querySelector("[data-map-root]");
      if (!root) return Number.POSITIVE_INFINITY;
      const x = Number(root.getAttribute("data-marker-x"));
      const y = Number(root.getAttribute("data-marker-y"));
      const w = Number(root.getAttribute("data-viewport-w"));
      const h = Number(root.getAttribute("data-viewport-h"));
      return Math.hypot(x - w / 2, y - h / 2);
    });
    expect(offset).toBeLessThan(MARKER_CENTER_PX);

    await page.screenshot({
      path: "e2e/artifacts/tesla-browser-1920.png",
      fullPage: true,
    });
  });
});
