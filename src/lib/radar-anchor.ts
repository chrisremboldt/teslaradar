export type RadarCoverAnchor = {
  lat: number;
  lon: number;
  zoom: number;
  size: number;
};

/**
 * A RainViewer centered image already covers a whole mercator tile at `zoom`.
 * Following-mode GPS hops (~tens of meters) must not start a new 12-frame
 * download — that is what blanked the overlay after watchPosition landed.
 */
export function radarAnchorStillCovers(
  prev: RadarCoverAnchor,
  next: RadarCoverAnchor,
  slopFraction = 0.25,
): boolean {
  if (prev.size !== next.size || prev.zoom !== next.zoom) return false;
  const tileDeg = 360 / 2 ** prev.zoom;
  const slop = tileDeg * slopFraction;
  return Math.abs(prev.lat - next.lat) <= slop && Math.abs(prev.lon - next.lon) <= slop;
}
