-- BhoomiX authentication profiles and application roles.
-- Supabase Auth owns credentials; this public table stores safe app-facing data.

CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  role TEXT NOT NULL DEFAULT 'reviewer'
    CHECK (role IN ('admin', 'surveyor', 'reviewer')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

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

DROP TRIGGER IF EXISTS on_bhoomix_auth_user_created ON auth.users;
CREATE TRIGGER on_bhoomix_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_bhoomix_user();

-- Include accounts that existed before this migration.
INSERT INTO public.profiles (id, email, display_name, role)
SELECT
  id,
  email,
  COALESCE(raw_user_meta_data ->> 'display_name', raw_user_meta_data ->> 'full_name'),
  'reviewer'
FROM auth.users
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Users can read their BhoomiX profile" ON public.profiles;
CREATE POLICY "Users can read their BhoomiX profile"
  ON public.profiles FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

REVOKE ALL ON TABLE public.profiles FROM anon;
GRANT SELECT ON TABLE public.profiles TO authenticated;
GRANT ALL ON TABLE public.profiles TO service_role;

NOTIFY pgrst, 'reload schema';
