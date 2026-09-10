import { expect, test } from "@playwright/test";

const NASHVILLE = { lat: 36.1627, lon: -86.7816 };

test.describe("map zoom controls", () => {
  test("zoom in and out change the published map zoom", async ({ page }) => {
    await page.context().grantPermissions(["geolocation"]);
    await page.context().setGeolocation({
      latitude: NASHVILLE.lat,
      longitude: NASHVILLE.lon,
      accuracy: 10,
    });
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
    await page.goto("/");
    await expect(page.locator("[data-map-root][data-map-zoom]")).toBeVisible({
      timeout: 25_000,
    });
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom out" })).toBeVisible();

    const start = Number(await page.locator("[data-map-root]").getAttribute("data-map-zoom"));
    await page.getByRole("button", { name: "Zoom in" }).click();
    await expect
      .poll(async () => Number(await page.locator("[data-map-root]").getAttribute("data-map-zoom")))
      .toBeGreaterThan(start);

    const afterIn = Number(await page.locator("[data-map-root]").getAttribute("data-map-zoom"));
    await page.getByRole("button", { name: "Zoom out" }).click();
    await expect
      .poll(async () => Number(await page.locator("[data-map-root]").getAttribute("data-map-zoom")))
      .toBeLessThan(afterIn);
  });
});
