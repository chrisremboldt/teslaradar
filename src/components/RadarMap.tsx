"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { JumpToOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RadarOverlay } from "@/components/RadarOverlay";
import { RangeRingsOverlay } from "@/components/RangeRingsOverlay";
import {
  MAP_DEFAULT_ZOOM,
  MAP_MAX_ZOOM,
  OSM_ATTRIBUTION,
  OSM_RASTER_TILES,
} from "@/lib/constants";
import { normalizeHeading } from "@/lib/format";
import { accuracyCircle, emptyCollection, ringLabelLngLat } from "@/lib/geo";
import type { RadarFrame } from "@/lib/types";

type RadarMapProps = {
  lat: number;
  lon: number;
  accuracy: number | null;
  /** GPS track heading for the ownship chevron. Null = no-heading look. */
  heading: number | null;
  /** Compass (or track fallback) used to rotate the map in heading-up. */
  mapHeading?: number | null;
  followMe: boolean;
  headingUp: boolean;
  radarHost: string | null;
  radarFrames: RadarFrame[];
  radarFrameIndex: number;
  range5m?: number | null;
  range30m?: number | null;
  onUserPan: () => void;
};

function applyAccuracy(
  map: MapLibreMap,
  lon: number,
  lat: number,
  accuracy: number | null,
) {
  const source = map.getSource("accuracy") as GeoJSONSource | undefined;
  if (!source) return;
  if (accuracy && accuracy > 0 && accuracy < 50_000) {
    source.setData(accuracyCircle(lon, lat, accuracy));
  } else {
    source.setData(emptyCollection());
  }
}

function placeRangeLabel(marker: Marker, lon: number, lat: number, radius: number | null | undefined) {
  const el = marker.getElement();
  const show = Boolean(radius && radius > 0);
  el.classList.toggle("is-hidden", !show);
  if (show && radius) marker.setLngLat(ringLabelLngLat(lon, lat, radius));
}

export function RadarMap({
  lat,
  lon,
  accuracy,
  heading,
  mapHeading = heading,
  followMe,
  headingUp,
  radarHost,
  radarFrames,
  radarFrameIndex,
  range5m = null,
  range30m = null,
  onUserPan,
}: RadarMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const label5Ref = useRef<Marker | null>(null);
  const label30Ref = useRef<Marker | null>(null);
  const onUserPanRef = useRef(onUserPan);
  const [map, setMap] = useState<MapLibreMap | null>(null);

  useEffect(() => {
    onUserPanRef.current = onUserPan;
  }, [onUserPan]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const mapInstance = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {
          osm: {
            type: "raster",
            tiles: OSM_RASTER_TILES,
            tileSize: 256,
            attribution: OSM_ATTRIBUTION,
          },
        },
        layers: [
          {
            id: "osm",
            type: "raster",
            source: "osm",
            paint: {
              "raster-saturation": -0.85,
              "raster-contrast": -0.15,
              "raster-brightness-min": 0,
              "raster-brightness-max": 0.38,
            },
          },
        ],
      },
      center: [lon, lat],
      zoom: MAP_DEFAULT_ZOOM,
      maxZoom: MAP_MAX_ZOOM,
      minZoom: 3,
      attributionControl: { compact: true },
      fadeDuration: 0,
      canvasContextAttributes: {
        antialias: false,
        failIfMajorPerformanceCaveat: false,
      },
    });

    const markerEl = document.createElement("div");
    markerEl.className = "tesla-location-marker";
    markerEl.innerHTML = `<span class="tesla-location-marker-pulse"></span><span class="tesla-location-marker-chevron"></span>`;
    const marker = new Marker({ element: markerEl, anchor: "center" })
      .setLngLat([lon, lat])
      .addTo(mapInstance);

    const label5El = document.createElement("div");
    label5El.className = "range-ring-label is-hidden";
    label5El.textContent = "5 min";
    const label5 = new Marker({ element: label5El, anchor: "left" })
      .setLngLat([lon, lat])
      .addTo(mapInstance);

    const label30El = document.createElement("div");
    label30El.className = "range-ring-label is-hidden";
    label30El.textContent = "30 min";
    const label30 = new Marker({ element: label30El, anchor: "left" })
      .setLngLat([lon, lat])
      .addTo(mapInstance);

    mapInstance.on("load", () => {
      mapInstance.addSource("accuracy", {
        type: "geojson",
        data: emptyCollection(),
      });
      mapInstance.addLayer({
        id: "accuracy-fill",
        type: "fill",
        source: "accuracy",
        paint: {
          "fill-color": "#3b82f6",
          "fill-opacity": 0.15,
        },
      });
      mapInstance.addLayer({
        id: "accuracy-line",
        type: "line",
        source: "accuracy",
        paint: {
          "line-color": "#60a5fa",
          "line-opacity": 0.45,
          "line-width": 1,
        },
      });
      applyAccuracy(mapInstance, lon, lat, accuracy);
      setMap(mapInstance);
    });

    mapInstance.on("dragstart", () => {
      onUserPanRef.current();
    });

    mapRef.current = mapInstance;
    markerRef.current = marker;
    label5Ref.current = label5;
    label30Ref.current = label30;

    return () => {
      setMap(null);
      marker.remove();
      label5.remove();
      label30.remove();
      mapInstance.remove();
      mapRef.current = null;
      markerRef.current = null;
      label5Ref.current = null;
      label30Ref.current = null;
    };
    // Map is created once for the session; camera updates happen in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const current = mapRef.current;
    const marker = markerRef.current;
    if (!current || !marker) return;

    marker.setLngLat([lon, lat]);
    const hasTrackHeading = heading != null;
    const rotateHeading = headingUp ? (mapHeading ?? heading) : null;
    const markerRotation = !hasTrackHeading
      ? 0
      : headingUp && rotateHeading != null
        ? normalizeHeading(heading - rotateHeading)
        : heading;
    marker.setRotation(markerRotation);
    const markerEl = marker.getElement();
    markerEl.classList.toggle("has-heading", hasTrackHeading);
    if (hasTrackHeading) {
      markerEl.dataset.trackHeading = String(Math.round(heading));
    } else {
      delete markerEl.dataset.trackHeading;
    }

    if (label5Ref.current) placeRangeLabel(label5Ref.current, lon, lat, range5m);
    if (label30Ref.current) placeRangeLabel(label30Ref.current, lon, lat, range30m);

    const apply = () => {
      applyAccuracy(current, lon, lat, accuracy);
      if (label5Ref.current) placeRangeLabel(label5Ref.current, lon, lat, range5m);
      if (label30Ref.current) placeRangeLabel(label30Ref.current, lon, lat, range30m);
      const nextBearing = headingUp && rotateHeading != null ? rotateHeading : 0;
      const camera: JumpToOptions = { bearing: nextBearing };
      if (followMe) {
        camera.center = [lon, lat];
      }
      current.jumpTo(camera);
    };

    if (current.isStyleLoaded()) apply();
    else current.once("load", apply);
  }, [accuracy, followMe, heading, headingUp, lat, lon, map, mapHeading, range5m, range30m]);

  const frame = radarFrames[radarFrameIndex] ?? radarFrames.at(-1) ?? null;

  return (
    <div
      className="relative h-full w-full"
      data-radar-index={frame ? String(radarFrameIndex) : ""}
      data-radar-path={frame?.path ?? ""}
    >
      <div ref={containerRef} className="radar-map h-full w-full" />
      {map ? (
        <RadarOverlay
          map={map}
          host={radarHost}
          frames={radarFrames}
          frameIndex={radarFrameIndex}
        />
      ) : null}
      {map ? (
        <RangeRingsOverlay
          map={map}
          lon={lon}
          lat={lat}
          range5m={range5m ?? null}
          range30m={range30m ?? null}
        />
      ) : null}
    </div>
  );
}
