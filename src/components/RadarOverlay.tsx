"use client";

import { useEffect, useRef } from "react";
import type { Map as MapLibreMap } from "maplibre-gl";
import {
  RADAR_ANCHOR_SLOP,
  RADAR_LAYER_OPACITY,
  RADAR_PLAY_WARM_RADIUS,
  TESLA_OVERLAY_MIN_DRAW_MS,
} from "@/lib/constants";
import {
  shouldDrawRadarOverlay,
  type OverlayDrawReason,
} from "@/lib/overlay-draw";
import {
  capRadarImageCache,
  clearRadarImageCache,
  evictRadarImages,
  resolveRadarPaintImage,
  shrinkRadarImageCacheToPlayhead,
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
 * Lean path: paused cache is the latest frame only. Play preloads every
 * current-catalog URL at this anchor (full past loop) and holds the last
 * painted bitmap if the next frame is still decoding — never clear-to-empty.
 * Pause evicts extras with src="". No `move` listener (settle / frame /
 * resize only) so a 1920×1200 2D canvas does not redraw on every follow jumpTo.
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
    const inflight = new Set<string>();
    let loadGen = 0;
    let preloadBatchKey = "";
    let raf = 0;
    let lastPaintedUrl: string | null = null;
    let hasPainted = false;
    const pixelRatio = overlayPixelRatioForBrowser();
    const cacheLimitFor = () => radarImageCacheLimitForBrowser(true, animateRef.current);
    const ctx = canvas.getContext("2d");
    canvas.dataset.pixelRatio = String(pixelRatio);
    canvas.dataset.radarCacheSize = "0";
    canvas.dataset.radarPlayReady = "0";
    canvas.dataset.radarHeld = "0";

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

    const publishPlayReady = (anchor: RadarImageAnchor | null, activeHost: string) => {
      if (!animateRef.current || !anchor) {
        canvas.dataset.radarPlayReady = "0";
        return;
      }
      const warm = radarFramesToPreload(
        framesRef.current,
        frameIndexRef.current,
        RADAR_PLAY_WARM_RADIUS,
      );
      const ready = warm.every((item) => images.has(radarImageUrl(activeHost, item.path, anchor)));
      canvas.dataset.radarPlayReady = ready ? "1" : "0";
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

      const url = frame && anchor ? frameUrl(frame, anchor) : "";
      const resolved = resolveRadarPaintImage(images, url, lastPaintedUrl);
      const activeHost = hostRef.current;

      canvas.dataset.radarSrc = url;
      canvas.dataset.radarPath = frame?.path ?? "";
      canvas.dataset.radarIndex = frame ? String(frameIndexRef.current) : "";
      canvas.dataset.radarZoom = anchor ? String(anchor.zoom) : "";
      canvas.dataset.radarCacheSize = String(images.size);
      canvas.dataset.radarLastDraw = String(Math.round(now));
      canvas.dataset.radarDrawReason = reason;
      canvas.dataset.radarHeld = resolved?.held ? "1" : "0";
      canvas.dataset.radarPainted = resolved && anchor ? "1" : hasPainted ? "1" : "0";
      if (activeHost) publishPlayReady(anchor, activeHost);

      if (!resolved || !anchor) {
        return;
      }

      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }

      ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      ctx.clearRect(0, 0, width, height);

      const placed = radarOverlayPlacement(
        (lngLat) => map.project(lngLat),
        map.getBearing(),
        anchor,
      );
      ctx.save();
      ctx.globalAlpha = RADAR_LAYER_OPACITY;
      ctx.translate(placed.x, placed.y);
      ctx.rotate((placed.rotation * Math.PI) / 180);
      ctx.drawImage(resolved.image, -placed.size / 2, -placed.size / 2, placed.size, placed.size);
      ctx.restore();
      lastPaintedUrl = resolved.url;
      hasPainted = true;
      canvas.dataset.radarPainted = "1";
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
        canvas.dataset.radarCacheSize = String(images.size);
        schedule("preload");
        return;
      }
      const batchKey = `${activeHost}|${next.lat}|${next.lon}|${next.zoom}|${next.size}|${animateRef.current ? "play" : "pause"}`;
      if (batchKey !== preloadBatchKey) {
        preloadBatchKey = batchKey;
        loadGen += 1;
      }
      const gen = loadGen;
      const current = (() => {
        const frame = activeFrame();
        return frame ? radarImageUrl(activeHost, frame.path, next) : "";
      })();
      const wanted = wantedUrls(next, activeHost);
      if (!animateRef.current) {
        shrinkRadarImageCacheToPlayhead(images, current);
      } else {
        evictRadarImages(images, wanted);
        capRadarImageCache(images, cacheLimitFor(), wanted);
      }
      canvas.dataset.radarCacheSize = String(images.size);
      publishPlayReady(next, activeHost);
      const warm = new Set(
        radarFramesToPreload(
          framesRef.current,
          frameIndexRef.current,
          RADAR_PLAY_WARM_RADIUS,
        ).map((item) => radarImageUrl(activeHost, item.path, next)),
      );
      const ordered = [...wanted].sort((a, b) => {
        if (a === current) return -1;
        if (b === current) return 1;
        const aWarm = warm.has(a);
        const bWarm = warm.has(b);
        if (aWarm !== bWarm) return aWarm ? -1 : 1;
        return 0;
      });
      for (const url of ordered) {
        if (images.has(url) || inflight.has(url)) continue;
        inflight.add(url);
        void loadImage(url)
          .then((image) => {
            const stillWanted = wantedUrls(next, activeHost);
            if (gen !== loadGen || !stillWanted.has(url)) {
              image.src = "";
              return;
            }
            images.set(url, image);
            if (!animateRef.current) {
              shrinkRadarImageCacheToPlayhead(images, current);
            } else {
              capRadarImageCache(images, cacheLimitFor(), stillWanted);
            }
            canvas.dataset.radarCacheSize = String(images.size);
            publishPlayReady(next, activeHost);
            schedule("preload");
          })
          .catch(() => undefined)
          .finally(() => {
            inflight.delete(url);
          });
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
      const next = resolveAnchor();
      const activeHost = hostRef.current;
      if (!next || !activeHost) {
        applyAnchor(false, reason);
        return;
      }
      const prev = anchorRef.current;
      if (!prev || !radarAnchorStillCovers(prev, next, RADAR_ANCHOR_SLOP)) {
        anchorRef.current = next;
        preload(next);
        return;
      }
      // Same geographic PNG — refresh the play/pause wanted set, do not
      // start a new download just because follow settled.
      preload(prev);
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
