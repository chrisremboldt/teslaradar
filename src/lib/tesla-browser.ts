/**
 * TeslaRadar is Tesla-only. Every session is the lean in-car path:
 * poll GPS, jumpTo, 1× pixels, tiny GL tile cache, latest radar frame.
 *
 * There is no phone profile and no UA / `?tesla=` mode flip. `?tesla=1`
 * is ignored. `data-tesla-browser=on` is always set so in-car debug is obvious.
 */
export function teslaUserAgent(ua?: string): boolean {
  void ua;
  return true;
}

export function teslaQueryEnabled(search?: string): boolean {
  void search;
  return true;
}

/** Always lean. Kept so existing call sites / debug attrs stay truthful. */
export function isTeslaBrowser(input?: { userAgent?: string; search?: string }): boolean {
  void input;
  return true;
}

export function applyTeslaDocumentClass(
  tesla = true,
  root: Pick<Element, "classList"> | null = typeof document !== "undefined"
    ? document.documentElement
    : null,
): void {
  void tesla;
  root?.classList.add("tesla-browser");
}

export function mapPixelRatioForBrowser(
  tesla?: boolean,
  devicePixelRatio?: number,
): number {
  void tesla;
  void devicePixelRatio;
  return 1;
}

export function overlayPixelRatioForBrowser(
  tesla?: boolean,
  devicePixelRatio?: number,
): number {
  void tesla;
  void devicePixelRatio;
  return 1;
}

/** watchPosition + enableHighAccuracy has crashed Tesla Chromium. */
export function shouldWatchGeolocation(tesla?: boolean): boolean {
  void tesla;
  return false;
}

/** easeTo CSS-transforms the GL canvas every frame and OOMs the tab. */
export function preferJumpFollow(tesla?: boolean): boolean {
  void tesla;
  return true;
}

/**
 * Paused = playhead only. Play = every current-catalog URL at this anchor
 * (`Infinity` so `radarFramesToPreload` returns the full past loop).
 */
export function radarPreloadRadius(tesla?: boolean, animate = false): number {
  void tesla;
  return animate ? Number.POSITIVE_INFINITY : 0;
}

/** Hard cap on decoded RainViewer bitmaps. Paused = 1; Play = full past loop. */
export function radarImageCacheLimitForBrowser(tesla?: boolean, animate = false): number {
  void tesla;
  return animate ? 16 : 1;
}

export function mapMaxTileCacheSize(tesla?: boolean): number {
  void tesla;
  return 8;
}

export function mapMaxTileCacheZoomLevels(): number {
  return 1;
}

export function mapMaxCanvasSize(tesla?: boolean): [number, number] {
  void tesla;
  return [2048, 2048];
}
