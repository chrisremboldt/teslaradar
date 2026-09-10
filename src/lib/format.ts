import { normalizeEpochMs } from "@/lib/time";

export function formatLatLon(lat: number, lon: number): string {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lon >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}°${ns}  ${Math.abs(lon).toFixed(4)}°${ew}`;
}

export function formatAccuracy(meters: number | null): string {
  if (meters == null || !Number.isFinite(meters)) return "accuracy unknown";
  if (meters < 1000) return `±${Math.round(meters)} m`;
  return `±${(meters / 1000).toFixed(1)} km`;
}

export function formatClock(timestamp: number, now = Date.now()): string {
  return new Date(normalizeEpochMs(timestamp, now)).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function formatRelative(timestamp: number, now: number): string {
  const ms = normalizeEpochMs(timestamp, now);
  const delta = Math.max(0, now - ms);
  const seconds = Math.round(delta / 1000);
  if (seconds < 10) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 365) return `${days}d ago`;
  return "just now";
}

export function formatHeading(degrees: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;
  const idx = Math.round(degrees / 45) % 8;
  return `${Math.round(normalizeHeading(degrees))}° ${dirs[idx]}`;
}

export function normalizeHeading(degrees: number): number {
  return ((degrees % 360) + 360) % 360;
}

export function shortestAngleDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}
