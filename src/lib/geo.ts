type PolygonFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
};

type LineFeature = {
  type: "Feature";
  properties: { id: string; label: string };
  geometry: {
    type: "LineString";
    coordinates: [number, number][];
  };
};

function ringScales(lat: number): { latScale: number; lonScale: number } {
  return {
    latScale: 1 / 110_540,
    lonScale: 1 / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180))),
  };
}

export function ringCoordinates(
  lon: number,
  lat: number,
  radiusMeters: number,
  points = 96,
): [number, number][] {
  const { latScale, lonScale } = ringScales(lat);
  const coords: [number, number][] = [];
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    coords.push([
      lon + radiusMeters * lonScale * Math.cos(angle),
      lat + radiusMeters * latScale * Math.sin(angle),
    ]);
  }
  return coords;
}

/** East edge of a ring — quiet label sits just outside the stroke. */
export function ringLabelLngLat(
  lon: number,
  lat: number,
  radiusMeters: number,
): [number, number] {
  const { lonScale } = ringScales(lat);
  return [lon + radiusMeters * lonScale, lat];
}

export function accuracyCircle(
  lon: number,
  lat: number,
  radiusMeters: number,
  points = 64,
): PolygonFeature {
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [ringCoordinates(lon, lat, radiusMeters, points)],
    },
  };
}

export function rangeRingLine(
  lon: number,
  lat: number,
  radiusMeters: number,
  id: string,
  label: string,
): LineFeature {
  return {
    type: "Feature",
    properties: { id, label },
    geometry: {
      type: "LineString",
      coordinates: ringCoordinates(lon, lat, radiusMeters),
    },
  };
}

export function rangeRingsCollection(
  lon: number,
  lat: number,
  rings: { radiusMeters: number; id: string; label: string }[],
): {
  type: "FeatureCollection";
  features: LineFeature[];
} {
  return {
    type: "FeatureCollection",
    features: rings
      .filter((ring) => ring.radiusMeters > 0)
      .map((ring) => rangeRingLine(lon, lat, ring.radiusMeters, ring.id, ring.label)),
  };
}

export function emptyCollection(): {
  type: "FeatureCollection";
  features: [];
} {
  return { type: "FeatureCollection", features: [] };
}
