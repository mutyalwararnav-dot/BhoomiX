import sharp from 'sharp';
import { supabaseServer as supabase } from '@/lib/supabase-server';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PREVIEW_EDGE = 1600;
const MAX_STORED_IMAGE_BYTES = 100 * 1024 * 1024;

interface StoredMetadata {
  extension?: unknown;
  layer_type?: unknown;
  preview_path?: unknown;
  georeferencing?: {
    georeferenced?: unknown;
  };
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'imagery-overlay', limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return Response.json({ error: 'Invalid imagery identifier.' }, { status: 400 });
  }

  const { data: upload, error: lookupError } = await supabase
    .from('drone_uploads')
    .select('file_path,file_size_bytes,mime_type,status,metadata')
    .eq('id', id)
    .maybeSingle();

  if (lookupError) {
    console.error('[ImageryOverlay] Lookup failed:', lookupError.message);
    return internalServerError('The imagery preview could not be loaded.');
  }
  if (!upload) return Response.json({ error: 'Imagery was not found.' }, { status: 404 });

  const metadata = upload.metadata as StoredMetadata | null;
  const extension = typeof metadata?.extension === 'string' ? metadata.extension.toLowerCase() : '';
  const isTiff = extension === 'tif' || extension === 'tiff' || upload.mime_type === 'image/tiff';
  if (!isTiff || metadata?.georeferencing?.georeferenced !== true) {
    return Response.json({ error: 'Only located GeoTIFF imagery can be rendered as a map overlay.' }, { status: 422 });
  }
  if (upload.status !== 'ready') {
    return Response.json({ error: 'Imagery processing is not complete.' }, { status: 409 });
  }
  if (typeof upload.file_size_bytes === 'number' && upload.file_size_bytes > MAX_STORED_IMAGE_BYTES) {
    return Response.json({ error: 'The stored image is too large to preview safely.' }, { status: 413 });
  }

  const isNdsmPreview = metadata?.layer_type === 'ndsm' && typeof metadata.preview_path === 'string';
  const downloadPath = isNdsmPreview ? metadata.preview_path as string : upload.file_path;
  const { data: storedFile, error: downloadError } = await supabase.storage
    .from('drone_datasets')
    .download(downloadPath);

  if (downloadError || !storedFile) {
    return Response.json({ error: downloadError?.message || 'Stored imagery could not be downloaded.' }, { status: 502 });
  }

  try {
    const source = Buffer.from(await storedFile.arrayBuffer());
    const preview = await sharp(source, { limitInputPixels: 100_000_000 })
      .resize({
        width: MAX_PREVIEW_EDGE,
        height: MAX_PREVIEW_EDGE,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 78, mozjpeg: true })
      .toBuffer();

    return new Response(new Uint8Array(preview), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(preview.byteLength),
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown image conversion error';
    console.error('[ImageryOverlay] Preview conversion failed:', message);
    return Response.json({ error: 'The GeoTIFF preview could not be rendered.' }, { status: 422 });
  }
}
