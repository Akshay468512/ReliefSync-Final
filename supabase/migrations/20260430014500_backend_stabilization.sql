-- ReliefLink AI backend stabilization migration
-- Idempotent and safe to run on existing environments.

create extension if not exists pgcrypto;

-- 1) Hard type/default/null guarantees for core tables
alter table if exists public.profiles
  alter column id set data type uuid using id::uuid,
  alter column full_name set data type text,
  alter column phone set data type text,
  alter column skills set data type text[] using coalesce(skills, '{}'::text[]),
  alter column has_vehicle set default false,
  alter column has_vehicle set not null,
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.user_roles
  alter column id set data type uuid using id::uuid,
  alter column id set default gen_random_uuid(),
  alter column user_id set data type uuid using user_id::uuid,
  alter column user_id set not null,
  alter column role set not null,
  alter column role set default 'citizen'::public.app_role,
  alter column created_at set not null,
  alter column created_at set default now();

alter table if exists public.emergency_requests
  alter column id set data type uuid using id::uuid,
  alter column id set default gen_random_uuid(),
  alter column reporter_id set data type uuid using reporter_id::uuid,
  alter column reporter_name set data type text,
  alter column reporter_phone set data type text,
  alter column people_affected set default 1,
  alter column description set default '',
  alter column ai_score set default 50,
  alter column status set default 'open'::public.request_status,
  alter column urgency set default 'medium'::public.urgency_level,
  alter column created_at set default now(),
  alter column updated_at set default now();

alter table if exists public.missions
  alter column id set data type uuid using id::uuid,
  alter column id set default gen_random_uuid(),
  alter column request_id set data type uuid using request_id::uuid,
  alter column volunteer_id set data type uuid using volunteer_id::uuid,
  alter column volunteer_name set data type text,
  alter column notes set data type text,
  alter column status set default 'accepted'::public.mission_status,
  alter column created_at set default now(),
  alter column updated_at set default now();

update public.profiles set has_vehicle = false where has_vehicle is null;
update public.profiles set skills = '{}'::text[] where skills is null;
update public.user_roles set created_at = now() where created_at is null;
update public.emergency_requests set created_at = now() where created_at is null;
update public.emergency_requests set updated_at = now() where updated_at is null;
update public.missions set created_at = now() where created_at is null;
update public.missions set updated_at = now() where updated_at is null;

-- 2) Tight uniqueness to prevent role duplicates/user duplication drift
alter table if exists public.user_roles
  drop constraint if exists user_roles_user_id_role_key;

-- Keep one role row per user (highest privilege retained if duplicates exist)
with ranked as (
  select
    id,
    user_id,
    row_number() over (
      partition by user_id
      order by
        case role
          when 'admin' then 3
          when 'volunteer' then 2
          else 1
        end desc,
        created_at asc,
        id asc
    ) as rn
  from public.user_roles
)
delete from public.user_roles ur
using ranked r
where ur.id = r.id
  and r.rn > 1;

alter table if exists public.user_roles
  add constraint user_roles_user_id_key unique (user_id);

-- 3) Backfill missing profile/role rows for already-existing auth users
insert into public.profiles (id, full_name, phone)
select
  au.id,
  coalesce(au.raw_user_meta_data->>'full_name', ''),
  nullif(coalesce(au.raw_user_meta_data->>'phone', ''), '')
from auth.users au
left join public.profiles p on p.id = au.id
where p.id is null
on conflict (id) do nothing;

insert into public.user_roles (user_id, role)
select
  au.id,
  case
    when (au.raw_user_meta_data->>'role') in ('citizen', 'volunteer', 'admin')
      then (au.raw_user_meta_data->>'role')::public.app_role
    else 'citizen'::public.app_role
  end
from auth.users au
left join public.user_roles ur on ur.user_id = au.id
where ur.user_id is null
on conflict (user_id) do nothing;

-- 4) Functions/triggers: remove drift and recreate canonical versions
create or replace function public.has_role(_user_id uuid, _role public.app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    where ur.user_id = _user_id and ur.role = _role
  );
$$;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.sync_request_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  req_id uuid;
  active_count int;
  completed_count int;
begin
  req_id := coalesce(new.request_id, old.request_id);

  select
    count(*) filter (where status in ('accepted', 'on_the_way')),
    count(*) filter (where status = 'completed')
  into active_count, completed_count
  from public.missions
  where request_id = req_id;

  if completed_count > 0 then
    update public.emergency_requests set status = 'completed' where id = req_id;
  elsif active_count > 0 then
    update public.emergency_requests set status = 'in_progress' where id = req_id;
  else
    update public.emergency_requests set status = 'open' where id = req_id;
  end if;

  return coalesce(new, old);
end;
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role_text text;
  resolved_role public.app_role := 'citizen'::public.app_role;
begin
  requested_role_text := coalesce(new.raw_user_meta_data->>'role', '');

  if requested_role_text in ('citizen', 'volunteer', 'admin') then
    resolved_role := requested_role_text::public.app_role;
  end if;

  begin
    insert into public.profiles (id, full_name, phone)
    values (
      new.id,
      coalesce(new.raw_user_meta_data->>'full_name', ''),
      nullif(coalesce(new.raw_user_meta_data->>'phone', ''), '')
    )
    on conflict (id) do update
      set
        full_name = excluded.full_name,
        phone = coalesce(excluded.phone, public.profiles.phone),
        updated_at = now();
  exception when others then
    -- Never block auth signup due to profile sync issues.
    null;
  end;

  begin
    insert into public.user_roles (user_id, role)
    values (new.id, resolved_role)
    on conflict (user_id) do update set role = excluded.role;
  exception when others then
    -- Never block auth signup due to role sync issues.
    null;
  end;

  return new;
end;
$$;

-- Remove duplicate/legacy trigger definitions and recreate exactly one each
do $$
declare
  t record;
begin
  for t in
    select tgname
    from pg_trigger
    where tgrelid = 'public.profiles'::regclass
      and not tgisinternal
  loop
    execute format('drop trigger if exists %I on public.profiles', t.tgname);
  end loop;

  for t in
    select tgname
    from pg_trigger
    where tgrelid = 'public.emergency_requests'::regclass
      and not tgisinternal
  loop
    execute format('drop trigger if exists %I on public.emergency_requests', t.tgname);
  end loop;

  for t in
    select tgname
    from pg_trigger
    where tgrelid = 'public.missions'::regclass
      and not tgisinternal
  loop
    execute format('drop trigger if exists %I on public.missions', t.tgname);
  end loop;
end
$$;

create trigger trg_profiles_updated
before update on public.profiles
for each row execute function public.set_updated_at();

create trigger trg_requests_updated
before update on public.emergency_requests
for each row execute function public.set_updated_at();

create trigger trg_missions_updated
before update on public.missions
for each row execute function public.set_updated_at();

create trigger trg_sync_request_status
after insert or update or delete on public.missions
for each row execute function public.sync_request_status();

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 5) RLS canonical reset
alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.emergency_requests enable row level security;
alter table public.missions enable row level security;

drop policy if exists "Profiles viewable by authenticated users" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
drop policy if exists "Users insert own profile" on public.profiles;
drop policy if exists "Profiles read own or admin" on public.profiles;
drop policy if exists "Profiles update own or admin" on public.profiles;

drop policy if exists "Roles viewable by authenticated" on public.user_roles;
drop policy if exists "Admins manage roles" on public.user_roles;
drop policy if exists "Roles readable by authenticated users" on public.user_roles;
drop policy if exists "Only admins manage roles" on public.user_roles;

drop policy if exists "Requests viewable by all authenticated" on public.emergency_requests;
drop policy if exists "Authenticated users create requests as themselves" on public.emergency_requests;
drop policy if exists "Reporter or admin updates request" on public.emergency_requests;
drop policy if exists "Reporter or admin deletes request" on public.emergency_requests;
drop policy if exists "Requests readable by authenticated users" on public.emergency_requests;
drop policy if exists "Authenticated users create own requests" on public.emergency_requests;
drop policy if exists "Reporter/admin/volunteer update requests" on public.emergency_requests;
drop policy if exists "Reporter/admin delete requests" on public.emergency_requests;

drop policy if exists "Missions viewable by authenticated" on public.missions;
drop policy if exists "Volunteers create own missions" on public.missions;
drop policy if exists "Volunteers update own missions" on public.missions;
drop policy if exists "Volunteers delete own missions" on public.missions;
drop policy if exists "Missions readable by authenticated users" on public.missions;
drop policy if exists "Volunteer/admin create missions" on public.missions;
drop policy if exists "Volunteer/admin update missions" on public.missions;
drop policy if exists "Volunteer/admin delete missions" on public.missions;

create policy "Profiles read own or admin"
on public.profiles
for select
to authenticated
using (auth.uid() = id or public.has_role(auth.uid(), 'admin'));

create policy "Profiles update own or admin"
on public.profiles
for update
to authenticated
using (auth.uid() = id or public.has_role(auth.uid(), 'admin'))
with check (auth.uid() = id or public.has_role(auth.uid(), 'admin'));

create policy "Roles readable by authenticated users"
on public.user_roles
for select
to authenticated
using (true);

create policy "Only admins manage roles"
on public.user_roles
for all
to authenticated
using (public.has_role(auth.uid(), 'admin'))
with check (public.has_role(auth.uid(), 'admin'));

create policy "Requests readable by authenticated users"
on public.emergency_requests
for select
to authenticated
using (true);

create policy "Authenticated users create own requests"
on public.emergency_requests
for insert
to authenticated
with check (auth.uid() = reporter_id);

create policy "Reporter/admin/volunteer update requests"
on public.emergency_requests
for update
to authenticated
using (
  auth.uid() = reporter_id
  or public.has_role(auth.uid(), 'admin')
  or public.has_role(auth.uid(), 'volunteer')
)
with check (
  auth.uid() = reporter_id
  or public.has_role(auth.uid(), 'admin')
  or public.has_role(auth.uid(), 'volunteer')
);

create policy "Reporter/admin delete requests"
on public.emergency_requests
for delete
to authenticated
using (auth.uid() = reporter_id or public.has_role(auth.uid(), 'admin'));

create policy "Missions readable by authenticated users"
on public.missions
for select
to authenticated
using (true);

create policy "Volunteer/admin create missions"
on public.missions
for insert
to authenticated
with check (
  auth.uid() = volunteer_id
  or public.has_role(auth.uid(), 'admin')
);

create policy "Volunteer/admin update missions"
on public.missions
for update
to authenticated
using (
  auth.uid() = volunteer_id
  or public.has_role(auth.uid(), 'admin')
)
with check (
  auth.uid() = volunteer_id
  or public.has_role(auth.uid(), 'admin')
);

create policy "Volunteer/admin delete missions"
on public.missions
for delete
to authenticated
using (
  auth.uid() = volunteer_id
  or public.has_role(auth.uid(), 'admin')
);

-- 6) Realtime publication resilience
do $$
begin
  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'emergency_requests'
  ) then
    alter publication supabase_realtime add table public.emergency_requests;
  end if;

  if not exists (
    select 1
    from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'missions'
  ) then
    alter publication supabase_realtime add table public.missions;
  end if;
exception when undefined_object then
  -- Publication may not exist in some local setups.
  null;
end
$$;

alter table public.emergency_requests replica identity full;
alter table public.missions replica identity full;

-- 7) Function execution hardening
revoke execute on function public.has_role(uuid, public.app_role) from public, anon;
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.sync_request_status() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- 8) IST timezone preference (best-effort for common runtime roles)
do $$
begin
  begin
    execute 'alter role authenticated set timezone = ''Asia/Kolkata''';
  exception when undefined_object then null;
  end;
  begin
    execute 'alter role anon set timezone = ''Asia/Kolkata''';
  exception when undefined_object then null;
  end;
  begin
    execute 'alter role service_role set timezone = ''Asia/Kolkata''';
  exception when undefined_object then null;
  end;
exception when insufficient_privilege then
  null;
end
$$;

-- 9) Refresh PostgREST schema cache
notify pgrst, 'reload schema';
