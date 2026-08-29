-- ============================================================
-- BhoomiX · 07_security_roles_and_rls.sql
-- Least-privilege roles, RLS, and server-only mutations.
-- Run after 00-06 in the Supabase SQL Editor.
-- IMPORTANT: configure SUPABASE_SERVICE_ROLE_KEY on the Next.js server first.
-- ============================================================

-- New self-service accounts begin as reviewers. Administrators can promote an
-- account to surveyor/admin through a trusted server-side administration flow.
ALTER TABLE public.profiles ALTER COLUMN role SET DEFAULT 'reviewer';

CREATE OR REPLACE FUNCTION public.handle_new_bhoomix_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, display_name, role)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'display_name', NEW.raw_user_meta_data ->> 'full_name'),
    'reviewer'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- Public visitors may read parcel geometry through the read-only GeoJSON RPC.
-- Every mutation is performed by validated/rate-limited Next.js server routes.
ALTER TABLE public.parcels ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Public can read cadastral parcels" ON public.parcels;
CREATE POLICY "Public can read cadastral parcels"
  ON public.parcels FOR SELECT
  TO anon, authenticated
  USING (true);

REVOKE INSERT, UPDATE, DELETE, TRUNCATE, REFERENCES, TRIGGER
  ON public.parcels FROM anon, authenticated;
GRANT SELECT ON public.parcels TO anon, authenticated;
GRANT ALL ON public.parcels TO service_role;

ALTER TABLE public.parcel_audit_trail ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.parcel_audit_trail FROM anon, authenticated;
GRANT ALL ON public.parcel_audit_trail TO service_role;

ALTER TABLE public.drone_uploads ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.drone_uploads FROM anon, authenticated;
GRANT ALL ON public.drone_uploads TO service_role;

ALTER TABLE public.model_feedback_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.model_feedback_logs FROM anon, authenticated;
GRANT ALL ON public.model_feedback_logs TO service_role;

-- Raw survey imagery is private. Access is mediated by the application server.
UPDATE storage.buckets SET public = false WHERE id = 'drone_datasets';
DROP POLICY IF EXISTS "Allow public uploads to drone_datasets" ON storage.objects;
DROP POLICY IF EXISTS "Allow public select from drone_datasets" ON storage.objects;

-- Read-only RPC remains public for the open map experience.
GRANT EXECUTE ON FUNCTION public.get_parcels_as_geojson() TO anon, authenticated, service_role;

-- Mutation and training-data RPCs are server-only.
REVOKE EXECUTE ON FUNCTION public.seed_mock_parcels(jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.seed_mock_parcels(jsonb) TO service_role;

REVOKE EXECUTE ON FUNCTION public.update_parcel_geometry(TEXT, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.update_parcel_geometry(TEXT, JSONB, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.flag_overlapping_parcels(FLOAT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.flag_overlapping_parcels(FLOAT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.check_single_parcel_overlaps(TEXT, FLOAT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_single_parcel_overlaps(TEXT, FLOAT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.log_parcel_feedback(TEXT, TEXT, JSONB, JSONB, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.log_parcel_feedback(TEXT, TEXT, JSONB, JSONB, TEXT) TO service_role;

REVOKE EXECUTE ON FUNCTION public.get_feedback_export() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_feedback_export() TO service_role;

REVOKE ALL ON public.parcel_geojson FROM anon, authenticated;

NOTIFY pgrst, 'reload schema';
