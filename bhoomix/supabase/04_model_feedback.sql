-- ============================================================
-- BhoomiX  ·  04_model_feedback.sql
-- Model Feedback Loop — audit log for human corrections
-- Run once in the Supabase SQL Editor.
-- ============================================================

-- ─── 1. model_feedback_logs table ────────────────────────────────────────────
-- Every time a surveyor edits or rejects an AI parcel, one row is written here.
-- This table doubles as a training-data source for model fine-tuning.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS model_feedback_logs (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source parcel
  parcel_id           TEXT        NOT NULL,

  -- Action taken by the human surveyor
  action              TEXT        NOT NULL CHECK (action IN ('edited', 'rejected', 'confirmed')),

  -- Original AI geometry (stored at log-time so it survives future parcel edits)
  original_geometry   JSONB,

  -- Final human-edited geometry (null for 'rejected' and 'confirmed' actions)
  final_geometry      JSONB,

  -- GeoJSON delta: ST_Difference(final, original) as JSONB  —  null when not applicable
  geometry_delta      JSONB,

  -- Approximate area change in m² (negative = boundary shrunk, positive = expanded)
  area_delta_sqm      DOUBLE PRECISION,

  -- Who did it and when
  surveyor_id         TEXT        DEFAULT 'Surveyor_01',
  created_at          TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast queries by parcel and time
CREATE INDEX IF NOT EXISTS idx_mfl_parcel_id   ON model_feedback_logs (parcel_id);
CREATE INDEX IF NOT EXISTS idx_mfl_action       ON model_feedback_logs (action);
CREATE INDEX IF NOT EXISTS idx_mfl_created_at   ON model_feedback_logs (created_at DESC);

-- ─── 2. log_parcel_feedback RPC ───────────────────────────────────────────────
-- Called by the backend API whenever a surveyor edits or rejects a parcel.
-- Computes the PostGIS geometry delta automatically from the JSONB inputs.
--
-- Usage:
--   SELECT log_parcel_feedback(
--     'AI-GEN-123', 'edited',
--     '{"type":"Polygon","coordinates":[...]}',   -- original
--     '{"type":"Polygon","coordinates":[...]}'    -- final (null for rejected)
--   );
-- ─────────────────────────────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS log_parcel_feedback(TEXT, TEXT, JSONB, JSONB, TEXT);

CREATE OR REPLACE FUNCTION log_parcel_feedback(
  p_parcel_id         TEXT,
  p_action            TEXT,
  p_original_geojson  JSONB DEFAULT NULL,
  p_final_geojson     JSONB DEFAULT NULL,
  p_surveyor_id       TEXT DEFAULT 'Surveyor_01'
)
RETURNS TEXT
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_original_geom  GEOMETRY;
  v_final_geom     GEOMETRY;
  v_delta_geom     GEOMETRY;
  v_delta_json     JSONB;
  v_area_delta     DOUBLE PRECISION := 0;
  v_log_id         TEXT;
BEGIN
  -- Parse geometries from GeoJSON if provided
  IF p_original_geojson IS NOT NULL THEN
    v_original_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_original_geojson::TEXT), 4326);
  END IF;

  IF p_final_geojson IS NOT NULL THEN
    v_final_geom := ST_SetSRID(ST_GeomFromGeoJSON(p_final_geojson::TEXT), 4326);
  END IF;

  -- Compute delta geometry (what changed from original → final)
  IF v_original_geom IS NOT NULL AND v_final_geom IS NOT NULL THEN
    -- Union of symmetric difference gives the "changed region"
    v_delta_geom := ST_SymDifference(v_original_geom, v_final_geom);
    IF NOT ST_IsEmpty(v_delta_geom) THEN
      v_delta_json := ST_AsGeoJSON(v_delta_geom)::JSONB;
    END IF;

    -- Area delta in m² (UTM-43N for Pune)
    v_area_delta :=
      ST_Area(ST_Transform(v_final_geom,    32643)) -
      ST_Area(ST_Transform(v_original_geom, 32643));
  END IF;

  INSERT INTO model_feedback_logs (
    parcel_id, action,
    original_geometry, final_geometry, geometry_delta,
    area_delta_sqm, surveyor_id
  ) VALUES (
    p_parcel_id, p_action,
    p_original_geojson, p_final_geojson, v_delta_json,
    v_area_delta, p_surveyor_id
  )
  RETURNING id::TEXT INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- ─── 3. get_feedback_export RPC ───────────────────────────────────────────────
-- Returns all 'edited' feedback rows formatted for ML dataset export.
-- Each row contains original + final geometries so the training pipeline
-- can compute bounding-box regressions for Faster R-CNN / YOLO.
-- ─────────────────────────────────────────────────────────────────────────────
-- PostgreSQL cannot CREATE OR REPLACE a function when its OUT-column shape
-- changed in an earlier prototype, so recreate this read-only RPC explicitly.
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
  created_at         TIMESTAMPTZ
)
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT
    id::TEXT, parcel_id, action,
    original_geometry, final_geometry, geometry_delta,
    area_delta_sqm, surveyor_id, created_at
  FROM model_feedback_logs
  ORDER BY created_at DESC;
$$;

-- ─── 4. Backfill previously verified parcels ────────────────────────────────
-- Existing confirmed/reviewed rows pre-date this feedback table. Import them
-- once so the badge count and the exported training dataset remain consistent.
INSERT INTO model_feedback_logs (
  parcel_id,
  action,
  original_geometry,
  final_geometry,
  geometry_delta,
  area_delta_sqm,
  surveyor_id,
  created_at
)
SELECT
  p.id,
  CASE WHEN p.status = 'reviewed_edited' THEN 'edited' ELSE 'confirmed' END,
  CASE
    WHEN p.status = 'reviewed_edited' AND audit.previous_geometry IS NOT NULL
      THEN ST_AsGeoJSON(audit.previous_geometry)::JSONB
    ELSE ST_AsGeoJSON(p.geometry)::JSONB
  END,
  CASE
    WHEN p.status = 'reviewed_edited'
      THEN ST_AsGeoJSON(COALESCE(audit.new_geometry, p.geometry))::JSONB
    ELSE NULL
  END,
  CASE
    WHEN audit.previous_geometry IS NOT NULL AND audit.new_geometry IS NOT NULL
      THEN ST_AsGeoJSON(ST_SymDifference(audit.previous_geometry, audit.new_geometry))::JSONB
    ELSE NULL
  END,
  CASE
    WHEN audit.previous_geometry IS NOT NULL AND audit.new_geometry IS NOT NULL
      THEN ST_Area(ST_Transform(audit.new_geometry, 32643))
         - ST_Area(ST_Transform(audit.previous_geometry, 32643))
    ELSE 0
  END,
  COALESCE(audit.changed_by, 'migration_backfill'),
  COALESCE(audit.changed_at, NOW())
FROM parcels p
LEFT JOIN LATERAL (
  SELECT previous_geometry, new_geometry, changed_by, changed_at
  FROM parcel_audit_trail
  WHERE parcel_id = p.id AND new_status = 'reviewed_edited'
  ORDER BY changed_at DESC
  LIMIT 1
) audit ON TRUE
WHERE p.status IN ('confirmed', 'reviewed_edited')
  AND NOT EXISTS (
    SELECT 1
    FROM model_feedback_logs existing
    WHERE existing.parcel_id = p.id
      AND existing.action = CASE
        WHEN p.status = 'reviewed_edited' THEN 'edited'
        ELSE 'confirmed'
      END
  );

-- ─── 5. Grants ────────────────────────────────────────────────────────────────
GRANT SELECT, INSERT ON model_feedback_logs TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION log_parcel_feedback(TEXT, TEXT, JSONB, JSONB, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION get_feedback_export() TO anon, authenticated, service_role;
