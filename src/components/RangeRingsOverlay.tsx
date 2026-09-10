"use client";

import { useEffect, useState } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { ringLabelLngLat } from "@/lib/geo";

type RangeRingsOverlayProps = {
  map: MapLibreMap;
  lon: number;
  lat: number;
  range5m: number | null;
  range30m: number | null;
};

type RingFrame = {
  x: number;
  y: number;
  r5: number;
  r30: number;
};

function projectedRadius(
  map: MapLibreMap,
  lon: number,
  lat: number,
  radiusMeters: number,
): number {
  const edge = ringLabelLngLat(lon, lat, radiusMeters);
  const center = map.project([lon, lat]);
  const rim = map.project(edge);
  return Math.hypot(rim.x - center.x, rim.y - center.y);
}

/**
 * SVG rings sit above the radar canvas (MapLibre layers would be hidden under it).
 */
export function RangeRingsOverlay({
  map,
  lon,
  lat,
  range5m,
  range30m,
}: RangeRingsOverlayProps) {
  const [frame, setFrame] = useState<RingFrame | null>(null);

  useEffect(() => {
    const update = () => {
      if (!range5m && !range30m) {
        setFrame(null);
        return;
      }
      const center = map.project([lon, lat]);
      setFrame({
        x: center.x,
        y: center.y,
        r5: range5m ? projectedRadius(map, lon, lat, range5m) : 0,
        r30: range30m ? projectedRadius(map, lon, lat, range30m) : 0,
      });
    };
    update();
    map.on("move", update);
    map.on("rotate", update);
    map.on("zoom", update);
    map.on("pitch", update);
    map.on("resize", update);
    return () => {
      map.off("move", update);
      map.off("rotate", update);
      map.off("zoom", update);
      map.off("pitch", update);
      map.off("resize", update);
    };
  }, [lat, lon, map, range30m, range5m]);

  if (!frame || (!range5m && !range30m)) return null;

  return (
    <svg
      className="range-rings-overlay"
      aria-hidden
      data-range-overlay="on"
    >
      {frame.r30 > 0 ? (
        <circle
          className="range-ring-stroke range-ring-stroke-30"
          cx={frame.x}
          cy={frame.y}
          r={frame.r30}
        />
      ) : null}
      {frame.r5 > 0 ? (
        <circle
          className="range-ring-stroke range-ring-stroke-5"
          cx={frame.x}
          cy={frame.y}
          r={frame.r5}
        />
      ) : null}
    </svg>
  );
}
