export const DEFAULT_FOLLOW_JUMP_METERS = 500;
export const DEFAULT_USER_PAN_MIN_PX = 16;

export type LngLat = { lat: number; lon: number };

function distanceMeters(from: LngLat, to: LngLat): number {
  const dLat = (to.lat - from.lat) * 110_540;
  const dLon =
    (to.lon - from.lon) * 111_320 * Math.max(0.2, Math.cos((from.lat * Math.PI) / 180));
  return Math.hypot(dLat, dLon);
}

export type FollowCameraMode = "ease" | "jump" | "bearing-only";

export type FollowCameraPlan = {
  center?: [number, number];
  bearing: number;
  mode: FollowCameraMode;
};

export function planFollowCamera(input: {
  followMe: boolean;
  ownship: LngLat;
  mapCenter: LngLat;
  bearing: number;
  firstLock: boolean;
  positionChanged: boolean;
  followJustEnabled: boolean;
  jumpMeters?: number;
}): FollowCameraPlan {
  const { bearing } = input;
  if (!input.followMe) {
    return { bearing, mode: "bearing-only" };
  }

  const center: [number, number] = [input.ownship.lon, input.ownship.lat];
  const mustRecenter =
    input.firstLock || input.followJustEnabled || input.positionChanged;
  if (!mustRecenter) {
    // Heading-up ticks: rotate around ownship, do not drift the planted chevron.
    return { center, bearing, mode: "jump" };
  }

  const distanceM = distanceMeters(input.mapCenter, input.ownship);
  const jumpMeters = input.jumpMeters ?? DEFAULT_FOLLOW_JUMP_METERS;
  if (input.firstLock || distanceM >= jumpMeters) {
    return { center, bearing, mode: "jump" };
  }
  return { center, bearing, mode: "ease" };
}

export function shortestBearingDelta(from: number, to: number): number {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

/** Skip jumpTo/easeTo when the camera is already on the follow plan. */
export function isCameraOnTarget(input: {
  mapCenter: LngLat;
  mapBearing: number;
  plan: FollowCameraPlan;
  centerEpsilonDeg?: number;
  bearingEpsilonDeg?: number;
}): boolean {
  const bearingEps = input.bearingEpsilonDeg ?? 0.05;
  if (Math.abs(shortestBearingDelta(input.mapBearing, input.plan.bearing)) > bearingEps) {
    return false;
  }
  if (!input.plan.center) return true;
  const eps = input.centerEpsilonDeg ?? 1e-7;
  return (
    Math.abs(input.mapCenter.lon - input.plan.center[0]) <= eps &&
    Math.abs(input.mapCenter.lat - input.plan.center[1]) <= eps
  );
}

export function isMeaningfulUserPan(
  start: { x: number; y: number },
  end: { x: number; y: number },
  minPixels = DEFAULT_USER_PAN_MIN_PX,
): boolean {
  return Math.hypot(end.x - start.x, end.y - start.y) >= minPixels;
}

/**
 * Programmatic easeTo/jumpTo must never look like a user pan.
 * Tesla jitter below minPixels is ignored even when originalEvent exists.
 */
export function shouldTreatAsUserPan(input: {
  programmatic: boolean;
  hasOriginalEvent: boolean;
  start: { x: number; y: number } | null;
  end: { x: number; y: number };
  minPixels?: number;
}): boolean {
  if (input.programmatic) return false;
  if (!input.hasOriginalEvent) return false;
  if (!input.start) return false;
  return isMeaningfulUserPan(input.start, input.end, input.minPixels);
}
