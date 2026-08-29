-- ============================================================
-- BhoomiX · 06_training_dataset_lineage.sql
-- Links every AI parcel and human correction to its source image.
-- Run after 00-05 in the Supabase SQL Editor.
-- ============================================================

ALTER TABLE parcels
  ADD COLUMN IF NOT EXISTS source_upload_id UUID REFERENCES drone_uploads(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS source_type TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS model_version TEXT;

ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_source_type_check;
ALTER TABLE parcels ADD CONSTRAINT parcels_source_type_check
  CHECK (source_type IN ('model', 'demo', 'imported', 'unknown'));

CREATE INDEX IF NOT EXISTS parcels_source_upload_id_idx ON parcels (source_upload_id);

-- Keep the existing RPC name for compatibility, but allow it to record
-- production model lineage as well as demo data.
CREATE OR REPLACE FUNCTION seed_mock_parcels(parcels_input jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  parcel       jsonb;
  inserted_ids text[] := '{}';
  parcel_id    text;
BEGIN
  FOR parcel IN SELECT * FROM jsonb_array_elements(parcels_input)
  LOOP
    parcel_id := parcel->>'id';

    INSERT INTO parcels (
      id,
      status,
      confidence_score,
      computed_area_sqm,
      land_use,
      geometry,
      source_upload_id,
      source_type,
      model_version
    )
    VALUES (
      parcel_id,
      COALESCE(parcel->>'status', 'pending'),
      (parcel->>'confidence_score')::NUMERIC,
      (parcel->>'computed_area_sqm')::NUMERIC,
      parcel->>'land_use',
      ST_SetSRID(ST_GeomFromGeoJSON(parcel->'geometry'), 4326),
      NULLIF(parcel->>'source_upload_id', '')::UUID,
      COALESCE(NULLIF(parcel->>'source_type', ''), 'unknown'),
      NULLIF(parcel->>'model_version', '')
    )
    ON CONFLICT (id) DO NOTHING;

    inserted_ids := array_append(inserted_ids, parcel_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'processed', array_length(inserted_ids, 1),
    'parcel_ids', to_jsonb(inserted_ids)
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error', SQLERRM,
    'detail', SQLSTATE
  );
END;
$$;

GRANT EXECUTE ON FUNCTION seed_mock_parcels(jsonb) TO anon, authenticated, service_role;

-- Export feedback together with its source imagery. PostgreSQL requires a
-- drop/recreate when the result columns change.
DROP FUNCTION IF EXISTS get_feedback_export();

CREATE OR REPLACE FUNCTION get_feedback_export()
RETURNS TABLE(
  log_id             TEXT,
  parcel_id          TEXT,
  action             TEXT,
  original_geometry  JSONB,
  final_geometry     JSONB,
  geometry_delta     JSONB,
  area_delta_sqm     DOUBLE PRECISION,
  surveyor_id        TEXT,
  created_at         TIMESTAMPTZ,
  source_upload_id   UUID,
  source_filename    TEXT,
  source_file_path   TEXT,
  source_type        TEXT,
  model_version      TEXT
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    feedback.id::TEXT,
    feedback.parcel_id,
    feedback.action,
    feedback.original_geometry,
    feedback.final_geometry,
    feedback.geometry_delta,
    feedback.area_delta_sqm,
    feedback.surveyor_id,
    feedback.created_at,
    parcel.source_upload_id,
    upload.filename,
    upload.file_path,
    parcel.source_type,
    parcel.model_version
  FROM model_feedback_logs feedback
  LEFT JOIN parcels parcel ON parcel.id = feedback.parcel_id
  LEFT JOIN drone_uploads upload ON upload.id = parcel.source_upload_id
  ORDER BY feedback.created_at DESC;
$$;

GRANT EXECUTE ON FUNCTION get_feedback_export() TO anon, authenticated, service_role;
