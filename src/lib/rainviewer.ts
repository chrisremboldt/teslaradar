import {
  RADAR_COLOR_SCHEME,
  RADAR_COORD_DECIMALS,
  RADAR_IMAGE_SIZE,
  RADAR_MAX_NATIVE_ZOOM,
  RADAR_OPTIONS,
  RAINVIEWER_API,
} from "@/lib/constants";
import type { RadarFrame, RainViewerCatalog } from "@/lib/types";

type RainViewerApiResponse = {
  version?: string;
  generated?: number;
  host?: string;
  radar?: {
    past?: { time: number; path: string }[];
    nowcast?: { time: number; path: string }[];
  };
};

export type RadarImageAnchor = {
  lat: number;
  lon: number;
  zoom: number;
  size: number;
};

export function roundRadarCoord(value: number): number {
  return Number(value.toFixed(RADAR_COORD_DECIMALS));
}

export function formatRadarCoord(value: number): string {
  return roundRadarCoord(value).toFixed(RADAR_COORD_DECIMALS);
}

/**
 * RainViewer coordinate-centered composite (not a MapLibre tile template).
 * `{host}{path}/{size}/{z}/{lat}/{lon}/{color}/{options}.png`
 * Frame `path` is already unique (hash/time). Do not append query strings —
 * RainViewer 404s them, which is how a cache-bust param blanked the overlay.
 */
export function radarImageUrl(
  host: string,
  path: string,
  anchor: RadarImageAnchor,
): string {
  const lat = formatRadarCoord(anchor.lat);
  const lon = formatRadarCoord(anchor.lon);
  return `${host}${path}/${anchor.size}/${anchor.zoom}/${lat}/${lon}/${RADAR_COLOR_SCHEME}/${RADAR_OPTIONS}.png`;
}

/** Integer zoom 5–7: glanceable in-car coverage, never a continent-scale tile. */
export function chooseRadarImageZoom(
  mapZoom: number,
  width: number,
  height: number,
): number {
  const cover = Math.max(Math.max(width, height) * 1.05, RADAR_IMAGE_SIZE);
  const delta = Math.log2(cover / 512);
  const computed = Math.floor(mapZoom - delta);
  return Math.max(5, Math.min(RADAR_MAX_NATIVE_ZOOM, computed));
}

export function radarImageAnchor(
  lat: number,
  lon: number,
  mapZoom: number,
  width: number,
  height: number,
): RadarImageAnchor {
  return {
    lat: roundRadarCoord(lat),
    lon: roundRadarCoord(lon),
    zoom: chooseRadarImageZoom(mapZoom, width, height),
    size: RADAR_IMAGE_SIZE,
  };
}

/** Playhead ± radius, wrapping. A non-finite radius means every frame. */
export function radarFramesToPreload<T>(frames: T[], index: number, radius: number): T[] {
  if (frames.length === 0) return [];
  if (!Number.isFinite(radius) || radius >= frames.length) return frames;
  const clamped = Math.max(0, Math.floor(radius));
  const out: T[] = [];
  const seen = new Set<number>();
  for (let delta = -clamped; delta <= clamped; delta += 1) {
    const i = ((index + delta) % frames.length + frames.length) % frames.length;
    if (seen.has(i)) continue;
    seen.add(i);
    const frame = frames[i];
    if (frame !== undefined) out.push(frame);
  }
  return out;
}

export function radarAnchorKey(host: string, anchor: RadarImageAnchor): string {
  return `${host}|${anchor.size}|${anchor.zoom}|${formatRadarCoord(anchor.lat)}|${formatRadarCoord(anchor.lon)}`;
}

function mercatorX(lon: number, worldSize: number): number {
  return ((lon + 180) / 360) * worldSize;
}

function mercatorLon(x: number, worldSize: number): number {
  return (x / worldSize) * 360 - 180;
}

/**
 * Screen-space placement for a RainViewer lat/lon image: one OSM mercator tile
 * at `zoom`, centered on the requested coords. `size` is pixel resolution only.
 */
export function radarOverlayPlacement(
  project: (lngLat: [number, number]) => { x: number; y: number },
  bearingDeg: number,
  anchor: RadarImageAnchor,
): { x: number; y: number; size: number; rotation: number } {
  const worldSize = 256 * 2 ** anchor.zoom;
  const cx = mercatorX(anchor.lon, worldSize);
  const half = 128;
  const center = project([anchor.lon, anchor.lat]);
  const east = project([mercatorLon(cx + half, worldSize), anchor.lat]);
  const radius = Math.hypot(east.x - center.x, east.y - center.y);
  return {
    x: center.x,
    y: center.y,
    size: Math.max(1, radius * 2),
    rotation: bearingDeg,
  };
}

export async function fetchRainViewerCatalog(
  signal?: AbortSignal,
): Promise<RainViewerCatalog> {
  const response = await fetch(RAINVIEWER_API, {
    signal,
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(`RainViewer catalog failed (${response.status})`);
  }
  const data = (await response.json()) as RainViewerApiResponse;
  if (!data.host || !data.radar?.past?.length) {
    throw new Error("RainViewer catalog missing radar frames");
  }
  const frames: RadarFrame[] = data.radar.past.map((frame) => ({
    time: frame.time * 1000,
    path: frame.path,
  }));
  return {
    host: data.host,
    generated: (data.generated ?? 0) * 1000,
    frames,
  };
}
