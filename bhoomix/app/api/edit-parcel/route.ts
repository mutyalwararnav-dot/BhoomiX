import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { resolveRequestActor } from '@/lib/request-actor';
import { validateGeoJsonPolygon } from '@/lib/geometry';
import { contentLengthError, internalServerError, isValidParcelId, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

// POST /api/edit-parcel
// Body: { parcel_id: string, geojson_geometry: GeoJSON.Polygon }
// 1. Fetches original geometry (for feedback delta)
// 2. Calls update_parcel_geometry RPC → sets status = 'reviewed_edited'
// 3. Logs the edit into model_feedback_logs (fire-and-forget)
export async function POST(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'edit-parcel', limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 1024 * 1024);
  if (oversized) return oversized;

  try {
    const actor = await resolveRequestActor(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const { parcel_id, geojson_geometry } = body;

    if (!isValidParcelId(parcel_id) || !geojson_geometry) {
      return NextResponse.json(
        { error: 'Missing required fields: parcel_id and geojson_geometry' },
        { status: 400 }
      );
    }

    const geometryError = validateGeoJsonPolygon(geojson_geometry);
    if (geometryError) {
      return NextResponse.json(
        { error: geometryError },
        { status: 400 }
      );
    }

    // ── Fetch original geometry BEFORE update (for feedback delta) ──────────
    let originalGeometry: GeoJSON.Polygon | null = null;
    try {
      const { data: existing } = await supabase
        .from('parcels')
        .select('geometry')
        .eq('id', parcel_id)
        .single();
      originalGeometry = existing?.geometry ?? null;
    } catch { /* non-fatal */ }

    // ── Call PostGIS RPC → updates geometry + status + writes audit trail ───
    const { data: result, error } = await supabase.rpc('update_parcel_geometry', {
      p_id:          parcel_id,
      p_new_geojson: geojson_geometry,
      p_changed_by:  actor,
    });

    if (error) {
      console.error('[EditParcel] RPC error:', error.message);
      return internalServerError('The parcel geometry could not be saved.');
    }

    // update_parcel_geometry returns { success: bool, error?: string }
    if (result && result.success === false) {
      return NextResponse.json(
        { error: result.error ?? 'RPC returned failure' },
        { status: 500 }
      );
    }

    // ── Fire-and-forget: log the edit for model feedback ────────────────────
    const { error: feedbackError } = await supabase.rpc('log_parcel_feedback', {
      p_parcel_id:        parcel_id,
      p_action:           'edited',
      p_original_geojson: originalGeometry
        ? JSON.parse(JSON.stringify(originalGeometry))
        : null,
      p_final_geojson:    geojson_geometry,
      p_surveyor_id:      actor,
    });
    if (feedbackError) {
      console.warn('[EditParcel] Feedback log error:', feedbackError.message);
    }

    return NextResponse.json({ success: true, parcel_id, changed_by: actor });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[EditParcel] Unexpected error:', message);
    return internalServerError('The parcel geometry could not be saved.');
  }
}
