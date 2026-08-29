-- ============================================================
-- BhoomiX  ·  03_spatial_validation.sql
-- Spatial overlap detection & automatic conflict flagging
-- Run this in the Supabase SQL Editor ONCE.
-- ============================================================

-- ─── 1. flag_overlapping_parcels ─────────────────────────────────────────────
-- Scans all pairs of parcels whose status is 'ai_suggestion'.
-- If two polygons overlap by more than `p_tolerance_sqm` square metres
-- (measured in UTM zone 43N – EPSG:32643, appropriate for Pune) both are
-- promoted to status = 'conflict'.
--
-- Returns: a result set of { parcel_a, parcel_b, overlap_sqm } for logging.
--
-- Usage:
--   SELECT * FROM flag_overlapping_parcels();           -- default 1 m² tolerance
--   SELECT * FROM flag_overlapping_parcels(0.5);        -- stricter: 0.5 m²
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION flag_overlapping_parcels(
  p_tolerance_sqm FLOAT DEFAULT 1.0
)
RETURNS TABLE(
  parcel_a       TEXT,
  parcel_b       TEXT,
  overlap_sqm    FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- ── Step 1: find intersecting pairs ──────────────────────────────────────
  -- We only compare ai_suggestion parcels (already-confirmed parcels are
  -- immutable; reviewing them is a human task).
  -- ST_Touches is excluded: shared boundaries are legally valid.
  -- ST_Transform to UTM-43N gives m² instead of degrees².
  WITH overlap_pairs AS (
    SELECT
      a.id   AS id_a,
      b.id   AS id_b,
      ST_Area(
        ST_Transform(
          ST_Intersection(a.geometry, b.geometry),
          32643   -- WGS84 / UTM zone 43N  (covers Pune, Maharashtra)
        )
      )          AS area_sqm
    FROM parcels a
    JOIN parcels b
      ON a.id < b.id            -- avoid (A,B) + (B,A) duplicates
    WHERE a.status = 'ai_suggestion'
      AND b.status = 'ai_suggestion'
      AND ST_Intersects(a.geometry, b.geometry)
      AND NOT ST_Touches(a.geometry, b.geometry)
  ),
  -- ── Step 2: filter by tolerance ─────────────────────────────────────────
  real_conflicts AS (
    SELECT id_a, id_b, area_sqm
    FROM   overlap_pairs
    WHERE  area_sqm > p_tolerance_sqm
  )
  -- ── Step 3: flag both parcels in each conflicting pair ───────────────────
  UPDATE parcels
  SET    status = 'conflict'
  WHERE  id IN (
    SELECT id_a FROM real_conflicts
    UNION
    SELECT id_b FROM real_conflicts
  );

  -- ── Step 4: return the pairs for API-level logging ───────────────────────
  RETURN QUERY
    SELECT
      a.id,
      b.id,
      ST_Area(
        ST_Transform(ST_Intersection(a.geometry, b.geometry), 32643)
      )::FLOAT
    FROM parcels a
    JOIN parcels b ON a.id < b.id
    WHERE a.status = 'conflict'
      AND b.status = 'conflict'
      AND ST_Intersects(a.geometry, b.geometry)
      AND NOT ST_Touches(a.geometry, b.geometry)
      AND ST_Area(
            ST_Transform(ST_Intersection(a.geometry, b.geometry), 32643)
          ) > p_tolerance_sqm;
END;
$$;

-- ─── 2. check_single_parcel_overlaps ─────────────────────────────────────────
-- Checks one specific parcel (by id) against ALL other active parcels.
-- Called immediately after insert/update so newly added geometry is validated
-- without re-scanning the whole table.
--
-- Usage:
--   SELECT * FROM check_single_parcel_overlaps('AI-GEN-1234567890-0');
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION check_single_parcel_overlaps(
  p_parcel_id     TEXT,
  p_tolerance_sqm FLOAT DEFAULT 1.0
)
RETURNS TABLE(
  conflicting_id TEXT,
  overlap_sqm    FLOAT
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Flag the target parcel and any neighbours that significantly intersect it
  WITH target AS (
    SELECT id, geometry FROM parcels WHERE id = p_parcel_id
  ),
  neighbours AS (
    SELECT
      p.id,
      ST_Area(
        ST_Transform(ST_Intersection(t.geometry, p.geometry), 32643)
      ) AS area_sqm
    FROM   parcels p, target t
    WHERE  p.id <> p_parcel_id
      AND  p.status IN ('ai_suggestion', 'confirmed', 'reviewed_edited')
      AND  ST_Intersects(t.geometry, p.geometry)
      AND  NOT ST_Touches(t.geometry, p.geometry)
  ),
  real_conflicts AS (
    SELECT id, area_sqm FROM neighbours WHERE area_sqm > p_tolerance_sqm
  )
  -- Mark both sides as conflict
  UPDATE parcels
  SET    status = 'conflict'
  WHERE  id IN (
    SELECT p_parcel_id::TEXT  -- the new parcel
    WHERE  EXISTS (SELECT 1 FROM real_conflicts)
    UNION
    SELECT id FROM real_conflicts
  );

  RETURN QUERY
    SELECT id::TEXT, area_sqm::FLOAT FROM real_conflicts;
END;
$$;

-- ─── 3. Grant execute to prototype application roles ──────────────────────────
GRANT EXECUTE ON FUNCTION flag_overlapping_parcels(FLOAT) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION check_single_parcel_overlaps(TEXT, FLOAT) TO anon, authenticated, service_role;

-- ─── 4. Add optional conflict_reason column (safe, idempotent) ───────────────
-- Allows the backend to store a human-readable reason for the conflict flag.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE  table_name  = 'parcels'
      AND  column_name = 'conflict_reason'
  ) THEN
    ALTER TABLE parcels ADD COLUMN conflict_reason TEXT;
  END IF;
END;
$$;
