-- ReliefLink AI backend stabilization migration
-- Idempotent, safe to run on existing environments.

-- 1) Timezone defaults (IST) for application-facing roles.
DO $$
BEGIN
  EXECUTE 'ALTER ROLE authenticator SET timezone TO ''Asia/Kolkata''';
  EXECUTE 'ALTER ROLE authenticated SET timezone TO ''Asia/Kolkata''';
  EXECUTE 'ALTER ROLE anon SET timezone TO ''Asia/Kolkata''';
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE NOTICE 'Skipping role timezone updates due to privilege limits.';
END $$;

-- 2) Core table shape hardening (required columns, defaults, datatypes).
ALTER TABLE public.profiles
  ALTER COLUMN id SET DATA TYPE uuid USING id::uuid,
  ALTER COLUMN full_name SET DATA TYPE text,
  ALTER COLUMN phone SET DATA TYPE text,
  ALTER COLUMN skills SET DATA TYPE text[] USING COALESCE(skills, '{}')::text[],
  ALTER COLUMN has_vehicle SET DATA TYPE boolean USING COALESCE(has_vehicle, false),
  ALTER COLUMN created_at SET DATA TYPE timestamptz USING created_at::timestamptz,
  ALTER COLUMN updated_at SET DATA TYPE timestamptz USING updated_at::timestamptz,
  ALTER COLUMN full_name SET DEFAULT '',
  ALTER COLUMN skills SET DEFAULT '{}'::text[],
  ALTER COLUMN has_vehicle SET DEFAULT false,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.user_roles
  ALTER COLUMN id SET DATA TYPE uuid USING id::uuid,
  ALTER COLUMN user_id SET DATA TYPE uuid USING user_id::uuid,
  ALTER COLUMN created_at SET DATA TYPE timestamptz USING created_at::timestamptz,
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now();

ALTER TABLE public.emergency_requests
  ALTER COLUMN id SET DATA TYPE uuid USING id::uuid,
  ALTER COLUMN reporter_id SET DATA TYPE uuid USING reporter_id::uuid,
  ALTER COLUMN reporter_name SET DATA TYPE text,
  ALTER COLUMN reporter_phone SET DATA TYPE text,
  ALTER COLUMN people_affected SET DATA TYPE integer USING people_affected::integer,
  ALTER COLUMN description SET DATA TYPE text,
  ALTER COLUMN latitude SET DATA TYPE double precision USING latitude::double precision,
  ALTER COLUMN longitude SET DATA TYPE double precision USING longitude::double precision,
  ALTER COLUMN address SET DATA TYPE text,
  ALTER COLUMN photo_url SET DATA TYPE text,
  ALTER COLUMN ai_score SET DATA TYPE integer USING ai_score::integer,
  ALTER COLUMN created_at SET DATA TYPE timestamptz USING created_at::timestamptz,
  ALTER COLUMN updated_at SET DATA TYPE timestamptz USING updated_at::timestamptz,
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN people_affected SET DEFAULT 1,
  ALTER COLUMN description SET DEFAULT '',
  ALTER COLUMN ai_score SET DEFAULT 50,
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

ALTER TABLE public.missions
  ALTER COLUMN id SET DATA TYPE uuid USING id::uuid,
  ALTER COLUMN request_id SET DATA TYPE uuid USING request_id::uuid,
  ALTER COLUMN volunteer_id SET DATA TYPE uuid USING volunteer_id::uuid,
  ALTER COLUMN volunteer_name SET DATA TYPE text,
  ALTER COLUMN eta_minutes SET DATA TYPE integer USING eta_minutes::integer,
  ALTER COLUMN notes SET DATA TYPE text,
  ALTER COLUMN created_at SET DATA TYPE timestamptz USING created_at::timestamptz,
  ALTER COLUMN updated_at SET DATA TYPE timestamptz USING updated_at::timestamptz,
  ALTER COLUMN id SET DEFAULT gen_random_uuid(),
  ALTER COLUMN created_at SET DEFAULT now(),
  ALTER COLUMN updated_at SET DEFAULT now();

-- 3) Null-safety for PK/FK-critical fields.
ALTER TABLE public.profiles
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN full_name SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.user_roles
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN user_id SET NOT NULL,
  ALTER COLUMN role SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL;

ALTER TABLE public.emergency_requests
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN reporter_name SET NOT NULL,
  ALTER COLUMN reporter_phone SET NOT NULL,
  ALTER COLUMN disaster_type SET NOT NULL,
  ALTER COLUMN need_type SET NOT NULL,
  ALTER COLUMN people_affected SET NOT NULL,
  ALTER COLUMN description SET NOT NULL,
  ALTER COLUMN latitude SET NOT NULL,
  ALTER COLUMN longitude SET NOT NULL,
  ALTER COLUMN urgency SET NOT NULL,
  ALTER COLUMN ai_score SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

ALTER TABLE public.missions
  ALTER COLUMN id SET NOT NULL,
  ALTER COLUMN request_id SET NOT NULL,
  ALTER COLUMN volunteer_id SET NOT NULL,
  ALTER COLUMN volunteer_name SET NOT NULL,
  ALTER COLUMN status SET NOT NULL,
  ALTER COLUMN created_at SET NOT NULL,
  ALTER COLUMN updated_at SET NOT NULL;

-- 4) Ensure canonical constraints and indexes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'user_roles_user_id_role_key' AND conrelid = 'public.user_roles'::regclass
  ) THEN
    ALTER TABLE public.user_roles
      ADD CONSTRAINT user_roles_user_id_role_key UNIQUE (user_id, role);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'missions_request_id_volunteer_id_key' AND conrelid = 'public.missions'::regclass
  ) THEN
    ALTER TABLE public.missions
      ADD CONSTRAINT missions_request_id_volunteer_id_key UNIQUE (request_id, volunteer_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_requests_status ON public.emergency_requests(status);
CREATE INDEX IF NOT EXISTS idx_requests_created ON public.emergency_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_missions_request ON public.missions(request_id);
CREATE INDEX IF NOT EXISTS idx_missions_volunteer ON public.missions(volunteer_id);

-- 5) Rebuild trigger functions with safe semantics.
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles ur
    WHERE ur.user_id = _user_id
      AND ur.role = _role
  );
$$;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  requested_role text;
  effective_role app_role;
BEGIN
  requested_role := lower(COALESCE(NEW.raw_user_meta_data->>'role', 'citizen'));
  effective_role := CASE
    WHEN requested_role IN ('citizen', 'volunteer', 'admin') THEN requested_role::app_role
    ELSE 'citizen'::app_role
  END;

  INSERT INTO public.profiles (id, full_name, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', '')
  )
  ON CONFLICT (id) DO UPDATE
    SET full_name = COALESCE(EXCLUDED.full_name, public.profiles.full_name),
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone);

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, effective_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN NEW;
EXCEPTION
  WHEN OTHERS THEN
    -- Never block signup because of profile/role side effects.
    RAISE LOG 'handle_new_user failed for user %: %', NEW.id, SQLERRM;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_request_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  target_request_id uuid;
  active_count integer;
  completed_count integer;
BEGIN
  target_request_id := COALESCE(NEW.request_id, OLD.request_id);

  SELECT COUNT(*) FILTER (WHERE status IN ('accepted','on_the_way')),
         COUNT(*) FILTER (WHERE status = 'completed')
    INTO active_count, completed_count
  FROM public.missions
  WHERE request_id = target_request_id;

  IF completed_count > 0 THEN
    UPDATE public.emergency_requests SET status = 'completed' WHERE id = target_request_id;
  ELSIF active_count > 0 THEN
    UPDATE public.emergency_requests SET status = 'in_progress' WHERE id = target_request_id;
  ELSE
    UPDATE public.emergency_requests SET status = 'open' WHERE id = target_request_id;
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- 6) Remove duplicate/broken triggers and recreate exactly once.
DROP TRIGGER IF EXISTS trg_profiles_updated ON public.profiles;
DROP TRIGGER IF EXISTS trg_requests_updated ON public.emergency_requests;
DROP TRIGGER IF EXISTS trg_missions_updated ON public.missions;
DROP TRIGGER IF EXISTS trg_sync_request_status ON public.missions;
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER trg_profiles_updated
BEFORE UPDATE ON public.profiles
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_requests_updated
BEFORE UPDATE ON public.emergency_requests
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_missions_updated
BEFORE UPDATE ON public.missions
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER trg_sync_request_status
AFTER INSERT OR UPDATE OR DELETE ON public.missions
FOR EACH ROW EXECUTE FUNCTION public.sync_request_status();

CREATE TRIGGER on_auth_user_created
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- 7) RLS stabilization (drop/recreate canonical policies).
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emergency_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.missions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Profiles viewable by authenticated users" ON public.profiles;
DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
DROP POLICY IF EXISTS "Profiles read own" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update own" ON public.profiles;

CREATE POLICY "Profiles read own"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY "Profiles update own"
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Roles viewable by authenticated" ON public.user_roles;
DROP POLICY IF EXISTS "Admins manage roles" ON public.user_roles;
DROP POLICY IF EXISTS "User roles readable by authenticated" ON public.user_roles;
DROP POLICY IF EXISTS "User roles admin manage" ON public.user_roles;

CREATE POLICY "User roles readable by authenticated"
ON public.user_roles
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "User roles admin manage"
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "Requests viewable by all authenticated" ON public.emergency_requests;
DROP POLICY IF EXISTS "Authenticated users create requests as themselves" ON public.emergency_requests;
DROP POLICY IF EXISTS "Reporter or admin updates request" ON public.emergency_requests;
DROP POLICY IF EXISTS "Reporter or admin deletes request" ON public.emergency_requests;
DROP POLICY IF EXISTS "Emergency requests read authenticated" ON public.emergency_requests;
DROP POLICY IF EXISTS "Emergency requests insert self" ON public.emergency_requests;
DROP POLICY IF EXISTS "Emergency requests update reporter_admin_volunteer" ON public.emergency_requests;
DROP POLICY IF EXISTS "Emergency requests delete reporter_admin" ON public.emergency_requests;

CREATE POLICY "Emergency requests read authenticated"
ON public.emergency_requests
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Emergency requests insert self"
ON public.emergency_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY "Emergency requests update reporter_admin_volunteer"
ON public.emergency_requests
FOR UPDATE
TO authenticated
USING (
  auth.uid() = reporter_id
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'volunteer')
)
WITH CHECK (
  auth.uid() = reporter_id
  OR public.has_role(auth.uid(), 'admin')
  OR public.has_role(auth.uid(), 'volunteer')
);

CREATE POLICY "Emergency requests delete reporter_admin"
ON public.emergency_requests
FOR DELETE
TO authenticated
USING (
  auth.uid() = reporter_id
  OR public.has_role(auth.uid(), 'admin')
);

DROP POLICY IF EXISTS "Missions viewable by authenticated" ON public.missions;
DROP POLICY IF EXISTS "Volunteers create own missions" ON public.missions;
DROP POLICY IF EXISTS "Volunteers update own missions" ON public.missions;
DROP POLICY IF EXISTS "Volunteers delete own missions" ON public.missions;
DROP POLICY IF EXISTS "Missions read authenticated" ON public.missions;
DROP POLICY IF EXISTS "Missions insert volunteer_or_admin" ON public.missions;
DROP POLICY IF EXISTS "Missions update volunteer_or_admin" ON public.missions;
DROP POLICY IF EXISTS "Missions delete volunteer_or_admin" ON public.missions;

CREATE POLICY "Missions read authenticated"
ON public.missions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY "Missions insert volunteer_or_admin"
ON public.missions
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Missions update volunteer_or_admin"
ON public.missions
FOR UPDATE
TO authenticated
USING (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
)
WITH CHECK (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY "Missions delete volunteer_or_admin"
ON public.missions
FOR DELETE
TO authenticated
USING (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
);

-- 8) Realtime publication safety.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'emergency_requests'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.emergency_requests;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'missions'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.missions;
  END IF;
END $$;

ALTER TABLE public.emergency_requests REPLICA IDENTITY FULL;
ALTER TABLE public.missions REPLICA IDENTITY FULL;

-- 9) Lock down function execution surfaces.
REVOKE EXECUTE ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_request_status() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_updated_at() FROM PUBLIC, anon, authenticated;

-- 10) Ask PostgREST to refresh schema cache.
NOTIFY pgrst, 'reload schema';
