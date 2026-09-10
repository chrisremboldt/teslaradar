import { expect, test, type BrowserContext, type Page } from "@playwright/test";

const NASHVILLE = { latitude: 36.1627, longitude: -86.7816 };

function eastOf(lon: number, meters: number): number {
  return lon + meters / 111_320;
}

async function openRadar(page: Page, context: BrowserContext) {
  await context.grantPermissions(["geolocation"]);
  await context.setGeolocation({
    ...NASHVILLE,
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
  await expect(page.locator("[data-track-heading]")).toBeVisible({ timeout: 25_000 });
}

async function refreshAt(
  page: Page,
  context: BrowserContext,
  latitude: number,
  longitude: number,
) {
  await context.setGeolocation({ latitude, longitude, accuracy: 10 });
  await page.getByRole("button", { name: /Refresh now|Refreshing/ }).click();
  await expect(page.getByRole("button", { name: "Refresh now" })).toBeEnabled({
    timeout: 20_000,
  });
}

test.describe("ownship track heading", () => {
  test("parked GPS keeps the no-heading marker", async ({ page, context }) => {
    await openRadar(page, context);
    await expect(page.locator("[data-track-heading]")).toHaveAttribute(
      "data-track-heading",
      "",
    );
    await expect(page.locator(".tesla-location-marker")).not.toHaveClass(/has-heading/);
    await page.screenshot({
      path: "e2e/artifacts/ownship-parked-no-heading.png",
      fullPage: true,
    });

    await refreshAt(page, context, NASHVILLE.latitude, eastOf(NASHVILLE.longitude, 6));
    await refreshAt(page, context, NASHVILLE.latitude, eastOf(NASHVILLE.longitude, 2));
    await expect(page.locator("[data-track-heading]")).toHaveAttribute(
      "data-track-heading",
      "",
    );
    await expect(page.locator(".tesla-location-marker")).not.toHaveClass(/has-heading/);
  });

  test("eastbound fixes rotate the chevron to the averaged course", async ({
    page,
    context,
  }) => {
    await openRadar(page, context);

    for (const meters of [80, 160, 240, 320]) {
      await refreshAt(
        page,
        context,
        NASHVILLE.latitude,
        eastOf(NASHVILLE.longitude, meters),
      );
    }

    const raw = await page.locator("[data-track-heading]").getAttribute("data-track-heading");
    const heading = Number(raw);
    expect(heading).toBeGreaterThan(80);
    expect(heading).toBeLessThan(100);
    await expect(page.locator(".tesla-location-marker")).toHaveClass(/has-heading/);
    await expect(page.locator("text=/track 8|track 9/")).toBeVisible();
    await page.screenshot({
      path: "e2e/artifacts/ownship-eastbound-heading.png",
      fullPage: true,
    });
  });
});
