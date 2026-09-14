import { expect, test, type Page } from "@playwright/test";

const NASHVILLE = { lat: 36.1627, lon: -86.7816 };

function eastOf(lon: number, meters: number): number {
  return lon + meters / (111_320 * Math.cos((NASHVILLE.lat * Math.PI) / 180));
}

function northOf(lat: number, meters: number): number {
  return lat + meters / 110_540;
}

type MockFix = {
  lat: number;
  lon: number;
  timestamp: number;
  accuracy?: number;
  speed?: number | null;
  heading?: number | null;
};

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

async function openRadar(page: Page) {
  await page.context().grantPermissions(["geolocation"]);
  await page.context().setGeolocation({
    latitude: NASHVILLE.lat,
    longitude: NASHVILLE.lon,
    accuracy: 10,
  });
  await seedPrefs(page);
  await page.goto("/");
  await expect(page.locator("[data-place][data-track-heading]")).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.locator(".tesla-location-marker")).toBeVisible();
  await page.waitForTimeout(1500);
}

async function openRadarWithMockTrack(page: Page, first: MockFix) {
  await seedPrefs(page);
  await page.addInitScript((seed) => {
    const queue = [seed];
    (
      window as unknown as { __pushGeo: (fix: typeof seed) => void }
    ).__pushGeo = (fix) => {
      queue.push(fix);
    };
    navigator.geolocation.getCurrentPosition = (success) => {
      const fix = queue[queue.length - 1]!;
      success({
        coords: {
          latitude: fix.lat,
          longitude: fix.lon,
          accuracy: fix.accuracy ?? 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: fix.heading ?? null,
          speed: fix.speed ?? null,
        },
        timestamp: fix.timestamp,
      } as GeolocationPosition);
    };
    navigator.geolocation.watchPosition = () => 0;
    navigator.geolocation.clearWatch = () => undefined;
  }, first);
  await page.goto("/");
  await expect(page.locator("[data-place][data-track-heading]")).toBeVisible({
    timeout: 25_000,
  });
  await expect(page.locator(".tesla-location-marker")).toBeVisible();
  await page.waitForTimeout(1500);
}

async function refreshAt(
  page: Page,
  latitude: number,
  longitude: number,
) {
  const before = await page.locator("[data-place]").getAttribute("data-lon");
  await page.context().setGeolocation({ latitude, longitude, accuracy: 10 });
  await page.getByRole("button", { name: /Refresh now|Refreshing/ }).click();
  await expect(page.getByRole("button", { name: "Refresh now" })).toBeEnabled({
    timeout: 20_000,
  });
  await expect(page.locator("[data-place]")).not.toHaveAttribute("data-lon", before ?? "", {
    timeout: 15_000,
  });
}

async function mockRefresh(page: Page, next: MockFix, expectMove = true) {
  const beforeLon = await page.locator("[data-place]").getAttribute("data-lon");
  const beforeLat = await page.locator("[data-place]").getAttribute("data-lat");
  await page.evaluate((fix) => {
    (window as unknown as { __pushGeo: (fix: MockFix) => void }).__pushGeo(fix);
  }, next);
  await page.getByRole("button", { name: /Refresh now|Refreshing/ }).click();
  await expect(page.getByRole("button", { name: "Refresh now" })).toBeEnabled({
    timeout: 20_000,
  });
  if (expectMove) {
    await expect
      .poll(async () => {
        const lon = await page.locator("[data-place]").getAttribute("data-lon");
        const lat = await page.locator("[data-place]").getAttribute("data-lat");
        return lon !== beforeLon || lat !== beforeLat;
      }, { timeout: 15_000 })
      .toBe(true);
  }
}

test.describe("ownship track heading", () => {
  test("parked GPS keeps the no-heading marker and hides rings", async ({ page }) => {
    await openRadar(page);
    await expect(page.locator("[data-place][data-track-heading]")).toHaveAttribute(
      "data-track-heading",
      "",
    );
    await expect(page.locator("[data-place]")).toHaveAttribute("data-range-5", "");
    await expect(page.locator("[data-place]")).toHaveAttribute("data-range-30", "");
    await expect(page.locator(".tesla-location-marker")).not.toHaveClass(/has-heading/);
    await expect(page.locator(".range-ring-label").first()).toBeHidden();
    await expect(page.locator(".range-ring-label").nth(1)).toBeHidden();
    await page.screenshot({
      path: "e2e/artifacts/ownship-parked-no-heading.png",
      fullPage: true,
    });
    await page.locator(".tesla-location-marker").screenshot({
      path: "e2e/artifacts/ownship-parked-marker.png",
    });

    await refreshAt(page, NASHVILLE.lat, eastOf(NASHVILLE.lon, 6));
    await refreshAt(page, NASHVILLE.lat, eastOf(NASHVILLE.lon, 2));
    await expect(page.locator("[data-place][data-track-heading]")).toHaveAttribute(
      "data-track-heading",
      "",
    );
    await expect(page.locator("[data-place]")).toHaveAttribute("data-range-5", "");
    await expect(page.locator(".tesla-location-marker")).not.toHaveClass(/has-heading/);
  });

  test("eastbound fixes rotate the chevron and draw 5/30 min rings", async ({
    page,
  }) => {
    const t0 = Date.now() - 4 * 60_000;
    await openRadarWithMockTrack(page, {
      lat: NASHVILLE.lat,
      lon: NASHVILLE.lon,
      timestamp: t0,
      accuracy: 10,
    });

    for (const [i, meters] of [1000, 2000, 3000, 4000].entries()) {
      await mockRefresh(page, {
        lat: NASHVILLE.lat,
        lon: eastOf(NASHVILLE.lon, meters),
        timestamp: t0 + (i + 1) * 60_000,
        accuracy: 10,
      });
    }

    const raw = await page
      .locator("[data-place][data-track-heading]")
      .getAttribute("data-track-heading");
    const heading = Number(raw);
    expect(heading).toBeGreaterThan(80);
    expect(heading).toBeLessThan(100);
    await expect(page.locator(".tesla-location-marker")).toHaveClass(/has-heading/);
    await expect(page.locator("text=/track 8|track 9/")).toBeVisible();

    const range5 = Number(await page.locator("[data-place]").getAttribute("data-range-5"));
    const range30 = Number(await page.locator("[data-place]").getAttribute("data-range-30"));
    expect(range5).toBeGreaterThan(4_000);
    expect(range5).toBeLessThan(6_000);
    expect(range30).toBeGreaterThan(24_000);
    expect(range30).toBeLessThan(36_000);
    expect(range30 / range5).toBeGreaterThan(5.5);
    expect(range30 / range5).toBeLessThan(6.5);
    await expect(page.locator("[data-range-overlay=on]")).toBeVisible();
    await expect(page.locator(".range-ring-label", { hasText: "5 min" })).toBeVisible();
    await expect(page.locator(".range-ring-label", { hasText: "30 min" })).toBeVisible();

    await page.waitForTimeout(800);
    await page.screenshot({
      path: "e2e/artifacts/ownship-eastbound-heading.png",
      fullPage: true,
    });
    await page.locator(".tesla-location-marker").screenshot({
      path: "e2e/artifacts/ownship-eastbound-marker.png",
    });
  });

  test("stoplight sit then go restores rings without a special refresh path", async ({
    page,
  }) => {
    const t = Date.now();
    await openRadarWithMockTrack(page, {
      lat: NASHVILLE.lat,
      lon: NASHVILLE.lon,
      timestamp: t - 299_000,
      accuracy: 10,
    });

    const stopAt = Date.now();
    const stoppedLon = eastOf(NASHVILLE.lon, 80);
    await mockRefresh(page, {
      lat: NASHVILLE.lat,
      lon: stoppedLon,
      timestamp: stopAt,
      accuracy: 10,
    });
    await expect(page.locator("[data-place]")).toHaveAttribute("data-motion", "parked");
    await expect(page.locator("[data-place]")).toHaveAttribute("data-range-5", "");
    await expect(page.locator("[data-range-overlay=on]")).toHaveCount(0);

    await mockRefresh(page, {
      lat: NASHVILLE.lat,
      lon: eastOf(NASHVILLE.lon, 160),
      timestamp: stopAt + 4_000,
      accuracy: 10,
    });
    await expect(page.locator("[data-place]")).toHaveAttribute("data-motion", "moving");
    const range5 = Number(await page.locator("[data-place]").getAttribute("data-range-5"));
    expect(range5).toBeGreaterThan(4_000);
    await expect(page.locator("[data-range-overlay=on]")).toBeVisible();
  });

  test("native coords.speed drives moving + rings, then speed 0 parks after hysteresis", async ({
    page,
  }) => {
    await openRadarWithMockTrack(page, {
      lat: NASHVILLE.lat,
      lon: NASHVILLE.lon,
      timestamp: Date.now(),
      accuracy: 10,
      speed: 13.4,
      heading: 90,
    });

    await expect(page.locator("[data-place]")).toHaveAttribute("data-motion", "moving", {
      timeout: 15_000,
    });
    await expect(page.locator("[data-place]")).toHaveAttribute("data-track-heading", "90");
    const range5 = Number(await page.locator("[data-place]").getAttribute("data-range-5"));
    const range30 = Number(await page.locator("[data-place]").getAttribute("data-range-30"));
    expect(range5).toBeGreaterThan(3_500);
    expect(range5).toBeLessThan(5_000);
    expect(range30).toBeGreaterThan(22_000);
    expect(range30 / range5).toBeGreaterThan(5.5);
    await expect(page.locator("[data-range-overlay=on]")).toBeVisible();
    await expect(page.locator(".tesla-location-marker")).toHaveClass(/has-heading/);
    await page.screenshot({
      path: "e2e/artifacts/ownship-native-speed-moving.png",
      fullPage: true,
    });

    await mockRefresh(
      page,
      {
        lat: NASHVILLE.lat,
        lon: NASHVILLE.lon,
        timestamp: Date.now(),
        accuracy: 10,
        speed: 0,
        heading: null,
      },
      false,
    );
    await expect(page.locator("[data-place]")).toHaveAttribute("data-motion", "moving");
    await expect(page.locator("[data-range-overlay=on]")).toBeVisible();

    await expect(page.locator("[data-place]")).toHaveAttribute("data-motion", "parked", {
      timeout: 8_000,
    });
    await expect(page.locator("[data-place]")).toHaveAttribute("data-range-5", "");
    await expect(page.locator("[data-range-overlay=on]")).toHaveCount(0);
    await page.screenshot({
      path: "e2e/artifacts/ownship-native-speed-parked.png",
      fullPage: true,
    });
  });

  test("null native speed with city-pace north hops still goes moving", async ({
    page,
  }) => {
    const t0 = Date.now() - 12_000;
    const hop = 22;
    await openRadarWithMockTrack(page, {
      lat: NASHVILLE.lat,
      lon: NASHVILLE.lon,
      timestamp: t0,
      accuracy: 10,
      speed: null,
      heading: null,
    });

    for (const i of [1, 2, 3]) {
      await mockRefresh(page, {
        lat: northOf(NASHVILLE.lat, hop * i),
        lon: NASHVILLE.lon,
        timestamp: t0 + i * 4_000,
        accuracy: 10,
        speed: null,
        heading: null,
      });
    }

    await expect(page.locator("[data-place]")).toHaveAttribute("data-motion", "moving", {
      timeout: 10_000,
    });
    const heading = Number(
      await page.locator("[data-place][data-track-heading]").getAttribute("data-track-heading"),
    );
    expect(heading < 15 || heading > 345).toBeTruthy();
    await expect(page.locator("[data-range-overlay=on]")).toBeVisible();
    await expect(page.locator("[data-place]")).not.toHaveAttribute("data-range-5", "");
    await page.screenshot({
      path: "e2e/artifacts/ownship-city-hops-moving.png",
      fullPage: true,
    });
  });
});
