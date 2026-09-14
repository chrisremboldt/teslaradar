"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { JumpToOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { RadarOverlay } from "@/components/RadarOverlay";
import { RangeRingsOverlay } from "@/components/RangeRingsOverlay";
import {
  FOLLOW_BEARING_MIN_DEG,
  FOLLOW_JUMP_METERS,
  FOLLOW_JUMP_MIN_MS,
  MAP_DEFAULT_ZOOM,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  OSM_ATTRIBUTION,
  OSM_RASTER_TILES,
  USER_PAN_MIN_PX,
} from "@/lib/constants";
import {
  isCameraOnTarget,
  planFollowCamera,
  shouldApplyFollowJump,
  shouldTreatAsUserPan,
  shortestBearingDelta,
} from "@/lib/follow-camera";
import { isSubpixelCameraHop } from "@/lib/overlay-draw";
import { normalizeHeading } from "@/lib/format";
import { accuracyCircle, emptyCollection, ringLabelLngLat } from "@/lib/geo";
import {
  mapMaxCanvasSize,
  mapMaxTileCacheSize,
  mapMaxTileCacheZoomLevels,
  mapPixelRatioForBrowser,
} from "@/lib/tesla-browser";
import type { RadarFrame } from "@/lib/types";

function bindTestMapHandle(map: MapLibreMap | null) {
  if (map) {
    window.__TESLARADAR_MAP__ = map;
    return;
  }
  delete window.__TESLARADAR_MAP__;
}

type RadarMapProps = {
  lat: number;
  lon: number;
  accuracy: number | null;
  /** GPS track heading for the ownship chevron. Null = no-heading look. */
  heading: number | null;
  /** Track heading used to rotate the map in heading-up. */
  mapHeading?: number | null;
  followMe: boolean;
  headingUp: boolean;
  animateRadar?: boolean;
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
  animateRadar = false,
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
  const followApplyAtRef = useRef<number | null>(null);
  const followTimerRef = useRef(0);
  const latestRef = useRef({
    lat,
    lon,
    accuracy,
    heading,
    mapHeading,
    followMe,
    headingUp,
    range5m,
    range30m,
  });
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const [mapError, setMapError] = useState<string | null>(null);
  const [zoom, setZoom] = useState(MAP_DEFAULT_ZOOM);

  useEffect(() => {
    onUserPanRef.current = onUserPan;
  }, [onUserPan]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const pixelRatio = mapPixelRatioForBrowser();
    let mapInstance: MapLibreMap;
    try {
      mapInstance = new MapLibreMap({
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
        minZoom: MAP_MIN_ZOOM,
        attributionControl: { compact: true },
        fadeDuration: 0,
        validateStyle: false,
        pixelRatio,
        maxPitch: 0,
        pitchWithRotate: false,
        renderWorldCopies: false,
        refreshExpiredTiles: false,
        maxTileCacheSize: mapMaxTileCacheSize(),
        maxTileCacheZoomLevels: mapMaxTileCacheZoomLevels(),
        maxCanvasSize: mapMaxCanvasSize(),
        canvasContextAttributes: {
          antialias: false,
          failIfMajorPerformanceCaveat: false,
          preserveDrawingBuffer: false,
          powerPreference: "low-power",
        },
      });
    } catch {
      window.setTimeout(() => {
        setMapError("Map failed to start in this browser.");
      }, 0);
      return;
    }

    const glCanvas = mapInstance.getCanvas();
    const onContextLost = (event: Event) => {
      event.preventDefault();
      rootRef.current?.setAttribute("data-webgl", "lost");
    };
    glCanvas.addEventListener("webglcontextlost", onContextLost);

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

    let publishRaf = 0;
    const publish = () => {
      if (publishRaf) return;
      publishRaf = window.requestAnimationFrame(() => {
        publishRaf = 0;
        publishFollowState(rootRef.current, mapInstance, markerRef.current);
      });
    };
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

    bindTestMapHandle(mapInstance);

    mapRef.current = mapInstance;
    markerRef.current = marker;
    label5Ref.current = label5;
    label30Ref.current = label30;

    return () => {
      if (publishRaf) window.cancelAnimationFrame(publishRaf);
      glCanvas.removeEventListener("webglcontextlost", onContextLost);
      if (window.__TESLARADAR_MAP__ === mapInstance) {
        bindTestMapHandle(null);
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

    latestRef.current = {
      lat,
      lon,
      accuracy,
      heading,
      mapHeading,
      followMe,
      headingUp,
      range5m,
      range30m,
    };

    const applyMarkerAndCamera = (forceCamera: boolean) => {
      const snap = latestRef.current;
      marker.setLngLat([snap.lon, snap.lat]);
      const headingDeg = snap.heading;
      const hasTrackHeading = headingDeg != null;
      const rotateHeading = snap.headingUp ? (snap.mapHeading ?? headingDeg) : null;
      const markerRotation =
        headingDeg == null
          ? 0
          : snap.headingUp && rotateHeading != null
            ? normalizeHeading(headingDeg - rotateHeading)
            : headingDeg;
      marker.setRotation(markerRotation);
      const markerEl = marker.getElement();
      markerEl.classList.toggle("has-heading", hasTrackHeading);
      if (headingDeg != null) {
        markerEl.dataset.trackHeading = String(Math.round(headingDeg));
      } else {
        delete markerEl.dataset.trackHeading;
      }

      if (label5Ref.current) placeRangeLabel(label5Ref.current, snap.lon, snap.lat, snap.range5m);
      if (label30Ref.current) placeRangeLabel(label30Ref.current, snap.lon, snap.lat, snap.range30m);

      applyAccuracy(current, snap.lon, snap.lat, snap.accuracy);
      const nextBearing = snap.headingUp && rotateHeading != null ? rotateHeading : 0;
      const mapCenter = current.getCenter();
      const followJustEnabled = snap.followMe && !followMeRef.current;
      const firstLock = snap.followMe && !hasFollowLockedRef.current;
      const positionChanged =
        lastOwnshipRef.current.lat !== snap.lat || lastOwnshipRef.current.lon !== snap.lon;
      const plan = planFollowCamera({
        followMe: snap.followMe,
        ownship: { lat: snap.lat, lon: snap.lon },
        mapCenter: { lat: mapCenter.lat, lon: mapCenter.lng },
        bearing: nextBearing,
        firstLock,
        positionChanged,
        followJustEnabled,
        jumpMeters: FOLLOW_JUMP_METERS,
        preferJump: true,
      });
      const camera: JumpToOptions = { bearing: plan.bearing };
      if (plan.center) camera.center = plan.center;

      const alreadyThere = isCameraOnTarget({
        mapCenter: { lat: mapCenter.lat, lon: mapCenter.lng },
        mapBearing: current.getBearing(),
        plan,
      });
      const skipSubpixel =
        !firstLock &&
        !followJustEnabled &&
        plan.center != null &&
        isSubpixelCameraHop(
          current.project([mapCenter.lng, mapCenter.lat]),
          current.project(plan.center),
        );
      const now = performance.now();
      const allowCamera = shouldApplyFollowJump({
        now,
        lastApplyAt: followApplyAtRef.current,
        firstLock,
        followJustEnabled,
        positionChanged,
        bearingDeltaDeg: shortestBearingDelta(current.getBearing(), nextBearing),
        minIntervalMs: FOLLOW_JUMP_MIN_MS,
        minBearingDeg: FOLLOW_BEARING_MIN_DEG,
        force: forceCamera,
      });

      if (!allowCamera) {
        if (followTimerRef.current) window.clearTimeout(followTimerRef.current);
        const elapsed = followApplyAtRef.current == null ? FOLLOW_JUMP_MIN_MS : now - followApplyAtRef.current;
        followTimerRef.current = window.setTimeout(() => {
          followTimerRef.current = 0;
          applyMarkerAndCamera(true);
        }, Math.max(0, FOLLOW_JUMP_MIN_MS - elapsed));
      } else if (!alreadyThere && !skipSubpixel) {
        const gen = programmaticGenRef.current + 1;
        programmaticGenRef.current = gen;
        programmaticMoveRef.current = true;
        const clearProgrammatic = () => {
          if (programmaticGenRef.current === gen) programmaticMoveRef.current = false;
        };
        current.once("moveend", clearProgrammatic);
        window.setTimeout(clearProgrammatic, 80);
        current.jumpTo(camera);
        followApplyAtRef.current = now;
      } else {
        followApplyAtRef.current = now;
      }

      followMeRef.current = snap.followMe;
      lastOwnshipRef.current = { lat: snap.lat, lon: snap.lon };
      if (snap.followMe) hasFollowLockedRef.current = true;
      publishFollowState(rootRef.current, current, marker);
    };

    applyMarkerAndCamera(false);
    return () => {
      if (followTimerRef.current) {
        window.clearTimeout(followTimerRef.current);
        followTimerRef.current = 0;
      }
    };
  }, [accuracy, followMe, heading, headingUp, lat, lon, map, mapHeading, range5m, range30m]);

  useEffect(() => {
    if (!map) return;
    const syncZoom = () => setZoom(map.getZoom());
    syncZoom();
    map.on("zoomend", syncZoom);
    return () => {
      map.off("zoomend", syncZoom);
    };
  }, [map]);

  const atMinZoom = zoom <= MAP_MIN_ZOOM + 0.01;
  const atMaxZoom = zoom >= MAP_MAX_ZOOM - 0.01;

  const frame = radarFrames[radarFrameIndex] ?? radarFrames.at(-1) ?? null;

  return (
    <div
      ref={rootRef}
      className="relative h-full w-full"
      data-map-root="true"
      data-follow-camera={followMe ? "on" : "off"}
      data-tesla-browser="on"
      data-lean-runtime="on"
      data-map-pixel-ratio={String(mapPixelRatioForBrowser())}
      data-tile-cache={String(mapMaxTileCacheSize())}
      data-follow-jump-ms={String(FOLLOW_JUMP_MIN_MS)}
      data-radar-index={frame ? String(radarFrameIndex) : ""}
      data-radar-path={frame?.path ?? ""}
      data-animate-radar={animateRadar ? "on" : "off"}
    >
      <div ref={containerRef} className="radar-map h-full w-full" />
      {mapError ? (
        <div className="absolute inset-0 grid place-items-center bg-[#0b0d10] px-6 text-center text-sm text-zinc-400">
          {mapError}
        </div>
      ) : null}
      {map ? (
        <RadarOverlay
          map={map}
          host={radarHost}
          frames={radarFrames}
          frameIndex={radarFrameIndex}
          animate={animateRadar}
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
      {map ? (
        <div className="map-zoom" data-map-zoom-controls="">
          <button
            type="button"
            className="map-zoom-btn"
            aria-label="Zoom in"
            disabled={atMaxZoom}
            onClick={() => map.zoomIn({ duration: 0 })}
          >
            +
          </button>
          <button
            type="button"
            className="map-zoom-btn"
            aria-label="Zoom out"
            disabled={atMinZoom}
            onClick={() => map.zoomOut({ duration: 0 })}
          >
            −
          </button>
        </div>
      ) : null}
    </div>
  );
}
