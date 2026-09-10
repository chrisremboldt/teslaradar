import { expect, test, type Page } from "@playwright/test";

const NASHVILLE = { lat: 36.1627, lon: -86.7816 };

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

async function installJitterGeo(page: Page) {
  await page.addInitScript((seed) => {
    let lat = seed.lat;
    let lon = seed.lon;
    const watchers = new Set<(position: GeolocationPosition) => void>();

    const toPosition = (): GeolocationPosition =>
      ({
        coords: {
          latitude: lat,
          longitude: lon,
          accuracy: 12,
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
    navigator.geolocation.watchPosition = (success) => {
      watchers.add(success);
      success(toPosition());
      const timer = window.setInterval(() => {
        lat = seed.lat + (Math.random() - 0.5) * 0.004;
        lon = seed.lon + (Math.random() - 0.5) * 0.004;
        for (const watcher of watchers) watcher(toPosition());
      }, 180);
      (
        window as unknown as { __stopJitter?: () => void }
      ).__stopJitter = () => window.clearInterval(timer);
      return 1;
    };
    navigator.geolocation.clearWatch = () => {
      watchers.clear();
    };
  }, NASHVILLE);
}

test.describe("place + radar after follow PRs", () => {
  test("city arrives despite 1 Hz GPS jitter and radar paints above the map", async ({
    page,
  }) => {
    await page.route("https://nominatim.openstreetmap.org/reverse**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 700));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          address: {
            city: "Nashville",
            state: "Tennessee",
            "ISO3166-2-lvl4": "US-TN",
            country_code: "us",
          },
        }),
      });
    });

    await seedPrefs(page);
    await installJitterGeo(page);
    await page.context().grantPermissions(["geolocation"]);
    await page.goto("/");

    await expect(page.locator("[data-place]")).toBeVisible({ timeout: 25_000 });
    await expect(page.locator("[data-place]")).toHaveAttribute("data-place", /Nashville/, {
      timeout: 15_000,
    });

    const canvas = page.locator(".radar-overlay-canvas");
    await expect(canvas).toBeAttached();
    await expect
      .poll(async () => canvas.getAttribute("data-radar-src"), { timeout: 25_000 })
      .toMatch(/rainviewer\.com|rvdl\.|\/256\/|\/512\//);
    await expect(canvas).toHaveAttribute("data-radar-mount", "root");
    await expect(canvas).toHaveAttribute("data-radar-painted", "1", { timeout: 25_000 });

    const stacking = await page.evaluate(() => {
      const overlay = document.querySelector(".radar-overlay-canvas");
      const map = document.querySelector(".radar-map");
      const root = document.querySelector("[data-map-root]");
      return {
        overlayParentIsRoot: overlay?.parentElement === root,
        overlayNotInCanvasContainer: !overlay?.closest(".maplibregl-canvas-container"),
        mapIsSibling: overlay?.parentElement?.contains(map ?? null) ?? false,
      };
    });
    expect(stacking.overlayParentIsRoot).toBe(true);
    expect(stacking.overlayNotInCanvasContainer).toBe(true);
    expect(stacking.mapIsSibling).toBe(true);

    await page.screenshot({
      path: "e2e/artifacts/place-radar-jitter.png",
      fullPage: true,
    });
  });
});
