import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { contentLengthError, internalServerError, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

// POST /api/validate-parcels
// Body (optional): { tolerance_sqm?: number }
//
// Calls the `flag_active_overlapping_parcels` PostGIS function which:
//   • Scans georeferenced model/imported parcel pairs for intersection
//   • Promotes both parcels to 'conflict' if overlap > tolerance_sqm
//   • Returns the list of conflicting pairs for the caller to log
//
// This endpoint is called automatically by /api/process-imagery after
// inserting new AI parcels, but can also be called ad-hoc from the UI.
async function runValidation(toleranceSqm: number) {
  try {
    if (!Number.isFinite(toleranceSqm) || toleranceSqm < 0 || toleranceSqm > 1_000_000) {
      return NextResponse.json(
        { error: 'tolerance_sqm must be between 0 and 1,000,000.' },
        { status: 400 }
      );
    }

    // Avoid calling the spatial RPC when the only stored geometry is legacy
    // demo/test data. This keeps an empty production queue valid even before
    // migration 11 has been applied.
    const [importedCountResult, modelCountResult] = await Promise.all([
      supabase
        .from('parcels')
        .select('id', { count: 'exact', head: true })
        .eq('source_type', 'imported')
        .eq('status', 'ai_suggestion'),
      supabase
        .from('parcels')
        .select('id', { count: 'exact', head: true })
        .eq('source_type', 'model')
        .not('source_upload_id', 'is', null)
        .eq('status', 'ai_suggestion'),
    ]);
    const countError = importedCountResult.error || modelCountResult.error;
    if (countError) {
      console.error('[ValidateParcels] Active parcel lookup failed:', countError.message);
      return internalServerError('Spatial validation could not be completed.');
    }
    if ((importedCountResult.count ?? 0) + (modelCountResult.count ?? 0) < 2) {
      return NextResponse.json({ success: true, conflict_pairs: [], conflict_count: 0 });
    }

    const { data, error } = await supabase.rpc('flag_active_overlapping_parcels', {
      p_tolerance_sqm: toleranceSqm,
    });

    if (error) {
      console.error('[ValidateParcels] RPC error:', error.message);
      return internalServerError('Spatial validation could not be completed.');
    }

    // data is an array of { parcel_a, parcel_b, overlap_sqm }
    const conflicts = (data ?? []) as Array<{
      parcel_a:    string;
      parcel_b:    string;
      overlap_sqm: number;
    }>;

    console.log(`[ValidateParcels] Flagged ${conflicts.length} conflict pair(s)`);

    return NextResponse.json({
      success:        true,
      conflict_pairs: conflicts,
      conflict_count: conflicts.length,
    });

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[ValidateParcels] Unexpected error:', message);
    return internalServerError('Spatial validation could not be completed.');
  }
}

export async function POST(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'validate-parcels', limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 8 * 1024);
  if (oversized) return oversized;

  let body: { tolerance_sqm?: unknown } = {};
  const rawBody = await request.text();
  if (rawBody.trim()) {
    try {
      body = JSON.parse(rawBody) as { tolerance_sqm?: unknown };
    } catch {
      return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
    }
  }
  const tolerance = body.tolerance_sqm === undefined ? 1 : Number(body.tolerance_sqm);
  return runValidation(tolerance);
}
