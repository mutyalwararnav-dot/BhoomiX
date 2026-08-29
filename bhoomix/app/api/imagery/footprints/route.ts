import { NextResponse } from 'next/server';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

interface StoredMetadata {
  georeferencing?: {
    georeferenced?: unknown;
    sourceCrs?: unknown;
    epsg?: unknown;
    wgs84BoundingBox?: unknown;
    footprint?: unknown;
    warning?: unknown;
  };
}

export async function GET(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'imagery-footprints', limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const { data, error } = await supabase
    .from('drone_uploads')
    .select('id,filename,status,metadata,created_at')
    .order('created_at', { ascending: false })
    .limit(200);

  if (error) {
    console.error('[ImageryFootprints] Lookup failed:', error.message);
    return internalServerError('Imagery footprints could not be loaded.');
  }

  const footprints = (data ?? []).flatMap((row) => {
    const georeferencing = (row.metadata as StoredMetadata | null)?.georeferencing;
    if (georeferencing?.georeferenced !== true || !georeferencing.footprint) return [];

    return [{
      id: row.id,
      filename: row.filename,
      status: row.status,
      sourceCrs: typeof georeferencing.sourceCrs === 'string' ? georeferencing.sourceCrs : null,
      epsg: typeof georeferencing.epsg === 'number' ? georeferencing.epsg : null,
      boundingBox: georeferencing.wgs84BoundingBox,
      footprint: georeferencing.footprint,
      overlayUrl: `/api/imagery/${row.id}/overlay`,
      createdAt: row.created_at,
    }];
  }).slice(0, 10);

  return NextResponse.json({ footprints });
}
