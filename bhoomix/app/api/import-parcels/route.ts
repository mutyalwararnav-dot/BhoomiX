import { NextResponse } from 'next/server';
import { validateGeoJsonPolygon } from '@/lib/geometry';
import { contentLengthError, internalServerError, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';
import { supabaseServer } from '@/lib/supabase-server';

const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const MAX_FEATURES = 1000;

interface ImportedProperties {
  id?: unknown;
  confidence_score?: unknown;
  confidence?: unknown;
  computed_area_sqm?: unknown;
  land_use?: unknown;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export async function POST(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'import-parcels', limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, MAX_IMPORT_BYTES);
  if (oversized) return oversized;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: 'Request body must contain valid GeoJSON.' }, { status: 400 });
  }

  if (!payload || typeof payload !== 'object') {
    return NextResponse.json({ error: 'GeoJSON must be an object.' }, { status: 400 });
  }

  const collection = payload as { type?: unknown; features?: unknown };
  if (collection.type !== 'FeatureCollection' || !Array.isArray(collection.features)) {
    return NextResponse.json({ error: 'GeoJSON must be a FeatureCollection.' }, { status: 400 });
  }
  if (collection.features.length === 0 || collection.features.length > MAX_FEATURES) {
    return NextResponse.json(
      { error: `GeoJSON must contain between 1 and ${MAX_FEATURES} features.` },
      { status: 400 },
    );
  }

  const importId = Date.now();
  const parcels: Array<Record<string, unknown>> = [];

  for (let index = 0; index < collection.features.length; index += 1) {
    const rawFeature = collection.features[index];
    if (!rawFeature || typeof rawFeature !== 'object') {
      return NextResponse.json({ error: `Feature ${index + 1} is not an object.` }, { status: 400 });
    }

    const feature = rawFeature as { geometry?: unknown; properties?: ImportedProperties | null };
    const geometryError = validateGeoJsonPolygon(feature.geometry);
    if (geometryError) {
      return NextResponse.json({ error: `Feature ${index + 1}: ${geometryError}` }, { status: 400 });
    }

    const properties = feature.properties || {};
    const confidence = finiteNumber(properties.confidence_score ?? properties.confidence) ?? 0.9;
    if (confidence < 0 || confidence > 1) {
      return NextResponse.json({ error: `Feature ${index + 1} has an invalid confidence score.` }, { status: 400 });
    }

    const suppliedId = typeof properties.id === 'string'
      ? properties.id.replace(/[^a-zA-Z0-9._:-]/g, '-').slice(0, 100)
      : '';
    const area = finiteNumber(properties.computed_area_sqm);

    parcels.push({
      id: `${suppliedId || 'AI-IMPORT'}-${importId}-${index}`,
      status: 'ai_suggestion',
      confidence_score: confidence,
      computed_area_sqm: area !== null && area >= 0 ? area : null,
      land_use: typeof properties.land_use === 'string' ? properties.land_use.slice(0, 100) : 'unknown',
      geometry: feature.geometry,
      source_type: 'imported',
      model_version: 'external-geojson',
    });
  }

  const { data, error } = await supabaseServer.rpc('seed_mock_parcels', { parcels_input: parcels });
  if (error) {
    console.error('[ImportParcels] RPC failed:', error.message);
    return internalServerError('The parcel import could not be completed.');
  }
  if (data && typeof data === 'object' && data.success === false) {
    return NextResponse.json({ error: String(data.error || 'Parcel import failed.') }, { status: 500 });
  }

  return NextResponse.json({ success: true, parcelCount: parcels.length });
}
