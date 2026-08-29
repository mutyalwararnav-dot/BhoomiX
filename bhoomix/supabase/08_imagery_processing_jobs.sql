-- ============================================================
-- BhoomiX · 08_imagery_processing_jobs.sql
-- Persistent imagery metadata and AI-processing job states.
-- Run after 00-07 in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.drone_uploads
  ADD COLUMN IF NOT EXISTS file_size_bytes BIGINT,
  ADD COLUMN IF NOT EXISTS mime_type TEXT,
  ADD COLUMN IF NOT EXISTS uploaded_by TEXT NOT NULL DEFAULT 'Guest',
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ;

ALTER TABLE public.drone_uploads DROP CONSTRAINT IF EXISTS drone_uploads_status_check;
ALTER TABLE public.drone_uploads ADD CONSTRAINT drone_uploads_status_check
  CHECK (status IN ('uploaded', 'queued', 'processing_ai', 'ready', 'failed'));

CREATE TABLE IF NOT EXISTS public.imagery_processing_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  upload_id UUID NOT NULL REFERENCES public.drone_uploads(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
  processing_mode TEXT NOT NULL DEFAULT 'demo'
    CHECK (processing_mode IN ('demo', 'model')),
  progress SMALLINT NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
  parcel_count INTEGER NOT NULL DEFAULT 0 CHECK (parcel_count >= 0),
  conflict_count INTEGER NOT NULL DEFAULT 0 CHECK (conflict_count >= 0),
  model_version TEXT,
  requested_by TEXT NOT NULL DEFAULT 'Guest',
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS imagery_jobs_status_idx
  ON public.imagery_processing_jobs(status, created_at DESC);
CREATE INDEX IF NOT EXISTS imagery_jobs_upload_idx
  ON public.imagery_processing_jobs(upload_id);

ALTER TABLE public.imagery_processing_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.imagery_processing_jobs FROM anon, authenticated;
GRANT ALL ON public.imagery_processing_jobs TO service_role;

NOTIFY pgrst, 'reload schema';
