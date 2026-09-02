import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

const OVERPASS_ENDPOINTS = [
  'https://overpass.private.coffee/api/interpreter',
  'https://lz4.overpass-api.de/api/interpreter',
  'https://overpass-api.de/api/interpreter',
];
const PUNE_PILOT_QUERY = '[out:json][timeout:15];way["building"](18.5175,73.853,18.5235,73.861);out geom qt;';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_BUILDINGS = 5000;

interface OverpassElement {
  type?: unknown;
  id?: unknown;
  tags?: unknown;
  geometry?: unknown;
}

interface OverpassPoint {
  lat?: unknown;
  lon?: unknown;
}

interface CachedBuildings {
  expiresAt: number;
  geojson: GeoJSON.FeatureCollection<GeoJSON.Polygon>;
}

let cachedBuildings: CachedBuildings | null = null;

function toFeature(element: OverpassElement): GeoJSON.Feature<GeoJSON.Polygon> | null {
  if (element.type !== 'way' || typeof element.id !== 'number' || !Array.isArray(element.geometry)) return null;

  const coordinates = (element.geometry as OverpassPoint[]).flatMap((point) => {
    const longitude = Number(point.lon);
    const latitude = Number(point.lat);
    return Number.isFinite(longitude) && Number.isFinite(latitude)
      ? [[longitude, latitude] as [number, number]]
      : [];
  });
  if (coordinates.length < 3) return null;

  const first = coordinates[0];
  const last = coordinates[coordinates.length - 1];
  if (first[0] !== last[0] || first[1] !== last[1]) coordinates.push([...first]);

  const tags = element.tags && typeof element.tags === 'object'
    ? element.tags as Record<string, unknown>
    : {};

  return {
    type: 'Feature',
    id: `osm-building-${element.id}`,
    properties: {
      osm_id: element.id,
      building: typeof tags.building === 'string' ? tags.building : 'yes',
      name: typeof tags.name === 'string' ? tags.name : null,
      source: 'OpenStreetMap',
      reference_only: true,
    },
    geometry: {
      type: 'Polygon',
      coordinates: [coordinates],
    },
  };
}

async function requestBuildings(endpoint: string) {
  const body = new URLSearchParams({ data: PUNE_PILOT_QUERY });
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
      'User-Agent': 'BhoomiX/0.1 local cadastral prototype',
    },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(25_000),
  });
  if (!response.ok) throw new Error(`OpenStreetMap reference service returned HTTP ${response.status}.`);

  const payload = await response.json() as { elements?: unknown };
  if (!Array.isArray(payload.elements)) throw new Error('OpenStreetMap returned an invalid response.');
  const features = (payload.elements as OverpassElement[])
    .slice(0, MAX_BUILDINGS)
    .flatMap((element) => {
      const feature = toFeature(element);
      return feature ? [feature] : [];
    });

  return {
    type: 'FeatureCollection',
    features,
  } satisfies GeoJSON.FeatureCollection<GeoJSON.Polygon>;
}

export async function GET() {
  if (cachedBuildings && cachedBuildings.expiresAt > Date.now()) {
    return NextResponse.json(
      { geojson: cachedBuildings.geojson, count: cachedBuildings.geojson.features.length, source: 'OpenStreetMap' },
      { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=21600' } },
    );
  }

  let lastError = 'Reference buildings could not be loaded.';
  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const geojson = await requestBuildings(endpoint);
      if (geojson.features.length === 0) throw new Error('No reference buildings were returned for the Pune pilot area.');
      cachedBuildings = { geojson, expiresAt: Date.now() + CACHE_TTL_MS };
      return NextResponse.json(
        { geojson, count: geojson.features.length, source: 'OpenStreetMap' },
        { headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=21600' } },
      );
    } catch (error: unknown) {
      lastError = error instanceof Error ? error.message : lastError;
    }
  }

  console.warn('[ReferenceBuildings] All OpenStreetMap reference endpoints failed:', lastError);
  return NextResponse.json({ error: 'Reference building footprints are temporarily unavailable.' }, { status: 502 });
}
