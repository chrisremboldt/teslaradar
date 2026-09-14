import { expect, test, type Page } from "@playwright/test";

const NASHVILLE = { lat: 36.1627, lon: -86.7816 };
const FRAME_COUNT = 12;
const CATALOG_GENERATED = 1_700_000_000;
const PIXEL_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

function pastFrames() {
  return Array.from({ length: FRAME_COUNT }, (_, i) => ({
    time: CATALOG_GENERATED + i * 600,
    path: `/v2/radar/${CATALOG_GENERATED + i * 600}/2`,
  }));
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

async function installPollGeo(page: Page) {
  await page.addInitScript((seed) => {
    const toPosition = (): GeolocationPosition =>
      ({
        coords: {
          latitude: seed.lat,
          longitude: seed.lon,
          accuracy: 10,
          altitude: null,
          altitudeAccuracy: null,
          heading: null,
          speed: null,
        },
        timestamp: Date.now(),
      }) as GeolocationPosition;

    navigator.geolocation.getCurrentPosition = (success) => {
      success(toPosition());
    };
    navigator.geolocation.watchPosition = () => 0;
    navigator.geolocation.clearWatch = () => undefined;
  }, NASHVILLE);
}

async function mockRainViewer(page: Page) {
  const frames = pastFrames();
  await page.route("https://api.rainviewer.com/public/weather-maps.json", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        version: "2.0",
        generated: CATALOG_GENERATED,
        host: "https://tilecache.rainviewer.com",
        radar: { past: frames, nowcast: [] },
      }),
    });
  });
  await page.route("https://tilecache.rainviewer.com/**", async (route) => {
    const url = route.request().url();
    // Delay one neighbor so Play must hold the last painted frame.
    if (url.includes(String(CATALOG_GENERATED + 600))) {
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
    await route.fulfill({
      status: 200,
      contentType: "image/png",
      body: PIXEL_PNG,
    });
  });
}

test.describe("radar play loop", () => {
  test.use({
    viewport: { width: 1920, height: 1200 },
    isMobile: false,
    hasTouch: true,
    deviceScaleFactor: 1,
  });

  test("Play advances painted frames; Pause returns to latest and shrinks cache", async ({
    page,
  }) => {
    await mockRainViewer(page);
    await seedPrefs(page);
    await installPollGeo(page);
    await page.context().grantPermissions(["geolocation"]);
    await page.goto("/?debug=1");

    const canvas = page.locator(".radar-overlay-canvas");
    await expect(page.locator("[data-animate-radar=off]").first()).toBeVisible({
      timeout: 25_000,
    });
    await expect(canvas).toBeAttached();
    await expect(canvas).toHaveAttribute("data-radar-painted", "1", { timeout: 25_000 });
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-radar-cache-size")), {
        timeout: 10_000,
      })
      .toBeLessThanOrEqual(2);
    await expect(page.locator("[data-map-root]")).toHaveAttribute(
      "data-radar-index",
      String(FRAME_COUNT - 1),
    );

    await page.getByRole("button", { name: "Play radar" }).click();
    await expect(page.locator("[data-animate-radar=on]").first()).toBeVisible();

    await expect
      .poll(async () => canvas.getAttribute("data-radar-play-ready"), { timeout: 8_000 })
      .toBe("1");

    const samples: { index: string; painted: string; cache: number }[] = [];
    const deadline = Date.now() + 6_500;
    while (Date.now() < deadline) {
      samples.push({
        index: (await canvas.getAttribute("data-radar-index")) ?? "",
        painted: (await canvas.getAttribute("data-radar-painted")) ?? "",
        cache: Number(await canvas.getAttribute("data-radar-cache-size")),
      });
      await page.waitForTimeout(220);
    }

    const indexes = new Set(samples.map((sample) => sample.index).filter(Boolean));
    const paintedRatio =
      samples.filter((sample) => sample.painted === "1").length / Math.max(1, samples.length);
    const maxCache = Math.max(...samples.map((sample) => sample.cache));

    expect(indexes.size, `indexes seen: ${[...indexes].join(",")}`).toBeGreaterThanOrEqual(4);
    expect(paintedRatio).toBeGreaterThanOrEqual(0.8);
    expect(maxCache).toBeGreaterThanOrEqual(10);

    await page.screenshot({
      path: "e2e/artifacts/radar-play-loop.png",
      fullPage: true,
    });

    await page.getByRole("button", { name: "Pause radar" }).click();
    await expect(page.locator("[data-animate-radar=off]").first()).toBeVisible();
    await expect(page.locator("[data-map-root]")).toHaveAttribute(
      "data-radar-index",
      String(FRAME_COUNT - 1),
    );
    await expect(canvas).toHaveAttribute("data-radar-painted", "1");
    await expect
      .poll(async () => Number(await canvas.getAttribute("data-radar-cache-size")), {
        timeout: 8_000,
      })
      .toBeLessThanOrEqual(1);
  });
});
