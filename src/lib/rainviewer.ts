import {
  RADAR_COLOR_SCHEME,
  RADAR_OPTIONS,
  RADAR_TILE_SIZE,
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

export function radarTileTemplate(host: string, path: string): string {
  return `${host}${path}/${RADAR_TILE_SIZE}/{z}/{x}/{y}/${RADAR_COLOR_SCHEME}/${RADAR_OPTIONS}.png`;
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
