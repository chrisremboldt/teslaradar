"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RADAR_REFRESH_MS } from "@/lib/constants";
import { fetchRainViewerCatalog } from "@/lib/rainviewer";
import type { RadarFrame, RainViewerCatalog } from "@/lib/types";

export const RADAR_FRAME_MS = 420;
export const RADAR_HOLD_LAST_MS = 900;

export function useRainViewer(animate: boolean) {
  const [catalog, setCatalog] = useState<RainViewerCatalog | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const animateRef = useRef(animate);
  const frameIndexRef = useRef(frameIndex);

  useEffect(() => {
    animateRef.current = animate;
  }, [animate]);

  useEffect(() => {
    frameIndexRef.current = frameIndex;
  }, [frameIndex]);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await fetchRainViewerCatalog();
      setCatalog(next);
      setFrameIndex((prev) => {
        if (!next.frames.length) return 0;
        // Paused: show the newest frame. Playing: keep the loop moving so a
        // catalog refresh cannot pin the UI on a single still (the last frame).
        if (!animateRef.current) return next.frames.length - 1;
        return prev < next.frames.length ? prev : 0;
      });
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

    let cancelled = false;
    let raf = 0;
    let index = frameIndexRef.current;
    let lastSwitch = performance.now();
    const last = catalog.frames.length - 1;

    const delayFor = (i: number) => (i === last ? RADAR_HOLD_LAST_MS : RADAR_FRAME_MS);

    const loop = (now: number) => {
      if (cancelled) return;
      // Elapsed-time stepping: iOS Safari / Tesla Chromium throttle timers
      // (and sometimes rAF). Advance by real elapsed time, not 1 frame/tick.
      let stepped = false;
      while (now - lastSwitch >= delayFor(index)) {
        lastSwitch += delayFor(index);
        index = index >= last ? 0 : index + 1;
        stepped = true;
        if (now - lastSwitch > 10_000) {
          lastSwitch = now;
          break;
        }
      }
      if (stepped) {
        frameIndexRef.current = index;
        setFrameIndex(index);
      }
      raf = window.requestAnimationFrame(loop);
    };

    const onVisibility = () => {
      if (document.visibilityState === "visible") {
        lastSwitch = performance.now();
      }
    };
    document.addEventListener("visibilitychange", onVisibility);
    raf = window.requestAnimationFrame(loop);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      document.removeEventListener("visibilitychange", onVisibility);
    };
    // Restart when play/pause or catalog identity changes — not every index tick.
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
