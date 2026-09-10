"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { normalizeHeading, shortestAngleDelta } from "@/lib/format";
import { isTeslaBrowser } from "@/lib/tesla-browser";
import type { CompassStatus } from "@/lib/types";

function screenAngle(): number {
  const orientation = window.screen.orientation?.angle;
  if (typeof orientation === "number") return orientation;
  return 0;
}

function headingFromQuaternion(q: [number, number, number, number]): number {
  const [x, y, z, w] = q;
  const siny = 2 * (w * z + x * y);
  const cosy = 1 - 2 * (y * y + z * z);
  const yaw = Math.atan2(siny, cosy) * (180 / Math.PI);
  return normalizeHeading(-yaw);
}

function headingFromOrientation(event: DeviceOrientationEvent): number | null {
  if (typeof event.webkitCompassHeading === "number") {
    return normalizeHeading(event.webkitCompassHeading + screenAngle());
  }
  if (typeof event.alpha !== "number") return null;
  return normalizeHeading(360 - event.alpha + screenAngle());
}

function canRequestMotionPermission(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.DeviceOrientationEvent?.requestPermission === "function"
  );
}

function subscribeNoop() {
  return () => undefined;
}

export function useCompass(simulatedHeading: number | null) {
  const needsGesture = useSyncExternalStore(
    subscribeNoop,
    canRequestMotionPermission,
    () => false,
  );
  const [liveHeading, setLiveHeading] = useState<number | null>(null);
  const [liveStatus, setLiveStatus] = useState<CompassStatus>("unknown");
  const [iosGranted, setIosGranted] = useState(false);
  const smoothed = useRef<number | null>(null);
  const gotReading = useRef(false);

  const publish = useCallback((raw: number) => {
    gotReading.current = true;
    const prev = smoothed.current;
    const next =
      prev == null ? raw : normalizeHeading(prev + shortestAngleDelta(prev, raw) * 0.2);
    smoothed.current = next;
    setLiveHeading(next);
    setLiveStatus("available");
  }, []);

  useEffect(() => {
    if (simulatedHeading != null) return;
    if (needsGesture && !iosGranted) return;
    // Tesla exposes broken orientation / AbsoluteOrientationSensor stubs that
    // have crashed the tab. Heading-up falls back to GPS track heading.
    if (isTeslaBrowser()) {
      setLiveStatus("unavailable");
      return;
    }

    let sensor: AbsoluteOrientationSensor | null = null;
    const onOrientation = (event: DeviceOrientationEvent) => {
      const value = headingFromOrientation(event);
      if (value != null) publish(value);
    };

    window.addEventListener("deviceorientationabsolute", onOrientation, true);
    window.addEventListener("deviceorientation", onOrientation, true);

    if (typeof AbsoluteOrientationSensor === "function") {
      try {
        sensor = new AbsoluteOrientationSensor({
          frequency: 10,
          referenceFrame: "screen",
        });
        sensor.addEventListener("reading", () => {
          if (sensor?.quaternion) publish(headingFromQuaternion(sensor.quaternion));
        });
        sensor.addEventListener("error", () => undefined);
        sensor.start();
      } catch {
        sensor = null;
      }
    }

    const timeout = window.setTimeout(() => {
      if (gotReading.current) return;
      setLiveStatus(canRequestMotionPermission() ? "needs-permission" : "unavailable");
    }, 2500);

    return () => {
      window.clearTimeout(timeout);
      window.removeEventListener("deviceorientationabsolute", onOrientation, true);
      window.removeEventListener("deviceorientation", onOrientation, true);
      try {
        sensor?.stop();
      } catch {
        // ignore
      }
    };
  }, [iosGranted, needsGesture, publish, simulatedHeading]);

  const requestPermission = useCallback(async () => {
    if (!canRequestMotionPermission()) return;
    try {
      const result = await window.DeviceOrientationEvent.requestPermission!();
      if (result === "granted") {
        gotReading.current = false;
        setIosGranted(true);
        setLiveStatus("unknown");
      } else {
        setLiveStatus("unavailable");
      }
    } catch {
      setLiveStatus("unavailable");
    }
  }, []);

  if (simulatedHeading != null) {
    return {
      heading: normalizeHeading(simulatedHeading),
      status: "simulated" as const,
      requestPermission,
      canRequestPermission: needsGesture,
    };
  }

  const status: CompassStatus =
    liveStatus === "available" || liveStatus === "unavailable"
      ? liveStatus
      : needsGesture && !iosGranted
        ? "needs-permission"
        : liveStatus;

  return {
    heading: liveHeading,
    status,
    requestPermission,
    canRequestPermission: needsGesture,
  };
}
