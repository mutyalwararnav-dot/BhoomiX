-- ============================================================
-- BhoomiX: Stage 0 - Drone Data Upload Schema
-- Run this in the Supabase SQL Editor
-- ============================================================

-- 1. Create drone_uploads table
CREATE TABLE IF NOT EXISTS drone_uploads (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  filename text NOT NULL,
  file_path text NOT NULL,
  status text NOT NULL CHECK (status IN ('uploaded', 'processing_ai', 'ready')),
  created_at timestamptz DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS drone_uploads_status_idx ON drone_uploads (status);
CREATE INDEX IF NOT EXISTS drone_uploads_created_at_idx ON drone_uploads (created_at DESC);

-- Enable RLS (we will allow all operations for the prototype, but in prod this would be restricted)
ALTER TABLE drone_uploads DISABLE ROW LEVEL SECURITY;

-- 2. Setup Storage Bucket for drone_datasets
-- Supabase handles buckets in the storage.buckets table
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'drone_datasets',
  'drone_datasets',
  true, -- public for prototype
  104857600, -- 100MB limit for prototype purposes
  ARRAY['image/tiff', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO NOTHING;

-- 3. Storage Policies
-- Allow public uploads to drone_datasets (Prototype Only!)
CREATE POLICY "Allow public uploads to drone_datasets"
ON storage.objects FOR INSERT
TO public
WITH CHECK (bucket_id = 'drone_datasets');

CREATE POLICY "Allow public select from drone_datasets"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'drone_datasets');
