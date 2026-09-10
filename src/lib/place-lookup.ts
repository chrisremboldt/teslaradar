/** ~1.1 km at 2 decimals — matches PLACE_CACHE_DECIMALS. */
export const DEFAULT_PLACE_DECIMALS = 2;

export function placeLookupKey(
  lat: number,
  lon: number,
  decimals = DEFAULT_PLACE_DECIMALS,
): string {
  return `${lat.toFixed(decimals)},${lon.toFixed(decimals)}`;
}

export function coordsFromPlaceKey(key: string): { lat: number; lon: number } {
  const [latRaw, lonRaw] = key.split(",");
  return { lat: Number(latRaw), lon: Number(lonRaw) };
}

/** GPS jitter must not restart Nominatim — only a new rounded cell does. */
export function shouldRestartPlaceLookup(prevKey: string | null, nextKey: string | null): boolean {
  if (nextKey == null) return false;
  return prevKey !== nextKey;
}
