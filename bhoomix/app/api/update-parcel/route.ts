import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { resolveRequestActor } from '@/lib/request-actor';
import { contentLengthError, internalServerError, isValidParcelId, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

// POST /api/update-parcel
// Body: { parcel_id: string, new_status: 'confirmed' | 'rejected' }
export async function POST(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'update-parcel', limit: 60, windowMs: 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 16 * 1024);
  if (oversized) return oversized;

  try {
    const actor = await resolveRequestActor(request);
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
    const { parcel_id, new_status } = body;

    if (!isValidParcelId(parcel_id) || typeof new_status !== 'string' || !new_status) {
      return NextResponse.json(
        { error: 'Missing required fields: parcel_id and new_status' },
        { status: 400 }
      );
    }

    if (!['confirmed', 'rejected'].includes(new_status)) {
      return NextResponse.json(
        { error: 'new_status must be "confirmed" or "rejected"' },
        { status: 400 }
      );
    }

    // Fetch the current geometry before we change status (needed for logging)
    let currentGeometry: GeoJSON.Polygon | null = null;
    try {
      const { data: existing } = await supabase
        .from('parcels')
        .select('geometry')
        .eq('id', parcel_id)
        .single();
      currentGeometry = existing?.geometry ?? null;
    } catch { /* non-fatal */ }

    const { data: updatedParcel, error } = await supabase
      .from('parcels')
      .update({ status: new_status })
      .eq('id', parcel_id)
      .select('id')
      .maybeSingle();

    if (error) {
      console.error('[UpdateParcel] DB update failed:', error.message);
      return internalServerError('The parcel status could not be updated.');
    }

    if (!updatedParcel) {
      return NextResponse.json({ error: 'Parcel not found' }, { status: 404 });
    }

    // ── Fire-and-forget: log the action for model feedback ─────────────────
    // 'rejected' and 'confirmed' have no final geometry (no edits were made)
    const { error: feedbackError } = await supabase.rpc('log_parcel_feedback', {
      p_parcel_id:        parcel_id,
      p_action:           new_status === 'confirmed' ? 'confirmed' : 'rejected',
      p_original_geojson: currentGeometry ?? null,
      p_final_geojson:    null,
      p_surveyor_id:      actor,
    });
    if (feedbackError) {
      console.warn('[UpdateParcel] Feedback log error:', feedbackError.message);
    }

    return NextResponse.json({ success: true, parcel_id, new_status, changed_by: actor });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[UpdateParcel] Unexpected error:', message);
    return internalServerError('The parcel status could not be updated.');
  }
}
