import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';
import { summarizeTrainingAnnotations } from '@/lib/training-annotations';

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

interface UploadRow {
  id: string;
  metadata: unknown;
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

export async function GET(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'dataset-readiness', limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  try {
    const [feedbackResult, uploadResult] = await Promise.all([
      supabase.rpc('get_feedback_export'),
      supabase.from('drone_uploads').select('id,metadata').eq('status', 'ready').limit(2000),
    ]);
    if (feedbackResult.error || uploadResult.error) {
      console.error('[DatasetReadiness] Dataset lookup failed:', feedbackResult.error?.message ?? uploadResult.error?.message);
      return internalServerError('Dataset readiness could not be calculated.');
    }

    const rows = (feedbackResult.data ?? []) as FeedbackRow[];
    const imageSummaries = ((uploadResult.data ?? []) as UploadRow[]).map((row) => summarizeTrainingAnnotations(row.metadata));
    const imageAnnotationSamples = imageSummaries.reduce((total, summary) => total + summary.approved.length, 0);
    const annotatedImages = imageSummaries.filter((summary) => summary.approved.length > 0).length;
    const excludedDemoAnnotations = imageSummaries.reduce((total, summary) => total + summary.excludedDemo, 0);
    const pendingImageAnnotations = imageSummaries.reduce((total, summary) => total + summary.pending, 0);
    const rejectedImageAnnotations = imageSummaries.reduce((total, summary) => total + summary.rejected, 0);
    const invalidAnnotationSets = imageSummaries.filter((summary) => summary.validationError).length;
    const annotationsMissingDimensions = imageSummaries.reduce(
      (total, summary) => total + (!summary.dimensions ? summary.approved.length : 0),
      0,
    );
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

    const guestMapSamples = rows.filter((row) => !row.surveyor_id || row.surveyor_id === 'Guest').length;
    const identifiedImageSamples = imageSummaries.reduce(
      (total, summary) => total + (summary.savedBy && summary.savedBy !== 'Guest' ? summary.approved.length : 0),
      0,
    );
    const guestImageSamples = imageAnnotationSamples - identifiedImageSamples;
    const invalidSamples = rows.length - geometryUsableRows.length + invalidAnnotationSets;
    const missingImageLineage = geometryUsableRows.length - usableRows.length;
    const duplicateRecords = Math.max(0, rows.length - uniqueParcels);
    const correctionPairs = usableRows.filter(
      (row) => row.action === 'edited' && hasUsableGeometry(row.original_geometry) && hasUsableGeometry(row.final_geometry),
    ).length;
    const totalSamples = rows.length + imageAnnotationSamples + pendingImageAnnotations + excludedDemoAnnotations;
    const usableSampleCount = usableRows.length + imageAnnotationSamples;
    const identifiedSamples = rows.length - guestMapSamples + identifiedImageSamples;
    const guestSamples = guestMapSamples + guestImageSamples;
    const qualityScore = totalSamples === 0 ? 0 : Math.round((usableSampleCount / totalSamples) * 100);

    const readiness = usableSampleCount >= 200 && qualityScore >= 90
      ? 'training_ready'
      : usableSampleCount >= 50 && qualityScore >= 80
        ? 'pilot_ready'
        : 'collecting';

    const issues: string[] = [];
    if (invalidSamples > 0) issues.push(`${invalidSamples} sample${invalidSamples === 1 ? '' : 's'} have missing or invalid geometry.`);
    if (missingImageLineage > 0) issues.push(`${missingImageLineage} reviewed sample${missingImageLineage === 1 ? '' : 's'} are not linked to their source image and cannot be used for image-model training.`);
    if (duplicateRecords > 0) issues.push(`${duplicateRecords} repeated parcel review record${duplicateRecords === 1 ? '' : 's'} should be checked before final training.`);
    if (actionCounts.rejected < 10) issues.push('Collect more rejected examples to improve negative-sample balance.');
    if (excludedDemoAnnotations > 0) issues.push(`${excludedDemoAnnotations} approved demo polygon${excludedDemoAnnotations === 1 ? '' : 's'} are excluded; adjust them manually before using them for training.`);
    if (pendingImageAnnotations > 0) issues.push(`${pendingImageAnnotations} image polygon${pendingImageAnnotations === 1 ? '' : 's'} still need reviewer approval or rejection.`);
    if (annotationsMissingDimensions > 0) issues.push(`${annotationsMissingDimensions} approved image polygon${annotationsMissingDimensions === 1 ? '' : 's'} lack stored pixel dimensions; re-upload those source images before training.`);
    if (usableSampleCount < 200) issues.push(`${200 - usableSampleCount} more usable polygon samples are recommended for the first full training run.`);
    if (usableSampleCount > 0 && guestSamples > usableSampleCount / 2) issues.push('Most usable samples were reviewed as Guest; signed-in reviewer identities would improve traceability.');

    return NextResponse.json({
      readiness,
      quality_score: qualityScore,
      total_samples: totalSamples,
      usable_samples: usableSampleCount,
      geometry_usable_samples: geometryUsableRows.length,
      image_linked_samples: imageLinkedRows.length,
      image_annotation_samples: imageAnnotationSamples,
      annotated_images: annotatedImages,
      excluded_demo_annotations: excludedDemoAnnotations,
      pending_image_annotations: pendingImageAnnotations,
      rejected_image_annotations: rejectedImageAnnotations,
      annotations_missing_dimensions: annotationsMissingDimensions,
      invalid_samples: invalidSamples,
      unique_parcels: uniqueParcels,
      duplicate_records: duplicateRecords,
      correction_pairs: correctionPairs,
      identified_samples: identifiedSamples,
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
