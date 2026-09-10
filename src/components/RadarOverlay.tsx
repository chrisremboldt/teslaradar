"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { RADAR_LAYER_OPACITY } from "@/lib/constants";
import {
  radarAnchorStillCovers,
  radarFramesToPreload,
  radarImageAnchor,
  radarImageUrl,
  radarOverlayPlacement,
  type RadarImageAnchor,
} from "@/lib/rainviewer";
import {
  isTeslaBrowser,
  overlayPixelRatioForBrowser,
  radarPreloadRadius,
} from "@/lib/tesla-browser";
import type { RadarFrame } from "@/lib/types";

type RadarOverlayProps = {
  map: MapLibreMap;
  host: string | null;
  frames: RadarFrame[];
  frameIndex: number;
};

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Radar frame failed: ${url}`));
    image.src = url;
  });
}

/**
 * Canvas RainViewer overlay. Frames are preloaded as `<img>` and painted on a
 * timer — never through MapLibre raster sources (unreliable on Tesla Chromium).
 */
export function RadarOverlay({ map, host, frames, frameIndex }: RadarOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const anchorRef = useRef<RadarImageAnchor | null>(null);
  const hostRef = useRef(host);
  const framesRef = useRef(frames);
  const frameIndexRef = useRef(frameIndex);
  const drawRef = useRef<() => void>(() => undefined);

  useEffect(() => {
    hostRef.current = host;
    framesRef.current = frames;
    frameIndexRef.current = frameIndex;
  }, [frameIndex, frames, host]);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.className = "radar-overlay-canvas";
    canvas.setAttribute("aria-hidden", "true");
    // Sit on the map container, not MapLibre's transforming canvas-container.
    // easeTo/jumpTo apply a CSS transform there; a child canvas then gets
    // double-offset by map.project() and the radar paints off-screen.
    // Sit on the map root (sibling of `.radar-map`), not inside MapLibre’s
    // canvas-container (CSS-transform double-offset) and not as a sibling of
    // the WebGL canvas (Tesla/Chromium composites GL on top of 2D).
    const mount = map.getContainer().parentElement ?? map.getContainer();
    mount.appendChild(canvas);
    canvas.dataset.radarMount = mount === map.getContainer() ? "map" : "root";
    canvasRef.current = canvas;

    const images = imagesRef.current;
    let loadGen = 0;
    let raf = 0;
    const tesla = isTeslaBrowser();
    const pixelRatio = overlayPixelRatioForBrowser(tesla, window.devicePixelRatio || 1);
    const ctx = canvas.getContext("2d");
    canvas.dataset.pixelRatio = String(pixelRatio);

    const activeFrame = () =>
      framesRef.current[frameIndexRef.current] ?? framesRef.current.at(-1) ?? null;

    const frameUrl = (frame: RadarFrame, anchor: RadarImageAnchor) => {
      const activeHost = hostRef.current;
      return activeHost ? radarImageUrl(activeHost, frame.path, anchor) : "";
    };

    const wantedUrls = (anchor: RadarImageAnchor, host: string) => {
      const subset = radarFramesToPreload(
        framesRef.current,
        frameIndexRef.current,
        radarPreloadRadius(tesla),
      );
      return new Set(subset.map((frame) => radarImageUrl(host, frame.path, anchor)));
    };

    const draw = () => {
      const anchor = anchorRef.current;
      const frame = activeFrame();
      if (!ctx) return;

      const width = canvas.clientWidth || map.getContainer().clientWidth;
      const height = canvas.clientHeight || map.getContainer().clientHeight;
      const pixelW = Math.max(1, Math.round(width * pixelRatio));
      const pixelH = Math.max(1, Math.round(height * pixelRatio));
      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const url = frame && anchor ? frameUrl(frame, anchor) : "";
      canvas.dataset.radarSrc = url;
      canvas.dataset.radarPath = frame?.path ?? "";
      canvas.dataset.radarIndex = frame ? String(frameIndexRef.current) : "";
      canvas.dataset.radarZoom = anchor ? String(anchor.zoom) : "";

      const image = url ? images.get(url) : undefined;
      canvas.dataset.radarPainted = image && anchor ? "1" : "0";
      if (!image || !anchor) return;

      const placed = radarOverlayPlacement(
        (lngLat) => map.project(lngLat),
        map.getBearing(),
        anchor,
      );
      ctx.save();
      ctx.globalAlpha = RADAR_LAYER_OPACITY;
      ctx.translate(placed.x, placed.y);
      ctx.rotate((placed.rotation * Math.PI) / 180);
      ctx.drawImage(image, -placed.size / 2, -placed.size / 2, placed.size, placed.size);
      ctx.restore();
    };

    drawRef.current = draw;

    const scheduleDraw = () => {
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        draw();
      });
    };

    const resolveAnchor = (): RadarImageAnchor | null => {
      const container = map.getContainer();
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width < 8 || height < 8) return null;
      const center = map.getCenter();
      return radarImageAnchor(center.lat, center.lng, map.getZoom(), width, height);
    };

    const preload = (next: RadarImageAnchor) => {
      const activeHost = hostRef.current;
      if (!activeHost || framesRef.current.length === 0) {
        images.clear();
        scheduleDraw();
        return;
      }
      const gen = ++loadGen;
      const wanted = wantedUrls(next, activeHost);
      const current = (() => {
        const frame = activeFrame();
        return frame ? radarImageUrl(activeHost, frame.path, next) : "";
      })();
      for (const key of images.keys()) {
        if (!wanted.has(key)) images.delete(key);
      }
      const ordered = [...wanted].sort((a, b) => {
        if (a === current) return -1;
        if (b === current) return 1;
        return 0;
      });
      for (const url of ordered) {
        if (images.has(url)) continue;
        void loadImage(url)
          .then((image) => {
            if (gen !== loadGen) return;
            images.set(url, image);
            scheduleDraw();
          })
          .catch(() => undefined);
      }
      scheduleDraw();
    };

    const applyAnchor = (force = false) => {
      const next = resolveAnchor();
      const activeHost = hostRef.current;
      if (!next || !activeHost) {
        anchorRef.current = next;
        scheduleDraw();
        return;
      }
      const prev = anchorRef.current;
      const keepImage = !force && prev && radarAnchorStillCovers(prev, next);
      if (!keepImage) {
        anchorRef.current = next;
        preload(next);
        return;
      }
      scheduleDraw();
    };

    const onMove = () => scheduleDraw();
    const onIdle = () => applyAnchor(false);

    map.on("move", onMove);
    map.on("resize", onIdle);
    map.on("moveend", onIdle);
    map.on("zoomend", onIdle);
    applyAnchor(true);

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => applyAnchor(false));
      observer.observe(map.getContainer());
    }

    return () => {
      loadGen += 1;
      drawRef.current = () => undefined;
      if (raf) window.cancelAnimationFrame(raf);
      observer?.disconnect();
      map.off("move", onMove);
      map.off("resize", onIdle);
      map.off("moveend", onIdle);
      map.off("zoomend", onIdle);
      canvas.remove();
      canvasRef.current = null;
      images.clear();
    };
  }, [map]);

  useEffect(() => {
    const container = map.getContainer();
    const center = map.getCenter();
    const computed = radarImageAnchor(
      center.lat,
      center.lng,
      map.getZoom(),
      container.clientWidth,
      container.clientHeight,
    );
    const prev = anchorRef.current;
    const anchor = prev && radarAnchorStillCovers(prev, computed) ? prev : computed;
    anchorRef.current = anchor;
    if (!host || frames.length === 0) {
      drawRef.current();
      return;
    }
    const images = imagesRef.current;
    const tesla = isTeslaBrowser();
    const wanted = new Set(
      radarFramesToPreload(frames, frameIndex, radarPreloadRadius(tesla)).map((frame) =>
        radarImageUrl(host, frame.path, anchor),
      ),
    );
    for (const key of images.keys()) {
      if (!wanted.has(key)) images.delete(key);
    }
    for (const url of wanted) {
      if (images.has(url)) continue;
      void loadImage(url)
        .then((image) => {
          images.set(url, image);
          drawRef.current();
        })
        .catch(() => undefined);
    }
    drawRef.current();
  }, [frameIndex, frames, host, map]);

  useEffect(() => {
    drawRef.current();
  }, [frameIndex]);

  return null;
}
