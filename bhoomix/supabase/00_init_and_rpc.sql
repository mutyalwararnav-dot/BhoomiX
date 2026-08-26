-- ============================================================
-- BhoomiX: Supabase PostGIS Schema + RPC
-- Run this in the Supabase SQL Editor (Dashboard > SQL Editor)
-- ============================================================

-- Enable PostGIS extension (idempotent)
CREATE EXTENSION IF NOT EXISTS postgis;

-- ============================================================
-- TABLE: parcels
-- Core cadastral parcel storage with PostGIS geometry
-- ============================================================
CREATE TABLE IF NOT EXISTS parcels (
  id                TEXT PRIMARY KEY,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('ai_suggestion', 'confirmed', 'conflict', 'pending')),
  confidence_score  NUMERIC(5, 4) CHECK (confidence_score BETWEEN 0 AND 1),
  computed_area_sqm NUMERIC(12, 2),
  land_use          TEXT,
  geometry          geometry(Polygon, 4326) NOT NULL
);

-- Spatial index for fast bounding-box queries
CREATE INDEX IF NOT EXISTS parcels_geometry_idx
  ON parcels USING GIST (geometry);

-- Index on status for filter queries
CREATE INDEX IF NOT EXISTS parcels_status_idx
  ON parcels (status);

-- ============================================================
-- RLS: DISABLED — allows direct seeding without auth headers
-- ============================================================
ALTER TABLE parcels DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- TABLE: parcel_audit_trail
-- Immutable log of all parcel status / geometry changes
-- ============================================================
CREATE TABLE IF NOT EXISTS parcel_audit_trail (
  id                SERIAL PRIMARY KEY,
  parcel_id         TEXT REFERENCES parcels(id) ON DELETE CASCADE,
  previous_status   TEXT,
  new_status        TEXT,
  previous_geometry geometry(Polygon, 4326),
  new_geometry      geometry(Polygon, 4326),
  changed_by        TEXT,
  changed_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast audit lookup by parcel
CREATE INDEX IF NOT EXISTS audit_parcel_id_idx
  ON parcel_audit_trail (parcel_id);

-- Index for time-range queries
CREATE INDEX IF NOT EXISTS audit_changed_at_idx
  ON parcel_audit_trail (changed_at DESC);

-- ============================================================
-- RLS: DISABLED — prevents permission errors during seeding
-- ============================================================
ALTER TABLE parcel_audit_trail DISABLE ROW LEVEL SECURITY;

-- ============================================================
-- RPC: seed_mock_parcels(parcels_input jsonb)
--
-- Accepts a JSON array of parcel objects and bulk-inserts them.
-- Uses ON CONFLICT DO NOTHING for idempotent re-seeding.
--
-- Expected JSON shape per element:
-- {
--   "id": "PUNE-001",
--   "status": "confirmed",
--   "confidence_score": 0.97,
--   "computed_area_sqm": 4200.5,
--   "land_use": "residential",
--   "geometry": { <GeoJSON Polygon> }
-- }
-- ============================================================
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
  -- Iterate over each element in the input JSON array
  FOR parcel IN SELECT * FROM jsonb_array_elements(parcels_input)
  LOOP
    parcel_id := parcel->>'id';

    INSERT INTO parcels (
      id,
      status,
      confidence_score,
      computed_area_sqm,
      land_use,
      geometry
    )
    VALUES (
      parcel_id,
      COALESCE(parcel->>'status', 'pending'),
      (parcel->>'confidence_score')::NUMERIC,
      (parcel->>'computed_area_sqm')::NUMERIC,
      parcel->>'land_use',
      ST_GeomFromGeoJSON(parcel->'geometry')
    )
    ON CONFLICT (id) DO NOTHING;

    -- Track successfully processed IDs
    inserted_ids := array_append(inserted_ids, parcel_id);
  END LOOP;

  RETURN jsonb_build_object(
    'success',       true,
    'processed',     array_length(inserted_ids, 1),
    'parcel_ids',    to_jsonb(inserted_ids)
  );

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object(
    'success', false,
    'error',   SQLERRM,
    'detail',  SQLSTATE
  );
END;
$$;

-- Grant execute to service role and anon (seeding via client)
GRANT EXECUTE ON FUNCTION seed_mock_parcels(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION seed_mock_parcels(jsonb) TO anon;
GRANT EXECUTE ON FUNCTION seed_mock_parcels(jsonb) TO authenticated;

-- ============================================================
-- VIEW: parcel_geojson
-- Returns parcels as GeoJSON FeatureCollection rows
-- Useful for direct MapLibre source consumption
-- ============================================================
CREATE OR REPLACE VIEW parcel_geojson AS
SELECT
  id,
  status,
  confidence_score,
  computed_area_sqm,
  land_use,
  ST_AsGeoJSON(geometry)::jsonb AS geojson_geometry,
  jsonb_build_object(
    'type',       'Feature',
    'id',         id,
    'geometry',   ST_AsGeoJSON(geometry)::jsonb,
    'properties', jsonb_build_object(
      'id',               id,
      'status',           status,
      'confidence_score', confidence_score,
      'computed_area_sqm',computed_area_sqm,
      'land_use',         land_use
    )
  ) AS feature
FROM parcels;

-- ============================================================
-- FUNCTION: get_parcels_as_geojson()
-- Returns a complete GeoJSON FeatureCollection for all parcels
-- Call via Supabase RPC: supabase.rpc('get_parcels_as_geojson')
-- ============================================================
CREATE OR REPLACE FUNCTION get_parcels_as_geojson()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
AS $$
  SELECT jsonb_build_object(
    'type',     'FeatureCollection',
    'features', COALESCE(jsonb_agg(feature), '[]'::jsonb)
  )
  FROM parcel_geojson;
$$;

GRANT EXECUTE ON FUNCTION get_parcels_as_geojson() TO service_role;
GRANT EXECUTE ON FUNCTION get_parcels_as_geojson() TO anon;
GRANT EXECUTE ON FUNCTION get_parcels_as_geojson() TO authenticated;
