"use client";

import { useEffect, useState } from "react";
import { PLACE_CACHE_DECIMALS } from "@/lib/constants";
import { cachedPlaceLabel, reverseGeocode } from "@/lib/nominatim";

function coordKey(lat: number, lon: number): string {
  return `${lat.toFixed(PLACE_CACHE_DECIMALS)},${lon.toFixed(PLACE_CACHE_DECIMALS)}`;
}

export function useReverseGeocode(lat: number | null, lon: number | null) {
  const key = lat != null && lon != null ? coordKey(lat, lon) : null;
  const cached = lat != null && lon != null ? cachedPlaceLabel(lat, lon) : null;
  const [fetched, setFetched] = useState<{ key: string; label: string | null } | null>(null);

  useEffect(() => {
    if (lat == null || lon == null || key == null || cached) return undefined;

    const controller = new AbortController();
    const debounce = window.setTimeout(() => {
      void reverseGeocode(lat, lon, controller.signal)
        .then((label) => {
          if (!controller.signal.aborted) setFetched({ key, label });
        })
        .catch((error: unknown) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          if (!controller.signal.aborted) setFetched({ key, label: null });
        });
    }, 280);

    return () => {
      controller.abort();
      window.clearTimeout(debounce);
    };
  }, [cached, key, lat, lon]);

  if (cached) return cached;
  if (fetched && fetched.key === key) return fetched.label;
  return null;
}
