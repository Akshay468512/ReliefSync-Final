-- Align RLS policies with backend requirements.

-- Profiles: user can read/update own profile only.
DROP POLICY IF EXISTS profiles_select ON public.profiles;
DROP POLICY IF EXISTS profiles_update_own ON public.profiles;
DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
DROP POLICY IF EXISTS "Profiles read own" ON public.profiles;
DROP POLICY IF EXISTS "Profiles update own" ON public.profiles;

CREATE POLICY profiles_select_own
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);

CREATE POLICY profiles_update_own
ON public.profiles
FOR UPDATE
TO authenticated
USING (auth.uid() = id)
WITH CHECK (auth.uid() = id);

CREATE POLICY profiles_insert_own
ON public.profiles
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = id);

-- user_roles: readable by authenticated users; admins can manage.
DROP POLICY IF EXISTS roles_select ON public.user_roles;
DROP POLICY IF EXISTS roles_admin_manage ON public.user_roles;
DROP POLICY IF EXISTS "User roles readable by authenticated" ON public.user_roles;
DROP POLICY IF EXISTS "User roles admin manage" ON public.user_roles;

CREATE POLICY roles_select
ON public.user_roles
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY roles_admin_manage
ON public.user_roles
FOR ALL
TO authenticated
USING (public.has_role(auth.uid(), 'admin'))
WITH CHECK (public.has_role(auth.uid(), 'admin'));

-- emergency_requests: authenticated create/read; reporter/admin/volunteer update; reporter/admin delete.
DROP POLICY IF EXISTS requests_select ON public.emergency_requests;
DROP POLICY IF EXISTS requests_insert ON public.emergency_requests;
DROP POLICY IF EXISTS requests_update ON public.emergency_requests;
DROP POLICY IF EXISTS requests_delete ON public.emergency_requests;
DROP POLICY IF EXISTS "Emergency requests read authenticated" ON public.emergency_requests;
DROP POLICY IF EXISTS "Emergency requests insert self" ON public.emergency_requests;
DROP POLICY IF EXISTS "Emergency requests update reporter_admin_volunteer" ON public.emergency_requests;
DROP POLICY IF EXISTS "Emergency requests delete reporter_admin" ON public.emergency_requests;

CREATE POLICY requests_select
ON public.emergency_requests
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY requests_insert
ON public.emergency_requests
FOR INSERT
TO authenticated
WITH CHECK (auth.uid() = reporter_id);

CREATE POLICY requests_update
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

CREATE POLICY requests_delete
ON public.emergency_requests
FOR DELETE
TO authenticated
USING (
  auth.uid() = reporter_id
  OR public.has_role(auth.uid(), 'admin')
);

-- missions: volunteer/admin can create/update/delete; authenticated users can read.
DROP POLICY IF EXISTS missions_select ON public.missions;
DROP POLICY IF EXISTS missions_insert ON public.missions;
DROP POLICY IF EXISTS missions_update ON public.missions;
DROP POLICY IF EXISTS missions_delete ON public.missions;
DROP POLICY IF EXISTS "Missions read authenticated" ON public.missions;
DROP POLICY IF EXISTS "Missions insert volunteer_or_admin" ON public.missions;
DROP POLICY IF EXISTS "Missions update volunteer_or_admin" ON public.missions;
DROP POLICY IF EXISTS "Missions delete volunteer_or_admin" ON public.missions;

CREATE POLICY missions_select
ON public.missions
FOR SELECT
TO authenticated
USING (true);

CREATE POLICY missions_insert
ON public.missions
FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
);

CREATE POLICY missions_update
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

CREATE POLICY missions_delete
ON public.missions
FOR DELETE
TO authenticated
USING (
  auth.uid() = volunteer_id
  OR public.has_role(auth.uid(), 'admin')
);

NOTIFY pgrst, 'reload schema';
