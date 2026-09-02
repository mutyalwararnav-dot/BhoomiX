import { NextResponse } from 'next/server';
import { resolveRequestActor } from '@/lib/request-actor';
import { contentLengthError, internalServerError, mutationRequestError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';
import { supabaseServer as supabase } from '@/lib/supabase-server';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CATEGORIES = new Set(['incorrect_boundary', 'missing_boundary', 'extra_boundary', 'image_quality', 'other']);

interface SurveyorFeedbackEntry {
  id: string;
  category: string;
  message: string;
  annotationCount: number;
  submittedAt: string;
  submittedBy: string;
}

interface UploadMetadata {
  surveyorFeedback?: SurveyorFeedbackEntry[];
  [key: string]: unknown;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const originError = mutationRequestError(request);
  if (originError) return originError;
  const limited = rateLimitRequest(request, { bucket: 'imagery-written-feedback', limit: 20, windowMs: 60_000 });
  if (limited) return limited;
  const oversized = contentLengthError(request, 16 * 1024);
  if (oversized) return oversized;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) return NextResponse.json({ error: 'Invalid imagery identifier.' }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: 'Request body must be valid JSON.' }, { status: 400 });
  }

  const category = typeof body.category === 'string' ? body.category : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  const annotationCount = typeof body.annotationCount === 'number' && Number.isInteger(body.annotationCount)
    ? body.annotationCount
    : 0;

  if (!CATEGORIES.has(category)) {
    return NextResponse.json({ error: 'Choose a valid feedback category.' }, { status: 400 });
  }
  if (message.length < 5 || message.length > 1000) {
    return NextResponse.json({ error: 'Feedback must contain between 5 and 1000 characters.' }, { status: 400 });
  }
  if (annotationCount < 0 || annotationCount > 500) {
    return NextResponse.json({ error: 'The annotation count is invalid.' }, { status: 400 });
  }

  const { data: upload, error: lookupError } = await supabase
    .from('drone_uploads')
    .select('metadata,status')
    .eq('id', id)
    .maybeSingle();
  if (lookupError) {
    console.error('[ImageryFeedback] Lookup failed:', lookupError.message);
    return internalServerError('The related image could not be loaded.');
  }
  if (!upload) return NextResponse.json({ error: 'Imagery was not found.' }, { status: 404 });
  if (upload.status !== 'ready') return NextResponse.json({ error: 'Image processing must finish before feedback can be submitted.' }, { status: 409 });

  const actor = await resolveRequestActor(request);
  const currentMetadata = upload.metadata && typeof upload.metadata === 'object'
    ? upload.metadata as UploadMetadata
    : {};
  const previousEntries = Array.isArray(currentMetadata.surveyorFeedback)
    ? currentMetadata.surveyorFeedback.slice(-49)
    : [];
  const entry: SurveyorFeedbackEntry = {
    id: crypto.randomUUID(),
    category,
    message,
    annotationCount,
    submittedAt: new Date().toISOString(),
    submittedBy: actor,
  };

  const { error: updateError } = await supabase
    .from('drone_uploads')
    .update({ metadata: { ...currentMetadata, surveyorFeedback: [...previousEntries, entry] } })
    .eq('id', id);
  if (updateError) {
    console.error('[ImageryFeedback] Save failed:', updateError.message);
    return internalServerError('Written surveyor feedback could not be saved.');
  }

  return NextResponse.json({ success: true, feedbackId: entry.id, submittedAt: entry.submittedAt });
}
