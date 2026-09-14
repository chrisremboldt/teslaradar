"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import { RADAR_ANCHOR_SLOP, RADAR_LAYER_OPACITY, TESLA_OVERLAY_MIN_DRAW_MS } from "@/lib/constants";
import {
  shouldDrawRadarOverlay,
  type OverlayDrawReason,
} from "@/lib/overlay-draw";
import {
  capRadarImageCache,
  clearRadarImageCache,
  evictRadarImages,
} from "@/lib/radar-image-cache";
import {
  radarAnchorStillCovers,
  radarFramesToPreload,
  radarImageAnchor,
  radarImageUrl,
  radarOverlayPlacement,
  type RadarImageAnchor,
} from "@/lib/rainviewer";
import {
  overlayPixelRatioForBrowser,
  radarImageCacheLimitForBrowser,
  radarPreloadRadius,
} from "@/lib/tesla-browser";
import type { RadarFrame } from "@/lib/types";

type RadarOverlayProps = {
  map: MapLibreMap;
  host: string | null;
  frames: RadarFrame[];
  frameIndex: number;
  animate?: boolean;
};

type OverlayApi = {
  sync: (reason: OverlayDrawReason) => void;
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
 *
 * Lean path: hard-capped image cache (latest frame, or playhead ±1 if Play),
 * src="" on eviction, no `move` listener (settle / frame / resize only) so a
 * 1920×1200 2D canvas does not redraw on every follow jumpTo.
 */
export function RadarOverlay({
  map,
  host,
  frames,
  frameIndex,
  animate = false,
}: RadarOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const imagesRef = useRef<Map<string, HTMLImageElement>>(new Map());
  const anchorRef = useRef<RadarImageAnchor | null>(null);
  const hostRef = useRef(host);
  const framesRef = useRef(frames);
  const frameIndexRef = useRef(frameIndex);
  const apiRef = useRef<OverlayApi | null>(null);
  const lastDrawAtRef = useRef<number | null>(null);
  const animateRef = useRef(animate);

  useEffect(() => {
    hostRef.current = host;
    framesRef.current = frames;
    frameIndexRef.current = frameIndex;
    animateRef.current = animate;
    apiRef.current?.sync("frame");
  }, [animate, frameIndex, frames, host]);

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
    const pixelRatio = overlayPixelRatioForBrowser();
    const cacheLimitFor = () => radarImageCacheLimitForBrowser(true, animateRef.current);
    const ctx = canvas.getContext("2d");
    canvas.dataset.pixelRatio = String(pixelRatio);
    canvas.dataset.radarCacheSize = "0";

    const hidden = () => document.visibilityState !== "visible";

    const activeFrame = () =>
      framesRef.current[frameIndexRef.current] ?? framesRef.current.at(-1) ?? null;

    const frameUrl = (frame: RadarFrame, anchor: RadarImageAnchor) => {
      const activeHost = hostRef.current;
      return activeHost ? radarImageUrl(activeHost, frame.path, anchor) : "";
    };

    const wantedUrls = (anchor: RadarImageAnchor, activeHost: string) => {
      const subset = radarFramesToPreload(
        framesRef.current,
        frameIndexRef.current,
        radarPreloadRadius(true, animateRef.current),
      );
      return new Set(subset.map((frame) => radarImageUrl(activeHost, frame.path, anchor)));
    };

    const paint = (reason: OverlayDrawReason) => {
      const now = performance.now();
      if (
        !shouldDrawRadarOverlay({
          tesla: true,
          reason,
          lastDrawAt: lastDrawAtRef.current,
          now,
          hidden: hidden(),
          minIntervalMs: TESLA_OVERLAY_MIN_DRAW_MS,
        })
      ) {
        return;
      }
      lastDrawAtRef.current = now;

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
      canvas.dataset.radarCacheSize = String(images.size);
      canvas.dataset.radarLastDraw = String(Math.round(now));
      canvas.dataset.radarDrawReason = reason;

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

    const schedule = (reason: OverlayDrawReason) => {
      if (reason === "move") {
        paint("move");
        return;
      }
      if (raf) return;
      raf = window.requestAnimationFrame(() => {
        raf = 0;
        paint(reason);
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
        clearRadarImageCache(images);
        canvas.dataset.radarCacheSize = "0";
        schedule("preload");
        return;
      }
      const gen = ++loadGen;
      const wanted = wantedUrls(next, activeHost);
      const current = (() => {
        const frame = activeFrame();
        return frame ? radarImageUrl(activeHost, frame.path, next) : "";
      })();
      evictRadarImages(images, wanted);
      capRadarImageCache(images, cacheLimitFor(), wanted);
      canvas.dataset.radarCacheSize = String(images.size);
      const ordered = [...wanted].sort((a, b) => {
        if (a === current) return -1;
        if (b === current) return 1;
        return 0;
      });
      for (const url of ordered) {
        if (images.has(url)) continue;
        void loadImage(url)
          .then((image) => {
            if (gen !== loadGen || !wanted.has(url)) {
              image.src = "";
              return;
            }
            images.set(url, image);
            capRadarImageCache(images, cacheLimitFor(), wanted);
            canvas.dataset.radarCacheSize = String(images.size);
            schedule("preload");
          })
          .catch(() => undefined);
      }
      schedule("preload");
    };

    const applyAnchor = (force = false, reason: OverlayDrawReason = "settle") => {
      const next = resolveAnchor();
      const activeHost = hostRef.current;
      if (!next || !activeHost) {
        anchorRef.current = next;
        schedule(reason);
        return;
      }
      const prev = anchorRef.current;
      const keepImage = !force && prev && radarAnchorStillCovers(prev, next, RADAR_ANCHOR_SLOP);
      if (!keepImage) {
        anchorRef.current = next;
        preload(next);
        return;
      }
      schedule(reason);
    };

    const sync = (reason: OverlayDrawReason) => {
      applyAnchor(false, reason);
    };
    apiRef.current = { sync };

    const onIdle = () => applyAnchor(false, "settle");
    const onResize = () => applyAnchor(false, "resize");

    map.on("resize", onResize);
    map.on("moveend", onIdle);
    map.on("zoomend", onIdle);
    applyAnchor(true, "force");

    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver === "function") {
      observer = new ResizeObserver(() => applyAnchor(false, "resize"));
      observer.observe(map.getContainer());
    }

    const onVisibility = () => {
      if (document.visibilityState === "visible") schedule("force");
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      loadGen += 1;
      apiRef.current = null;
      if (raf) window.cancelAnimationFrame(raf);
      observer?.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
      map.off("resize", onResize);
      map.off("moveend", onIdle);
      map.off("zoomend", onIdle);
      canvas.remove();
      canvasRef.current = null;
      clearRadarImageCache(images);
    };
  }, [map]);

  return null;
}
