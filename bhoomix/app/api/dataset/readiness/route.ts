import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { internalServerError, serverConfigurationError } from '@/lib/request-safety';

type FeedbackAction = 'edited' | 'rejected' | 'confirmed';

interface FeedbackRow {
  log_id: string;
  parcel_id: string;
  action: FeedbackAction;
  original_geometry: GeoJSON.Geometry | null;
  final_geometry: GeoJSON.Geometry | null;
  surveyor_id: string | null;
  source_upload_id?: string | null;
  source_file_path?: string | null;
}

function hasUsableGeometry(geometry: GeoJSON.Geometry | null) {
  if (!geometry || !['Polygon', 'MultiPolygon'].includes(geometry.type)) return false;
  if (!('coordinates' in geometry) || !Array.isArray(geometry.coordinates)) return false;
  return geometry.coordinates.length > 0;
}

function isUsableSample(row: FeedbackRow) {
  const hasOriginal = hasUsableGeometry(row.original_geometry);
  if (row.action === 'edited') return hasOriginal && hasUsableGeometry(row.final_geometry);
  return hasOriginal;
}

export async function GET() {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  try {
    const { data, error } = await supabase.rpc('get_feedback_export');
    if (error) {
      console.error('[DatasetReadiness] Feedback export failed:', error.message);
      return internalServerError('Dataset readiness could not be calculated.');
    }

    const rows = (data ?? []) as FeedbackRow[];
    const geometryUsableRows = rows.filter(isUsableSample);
    const imageLinkedRows = rows.filter((row) => Boolean(row.source_upload_id && row.source_file_path));
    const usableRows = geometryUsableRows.filter((row) => Boolean(row.source_upload_id && row.source_file_path));
    const uniqueParcels = new Set(rows.map((row) => row.parcel_id)).size;
    const actionCounts = rows.reduce(
      (counts, row) => {
        counts[row.action] += 1;
        return counts;
      },
      { confirmed: 0, edited: 0, rejected: 0 } as Record<FeedbackAction, number>,
    );

    const guestSamples = rows.filter((row) => !row.surveyor_id || row.surveyor_id === 'Guest').length;
    const invalidSamples = rows.length - geometryUsableRows.length;
    const missingImageLineage = geometryUsableRows.length - usableRows.length;
    const duplicateRecords = Math.max(0, rows.length - uniqueParcels);
    const correctionPairs = usableRows.filter(
      (row) => row.action === 'edited' && hasUsableGeometry(row.original_geometry) && hasUsableGeometry(row.final_geometry),
    ).length;
    const qualityScore = rows.length === 0 ? 0 : Math.round((usableRows.length / rows.length) * 100);

    const readiness = usableRows.length >= 200 && qualityScore >= 90
      ? 'training_ready'
      : usableRows.length >= 50 && qualityScore >= 80
        ? 'pilot_ready'
        : 'collecting';

    const issues: string[] = [];
    if (invalidSamples > 0) issues.push(`${invalidSamples} sample${invalidSamples === 1 ? '' : 's'} have missing or invalid geometry.`);
    if (missingImageLineage > 0) issues.push(`${missingImageLineage} reviewed sample${missingImageLineage === 1 ? '' : 's'} are not linked to their source image and cannot be used for image-model training.`);
    if (duplicateRecords > 0) issues.push(`${duplicateRecords} repeated parcel review record${duplicateRecords === 1 ? '' : 's'} should be checked before final training.`);
    if (actionCounts.rejected < 10) issues.push('Collect more rejected examples to improve negative-sample balance.');
    if (usableRows.length < 200) issues.push(`${200 - usableRows.length} more usable samples are recommended for the first full training run.`);
    if (guestSamples > rows.length / 2) issues.push('Most samples were reviewed as Guest; signed-in reviewer identities would improve traceability.');

    return NextResponse.json({
      readiness,
      quality_score: qualityScore,
      total_samples: rows.length,
      usable_samples: usableRows.length,
      geometry_usable_samples: geometryUsableRows.length,
      image_linked_samples: imageLinkedRows.length,
      invalid_samples: invalidSamples,
      unique_parcels: uniqueParcels,
      duplicate_records: duplicateRecords,
      correction_pairs: correctionPairs,
      identified_samples: rows.length - guestSamples,
      guest_samples: guestSamples,
      actions: actionCounts,
      issues,
      generated_at: new Date().toISOString(),
    }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[DatasetReadiness] Unexpected error:', message);
    return internalServerError('Dataset readiness could not be calculated.');
  }
}
