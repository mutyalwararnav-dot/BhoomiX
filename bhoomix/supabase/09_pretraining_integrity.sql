-- ============================================================
-- BhoomiX · 09_pretraining_integrity.sql
-- Data-quality constraints and stale-job recovery before training.
-- Run after 00-08 in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.drone_uploads
  DROP CONSTRAINT IF EXISTS drone_uploads_file_size_check,
  DROP CONSTRAINT IF EXISTS drone_uploads_mime_type_check,
  DROP CONSTRAINT IF EXISTS drone_uploads_metadata_object_check;

-- NOT VALID preserves historical prototype rows while enforcing the rules for
-- every new upload. Validate each constraint after legacy rows are cleaned.
ALTER TABLE public.drone_uploads
  ADD CONSTRAINT drone_uploads_file_size_check
    CHECK (file_size_bytes IS NULL OR (file_size_bytes > 0 AND file_size_bytes <= 26214400)) NOT VALID,
  ADD CONSTRAINT drone_uploads_mime_type_check
    CHECK (mime_type IS NULL OR mime_type IN ('image/jpeg', 'image/png', 'image/tiff')) NOT VALID,
  ADD CONSTRAINT drone_uploads_metadata_object_check
    CHECK (jsonb_typeof(metadata) = 'object') NOT VALID;

CREATE INDEX IF NOT EXISTS drone_uploads_status_created_idx
  ON public.drone_uploads(status, created_at DESC);
CREATE INDEX IF NOT EXISTS model_feedback_created_idx
  ON public.model_feedback_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS parcels_training_source_idx
  ON public.parcels(source_upload_id, status)
  WHERE source_upload_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_bhoomix_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS imagery_jobs_set_updated_at ON public.imagery_processing_jobs;
CREATE TRIGGER imagery_jobs_set_updated_at
BEFORE UPDATE ON public.imagery_processing_jobs
FOR EACH ROW EXECUTE FUNCTION public.set_bhoomix_updated_at();

CREATE OR REPLACE FUNCTION public.fail_stale_imagery_jobs(p_max_age INTERVAL DEFAULT INTERVAL '30 minutes')
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  changed_count INTEGER;
BEGIN
  IF p_max_age < INTERVAL '5 minutes' OR p_max_age > INTERVAL '7 days' THEN
    RAISE EXCEPTION 'p_max_age must be between 5 minutes and 7 days';
  END IF;

  UPDATE public.imagery_processing_jobs
  SET
    status = 'failed',
    progress = 100,
    error_message = COALESCE(error_message, 'Processing timed out before completion.'),
    completed_at = NOW(),
    updated_at = NOW()
  WHERE status IN ('queued', 'processing')
    AND updated_at < NOW() - p_max_age;

  GET DIAGNOSTICS changed_count = ROW_COUNT;
  RETURN changed_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fail_stale_imagery_jobs(INTERVAL) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fail_stale_imagery_jobs(INTERVAL) TO service_role;

NOTIFY pgrst, 'reload schema';
