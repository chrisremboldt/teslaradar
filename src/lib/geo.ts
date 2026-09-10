type PolygonFeature = {
  type: "Feature";
  properties: Record<string, never>;
  geometry: {
    type: "Polygon";
    coordinates: [number, number][][];
  };
};

export function accuracyCircle(
  lon: number,
  lat: number,
  radiusMeters: number,
  points = 64,
): PolygonFeature {
  const coords: [number, number][] = [];
  const latScale = 1 / 110_540;
  const lonScale = 1 / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));
  for (let i = 0; i <= points; i += 1) {
    const angle = (i / points) * Math.PI * 2;
    coords.push([
      lon + radiusMeters * lonScale * Math.cos(angle),
      lat + radiusMeters * latScale * Math.sin(angle),
    ]);
  }
  return {
    type: "Feature",
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [coords],
    },
  };
}

export function emptyCollection(): {
  type: "FeatureCollection";
  features: [];
} {
  return { type: "FeatureCollection", features: [] };
}
