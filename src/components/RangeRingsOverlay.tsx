"use client";

import { useLayoutEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { ringLabelLngLat } from "@/lib/geo";

type RangeRingsOverlayProps = {
  map: MapLibreMap;
  lon: number;
  lat: number;
  range5m: number | null;
  range30m: number | null;
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

function writeCircle(
  el: SVGCircleElement | null,
  x: number,
  y: number,
  radius: number,
) {
  if (!el || radius <= 0) return;
  el.setAttribute("cx", x.toFixed(1));
  el.setAttribute("cy", y.toFixed(1));
  el.setAttribute("r", radius.toFixed(1));
}

/**
 * SVG rings sit above the radar canvas (MapLibre layers would be hidden under it).
 * Position updates are imperative — no React setState on every map `move`.
 * Lean path only listens to settle/resize/zoomend.
 */
export function RangeRingsOverlay({
  map,
  lon,
  lat,
  range5m,
  range30m,
}: RangeRingsOverlayProps) {
  const c5Ref = useRef<SVGCircleElement>(null);
  const c30Ref = useRef<SVGCircleElement>(null);
  const visible = Boolean(range5m || range30m);

  useLayoutEffect(() => {
    if (!visible) return;
    let raf = 0;

    const update = () => {
      const center = map.project([lon, lat]);
      writeCircle(
        c5Ref.current,
        center.x,
        center.y,
        range5m ? projectedRadius(map, lon, lat, range5m) : 0,
      );
      writeCircle(
        c30Ref.current,
        center.x,
        center.y,
        range30m ? projectedRadius(map, lon, lat, range30m) : 0,
      );
    };

    const schedule = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        update();
      });
    };

    update();
    map.on("moveend", schedule);
    map.on("zoomend", schedule);
    map.on("resize", schedule);
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      map.off("moveend", schedule);
      map.off("zoomend", schedule);
      map.off("resize", schedule);
    };
  }, [lat, lon, map, range30m, range5m, visible]);

  if (!visible) return null;

  return (
    <svg
      className="range-rings-overlay"
      aria-hidden
      data-range-overlay="on"
    >
      {range30m ? (
        <circle
          ref={c30Ref}
          className="range-ring-stroke range-ring-stroke-30"
          cx="0"
          cy="0"
          r="0"
        />
      ) : null}
      {range5m ? (
        <circle
          ref={c5Ref}
          className="range-ring-stroke range-ring-stroke-5"
          cx="0"
          cy="0"
          r="0"
        />
      ) : null}
    </svg>
  );
}
