"use client";

import { useCallback, useEffect, useState } from "react";
import { RADAR_REFRESH_MS } from "@/lib/constants";
import { fetchRainViewerCatalog, radarTileTemplate } from "@/lib/rainviewer";
import type { RadarFrame, RainViewerCatalog } from "@/lib/types";

const FRAME_MS = 420;
const HOLD_LAST_MS = 900;

export function useRainViewer(animate: boolean) {
  const [catalog, setCatalog] = useState<RainViewerCatalog | null>(null);
  const [frameIndex, setFrameIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    try {
      const next = await fetchRainViewerCatalog();
      setCatalog(next);
      setFrameIndex(next.frames.length ? next.frames.length - 1 : 0);
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
    let timer = 0;

    const tick = (index: number) => {
      if (cancelled) return;
      const last = catalog.frames.length - 1;
      const delay = index === last ? HOLD_LAST_MS : FRAME_MS;
      timer = window.setTimeout(() => {
        const next = index >= last ? 0 : index + 1;
        setFrameIndex(next);
        tick(next);
      }, delay);
    };

    tick(frameIndex);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
    // Restart the loop when play/pause or catalog identity changes — not every index tick.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional
  }, [animate, catalog]);

  const frames: RadarFrame[] = catalog?.frames ?? [];
  const frame = frames[frameIndex] ?? frames.at(-1) ?? null;
  const tileTemplate =
    catalog && frame ? radarTileTemplate(catalog.host, frame.path) : null;

  return {
    catalog,
    frames,
    frame,
    frameIndex,
    tileTemplate,
    error,
    isLoading,
    reload,
    setFrameIndex,
  };
}
