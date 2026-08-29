import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'processing-job-status', limit: 120, windowMs: 60_000 });
  if (limited) return limited;

  const { id } = await context.params;
  if (!UUID_PATTERN.test(id)) {
    return NextResponse.json({ error: 'Invalid processing job ID.' }, { status: 400 });
  }

  const { data, error } = await supabaseServer
    .from('imagery_processing_jobs')
    .select('id,upload_id,status,processing_mode,progress,parcel_count,conflict_count,model_version,error_message,created_at,started_at,completed_at,updated_at')
    .eq('id', id)
    .maybeSingle();

  if (error) {
    console.error('[ProcessingJob] Status lookup failed:', error.message);
    return internalServerError('The processing job could not be loaded.');
  }
  if (!data) return NextResponse.json({ error: 'Processing job not found.' }, { status: 404 });

  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
