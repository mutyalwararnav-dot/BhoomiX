import { NextResponse } from 'next/server';
import { resolveRequestPrincipal } from '@/lib/request-actor';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';
import { annotationToTrainingPolygons, summarizeTrainingAnnotations } from '@/lib/training-annotations';
import { supabaseServer as supabase } from '@/lib/supabase-server';

interface TrainingUploadRow {
  id: string;
  filename: string;
  file_path: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string;
  metadata: unknown;
  created_at: string;
}

export async function GET(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'image-annotation-export', limit: 10, windowMs: 60_000 });
  if (limited) return limited;

  const principal = await resolveRequestPrincipal(request);
  if (!['admin', 'surveyor'].includes(principal.role)) {
    return NextResponse.json(
      { error: 'A surveyor or administrator account is required to export image annotations.' },
      { status: 403 },
    );
  }

  const { data, error } = await supabase
    .from('drone_uploads')
    .select('id,filename,file_path,file_size_bytes,mime_type,uploaded_by,metadata,created_at')
    .eq('status', 'ready')
    .order('created_at', { ascending: true })
    .limit(2000);

  if (error) {
    console.error('[ImageAnnotationExport] Upload lookup failed:', error.message);
    return internalServerError('The image-annotation dataset could not be exported.');
  }

  let approvedPolygonCount = 0;
  let excludedDemoCount = 0;
  let missingDimensionCount = 0;
  const images = ((data ?? []) as TrainingUploadRow[]).flatMap((upload) => {
    const summary = summarizeTrainingAnnotations(upload.metadata);
    excludedDemoCount += summary.excludedDemo;
    if (!summary.approved.length) return [];
    approvedPolygonCount += summary.approved.length;
    if (!summary.dimensions) missingDimensionCount += 1;

    return [{
      upload_id: upload.id,
      filename: upload.filename,
      storage_path: upload.file_path,
      mime_type: upload.mime_type,
      file_size_bytes: upload.file_size_bytes,
      dimensions: summary.dimensions,
      annotations: summary.approved.map((annotation) => annotationToTrainingPolygons(annotation, summary.dimensions)),
      provenance: {
        uploaded_by: upload.uploaded_by,
        uploaded_at: upload.created_at,
        reviewed_by: summary.savedBy,
        reviewed_at: summary.savedAt,
      },
    }];
  });

  const payload = {
    schema: 'bhoomix-image-annotations/v1',
    generated_at: new Date().toISOString(),
    coordinate_system: {
      polygon_normalized: '[x/image_width, y/image_height] in the range 0..1',
      polygon_pixels: 'pixel coordinates when image dimensions are available',
    },
    images,
    report: {
      image_count: images.length,
      approved_polygon_count: approvedPolygonCount,
      excluded_demo_polygon_count: excludedDemoCount,
      images_missing_dimensions: missingDimensionCount,
    },
  };

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': 'attachment; filename="bhoomix_image_annotations.json"',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  });
}
