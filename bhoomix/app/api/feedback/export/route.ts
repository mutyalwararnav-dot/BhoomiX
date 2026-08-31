import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { resolveRequestPrincipal } from '@/lib/request-actor';
import { internalServerError, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

// GET /api/feedback/export
//
// Exports the model-feedback audit log as GeoJSON. Each feature retains the
// original AI geometry, the final human geometry, and the computed delta.

interface FeedbackRow {
  log_id: string;
  parcel_id: string;
  action: 'edited' | 'rejected' | 'confirmed';
  original_geometry: GeoJSON.Geometry | null;
  final_geometry: GeoJSON.Geometry | null;
  geometry_delta: GeoJSON.Geometry | null;
  area_delta_sqm: number | null;
  surveyor_id: string | null;
  created_at: string;
  source_upload_id?: string | null;
  source_filename?: string | null;
  source_file_path?: string | null;
  source_type?: string | null;
  model_version?: string | null;
}

interface VerifiedParcelRow {
  id: string;
  status: 'reviewed_edited' | 'confirmed';
  geometry: GeoJSON.Polygon;
  confidence_score: number | null;
  computed_area_sqm: number | null;
  land_use: string | null;
}

function geoJsonResponse(featureCollection: GeoJSON.FeatureCollection<GeoJSON.Geometry | null>) {
  return new NextResponse(JSON.stringify(featureCollection, null, 2), {
    status: 200,
    headers: {
      'Content-Type':        'application/geo+json',
      'Content-Disposition': 'attachment; filename="bhoomix_retraining_dataset.geojson"',
      'Cache-Control':       'no-store',
    },
  });
}

async function handleExport(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  if (request.method === 'POST') {
    const originError = mutationRequestError(request);
    if (originError) return originError;
  }
  const limited = rateLimitRequest(request, { bucket: 'feedback-export', limit: 10, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const principal = await resolveRequestPrincipal(request);
    if (!['admin', 'surveyor'].includes(principal.role)) {
      return NextResponse.json(
        { error: 'A surveyor or administrator account is required to export training data.' },
        { status: 403 },
      );
    }

    const { data, error } = await supabase.rpc('get_feedback_export');

    const rows = (data ?? []) as FeedbackRow[];

    if (error || rows.length === 0) {
      if (error) {
        console.warn('[FeedbackExport] Feedback RPC unavailable; exporting verified parcels:', error.message);
      }

      const { data: parcelData, error: parcelError } = await supabase
        .from('parcels')
        .select('id,status,geometry,confidence_score,computed_area_sqm,land_use')
        .in('status', ['reviewed_edited', 'confirmed']);

      if (parcelError) {
        console.error('[FeedbackExport] Verified parcel fallback failed:', parcelError.message);
        return internalServerError('Training data could not be exported.');
      }

      const verifiedParcels = (parcelData ?? []) as VerifiedParcelRow[];
      return geoJsonResponse({
        type: 'FeatureCollection',
        features: verifiedParcels.map(parcel => ({
          type: 'Feature',
          id: parcel.id,
          geometry: parcel.geometry,
          properties: {
            parcel_id: parcel.id,
            action: parcel.status === 'reviewed_edited' ? 'edited' : 'confirmed',
            confidence_score: parcel.confidence_score,
            computed_area_sqm: parcel.computed_area_sqm,
            land_use: parcel.land_use,
            label: 'cadastral_parcel',
            verified_by_human: true,
            export_source: 'verified_parcel_status',
          },
        })),
      });
    }

    const featureCollection: GeoJSON.FeatureCollection<GeoJSON.Geometry | null> = {
      type: 'FeatureCollection',
      features: rows.map(row => ({
        type:     'Feature',
        id:       row.log_id,
        geometry: row.final_geometry ??
          (row.action === 'confirmed' ? row.original_geometry : null),
        properties: {
          log_id: row.log_id,
          parcel_id: row.parcel_id,
          action: row.action,
          original_geometry: row.original_geometry,
          final_geometry: row.final_geometry,
          geometry_delta: row.geometry_delta,
          area_delta_sqm: row.area_delta_sqm,
          surveyor_id: row.surveyor_id,
          reviewed_at: row.created_at,
          source_upload_id: row.source_upload_id ?? null,
          source_filename: row.source_filename ?? null,
          source_file_path: row.source_file_path ?? null,
          source_type: row.source_type ?? 'unknown',
          model_version: row.model_version ?? null,
          label: 'cadastral_parcel',
          verified_by_human: true,
        },
      })),
    };

    return geoJsonResponse(featureCollection);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[FeedbackExport] Unexpected error:', message);
    return internalServerError('Training data could not be exported.');
  }
}

export const GET = handleExport;
export const POST = handleExport;
