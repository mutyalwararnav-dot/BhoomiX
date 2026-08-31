import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { contentLengthError, internalServerError, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
const MAX_ELEVATION_BYTES = 100 * 1024 * 1024;
const ALLOWED_EXTENSIONS = new Set(['jpg', 'jpeg', 'png', 'tif', 'tiff']);
const ALLOWED_MIME_TYPES = new Set(['image/jpeg', 'image/png', 'image/tiff']);

export async function POST(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'imagery-upload-url', limit: 10, windowMs: 10 * 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 16 * 1024);
  if (oversized) return oversized;

  let body: { filename?: unknown; mimeType?: unknown; size?: unknown; purpose?: unknown; layerType?: unknown };
  try {
    body = await request.json() as typeof body;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const filename = typeof body.filename === 'string' ? body.filename.trim() : '';
  const mimeType = typeof body.mimeType === 'string' ? body.mimeType : '';
  const size = typeof body.size === 'number' ? body.size : Number.NaN;
  const purpose = body.purpose === 'elevation' ? 'elevation' : 'imagery';
  const layerType = ['ori', 'dsm', 'dtm'].includes(String(body.layerType)) ? String(body.layerType) : null;
  const extension = filename.split('.').pop()?.toLowerCase() ?? '';
  const maximumBytes = purpose === 'elevation' ? MAX_ELEVATION_BYTES : MAX_IMAGE_BYTES;

  if (!filename || filename.length > 255 || /[\u0000-\u001f\u007f]/.test(filename)) {
    return NextResponse.json({ error: 'The image filename is invalid.' }, { status: 400 });
  }
  if (!ALLOWED_EXTENSIONS.has(extension) || !ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: 'Upload a JPG, PNG, TIFF, or TIF image.' }, { status: 415 });
  }
  if (purpose === 'elevation' && (!layerType || mimeType !== 'image/tiff' || !['tif', 'tiff'].includes(extension))) {
    return NextResponse.json({ error: 'Elevation uploads require an ORI, DSM or DTM GeoTIFF.' }, { status: 415 });
  }
  if (!Number.isInteger(size) || size <= 0 || size > maximumBytes) {
    return NextResponse.json({ error: `File must be larger than 0 bytes and no more than ${maximumBytes / 1024 / 1024} MB.` }, { status: 413 });
  }

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_').slice(-120) || `image.${extension}`;
  const storagePath = purpose === 'elevation'
    ? `incoming/elevation/${layerType}/${crypto.randomUUID()}_${safeName}`
    : `incoming/${crypto.randomUUID()}_${safeName}`;
  const { data, error } = await supabaseServer.storage
    .from('drone_datasets')
    .createSignedUploadUrl(storagePath, { upsert: false });

  if (error || !data) {
    console.error('[ImageryUploadUrl] Could not create signed upload URL:', error?.message);
    return internalServerError('A secure image upload could not be started.');
  }

  return NextResponse.json({
    storagePath,
    signedUrl: data.signedUrl,
  }, { headers: { 'Cache-Control': 'no-store' } });
}
