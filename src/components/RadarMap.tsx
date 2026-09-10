"use client";

import { useEffect, useRef } from "react";
import {
  GeoJSONSource,
  Map as MapLibreMap,
  Marker,
  RasterTileSource,
} from "maplibre-gl";
import type { JumpToOptions } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  MAP_DEFAULT_ZOOM,
  MAP_MAX_ZOOM,
  OSM_ATTRIBUTION,
  OSM_RASTER_TILES,
  RADAR_MAX_NATIVE_ZOOM,
} from "@/lib/constants";
import { accuracyCircle, emptyCollection } from "@/lib/geo";

type RadarMapProps = {
  lat: number;
  lon: number;
  accuracy: number | null;
  heading: number | null;
  followMe: boolean;
  headingUp: boolean;
  tileTemplate: string | null;
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

export function RadarMap({
  lat,
  lon,
  accuracy,
  heading,
  followMe,
  headingUp,
  tileTemplate,
  onUserPan,
}: RadarMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const onUserPanRef = useRef(onUserPan);
  const lastTileRef = useRef<string | null>(null);

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
      map.addSource("radar", {
        type: "raster",
        tiles: tileTemplate ? [tileTemplate] : [],
        tileSize: 256,
        maxzoom: RADAR_MAX_NATIVE_ZOOM,
        attribution:
          '<a href="https://www.rainviewer.com/api.html">RainViewer</a>',
      });
      map.addLayer({
        id: "radar",
        type: "raster",
        source: "radar",
        paint: {
          "raster-opacity": 0.78,
          "raster-fade-duration": 0,
        },
      });
      applyAccuracy(map, lon, lat, accuracy);
      lastTileRef.current = tileTemplate;
    });

    map.on("dragstart", () => {
      onUserPanRef.current();
    });

    mapRef.current = map;
    markerRef.current = marker;

    return () => {
      marker.remove();
      map.remove();
      mapRef.current = null;
      markerRef.current = null;
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
    if (!map || !tileTemplate || tileTemplate === lastTileRef.current) return;

    const applyTiles = () => {
      const source = map.getSource("radar") as RasterTileSource | undefined;
      if (!source) return;
      source.setTiles([tileTemplate]);
      lastTileRef.current = tileTemplate;
    };

    if (map.isStyleLoaded()) applyTiles();
    else map.once("load", applyTiles);
  }, [tileTemplate]);

  return <div ref={containerRef} className="radar-map h-full w-full" />;
}
