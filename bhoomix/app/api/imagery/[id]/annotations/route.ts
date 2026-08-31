import { NextResponse } from 'next/server';
import { validateImageAnnotations, type ImageAnnotation } from '@/lib/image-annotations';
import { resolveRequestActor } from '@/lib/request-actor';
import { contentLengthError, internalServerError, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';
import { supabaseServer as supabase } from '@/lib/supabase-server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface UploadMetadata {
  imageAnnotations?: {
    version?: unknown;
    annotations?: unknown;
    savedAt?: unknown;
    savedBy?: unknown;
  };
  [key: string]: unknown;
}

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'imagery-annotations-read', limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'Invalid imagery identifier.' }, { status: 400 });

  const { data, error } = await supabase.from('drone_uploads').select('metadata,status').eq('id', id).maybeSingle();
  if (error) {
    console.error('[ImageAnnotations] Lookup failed:', error.message);
    return internalServerError('Image annotations could not be loaded.');
  }
  if (!data) return NextResponse.json({ error: 'Imagery was not found.' }, { status: 404 });

  const metadata = data.metadata && typeof data.metadata === 'object' ? data.metadata as UploadMetadata : {};
  const stored = metadata.imageAnnotations;
  const validated = validateImageAnnotations(stored?.annotations ?? []);
  if (validated.error) {
    console.warn('[ImageAnnotations] Ignoring invalid stored annotations:', validated.error);
    return NextResponse.json({ annotations: [], savedAt: null, savedBy: null }, { headers: { 'Cache-Control': 'no-store' } });
  }
  return NextResponse.json({
    annotations: validated.annotations,
    savedAt: typeof stored?.savedAt === 'string' ? stored.savedAt : null,
    savedBy: typeof stored?.savedBy === 'string' ? stored.savedBy : null,
  }, { headers: { 'Cache-Control': 'no-store' } });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'imagery-annotations-save', limit: 30, windowMs: 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 1024 * 1024);
  if (oversized) return oversized;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'Invalid imagery identifier.' }, { status: 400 });

  let body: { annotations?: unknown };
  try {
    body = await request.json() as { annotations?: unknown };
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }
  const validated = validateImageAnnotations(body.annotations);
  if (validated.error || !validated.annotations) return NextResponse.json({ error: validated.error }, { status: 400 });

  const { data: upload, error: lookupError } = await supabase.from('drone_uploads').select('metadata,status').eq('id', id).maybeSingle();
  if (lookupError) {
    console.error('[ImageAnnotations] Save lookup failed:', lookupError.message);
    return internalServerError('Image annotations could not be saved.');
  }
  if (!upload) return NextResponse.json({ error: 'Imagery was not found.' }, { status: 404 });
  if (upload.status !== 'ready') return NextResponse.json({ error: 'Imagery processing must finish before annotations can be saved.' }, { status: 409 });

  const actor = await resolveRequestActor(request);
  const savedAt = new Date().toISOString();
  const currentMetadata = upload.metadata && typeof upload.metadata === 'object' ? upload.metadata as UploadMetadata : {};
  const metadata: UploadMetadata = {
    ...currentMetadata,
    imageAnnotations: { version: 1, annotations: validated.annotations as ImageAnnotation[], savedAt, savedBy: actor },
  };
  const { error: updateError } = await supabase.from('drone_uploads').update({ metadata }).eq('id', id);
  if (updateError) {
    console.error('[ImageAnnotations] Save failed:', updateError.message);
    return internalServerError('Image annotations could not be saved.');
  }
  return NextResponse.json({ success: true, annotationCount: validated.annotations.length, savedAt, savedBy: actor });
}
