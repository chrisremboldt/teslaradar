import { expect, test, type Page } from "@playwright/test";

const NASHVILLE = { lat: 36.1627, lon: -86.7816 };

async function openPhone(page: Page) {
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
  await expect(page.locator("[data-place]")).toBeVisible({ timeout: 25_000 });
  await page.waitForTimeout(800);
}

test.describe("phone HUD fit", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("phone portrait keeps chrome in bounds and leaves map room", async ({ page }) => {
    await openPhone(page);

    const metrics = await page.evaluate(() => {
      const root = document.documentElement;
      const buttons = [...document.querySelectorAll(".hud-btn")].map((el) => {
        const rect = el.getBoundingClientRect();
        const style = getComputedStyle(el);
        return {
          text: (el.textContent ?? "").trim(),
          w: Math.round(rect.width),
          h: Math.round(rect.height),
          wrap: style.whiteSpace,
          right: Math.round(rect.right),
        };
      });
      const map = document.querySelector(".radar-map")?.getBoundingClientRect();
      const header = document.querySelector("[data-hud=top]")?.getBoundingClientRect();
      const bottom = document.querySelector("[data-hud=bottom]")?.getBoundingClientRect();
      return {
        scrollWidth: root.scrollWidth,
        clientWidth: root.clientWidth,
        overflowX: root.scrollWidth - root.clientWidth,
        buttons,
        mapHeight: map ? Math.round(map.height) : 0,
        headerBottom: header ? Math.round(header.bottom) : 0,
        bottomTop: bottom ? Math.round(bottom.top) : 0,
        viewportH: window.innerHeight,
      };
    });

    await page.screenshot({
      path: "e2e/artifacts/phone-hud-390.png",
      fullPage: true,
    });
    await page.screenshot({
      path: "e2e/artifacts/phone-hud-after-390.png",
      fullPage: true,
    });

    expect(metrics.overflowX).toBeLessThanOrEqual(1);
    expect(metrics.mapHeight).toBe(metrics.viewportH);
    const openMap = metrics.bottomTop - metrics.headerBottom;
    expect(openMap).toBeGreaterThan(320);
    for (const button of metrics.buttons) {
      expect(button.h, button.text).toBeLessThanOrEqual(48);
      expect(button.right).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }
    const controlTops = await page.evaluate(() =>
      [...document.querySelectorAll("[data-hud=bottom] .hud-controls .hud-btn")].map((el) =>
        Math.round(el.getBoundingClientRect().top),
      ),
    );
    expect(Math.max(...controlTops) - Math.min(...controlTops)).toBeLessThan(8);
  });
});

test.describe("phone HUD fit (narrow)", () => {
  test.use({ viewport: { width: 360, height: 740 } });

  test("360px portrait does not overflow horizontally", async ({ page }) => {
    await openPhone(page);
    const overflowX = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    await page.screenshot({ path: "e2e/artifacts/phone-hud-360.png", fullPage: true });
    expect(overflowX).toBeLessThanOrEqual(1);
  });
});
