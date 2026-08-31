-- ============================================================
-- BhoomiX · 10_elevation_bundles.sql
-- Allow persistent ORI/DSM/DTM rasters up to 100 MB each.
-- Run after 00-09 in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.drone_uploads
  DROP CONSTRAINT IF EXISTS drone_uploads_file_size_check;

ALTER TABLE public.drone_uploads
  ADD CONSTRAINT drone_uploads_file_size_check
    CHECK (file_size_bytes IS NULL OR (file_size_bytes > 0 AND file_size_bytes <= 104857600)) NOT VALID;

UPDATE storage.buckets
SET
  file_size_limit = 104857600,
  allowed_mime_types = ARRAY['image/tiff', 'image/jpeg', 'image/png']
WHERE id = 'drone_datasets';

CREATE INDEX IF NOT EXISTS drone_uploads_elevation_bundle_idx
  ON public.drone_uploads ((metadata->>'bundle_id'), (metadata->>'layer_type'))
  WHERE metadata ? 'bundle_id';

NOTIFY pgrst, 'reload schema';
