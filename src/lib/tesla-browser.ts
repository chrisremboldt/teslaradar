/**
 * Tesla’s in-car Qt/Chromium browser (UA still has `Tesla/` or `QtCarBrowser`).
 * `?tesla=1` opts in for Playwright / desktop debugging.
 *
 * The car screen is huge (Model 3/Y ~1920×1200) and the GPU/driver is fragile:
 * WebGL2 MapLibre + a full-viewport 2D overlay + watchPosition + easeTo
 * has been enough to kill the tab.
 */
export function teslaUserAgent(ua: string): boolean {
  return /\bTesla\//i.test(ua) || /QtCarBrowser/i.test(ua);
}

export function teslaQueryEnabled(search: string): boolean {
  const query = search.startsWith("?") ? search.slice(1) : search;
  return new URLSearchParams(query).get("tesla") === "1";
}

export function isTeslaBrowser(input?: { userAgent?: string; search?: string }): boolean {
  const ua = input?.userAgent ?? (typeof navigator !== "undefined" ? navigator.userAgent : "");
  const search =
    input?.search ?? (typeof window !== "undefined" ? window.location.search : "");
  return teslaQueryEnabled(search) || teslaUserAgent(ua);
}

export function applyTeslaDocumentClass(
  tesla: boolean,
  root: Pick<Element, "classList"> | null = typeof document !== "undefined"
    ? document.documentElement
    : null,
): void {
  root?.classList.toggle("tesla-browser", tesla);
}

/** Tesla: 1×. Phones/desktops: cap at 2× so a 3× phone does not allocate a 3× WebGL buffer. */
export function mapPixelRatioForBrowser(tesla: boolean, devicePixelRatio: number): number {
  if (tesla) return 1;
  return Math.min(Math.max(devicePixelRatio || 1, 1), 2);
}

export function overlayPixelRatioForBrowser(tesla: boolean, devicePixelRatio: number): number {
  return mapPixelRatioForBrowser(tesla, devicePixelRatio);
}

/**
 * watchPosition + enableHighAccuracy has crashed Tesla Chromium.
 * Use getCurrentPosition on a short poll (await a recent reading) instead.
 */
export function shouldWatchGeolocation(tesla: boolean): boolean {
  return !tesla;
}

/** easeTo CSS-transforms the GL canvas every frame; Tesla cannot afford that. */
export function preferJumpFollow(tesla: boolean): boolean {
  return tesla;
}

/** Neighbors on each side of the playhead. Infinity = every past frame. */
export function radarPreloadRadius(tesla: boolean): number {
  return tesla ? 1 : Number.POSITIVE_INFINITY;
}

export function mapMaxTileCacheSize(tesla: boolean): number | undefined {
  return tesla ? 24 : undefined;
}

export function mapMaxCanvasSize(tesla: boolean): [number, number] | undefined {
  return tesla ? [2048, 2048] : undefined;
}
