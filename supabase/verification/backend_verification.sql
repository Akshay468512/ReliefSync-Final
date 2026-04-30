-- ReliefLink backend verification script
-- Run in Supabase SQL Editor or via:
-- npx supabase db query --linked -f supabase/verification/backend_verification.sql -o table

-- 1) Table row counts
SELECT 'profiles' AS table_name, COUNT(*)::bigint AS row_count FROM public.profiles
UNION ALL
SELECT 'user_roles', COUNT(*)::bigint FROM public.user_roles
UNION ALL
SELECT 'emergency_requests', COUNT(*)::bigint FROM public.emergency_requests
UNION ALL
SELECT 'missions', COUNT(*)::bigint FROM public.missions
ORDER BY table_name;

-- 2) Trigger existence matrix
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  t.tgname AS trigger_name,
  p.proname AS function_name,
  CASE WHEN t.tgenabled = 'O' THEN 'ENABLED' ELSE t.tgenabled::text END AS enabled_state
FROM pg_trigger t
JOIN pg_class c ON c.oid = t.tgrelid
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN pg_proc p ON p.oid = t.tgfoid
WHERE NOT t.tgisinternal
  AND (
    (n.nspname = 'auth' AND c.relname = 'users' AND t.tgname = 'on_auth_user_created')
    OR (n.nspname = 'public' AND c.relname IN ('profiles', 'emergency_requests', 'missions')
        AND t.tgname IN ('trg_profiles_updated', 'trg_requests_updated', 'trg_missions_updated', 'trg_sync_request_status'))
  )
ORDER BY schema_name, table_name, trigger_name;

-- 3) Policy matrix
SELECT
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN ('profiles', 'user_roles', 'emergency_requests', 'missions')
ORDER BY tablename, cmd, policyname;

-- 4) Function presence and definitions (signature-level)
SELECT
  n.nspname AS schema_name,
  p.proname AS function_name,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_function_result(p.oid) AS returns
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('handle_new_user', 'sync_request_status', 'set_updated_at', 'has_role')
ORDER BY function_name;

-- 5) Orphan checks
SELECT 'profiles_without_auth_user' AS check_name, COUNT(*)::bigint AS failures
FROM public.profiles p
LEFT JOIN auth.users u ON u.id = p.id
WHERE u.id IS NULL
UNION ALL
SELECT 'user_roles_without_auth_user', COUNT(*)::bigint
FROM public.user_roles r
LEFT JOIN auth.users u ON u.id = r.user_id
WHERE u.id IS NULL
UNION ALL
SELECT 'missions_without_request', COUNT(*)::bigint
FROM public.missions m
LEFT JOIN public.emergency_requests e ON e.id = m.request_id
WHERE e.id IS NULL
UNION ALL
SELECT 'missions_without_volunteer_user', COUNT(*)::bigint
FROM public.missions m
LEFT JOIN auth.users u ON u.id = m.volunteer_id
WHERE u.id IS NULL;

-- 6) Potential duplicate role rows
SELECT user_id, role, COUNT(*)::bigint AS duplicates
FROM public.user_roles
GROUP BY user_id, role
HAVING COUNT(*) > 1
ORDER BY duplicates DESC;

-- 7) RLS enabled checks
SELECT
  n.nspname AS schema_name,
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('profiles', 'user_roles', 'emergency_requests', 'missions')
ORDER BY c.relname;

