import {
  RADAR_COLOR_SCHEME,
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

/** ~111 m — enough to absorb GPS jitter without refetching every tick. */
export function quantizeRadarCoord(value: number): number {
  return Math.round(value * 1000) / 1000;
}

export function radarOverlayZoom(mapZoom: number): number {
  return Math.max(0, Math.min(RADAR_MAX_NATIVE_ZOOM, Math.round(mapZoom)));
}

/**
 * Coordinate-centered RainViewer composite (not an XYZ tile).
 * `{host}{path}/{size}/{z}/{lat}/{lon}/{color}/{options}.png`
 */
export function radarImageUrl(
  host: string,
  path: string,
  lat: number,
  lon: number,
  zoom: number,
  size: number = RADAR_IMAGE_SIZE,
): string {
  const z = radarOverlayZoom(zoom);
  const qLat = quantizeRadarCoord(lat);
  const qLon = quantizeRadarCoord(lon);
  return `${host}${path}/${size}/${z}/${qLat}/${qLon}/${RADAR_COLOR_SCHEME}/${RADAR_OPTIONS}.png`;
}

export function lngLatToMercatorPx(
  lng: number,
  lat: number,
  zoom: number,
  tileSize = 256,
): { x: number; y: number } {
  const scale = tileSize * 2 ** zoom;
  const x = ((lng + 180) / 360) * scale;
  const sin = Math.min(Math.max(Math.sin((lat * Math.PI) / 180), -0.9999), 0.9999);
  const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * scale;
  return { x, y };
}

export function mercatorPxToLngLat(
  x: number,
  y: number,
  zoom: number,
  tileSize = 256,
): [number, number] {
  const scale = tileSize * 2 ** zoom;
  const lng = (x / scale) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * y) / scale;
  const lat = (180 / Math.PI) * Math.atan(Math.sinh(n));
  return [lng, lat];
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
