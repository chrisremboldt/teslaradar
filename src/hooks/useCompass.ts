"use client";

import { useCallback } from "react";
import { normalizeHeading } from "@/lib/format";
import type { CompassStatus } from "@/lib/types";

/**
 * Core UX does not use DeviceOrientation / AbsoluteOrientationSensor —
 * those stubs have crashed Tesla Chromium. Heading-up uses GPS track
 * heading. `?heading=` remains a labeled sim for screenshots.
 */
export function useCompass(simulatedHeading: number | null) {
  const requestPermission = useCallback(async () => undefined, []);

  if (simulatedHeading != null) {
    return {
      heading: normalizeHeading(simulatedHeading),
      status: "simulated" as const,
      requestPermission,
      canRequestPermission: false,
    };
  }

  return {
    heading: null,
    status: "unavailable" as CompassStatus,
    requestPermission,
    canRequestPermission: false,
  };
}
