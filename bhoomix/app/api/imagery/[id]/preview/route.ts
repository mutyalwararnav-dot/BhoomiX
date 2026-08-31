import sharp from 'sharp';
import { resolveRequestPrincipal } from '@/lib/request-actor';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';
import { supabaseServer as supabase } from '@/lib/supabase-server';

export const runtime = 'nodejs';
export const maxDuration = 60;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_PREVIEW_EDGE = 1800;
const MAX_STORED_IMAGE_BYTES = 25 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/tiff']);

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'imagery-preview', limit: 30, windowMs: 60_000 });
  if (limited) return limited;

  const principal = await resolveRequestPrincipal(request);
  if (principal.role === 'guest') {
    return Response.json({ error: 'Sign in to reopen stored imagery.' }, { status: 403 });
  }

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return Response.json({ error: 'Invalid imagery identifier.' }, { status: 400 });
  }

  const { data: upload, error: lookupError } = await supabase
    .from('drone_uploads')
    .select('file_path,file_size_bytes,mime_type,status')
    .eq('id', id)
    .maybeSingle();

  if (lookupError) {
    console.error('[ImageryPreview] Lookup failed:', lookupError.message);
    return internalServerError('The imagery preview could not be loaded.');
  }
  if (!upload) return Response.json({ error: 'Imagery was not found.' }, { status: 404 });
  if (upload.status !== 'ready') return Response.json({ error: 'Imagery processing is not complete.' }, { status: 409 });
  if (!ALLOWED_IMAGE_TYPES.has(upload.mime_type)) return Response.json({ error: 'This stored file is not a supported image.' }, { status: 415 });
  if (typeof upload.file_size_bytes === 'number' && upload.file_size_bytes > MAX_STORED_IMAGE_BYTES) {
    return Response.json({ error: 'The stored image is too large to preview safely.' }, { status: 413 });
  }

  const { data: storedFile, error: downloadError } = await supabase.storage
    .from('drone_datasets')
    .download(upload.file_path);

  if (downloadError || !storedFile) {
    return Response.json({ error: 'The stored imagery could not be downloaded.' }, { status: 502 });
  }

  try {
    const source = Buffer.from(await storedFile.arrayBuffer());
    const preview = await sharp(source, { limitInputPixels: 100_000_000 })
      .resize({ width: MAX_PREVIEW_EDGE, height: MAX_PREVIEW_EDGE, fit: 'inside', withoutEnlargement: true })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 84, mozjpeg: true })
      .toBuffer();

    return new Response(new Uint8Array(preview), {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': String(preview.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown image conversion error';
    console.error('[ImageryPreview] Conversion failed:', message);
    return Response.json({ error: 'The imagery preview could not be rendered.' }, { status: 422 });
  }
}
