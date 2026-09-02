import { NextResponse } from 'next/server';
import { validateGeoJsonPolygon } from '@/lib/geometry';
import type { ParcelFeature } from '@/lib/supabase';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

interface ParcelRow {
  id: string;
  status: ParcelFeature['properties']['status'];
  confidence_score: number | string | null;
  computed_area_sqm: number | string | null;
  land_use: string | null;
  geometry: unknown;
  source_type: 'model' | 'imported';
  source_upload_id: string | null;
  model_version: string | null;
}

const PARCEL_COLUMNS = [
  'id',
  'status',
  'confidence_score',
  'computed_area_sqm',
  'land_use',
  'geometry',
  'source_type',
  'source_upload_id',
  'model_version',
].join(',');

function finiteNumber(value: number | string | null) {
  if (value === null) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function toFeature(row: ParcelRow): ParcelFeature | null {
  let geometry = row.geometry;
  if (typeof geometry === 'string') {
    try {
      geometry = JSON.parse(geometry) as unknown;
    } catch {
      return null;
    }
  }
  if (validateGeoJsonPolygon(geometry)) return null;

  return {
    type: 'Feature',
    id: row.id,
    geometry: geometry as GeoJSON.Polygon,
    properties: {
      id: row.id,
      status: row.status,
      confidence_score: finiteNumber(row.confidence_score),
      computed_area_sqm: finiteNumber(row.computed_area_sqm),
      land_use: row.land_use,
      source_type: row.source_type,
      source_upload_id: row.source_upload_id,
      model_version: row.model_version,
    },
  };
}

/**
 * Returns only parcels with trustworthy spatial lineage.
 *
 * Historical seed/demo rows are intentionally retained in Supabase for audit
 * purposes, but they are not valid live-map observations and must never be
 * mixed with imported GeoJSON or georeferenced model output.
 */
export async function GET(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'active-parcels', limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const [importedResult, modelResult, legacyCountResult] = await Promise.all([
    supabase
      .from('parcels')
      .select(PARCEL_COLUMNS)
      .eq('source_type', 'imported')
      .order('id', { ascending: true }),
    supabase
      .from('parcels')
      .select(PARCEL_COLUMNS)
      .eq('source_type', 'model')
      .not('source_upload_id', 'is', null)
      .order('id', { ascending: true }),
    supabase
      .from('parcels')
      .select('id', { count: 'exact', head: true })
      .in('source_type', ['unknown', 'demo']),
  ]);

  const databaseError = importedResult.error || modelResult.error || legacyCountResult.error;
  if (databaseError) {
    console.error('[ActiveParcels] Lookup failed:', databaseError.message);
    return internalServerError('Georeferenced parcels could not be loaded.');
  }

  const rows = [
    ...((importedResult.data ?? []) as unknown as ParcelRow[]),
    ...((modelResult.data ?? []) as unknown as ParcelRow[]),
  ];
  const features = rows.flatMap((row) => {
    const feature = toFeature(row);
    return feature ? [feature] : [];
  });

  return NextResponse.json(
    {
      geojson: {
        type: 'FeatureCollection',
        features,
      } satisfies GeoJSON.FeatureCollection<GeoJSON.Polygon>,
      legacyHiddenCount: legacyCountResult.count ?? 0,
    },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
