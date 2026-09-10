"use client";

import { useEffect, useRef, useState } from "react";
import { GeoJSONSource, Map as MapLibreMap, Marker } from "maplibre-gl";
import type { JumpToOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  MAP_DEFAULT_ZOOM,
  MAP_MAX_ZOOM,
  OSM_ATTRIBUTION,
  OSM_RASTER_TILES,
  RADAR_IMAGE_SIZE,
  RADAR_LAYER_OPACITY,
} from "@/lib/constants";
import { accuracyCircle, emptyCollection } from "@/lib/geo";
import {
  lngLatToMercatorPx,
  mercatorPxToLngLat,
  quantizeRadarCoord,
  radarImageUrl,
  radarOverlayZoom,
} from "@/lib/rainviewer";
import type { RadarFrame } from "@/lib/types";

type RadarMapProps = {
  lat: number;
  lon: number;
  accuracy: number | null;
  heading: number | null;
  followMe: boolean;
  headingUp: boolean;
  radarHost: string | null;
  radarFrames: RadarFrame[];
  radarFrameIndex: number;
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

function sizeOverlayCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
  const dpr = window.devicePixelRatio || 1;
  const nextW = Math.max(1, Math.round(width * dpr));
  const nextH = Math.max(1, Math.round(height * dpr));
  if (canvas.width !== nextW || canvas.height !== nextH) {
    canvas.width = nextW;
    canvas.height = nextH;
  }
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
}

/**
 * Draw a north-up RainViewer composite so it stays georegistered on the
 * basemap, including heading-up (rotate with map bearing). MapLibre raster
 * tile animation is intentionally not used — setTiles / dual-layer crossfade
 * stays frozen on iPhone Safari and Tesla Chromium.
 */
function paintRadarFrame(
  canvas: HTMLCanvasElement,
  map: MapLibreMap,
  image: HTMLImageElement,
  lat: number,
  lon: number,
  radarZoom: number,
) {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const cssWidth = canvas.clientWidth || map.getContainer().clientWidth;
  const cssHeight = canvas.clientHeight || map.getContainer().clientHeight;
  sizeOverlayCanvas(canvas, cssWidth, cssHeight);

  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const qLat = quantizeRadarCoord(lat);
  const qLon = quantizeRadarCoord(lon);
  const origin = lngLatToMercatorPx(qLon, qLat, radarZoom);
  const [eastLng, eastLat] = mercatorPxToLngLat(
    origin.x + RADAR_IMAGE_SIZE / 2,
    origin.y,
    radarZoom,
  );
  const center = map.project([qLon, qLat]);
  const east = map.project([eastLng, eastLat]);
  const displayHalf = Math.hypot(east.x - center.x, east.y - center.y);
  if (!Number.isFinite(displayHalf) || displayHalf < 2) return;

  const displaySize = displayHalf * 2;
  const bearing = map.getBearing();

  ctx.save();
  ctx.translate(center.x, center.y);
  ctx.rotate((bearing * Math.PI) / 180);
  ctx.globalAlpha = RADAR_LAYER_OPACITY;
  ctx.drawImage(image, -displaySize / 2, -displaySize / 2, displaySize, displaySize);
  ctx.restore();
}

export function RadarMap({
  lat,
  lon,
  accuracy,
  heading,
  followMe,
  headingUp,
  radarHost,
  radarFrames,
  radarFrameIndex,
  onUserPan,
}: RadarMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onUserPanRef = useRef(onUserPan);
  const imagesRef = useRef(new Map<string, HTMLImageElement>());
  const drawRef = useRef<() => void>(() => {});
  const [mapReady, setMapReady] = useState(false);
  const [radarZoom, setRadarZoom] = useState(() => radarOverlayZoom(MAP_DEFAULT_ZOOM));

  const frame = radarFrames[radarFrameIndex] ?? radarFrames.at(-1) ?? null;
  const frameUrl =
    radarHost && frame
      ? radarImageUrl(radarHost, frame.path, lat, lon, radarZoom)
      : null;

  useEffect(() => {
    onUserPanRef.current = onUserPan;
  }, [onUserPan]);

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;

    const map = new MapLibreMap({
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
      .addTo(map);

    map.on("load", () => {
      map.addSource("accuracy", {
        type: "geojson",
        data: emptyCollection(),
      });
      map.addLayer({
        id: "accuracy-fill",
        type: "fill",
        source: "accuracy",
        paint: {
          "fill-color": "#3b82f6",
          "fill-opacity": 0.15,
        },
      });
      map.addLayer({
        id: "accuracy-line",
        type: "line",
        source: "accuracy",
        paint: {
          "line-color": "#60a5fa",
          "line-opacity": 0.45,
          "line-width": 1,
        },
      });
      applyAccuracy(map, lon, lat, accuracy);
      setRadarZoom(radarOverlayZoom(map.getZoom()));
      setMapReady(true);
    });

    map.on("dragstart", () => {
      onUserPanRef.current();
    });

    const overlay = document.createElement("canvas");
    overlay.className = "radar-image-overlay";
    overlay.setAttribute("aria-hidden", "true");
    containerRef.current.appendChild(overlay);
    overlayRef.current = overlay;

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
      overlayRef.current = null;
      setMapReady(false);
    };
    // Map is created once for the session; camera updates happen in the effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    const marker = markerRef.current;
    if (!map || !marker) return;

    marker.setLngLat([lon, lat]);
    const markerHeading = headingUp ? 0 : (heading ?? 0);
    marker.setRotation(heading != null ? markerHeading : 0);
    marker.getElement().classList.toggle("has-heading", heading != null);

    const apply = () => {
      applyAccuracy(map, lon, lat, accuracy);
      const nextBearing = headingUp && heading != null ? heading : 0;
      const camera: JumpToOptions = { bearing: nextBearing };
      if (followMe) {
        camera.center = [lon, lat];
      }
      map.jumpTo(camera);
    };

    if (map.isStyleLoaded()) apply();
    else map.once("load", apply);
  }, [accuracy, followMe, heading, headingUp, lat, lon]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    const syncZoom = () => setRadarZoom(radarOverlayZoom(map.getZoom()));
    const redraw = () => drawRef.current();
    map.on("zoomend", syncZoom);
    map.on("move", redraw);
    map.on("resize", redraw);
    return () => {
      map.off("zoomend", syncZoom);
      map.off("move", redraw);
      map.off("resize", redraw);
    };
  }, [mapReady]);

  useEffect(() => {
    if (!radarHost || radarFrames.length === 0) return undefined;

    const urls = radarFrames.map((nextFrame) =>
      radarImageUrl(radarHost, nextFrame.path, lat, lon, radarZoom),
    );
    const keep = new Set(urls);
    let cancelled = false;

    urls.forEach((url) => {
      if (imagesRef.current.has(url)) return;
      const image = new Image();
      image.decoding = "async";
      image.onload = () => {
        if (cancelled) return;
        imagesRef.current.set(url, image);
        drawRef.current();
      };
      image.src = url;
    });

    if (imagesRef.current.size > 40) {
      for (const key of imagesRef.current.keys()) {
        if (!keep.has(key)) imagesRef.current.delete(key);
        if (imagesRef.current.size <= 26) break;
      }
    }

    return () => {
      cancelled = true;
    };
  }, [lat, lon, radarFrames, radarHost, radarZoom]);

  useEffect(() => {
    const canvas = overlayRef.current;
    const map = mapRef.current;
    if (canvas) {
      canvas.dataset.radarPath = frame?.path ?? "";
      canvas.dataset.radarUrl = frameUrl ?? "";
      canvas.dataset.radarIndex = frame ? String(radarFrameIndex) : "";
    }

    drawRef.current = () => {
      if (!canvas || !map || !frameUrl) return;
      const loaded = imagesRef.current.get(frameUrl);
      if (!loaded) return;
      paintRadarFrame(canvas, map, loaded, lat, lon, radarZoom);
    };

    drawRef.current();
  }, [frame, frameUrl, lat, lon, radarFrameIndex, radarZoom]);

  return (
    <div
      ref={containerRef}
      className="radar-map relative h-full w-full"
      data-radar-transport="dom-overlay"
    />
  );
}
