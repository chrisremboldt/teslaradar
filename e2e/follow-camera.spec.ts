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

async function seedPrefs(page: Page, followMe: boolean) {
  await page.addInitScript((follow) => {
    window.localStorage.setItem(
      "teslaradar:prefs",
      JSON.stringify({
        prefsVersion: 2,
        followMe: follow,
        headingUp: false,
        animateRadar: false,
      }),
    );
  }, followMe);
}

async function installWatchGeo(page: Page, first: MockFix) {
  await page.addInitScript((seed) => {
    type Fix = { lat: number; lon: number; timestamp: number; accuracy?: number };
    let current: Fix = seed;
    const watchers = new Set<(position: GeolocationPosition) => void>();

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
      window as unknown as { __pushGeo: (fix: Fix) => void }
    ).__pushGeo = (fix) => {
      current = fix;
      const position = toPosition(fix);
      for (const watcher of watchers) watcher(position);
    };

    navigator.geolocation.getCurrentPosition = (success) => {
      success(toPosition(current));
    };
    navigator.geolocation.watchPosition = (success) => {
      watchers.add(success);
      success(toPosition(current));
      return 1;
    };
    navigator.geolocation.clearWatch = () => {
      watchers.clear();
    };
  }, first);
}

async function openRadar(page: Page, followMe: boolean, first?: MockFix) {
  const seed = first ?? {
    lat: NASHVILLE.lat,
    lon: NASHVILLE.lon,
    timestamp: Date.now(),
    accuracy: 10,
  };
  await seedPrefs(page, followMe);
  await installWatchGeo(page, seed);
  await page.goto("/");
  await expect(page.locator("[data-map-root][data-map-center-lat]")).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.locator(".tesla-location-marker")).toBeVisible();
  await page.waitForFunction(() => Boolean(window.__TESLARADAR_MAP__));
  await page.evaluate(() => {
    window.__TESLARADAR_MAP__?.jumpTo({ zoom: 11 });
  });
  await expect(page.locator("[data-map-root]")).toHaveAttribute("data-map-zoom", /1[01]\./, {
    timeout: 10_000,
  });
  await page.waitForTimeout(400);
  await expect(page.locator(".radar-overlay-canvas")).toBeAttached();
  await expect
    .poll(async () => page.locator(".radar-overlay-canvas").getAttribute("data-radar-src"), {
      timeout: 25_000,
    })
    .toMatch(/rainviewer\.com|rvdl\.|\/256\/|\/512\//);
}

async function pushGeo(page: Page, next: MockFix) {
  await page.evaluate((fix) => {
    (window as unknown as { __pushGeo: (fix: MockFix) => void }).__pushGeo(fix);
  }, next);
  await expect(page.locator("[data-place]")).toHaveAttribute("data-lat", String(next.lat), {
    timeout: 15_000,
  });
}

async function mapCenter(page: Page) {
  return page.evaluate(() => {
    const center = window.__TESLARADAR_MAP__?.getCenter();
    return { lat: center?.lat ?? Number.NaN, lon: center?.lng ?? Number.NaN };
  });
}

async function markerOffsetFromCenter(page: Page) {
  const root = page.locator("[data-map-root]");
  const x = Number(await root.getAttribute("data-marker-x"));
  const y = Number(await root.getAttribute("data-marker-y"));
  const w = Number(await root.getAttribute("data-viewport-w"));
  const h = Number(await root.getAttribute("data-viewport-h"));
  return { dx: x - w / 2, dy: y - h / 2, x, y, w, h };
}

test.describe("follow camera", () => {
  test("Following keeps the chevron planted on a northbound hop", async ({ page }) => {
    await openRadar(page, true);
    await expect(page.locator("[data-follow-me]")).toHaveAttribute("data-follow-me", "on");

    const nextLat = northOf(NASHVILLE.lat, 4_000);
    await pushGeo(page, {
      lat: nextLat,
      lon: NASHVILLE.lon,
      timestamp: Date.now(),
      accuracy: 10,
    });

    await expect.poll(async () => {
      const center = await mapCenter(page);
      return Math.abs(center.lat - nextLat);
    }, { timeout: 10_000 }).toBeLessThan(CENTER_EPSILON_DEG);
    await expect.poll(async () => {
      const center = await mapCenter(page);
      return Math.abs(center.lon - NASHVILLE.lon);
    }).toBeLessThan(CENTER_EPSILON_DEG);
    await expect.poll(async () => {
      const offset = await markerOffsetFromCenter(page);
      return Math.hypot(offset.dx, offset.dy);
    }).toBeLessThan(MARKER_CENTER_PX);
    await expect(page.locator("[data-follow-me]")).toHaveAttribute("data-follow-me", "on");
    await expect(page.locator(".radar-overlay-canvas")).toHaveAttribute(
      "data-radar-src",
      /rainviewer\.com|rvdl\.|\/256\/|\/512\//,
    );

    await page.waitForTimeout(450);
    await page.screenshot({
      path: "e2e/artifacts/follow-northbound-centered.png",
      fullPage: true,
    });
  });

  test("Follow off does not chase ownship north", async ({ page }) => {
    await openRadar(page, true);
    await page.getByRole("button", { name: "Following" }).click();
    await expect(page.locator("[data-follow-me]")).toHaveAttribute("data-follow-me", "off");
    const before = await mapCenter(page);

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

    const after = await mapCenter(page);
    expect(Math.abs(after.lat - before.lat)).toBeLessThan(CENTER_EPSILON_DEG);
    expect(Math.abs(after.lon - before.lon)).toBeLessThan(CENTER_EPSILON_DEG);
    await expect.poll(async () => {
      const offset = await markerOffsetFromCenter(page);
      return offset.dy;
    }).toBeLessThan(-40);

    await page.screenshot({
      path: "e2e/artifacts/follow-off-northbound-drift.png",
      fullPage: true,
    });
  });

  test("re-tapping Following after a pan recenters on ownship", async ({ page }) => {
    await openRadar(page, true);
    const canvas = page.locator(".radar-map .maplibregl-canvas");
    const box = await canvas.boundingBox();
    expect(box).toBeTruthy();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height * 0.55;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + 140, y + 90, { steps: 16 });
    await page.mouse.up();

    await expect(page.locator("[data-follow-me]")).toHaveAttribute("data-follow-me", "off", {
      timeout: 10_000,
    });
    await expect.poll(async () => {
      const center = await mapCenter(page);
      return Math.abs(center.lat - NASHVILLE.lat) + Math.abs(center.lon - NASHVILLE.lon);
    }).toBeGreaterThan(0.001);

    await page.getByRole("button", { name: "Follow me" }).click();
    await expect(page.locator("[data-follow-me]")).toHaveAttribute("data-follow-me", "on");
    await expect.poll(async () => {
      const center = await mapCenter(page);
      return Math.abs(center.lat - NASHVILLE.lat);
    }, { timeout: 10_000 }).toBeLessThan(CENTER_EPSILON_DEG);
    await expect.poll(async () => {
      const offset = await markerOffsetFromCenter(page);
      return Math.hypot(offset.dx, offset.dy);
    }).toBeLessThan(MARKER_CENTER_PX);

    await page.screenshot({
      path: "e2e/artifacts/follow-after-pan-recentered.png",
      fullPage: true,
    });
  });
});
