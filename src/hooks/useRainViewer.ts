"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RADAR_FRAME_MS,
  RADAR_HOLD_LAST_MS,
  RADAR_PLAY_WARM_TIMEOUT_MS,
  RADAR_REFRESH_MS,
} from "@/lib/constants";
import {
  isRadarPlayReady,
  shouldAdvanceRadarPlayhead,
} from "@/lib/radar-image-cache";
import { fetchRainViewerCatalog, mergeRainViewerCatalog } from "@/lib/rainviewer";
import type { RadarFrame, RainViewerCatalog } from "@/lib/types";

/**
 * Advances past RainViewer frames on a single interval, paused while hidden.
 * Default product path is latest-frame only (`animate` false).
 *
 * Play: overlay preloads the full current catalog immediately. This hook
 * holds the playhead on the latest frame until playhead±1 are warm
 * (`data-radar-play-ready=1`) or 2s elapses, then steps. Catalog reloads
 * merge in place so the loop is not blanked or snapped to newest mid-cycle.
 */
export function useRainViewer(animate: boolean) {
  const [catalog, setCatalog] = useState<RainViewerCatalog | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const frameIndexRef = useRef(0);
  const catalogRef = useRef<RainViewerCatalog | null>(null);
  const animateRef = useRef(animate);

  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);

  useEffect(() => {
    catalogRef.current = catalog;
  }, [catalog]);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);

  const reload = useCallback(async () => {
    const hadCatalog = Boolean(catalogRef.current);
    if (!hadCatalog) setIsLoading(true);
    try {
      const next = await fetchRainViewerCatalog();
      const merged = mergeRainViewerCatalog(
        catalogRef.current,
        next,
        frameIndexRef.current,
        animateRef.current,
      );
      catalogRef.current = merged.catalog;
      frameIndexRef.current = merged.frameIndex;
      setCatalog(merged.catalog);
      setFrameIndex(merged.frameIndex);
      setError(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Radar unavailable");
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => {
      void reload();
    }, 0);
    const interval = window.setInterval(() => {
      if (document.visibilityState !== "visible") return;
      void reload();
    }, RADAR_REFRESH_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [reload]);

  useEffect(() => {
    if (!animate) {
      const frames = catalogRef.current?.frames ?? [];
      if (!frames.length) return undefined;
      const last = frames.length - 1;
      if (frameIndexRef.current !== last) {
        frameIndexRef.current = last;
        setFrameIndex(last);
      }
      return undefined;
    }
    if (!catalog || catalog.frames.length < 2) return undefined;

    const last = catalog.frames.length - 1;
    let lastTs = performance.now();
    let elapsed = 0;
    let index = frameIndexRef.current;
    if (index > last) {
      index = last;
      frameIndexRef.current = last;
      setFrameIndex(last);
    }

    const playStartedAt = performance.now();
    let advancing = false;

    const playReady = () =>
      isRadarPlayReady(
        document.querySelector(".radar-overlay-canvas")?.getAttribute("data-radar-play-ready"),
      );

    const pump = (ts: number) => {
      if (document.visibilityState !== "visible") {
        lastTs = ts;
        elapsed = 0;
        return;
      }
      if (
        !advancing &&
        !shouldAdvanceRadarPlayhead({
          ready: playReady(),
          elapsedMs: ts - playStartedAt,
          timeoutMs: RADAR_PLAY_WARM_TIMEOUT_MS,
        })
      ) {
        lastTs = ts;
        elapsed = 0;
        return;
      }
      advancing = true;
      const dt = Math.min(Math.max(0, ts - lastTs), 250);
      lastTs = ts;
      elapsed += dt;
      const delay = index === last ? RADAR_HOLD_LAST_MS : RADAR_FRAME_MS;
      if (elapsed >= delay) {
        elapsed %= delay;
        index = index >= last ? 0 : index + 1;
        frameIndexRef.current = index;
        setFrameIndex(index);
      }
    };

    const onVisibility = () => {
      lastTs = performance.now();
      elapsed = 0;
    };

    let interval = 0;
    const startPump = () => {
      if (interval) return;
      interval = window.setInterval(() => {
        pump(performance.now());
      }, RADAR_FRAME_MS);
    };
    const stopPump = () => {
      window.clearInterval(interval);
      interval = 0;
    };
    const onTeslaVisibility = () => {
      onVisibility();
      if (document.visibilityState === "visible") startPump();
      else stopPump();
    };
    document.addEventListener("visibilitychange", onTeslaVisibility);
    if (document.visibilityState === "visible") startPump();
    return () => {
      stopPump();
      document.removeEventListener("visibilitychange", onTeslaVisibility);
    };
  }, [animate, catalog]);

  const frames: RadarFrame[] = catalog?.frames ?? [];
  const frame = frames[frameIndex] ?? frames.at(-1) ?? null;

  return {
    catalog,
    frames,
    frame,
    frameIndex,
    error,
    isLoading,
    reload,
    setFrameIndex,
  };
}
