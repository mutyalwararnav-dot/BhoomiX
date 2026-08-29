import { NextResponse } from 'next/server';
import { resolveRequestPrincipal } from '@/lib/request-actor';
import { internalServerError, rateLimitRequest, serverConfigurationError } from '@/lib/request-safety';
import { supabaseServer } from '@/lib/supabase-server';

interface UploadSummary {
  id: string;
  filename: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  uploaded_by: string;
}

export async function GET(request: Request) {
  const configurationError = serverConfigurationError();
  if (configurationError) return configurationError;
  const limited = rateLimitRequest(request, { bucket: 'processing-job-list', limit: 60, windowMs: 60_000 });
  if (limited) return limited;

  const principal = await resolveRequestPrincipal(request);
  if (principal.role === 'guest') {
    return NextResponse.json({ error: 'Sign in to view processing-job history.' }, { status: 403 });
  }

  const { data: jobs, error } = await supabaseServer
    .from('imagery_processing_jobs')
    .select('id,upload_id,status,processing_mode,progress,parcel_count,conflict_count,model_version,error_message,requested_by,created_at,started_at,completed_at,updated_at')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    console.error('[ProcessingJobs] List failed:', error.message);
    return internalServerError('Processing jobs could not be loaded.');
  }

  const uploadIds = [...new Set((jobs ?? []).map((job) => job.upload_id))];
  const uploadsById = new Map<string, UploadSummary>();
  if (uploadIds.length) {
    const { data: uploads, error: uploadError } = await supabaseServer
      .from('drone_uploads')
      .select('id,filename,file_size_bytes,mime_type,uploaded_by')
      .in('id', uploadIds);
    if (uploadError) {
      console.warn('[ProcessingJobs] Upload metadata unavailable:', uploadError.message);
    } else {
      for (const upload of (uploads ?? []) as UploadSummary[]) uploadsById.set(upload.id, upload);
    }
  }

  return NextResponse.json({
    jobs: (jobs ?? []).map((job) => ({
      ...job,
      upload: uploadsById.get(job.upload_id) ?? null,
    })),
  }, { headers: { 'Cache-Control': 'no-store' } });
}
