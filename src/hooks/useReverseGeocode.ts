"use client";

import { useEffect, useState } from "react";
import { PLACE_CACHE_DECIMALS } from "@/lib/constants";
import { cachedPlaceLabel, reverseGeocode } from "@/lib/nominatim";
import { coordsFromPlaceKey, placeLookupKey } from "@/lib/place-lookup";

export function useReverseGeocode(lat: number | null, lon: number | null) {
  const key = lat != null && lon != null ? placeLookupKey(lat, lon, PLACE_CACHE_DECIMALS) : null;
  const cached = lat != null && lon != null ? cachedPlaceLabel(lat, lon) : null;
  const [fetched, setFetched] = useState<{ key: string; label: string | null } | null>(null);

  useEffect(() => {
    if (key == null) return undefined;
    const cell = coordsFromPlaceKey(key);
    if (cachedPlaceLabel(cell.lat, cell.lon)) return undefined;

    const controller = new AbortController();
    const debounce = window.setTimeout(() => {
      void reverseGeocode(cell.lat, cell.lon, controller.signal)
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
    // Depend on the rounded cell only. Raw GPS ticks (~1 Hz while Following)
    // used to abort Nominatim before it could finish.
  }, [key]);

  if (cached) return cached;
  if (fetched && fetched.key === key) return fetched.label;
  return null;
}
