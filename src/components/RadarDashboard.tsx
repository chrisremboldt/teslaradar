"use client";

import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { CompassBadge } from "@/components/CompassBadge";
import { useCompass } from "@/hooks/useCompass";
import { useGeolocation } from "@/hooks/useGeolocation";
import { usePreferences } from "@/hooks/usePreferences";
import { useRainViewer } from "@/hooks/useRainViewer";
import { useReverseGeocode } from "@/hooks/useReverseGeocode";
import { useOwnshipTrack } from "@/hooks/useOwnshipTrack";
import { LOCATION_POLL_MS, NOMINATIM_ATTRIBUTION } from "@/lib/constants";
import {
  formatAccuracy,
  formatClock,
  formatLatLon,
  formatRelative,
} from "@/lib/format";
import type { LocationErrorKind, LocationSource } from "@/lib/types";

const RadarMap = dynamic(
  () => import("@/components/RadarMap").then((mod) => mod.RadarMap),
  {
    ssr: false,
    loading: () => <div className="h-full w-full bg-[#0b0d10]" />,
  },
);

function sourceLabel(source: LocationSource): string {
  if (source === "gps") return "GPS";
  if (source === "cached") return "Cached GPS";
  return "DEMO";
}

function errorCopy(kind: LocationErrorKind): { title: string; body: string } {
  if (kind === "denied") {
    return {
      title: "Location permission denied",
      body: "TeslaRadar stays in your browser and never uploads coordinates. Allow location, or view a labeled DEMO city.",
    };
  }
  if (kind === "unsupported") {
    return {
      title: "Geolocation unavailable",
      body: "This browser does not expose navigator.geolocation. Showing a labeled DEMO map instead.",
    };
  }
  if (kind === "timeout") {
    return {
      title: "Location timed out",
      body: "GPS did not respond in time. Retry, or keep the DEMO map if you just want radar.",
    };
  }
  return {
    title: "Location unavailable",
    body: "Chromium could not read a position. Retry, or use a labeled DEMO city.",
  };
}

export function RadarDashboard() {
  const searchParams = useSearchParams();
  const simulatedHeading = useMemo(() => {
    const raw = searchParams.get("heading");
    if (raw == null || raw === "") return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  }, [searchParams]);

  const { prefs, update } = usePreferences();
  const { fix, error, isRefreshing, hasResolved, refresh, applyDemo } = useGeolocation({
    continuous: prefs.followMe,
  });
  const radar = useRainViewer(prefs.animateRadar);
  const compass = useCompass(simulatedHeading);
  const ownship = useOwnshipTrack(fix);
  const trackHeading = ownship.heading;
  const place = useReverseGeocode(fix?.lat ?? null, fix?.lon ?? null);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const mapHeading = compass.heading ?? trackHeading;
  const headingUpActive = prefs.headingUp && mapHeading != null;
  const showError =
    Boolean(error) && (fix?.source === "demo" || fix?.source === "cached" || !fix);
  const placeLabel = place ?? (fix ? formatLatLon(fix.lat, fix.lon) : null);
  const latestFrame = radar.frames.at(-1) ?? null;
  const latestClock = latestFrame ? formatClock(latestFrame.time) : null;
  const latestAge = latestFrame ? formatRelative(latestFrame.time, now) : null;

  return (
    <div className="relative h-dvh w-full overflow-hidden bg-[#0b0d10] text-zinc-100">
      {fix ? (
        <RadarMap
          lat={fix.lat}
          lon={fix.lon}
          accuracy={fix.accuracy}
          heading={trackHeading}
          mapHeading={mapHeading}
          range5m={ownship.range5m}
          range30m={ownship.range30m}
          followMe={prefs.followMe}
          headingUp={headingUpActive}
          radarHost={radar.catalog?.host ?? null}
          radarFrames={radar.frames}
          radarFrameIndex={radar.frameIndex}
          onUserPan={() => {
            if (prefs.followMe) update({ followMe: false });
          }}
        />
      ) : (
        <div className="grid h-full place-items-center px-6 text-center">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-red-400">TeslaRadar</p>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight">
              {hasResolved ? "No position yet" : "Locating…"}
            </h1>
            <p className="mt-2 max-w-sm text-sm text-zinc-400">
              Requesting Chromium geolocation. Last GPS is restored from this device if
              you have been here before.
            </p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 bg-gradient-to-b from-black/80 via-black/35 to-transparent pt-[max(0.75rem,env(safe-area-inset-top))]">
        <header className="pointer-events-auto mx-auto flex w-full max-w-xl flex-col gap-3 px-3 pb-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-red-400">
                TeslaRadar
              </p>
              <h1 className="text-xl font-semibold tracking-tight">Live weather radar</h1>
            </div>
            {fix ? (
              <span
                className={`rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide ${
                  fix.source === "demo"
                    ? "bg-amber-400 text-black"
                    : "bg-emerald-500/20 text-emerald-300"
                }`}
              >
                {sourceLabel(fix.source)}
              </span>
            ) : null}
          </div>

          {fix ? (
            <div
              className="rounded-2xl border border-white/10 bg-black/55 px-3 py-2.5 backdrop-blur-md"
              data-place={placeLabel ?? ""}
              data-relative={formatRelative(fix.timestamp, now)}
              data-lat={String(fix.lat)}
              data-lon={String(fix.lon)}
              data-track-heading={trackHeading == null ? "" : String(Math.round(trackHeading))}
              data-speed-mps={ownship.speedMps == null ? "" : ownship.speedMps.toFixed(2)}
              data-range-5={ownship.range5m == null ? "" : String(Math.round(ownship.range5m))}
              data-range-30={ownship.range30m == null ? "" : String(Math.round(ownship.range30m))}
            >
              <p className="text-lg font-semibold tracking-tight">{placeLabel}</p>
              <p className="mt-0.5 font-mono text-[11px] tracking-wide text-zinc-500">
                {formatLatLon(fix.lat, fix.lon)}
              </p>
              <p className="mt-1 text-xs text-zinc-400">
                {formatAccuracy(fix.accuracy)}
                {" · "}
                Updated {formatClock(fix.timestamp)}
                {" · "}
                {formatRelative(fix.timestamp, now)}
              </p>
              {fix.source === "demo" ? (
                <p className="mt-1 text-xs font-medium text-amber-300">
                  DEMO — {fix.demoLabel ?? "sample city"} (not your live position)
                </p>
              ) : null}
              {fix.source === "cached" ? (
                <p className="mt-1 text-xs text-sky-300">
                  Showing last GPS while a fresh fix arrives.
                </p>
              ) : null}
            </div>
          ) : null}

          {showError && error ? (
            <div className="rounded-2xl border border-amber-400/30 bg-amber-500/10 px-3 py-3">
              <p className="text-sm font-semibold text-amber-200">{errorCopy(error).title}</p>
              <p className="mt-1 text-xs leading-relaxed text-amber-100/80">
                {errorCopy(error).body}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" className="hud-btn" onClick={refresh}>
                  Retry location
                </button>
                <button type="button" className="hud-btn" onClick={() => applyDemo("nashville")}>
                  DEMO Nashville
                </button>
                <button type="button" className="hud-btn" onClick={() => applyDemo("traverse")}>
                  DEMO Traverse City
                </button>
              </div>
            </div>
          ) : null}
        </header>
      </div>

      {compass.heading != null &&
      (compass.status === "available" || compass.status === "simulated") ? (
        <div className="pointer-events-none absolute right-3 top-[min(42vh,22rem)] z-10">
          <CompassBadge heading={compass.heading} status={compass.status} />
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-gradient-to-t from-black/85 via-black/40 to-transparent pb-[max(0.85rem,env(safe-area-inset-bottom))] pt-10">
        <div className="pointer-events-auto mx-auto flex w-full max-w-xl flex-col gap-3 px-3">
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="hud-btn hud-btn-primary"
              onClick={() => {
                refresh();
                void radar.reload();
              }}
              disabled={isRefreshing}
            >
              {isRefreshing ? "Refreshing…" : "Refresh now"}
            </button>
            <button
              type="button"
              className={`hud-btn ${prefs.animateRadar ? "hud-btn-on" : ""}`}
              onClick={() => update({ animateRadar: !prefs.animateRadar })}
              disabled={!radar.frames.length}
            >
              {prefs.animateRadar ? "Pause radar" : "Play radar"}
            </button>
            <button
              type="button"
              className={`hud-btn ${prefs.followMe ? "hud-btn-on" : ""}`}
              aria-pressed={prefs.followMe}
              data-follow-me={prefs.followMe ? "on" : "off"}
              onClick={() => update({ followMe: !prefs.followMe })}
            >
              {prefs.followMe ? "Following" : "Follow me"}
            </button>
            <button
              type="button"
              className={`hud-btn ${headingUpActive ? "hud-btn-on" : ""}`}
              onClick={() => update({ headingUp: !prefs.headingUp })}
              disabled={mapHeading == null}
              title={
                mapHeading == null
                  ? "Heading-up needs a compass or GPS track heading"
                  : compass.heading == null
                    ? "Toggle heading-up vs north-up (GPS track)"
                    : "Toggle heading-up vs north-up"
              }
            >
              {headingUpActive ? "Heading-up" : "North-up"}
            </button>
            {compass.status === "needs-permission" ? (
              <button
                type="button"
                className="hud-btn"
                onClick={() => void compass.requestPermission()}
              >
                Enable compass
              </button>
            ) : null}
          </div>

          <div className="flex items-end justify-between gap-3 text-[11px] text-zinc-500">
            <div className="min-w-0">
              <p
                data-radar-index={radar.frame ? String(radar.frameIndex) : ""}
                data-radar-path={radar.frame?.path ?? ""}
              >
                {radar.frame
                  ? `Radar ${formatClock(radar.frame.time)} · ${radar.frameIndex + 1}/${radar.frames.length || 1}`
                  : radar.isLoading
                    ? "Loading RainViewer…"
                    : (radar.error ?? "No radar frames")}
                {" · "}
                Location poll {LOCATION_POLL_MS / 60000} min
                {trackHeading != null ? (
                  <span className="text-zinc-600">
                    {" "}
                    · track {Math.round(trackHeading)}°
                  </span>
                ) : null}
                {ownship.range5m != null && ownship.range30m != null ? (
                  <span className="text-zinc-600"> · 5 / 30 min rings</span>
                ) : null}
                {compass.status === "unavailable" || compass.status === "unknown" ? (
                  <span className="text-zinc-600"> · compass unavailable</span>
                ) : null}
              </p>
              {latestFrame && latestClock && latestAge ? (
                <p
                  className="mt-0.5 text-[10px] tabular-nums text-zinc-600"
                  title="Newest RainViewer past frame — data freshness, not the playhead"
                  data-radar-latest={String(latestFrame.time)}
                  data-radar-latest-clock={latestClock}
                  data-radar-latest-age={latestAge}
                >
                  Latest {latestClock} · {latestAge}
                </p>
              ) : null}
            </div>
            <p className="max-w-[14rem] text-right leading-relaxed">
              Radar by{" "}
              <a
                className="underline decoration-white/20 underline-offset-2"
                href="https://www.rainviewer.com/api.html"
                target="_blank"
                rel="noreferrer"
              >
                RainViewer
              </a>
              {" · "}
              {NOMINATIM_ATTRIBUTION}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
