import { PLACE_CACHE_DECIMALS, PLACE_CACHE_STORAGE_KEY } from "@/lib/constants";
import { US_STATE_ABBREV } from "@/lib/us-states";

export type NominatimAddress = {
  city?: string;
  town?: string;
  village?: string;
  hamlet?: string;
  municipality?: string;
  city_district?: string;
  suburb?: string;
  county?: string;
  state?: string;
  country?: string;
  country_code?: string;
  "ISO3166-2-lvl4"?: string;
};

type NominatimReverseResponse = {
  address?: NominatimAddress;
  error?: string;
};

const memoryCache = new Map<string, string>();
let lastRequestAt = 0;
let hydrating = false;

function roundKey(lat: number, lon: number): string {
  return `${lat.toFixed(PLACE_CACHE_DECIMALS)},${lon.toFixed(PLACE_CACHE_DECIMALS)}`;
}

function hydrateSessionCache() {
  if (hydrating || typeof window === "undefined") return;
  hydrating = true;
  try {
    const raw = window.sessionStorage.getItem(PLACE_CACHE_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw) as Record<string, string>;
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value) memoryCache.set(key, value);
    }
  } catch {
    // ignore
  }
}

function persistSessionCache() {
  if (typeof window === "undefined") return;
  try {
    const entries = Object.fromEntries(memoryCache.entries());
    window.sessionStorage.setItem(PLACE_CACHE_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // quota / private mode
  }
}

function stateAbbrev(address: NominatimAddress): string | null {
  const iso = address["ISO3166-2-lvl4"];
  if (iso && /^US-[A-Z]{2}$/i.test(iso)) return iso.slice(3).toUpperCase();
  const name = address.state;
  if (!name) return null;
  return US_STATE_ABBREV[name] ?? (name.length <= 3 ? name.toUpperCase() : name);
}

function locality(address: NominatimAddress): string | null {
  return (
    address.city ||
    address.town ||
    address.village ||
    address.hamlet ||
    address.municipality ||
    address.city_district ||
    address.suburb ||
    address.county ||
    null
  );
}

export function formatPlaceLabel(address: NominatimAddress): string | null {
  const town = locality(address);
  const region = stateAbbrev(address);
  const countryCode = address.country_code?.toLowerCase();
  const country =
    countryCode && countryCode !== "us" && address.country ? address.country : null;

  if (town && region) return `${town}, ${region}`;
  if (town && country) return `${town}, ${country}`;
  if (town) return town;
  if (region) return region;
  return null;
}

export function cachedPlaceLabel(lat: number, lon: number): string | null {
  hydrateSessionCache();
  return memoryCache.get(roundKey(lat, lon)) ?? null;
}

function remember(lat: number, lon: number, label: string) {
  memoryCache.set(roundKey(lat, lon), label);
  persistSessionCache();
}

async function waitForRateLimit(signal?: AbortSignal) {
  const wait = Math.max(0, 1100 - (Date.now() - lastRequestAt));
  if (!wait) return;
  await new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(resolve, wait);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException("Aborted", "AbortError"));
    };
    if (signal?.aborted) {
      onAbort();
      return;
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Client-side Nominatim reverse geocode. Browsers cannot set User-Agent;
 * TeslaRadar is identified via Referer plus the query `app` param.
 * Policy: 1 req/s, cache rounded coordinates, no server proxy.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  signal?: AbortSignal,
): Promise<string | null> {
  hydrateSessionCache();
  const hit = memoryCache.get(roundKey(lat, lon));
  if (hit) return hit;

  await waitForRateLimit(signal);
  lastRequestAt = Date.now();

  const url = new URL("https://nominatim.openstreetmap.org/reverse");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("lat", String(lat));
  url.searchParams.set("lon", String(lon));
  url.searchParams.set("zoom", "10");
  url.searchParams.set("addressdetails", "1");
  url.searchParams.set("app", "TeslaRadar");

  const response = await fetch(url, {
    signal,
    headers: {
      Accept: "application/json",
      "Accept-Language": "en",
    },
  });
  if (!response.ok) return null;
  const data = (await response.json()) as NominatimReverseResponse;
  if (!data.address) return null;
  const label = formatPlaceLabel(data.address);
  if (label) remember(lat, lon, label);
  return label;
}
