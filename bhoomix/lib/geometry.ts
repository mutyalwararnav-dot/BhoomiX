export type LngLatCoordinate = [number, number];

export function normalizeLinearRing(
  positions: readonly GeoJSON.Position[]
): LngLatCoordinate[] {
  const ring: LngLatCoordinate[] = [];

  for (const position of positions) {
    const lng = Number(position[0]);
    const lat = Number(position[1]);
    if (!Number.isFinite(lng) || !Number.isFinite(lat)) continue;

    const previous = ring[ring.length - 1];
    if (!previous || previous[0] !== lng || previous[1] !== lat) {
      ring.push([lng, lat]);
    }
  }

  if (ring.length < 3) {
    throw new Error('A polygon needs at least three valid, distinct vertices.');
  }

  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) {
    ring.push([first[0], first[1]]);
  }

  if (ring.length < 4) {
    throw new Error('The polygon ring could not be closed.');
  }

  return ring;
}

export function ringToWkt(ring: readonly LngLatCoordinate[]): string {
  return `POLYGON((${ring.map(([lng, lat]) => `${lng} ${lat}`).join(', ')}))`;
}

export function validateGeoJsonPolygon(value: unknown, maximumVertices = 5000): string | null {
  if (!value || typeof value !== 'object') return 'Geometry must be an object.';

  const geometry = value as { type?: unknown; coordinates?: unknown };
  if (geometry.type !== 'Polygon') return 'Geometry must be a GeoJSON Polygon.';
  if (!Array.isArray(geometry.coordinates) || geometry.coordinates.length === 0) {
    return 'Polygon coordinates must contain at least one linear ring.';
  }

  let vertexCount = 0;
  for (const rawRing of geometry.coordinates) {
    if (!Array.isArray(rawRing) || rawRing.length < 4) {
      return 'Every polygon ring must contain at least four positions.';
    }

    vertexCount += rawRing.length;
    if (vertexCount > maximumVertices) {
      return `Polygon exceeds the ${maximumVertices}-vertex safety limit.`;
    }

    for (const rawPosition of rawRing) {
      if (!Array.isArray(rawPosition) || rawPosition.length < 2) {
        return 'Every polygon position must contain longitude and latitude.';
      }
      const longitude = Number(rawPosition[0]);
      const latitude = Number(rawPosition[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
        return 'Polygon coordinates must be finite numbers.';
      }
      if (longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        return 'Polygon coordinates are outside valid WGS84 bounds.';
      }
    }

    const first = rawRing[0] as unknown[];
    const last = rawRing[rawRing.length - 1] as unknown[];
    if (Number(first[0]) !== Number(last[0]) || Number(first[1]) !== Number(last[1])) {
      return 'Every polygon ring must be closed.';
    }
  }

  return null;
}
