-- ============================================================
-- BhoomiX: Surveyor Workspace Updates
-- Run this in the Supabase SQL Editor to support vertex editing
-- ============================================================

-- 1. Update the parcel status constraint to allow 'reviewed_edited'
ALTER TABLE parcels DROP CONSTRAINT IF EXISTS parcels_status_check;
ALTER TABLE parcels ADD CONSTRAINT parcels_status_check 
  CHECK (status IN ('ai_suggestion', 'confirmed', 'conflict', 'pending', 'reviewed_edited'));

-- 2. Create RPC for updating geometry and auditing
CREATE OR REPLACE FUNCTION update_parcel_geometry(
  p_id TEXT,
  p_new_geojson JSONB,
  p_changed_by TEXT
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_old_status TEXT;
  v_old_geometry geometry(Polygon, 4326);
BEGIN
  -- Get existing parcel status and geometry
  SELECT status, geometry INTO v_old_status, v_old_geometry
  FROM parcels WHERE id = p_id;
  
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Parcel not found');
  END IF;

  -- Update parcel geometry and status
  UPDATE parcels
  SET status = 'reviewed_edited',
      geometry = ST_GeomFromGeoJSON(p_new_geojson)
  WHERE id = p_id;
  
  -- Insert into audit trail
  INSERT INTO parcel_audit_trail (
    parcel_id,
    previous_status,
    new_status,
    previous_geometry,
    new_geometry,
    changed_by,
    changed_at
  ) VALUES (
    p_id,
    v_old_status,
    'reviewed_edited',
    v_old_geometry,
    ST_GeomFromGeoJSON(p_new_geojson),
    p_changed_by,
    NOW()
  );
  
  RETURN jsonb_build_object('success', true);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- Grant execution permissions
GRANT EXECUTE ON FUNCTION update_parcel_geometry(TEXT, JSONB, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION update_parcel_geometry(TEXT, JSONB, TEXT) TO anon;
GRANT EXECUTE ON FUNCTION update_parcel_geometry(TEXT, JSONB, TEXT) TO authenticated;
