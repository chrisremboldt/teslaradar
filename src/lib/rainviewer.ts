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
 * Query `rv` is unique per frame path so Chromium cannot reuse one PNG for every frame.
 */
export function radarImageUrl(
  host: string,
  path: string,
  anchor: RadarImageAnchor,
): string {
  const lat = formatRadarCoord(anchor.lat);
  const lon = formatRadarCoord(anchor.lon);
  const bust = path.replace(/[^\w-]+/g, "") || String(anchor.zoom);
  return `${host}${path}/${anchor.size}/${anchor.zoom}/${lat}/${lon}/${RADAR_COLOR_SCHEME}/${RADAR_OPTIONS}.png?rv=${bust}`;
}

/** Integer zoom ≤7 so one 256-mercator tile covers the viewport (plus rotation pad). */
export function chooseRadarImageZoom(
  mapZoom: number,
  width: number,
  height: number,
): number {
  const cover = Math.max(Math.hypot(width, height) * 1.15, RADAR_IMAGE_SIZE);
  // Treat a RainViewer tile as 256 CSS px at matching zoom so we pick a lower z
  // (more coverage) if MapLibre's internal world is 512 px.
  const delta = Math.log2(cover / 256);
  return Math.max(0, Math.min(RADAR_MAX_NATIVE_ZOOM, Math.floor(mapZoom - delta)));
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
