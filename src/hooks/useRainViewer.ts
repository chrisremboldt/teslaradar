"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  RADAR_FRAME_MS,
  RADAR_HOLD_LAST_MS,
  RADAR_REFRESH_MS,
} from "@/lib/constants";
import { fetchRainViewerCatalog } from "@/lib/rainviewer";
import { isTeslaBrowser } from "@/lib/tesla-browser";
import type { RadarFrame, RainViewerCatalog } from "@/lib/types";

/**
 * Advances past RainViewer frames with requestAnimationFrame + elapsed time.
 * Tesla Chromium can throttle setTimeout in split-view; rAF plus a visible-tab
 * watchdog keep the footer index moving. Hidden tabs pause cleanly.
 */
export function useRainViewer(animate: boolean) {
  const [catalog, setCatalog] = useState<RainViewerCatalog | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const frameIndexRef = useRef(0);

  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await fetchRainViewerCatalog();
      setCatalog(next);
      const last = next.frames.length ? next.frames.length - 1 : 0;
      frameIndexRef.current = last;
      setFrameIndex(last);
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
      void reload();
    }, RADAR_REFRESH_MS);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [reload]);

  useEffect(() => {
    if (!animate || !catalog || catalog.frames.length < 2) return undefined;

    const last = catalog.frames.length - 1;
    let raf = 0;
    let lastTs = performance.now();
    let elapsed = 0;
    let index = frameIndexRef.current;
    if (index > last) {
      index = last;
      frameIndexRef.current = last;
      setFrameIndex(last);
    }

    const pump = (ts: number) => {
      if (document.visibilityState !== "visible") {
        lastTs = ts;
        elapsed = 0;
        return;
      }
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

    document.addEventListener("visibilitychange", onVisibility);

    // Tesla: one interval only. Phone/desktop keep rAF + a 250ms watchdog
    // because split-view can freeze either timer by itself.
    if (isTeslaBrowser()) {
      const interval = window.setInterval(() => {
        pump(performance.now());
      }, RADAR_FRAME_MS);
      return () => {
        window.clearInterval(interval);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    }

    const loop = (ts: number) => {
      raf = window.requestAnimationFrame(loop);
      pump(ts);
    };
    raf = window.requestAnimationFrame(loop);
    const watchdog = window.setInterval(() => {
      pump(performance.now());
    }, 250);

    return () => {
      window.cancelAnimationFrame(raf);
      window.clearInterval(watchdog);
      document.removeEventListener("visibilitychange", onVisibility);
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
