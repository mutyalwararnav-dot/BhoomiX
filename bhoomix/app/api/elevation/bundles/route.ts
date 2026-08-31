import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

interface ElevationMetadata {
  bundle_id?: unknown;
  layer_type?: unknown;
  georeferencing?: { wgs84BoundingBox?: unknown; sourceCrs?: unknown };
  ndsm_statistics?: unknown;
  validation?: unknown;
}

export async function GET(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'elevation-bundles', limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const { data, error } = await supabase
    .from('drone_uploads')
    .select('id,filename,metadata,created_at,uploaded_by')
    .eq('metadata->>layer_type', 'ndsm')
    .eq('status', 'ready')
    .order('created_at', { ascending: false })
    .limit(25);
  if (error) {
    console.error('[ElevationBundles] Lookup failed:', error.message);
    return internalServerError('Saved elevation projects could not be loaded.');
  }

  const bundles = (data ?? []).flatMap(row => {
    const metadata = row.metadata as ElevationMetadata | null;
    const bbox = metadata?.georeferencing?.wgs84BoundingBox;
    if (typeof metadata?.bundle_id !== 'string' || !Array.isArray(bbox) || bbox.length !== 4) return [];
    return [{
      bundleId: metadata.bundle_id,
      ndsmUploadId: row.id,
      filename: row.filename,
      previewUrl: `/api/imagery/${row.id}/overlay`,
      boundingBox: bbox,
      crs: typeof metadata.georeferencing?.sourceCrs === 'string' ? metadata.georeferencing.sourceCrs : null,
      statistics: metadata.ndsm_statistics,
      validation: metadata.validation,
      createdAt: row.created_at,
      uploadedBy: row.uploaded_by,
    }];
  });

  return NextResponse.json({ bundles }, { headers: { 'Cache-Control': 'no-store' } });
}
