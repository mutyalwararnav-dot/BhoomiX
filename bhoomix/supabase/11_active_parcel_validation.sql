-- ============================================================
-- BhoomiX · 11_active_parcel_validation.sql
-- Excludes legacy/demo seed geometry from production validation.
-- Run after 00-10 in the Supabase SQL Editor.
-- ============================================================

CREATE OR REPLACE FUNCTION public.flag_active_overlapping_parcels(
  p_tolerance_sqm DOUBLE PRECISION DEFAULT 1.0
)
RETURNS TABLE(
  parcel_a TEXT,
  parcel_b TEXT,
  overlap_sqm DOUBLE PRECISION
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_tolerance_sqm < 0 OR p_tolerance_sqm > 1000000 THEN
    RAISE EXCEPTION 'p_tolerance_sqm must be between 0 and 1,000,000';
  END IF;

  RETURN QUERY
  WITH active_suggestions AS (
    SELECT id, geometry
    FROM public.parcels
    WHERE status = 'ai_suggestion'
      AND (
        source_type = 'imported'
        OR (source_type = 'model' AND source_upload_id IS NOT NULL)
      )
  ),
  real_conflicts AS (
    SELECT
      a.id AS id_a,
      b.id AS id_b,
      public.ST_Area(
        public.ST_Transform(public.ST_Intersection(a.geometry, b.geometry), 32643)
      )::DOUBLE PRECISION AS area_sqm
    FROM active_suggestions a
    JOIN active_suggestions b ON a.id < b.id
    WHERE public.ST_Intersects(a.geometry, b.geometry)
      AND NOT public.ST_Touches(a.geometry, b.geometry)
      AND public.ST_Area(
        public.ST_Transform(public.ST_Intersection(a.geometry, b.geometry), 32643)
      ) > p_tolerance_sqm
  ),
  updated AS (
    UPDATE public.parcels
    SET status = 'conflict'
    WHERE id IN (
      SELECT id_a FROM real_conflicts
      UNION
      SELECT id_b FROM real_conflicts
    )
    RETURNING id
  )
  SELECT id_a, id_b, area_sqm
  FROM real_conflicts;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.flag_active_overlapping_parcels(DOUBLE PRECISION)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_active_overlapping_parcels(DOUBLE PRECISION)
  TO service_role;

NOTIFY pgrst, 'reload schema';
