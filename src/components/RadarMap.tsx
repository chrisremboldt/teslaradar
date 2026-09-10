"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { EaseToOptions, JumpToOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RadarOverlay } from "@/components/RadarOverlay";
import { RangeRingsOverlay } from "@/components/RangeRingsOverlay";
import {
  FOLLOW_EASE_MS,
  FOLLOW_JUMP_METERS,
  MAP_DEFAULT_ZOOM,
  MAP_MAX_ZOOM,
  OSM_ATTRIBUTION,
  OSM_RASTER_TILES,
  USER_PAN_MIN_PX,
} from "@/lib/constants";
import { isCameraOnTarget, planFollowCamera, shouldTreatAsUserPan } from "@/lib/follow-camera";
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

function publishFollowState(
  root: HTMLElement | null,
  map: MapLibreMap,
  marker: Marker | null,
) {
  if (!root) return;
  const center = map.getCenter();
  root.dataset.mapCenterLat = center.lat.toFixed(6);
  root.dataset.mapCenterLon = center.lng.toFixed(6);
  root.dataset.mapZoom = map.getZoom().toFixed(2);
  root.dataset.mapBearing = map.getBearing().toFixed(1);
  if (!marker) return;
  const mapEl = map.getContainer();
  const markerBox = marker.getElement().getBoundingClientRect();
  const mapBox = mapEl.getBoundingClientRect();
  if (mapBox.width <= 0 || mapBox.height <= 0) return;
  root.dataset.markerX = (markerBox.left + markerBox.width / 2 - mapBox.left).toFixed(1);
  root.dataset.markerY = (markerBox.top + markerBox.height / 2 - mapBox.top).toFixed(1);
  root.dataset.viewportW = mapBox.width.toFixed(1);
  root.dataset.viewportH = mapBox.height.toFixed(1);
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
  const rootRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const label5Ref = useRef<Marker | null>(null);
  const label30Ref = useRef<Marker | null>(null);
  const onUserPanRef = useRef(onUserPan);
  const programmaticMoveRef = useRef(false);
  const programmaticGenRef = useRef(0);
  const followMeRef = useRef(followMe);
  const hasFollowLockedRef = useRef(false);
  const lastOwnshipRef = useRef({ lat, lon });
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
      publishFollowState(rootRef.current, mapInstance, marker);
      setMap(mapInstance);
    });

    const publish = () => {
      publishFollowState(rootRef.current, mapInstance, markerRef.current);
    };
    mapInstance.on("move", publish);
    mapInstance.on("moveend", publish);

    let dragStartLngLat: { lat: number; lng: number } | null = null;
    const rememberDragStart = () => {
      if (programmaticMoveRef.current) return;
      dragStartLngLat = mapInstance.getCenter();
    };
    const maybeUserPan = (event: { originalEvent?: Event }) => {
      const startLngLat = dragStartLngLat;
      if (!startLngLat) return;
      const start = mapInstance.project(startLngLat);
      const end = mapInstance.project(mapInstance.getCenter());
      if (
        shouldTreatAsUserPan({
          programmatic: programmaticMoveRef.current,
          hasOriginalEvent: Boolean(event.originalEvent),
          start: { x: start.x, y: start.y },
          end: { x: end.x, y: end.y },
          minPixels: USER_PAN_MIN_PX,
        })
      ) {
        onUserPanRef.current();
      }
    };
    mapInstance.on("dragstart", rememberDragStart);
    mapInstance.on("drag", maybeUserPan);
    mapInstance.on("dragend", maybeUserPan);

    window.__TESLARADAR_MAP__ = mapInstance;

    mapRef.current = mapInstance;
    markerRef.current = marker;
    label5Ref.current = label5;
    label30Ref.current = label30;

    return () => {
      if (window.__TESLARADAR_MAP__ === mapInstance) {
        delete window.__TESLARADAR_MAP__;
      }
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
      const mapCenter = current.getCenter();
      const followJustEnabled = followMe && !followMeRef.current;
      const firstLock = followMe && !hasFollowLockedRef.current;
      const positionChanged =
        lastOwnshipRef.current.lat !== lat || lastOwnshipRef.current.lon !== lon;
      const plan = planFollowCamera({
        followMe,
        ownship: { lat, lon },
        mapCenter: { lat: mapCenter.lat, lon: mapCenter.lng },
        bearing: nextBearing,
        firstLock,
        positionChanged,
        followJustEnabled,
        jumpMeters: FOLLOW_JUMP_METERS,
      });
      const camera: JumpToOptions & EaseToOptions = { bearing: plan.bearing };
      if (plan.center) camera.center = plan.center;

      const alreadyThere = isCameraOnTarget({
        mapCenter: { lat: mapCenter.lat, lon: mapCenter.lng },
        mapBearing: current.getBearing(),
        plan,
      });
      if (!alreadyThere) {
        const gen = programmaticGenRef.current + 1;
        programmaticGenRef.current = gen;
        programmaticMoveRef.current = true;
        const clearProgrammatic = () => {
          if (programmaticGenRef.current === gen) programmaticMoveRef.current = false;
        };
        current.once("moveend", clearProgrammatic);
        window.setTimeout(clearProgrammatic, (plan.mode === "ease" ? FOLLOW_EASE_MS : 0) + 80);

        if (plan.mode === "ease") {
          current.stop();
          current.easeTo({ ...camera, duration: FOLLOW_EASE_MS, essential: true });
        } else {
          current.jumpTo(camera);
        }
      }

      followMeRef.current = followMe;
      lastOwnshipRef.current = { lat, lon };
      if (followMe) hasFollowLockedRef.current = true;
      publishFollowState(rootRef.current, current, marker);
    };

    // Do not gate on isStyleLoaded() — it goes false while OSM tiles or the
    // accuracy source are loading, which skipped jumpTo/easeTo and left the
    // chevron walking up a stuck map. Marker updates above always ran.
    apply();
  }, [accuracy, followMe, heading, headingUp, lat, lon, map, mapHeading, range5m, range30m]);

  const frame = radarFrames[radarFrameIndex] ?? radarFrames.at(-1) ?? null;

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full"
      data-map-root="true"
      data-follow-camera={followMe ? "on" : "off"}
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
