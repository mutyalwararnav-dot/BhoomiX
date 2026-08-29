import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { resolveRequestActor } from '@/lib/request-actor';
import { validateGeoJsonPolygon } from '@/lib/geometry';
import { contentLengthError, internalServerError, isValidParcelId, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

// POST /api/feedback/log
// Body: { parcel_id, action, original_geometry?, final_geometry? }
// Logs a surveyor action into model_feedback_logs via the PostGIS RPC.
// Falls back to a direct table insert if the RPC is not deployed yet.
export async function POST(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'feedback-log', limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 2 * 1024 * 1024);
  if (oversized) return oversized;

  try {
    const actor = await resolveRequestActor(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const { parcel_id, action, original_geometry, final_geometry } = body;

    if (!isValidParcelId(parcel_id) || typeof action !== 'string' || !action) {
      return NextResponse.json(
        { error: 'Missing required fields: parcel_id, action' },
        { status: 400 }
      );
    }

    if (!['edited', 'rejected', 'confirmed'].includes(action)) {
      return NextResponse.json(
        { error: 'action must be "edited", "rejected", or "confirmed"' },
        { status: 400 }
      );
    }

    if (original_geometry) {
      const originalError = validateGeoJsonPolygon(original_geometry);
      if (originalError) return NextResponse.json({ error: `Original geometry: ${originalError}` }, { status: 400 });
    }

    if (final_geometry) {
      const finalError = validateGeoJsonPolygon(final_geometry);
      if (finalError) return NextResponse.json({ error: `Final geometry: ${finalError}` }, { status: 400 });
    }

    // Try the RPC first (available after 04_model_feedback.sql is deployed)
    const { data: logId, error: rpcError } = await supabase.rpc('log_parcel_feedback', {
      p_parcel_id:        parcel_id,
      p_action:           action,
      p_original_geojson: original_geometry ?? null,
      p_final_geojson:    final_geometry    ?? null,
      p_surveyor_id:      actor,
    });

    if (!rpcError) {
      return NextResponse.json({ success: true, log_id: logId });
    }

    // Fallback: direct insert without PostGIS delta computation
    console.warn('[FeedbackLog] RPC not available, falling back to direct insert:', rpcError.message);
    const { data: row, error: insertError } = await supabase
      .from('model_feedback_logs')
      .insert({
        parcel_id,
        action,
        original_geometry: original_geometry ?? null,
        final_geometry:    final_geometry    ?? null,
        surveyor_id:       actor,
      })
      .select('id')
      .single();

    if (insertError) {
      console.error('[FeedbackLog] Direct insert error:', insertError.message);
      return internalServerError('The review feedback could not be recorded.');
    }

    return NextResponse.json({ success: true, log_id: row?.id });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[FeedbackLog] Unexpected error:', message);
    return internalServerError('The review feedback could not be recorded.');
  }
}
