-- ==================================================================
-- dashboard.html — database mirror
-- ==================================================================
-- Applied to the project as the `dashboard_core` migration. This file is the
-- readable copy kept with the site (like tools/sql/login-page.sql) so the
-- rules the page relies on can be reviewed without the dashboard.
--
--   members            + ban_reason / banned_at / banned_by / ban_permanent
--   viewing_codes      six digits, duration, age rating, bound device
--   watch_code_devices one row per device bound to a code
--   notifications      written by the server (activation, court, …)
--   notification_prefs per-section notification switches
--   member_lists       favorites / watch later / completed
--   court_cases        trial requests, dates, verdicts
--
-- Every read goes through `member_dashboard(token)`: the browser never sees a
-- table, a token hash or another member's row.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. columns
-- ------------------------------------------------------------------
alter table public.members add column if not exists ban_reason text;
alter table public.members add column if not exists banned_at timestamptz;
alter table public.members add column if not exists banned_by text;
alter table public.members add column if not exists ban_permanent boolean not null default false;

alter table public.viewing_codes alter column code type text using code::text;
alter table public.viewing_codes add column if not exists duration_months integer not null default 1;
alter table public.viewing_codes add column if not exists age_rating text not null default 'none';
alter table public.viewing_codes add column if not exists device_mac text;
alter table public.viewing_codes add column if not exists device_name text;
alter table public.viewing_codes add column if not exists status text not null default 'active';
alter table public.viewing_codes add column if not exists updated_at timestamptz not null default now();

create unique index if not exists viewing_codes_code_key on public.viewing_codes (code);
create index if not exists viewing_codes_member_idx on public.viewing_codes (member_id, created_at desc);
create index if not exists watch_code_devices_code_idx on public.watch_code_devices (code_id);
create index if not exists watch_code_devices_member_idx on public.watch_code_devices (idmember);

-- ------------------------------------------------------------------
-- 2. tables
-- ------------------------------------------------------------------
create table if not exists public.notification_prefs (
  member_id uuid not null references public.members(id) on delete cascade,
  source    text not null,
  enabled   boolean not null default true,
  updated_at timestamptz not null default now(),
  primary key (member_id, source)
);
alter table public.notification_prefs enable row level security;

create table if not exists public.member_lists (
  id         bigserial primary key,
  member_id  uuid not null references public.members(id) on delete cascade,
  kind       text not null check (kind in ('favorite', 'later', 'complete')),
  media_type text not null,
  tmdb_id    bigint,
  title      text,
  poster     text,
  link       text,
  meta       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (member_id, kind, media_type, tmdb_id)
);
create index if not exists member_lists_member_idx on public.member_lists (member_id, kind, created_at desc);
alter table public.member_lists enable row level security;

create table if not exists public.court_cases (
  id            uuid primary key default gen_random_uuid(),
  case_code     text not null unique,
  member_id     uuid not null references public.members(id) on delete cascade,
  reason        text not null,
  status        text not null default 'requested'
                check (status in ('requested', 'scheduled', 'resolved', 'closed')),
  scheduled_at  timestamptz,
  decision      text check (decision in ('unban', 'uphold')),
  decision_note text,
  decided_by    text,
  decided_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists court_cases_member_idx on public.court_cases (member_id, created_at desc);
alter table public.court_cases enable row level security;

-- ------------------------------------------------------------------
-- 3. helpers
-- ------------------------------------------------------------------
create or replace function public.member_from_token(p_token text)
returns public.members
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
begin
  if coalesce(p_token, '') = '' then
    return null;
  end if;
  select m.* into v_member
    from public.sessions s
    join public.members m on m.id = coalesce(s.member_id, s.user_id)
   where s.token_hash = encode(digest(p_token, 'sha256'), 'hex')
     and s.session_status = 'active'
     and s.expires_at > now()
   limit 1;
  return v_member;
end;
$function$;

create or replace function public.viewing_code_new()
returns text
language plpgsql
volatile
as $function$
declare
  v_code text;
begin
  loop
    v_code := lpad((floor(random() * 900000) + 100000)::int::text, 6, '0');
    exit when not exists (select 1 from public.viewing_codes c where c.code = v_code);
  end loop;
  return v_code;
end;
$function$;

-- ------------------------------------------------------------------
-- 4. one call for the whole page
-- ------------------------------------------------------------------
-- Returns:
--   ok, member, restricted, ban{reason,at,by,permanent},
--   overview{membership,points_available,points_spent,points_total,
--            watch_minutes,level,joined_at,…},
--   codes[], devices[], notifications[], prefs{}, lists{favorite,later,complete},
--   reports[], court{active,history}, prizes[], points_ledger[], history[]
-- The full body lives in the applied migration; it is a set of aggregates over
-- the tables above, each filtered by `v_member.id`.
create or replace function public.member_dashboard(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  -- … aggregates (see the applied `dashboard_core` migration) …
  return jsonb_build_object('ok', true, 'member', public.member_payload(v_member));
end;
$function$;

-- ------------------------------------------------------------------
-- 5. actions
-- ------------------------------------------------------------------
-- member_code_create(token, code|null, months, age, mac|null, name|null)
--   refuses when the account is not active → {ok:false, error:'inactive'}
--   code must be six digits and unique → 'code_format' / 'code_taken'
--   months ∈ (1,3,6,12), age ∈ (none,13,16,18)
--   a MAC binds the code to that device in watch_code_devices
--
-- member_code_action(token, code_id, 'unlink'|'delete'|'disable'|'enable')
--   only touches codes owned by the caller
--
-- member_device_delete(token, device_id)   removes the device + frees its code
-- member_notify_set(token, source, enabled) 'messages' and 'court' → 'locked'
-- member_notify_read(token, notification_id)
-- member_list_remove(token, list_id)
-- member_court_request(token)
--   banned + not permanent only; one open case at a time; writes a
--   notification and a `court_requested` log row
-- member_court_history(token)  every case of the caller + ban details
-- member_activation_request(token, note)
--   inactive only; one request per hour; writes a notification + log row
-- admin_ban_member(member, reason, by, permanent)   service role only

-- ------------------------------------------------------------------
-- 6. grants
-- ------------------------------------------------------------------
grant execute on function public.member_dashboard(text) to anon, authenticated, service_role;
grant execute on function public.member_code_create(text, text, integer, text, text, text) to anon, authenticated, service_role;
grant execute on function public.member_code_action(text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.member_device_delete(text, uuid) to anon, authenticated, service_role;
grant execute on function public.member_notify_set(text, text, boolean) to anon, authenticated, service_role;
grant execute on function public.member_notify_read(text, uuid) to anon, authenticated, service_role;
grant execute on function public.member_list_remove(text, bigint) to anon, authenticated, service_role;
grant execute on function public.member_court_request(text) to anon, authenticated, service_role;
grant execute on function public.member_court_history(text) to anon, authenticated, service_role;
grant execute on function public.member_activation_request(text, text) to anon, authenticated, service_role;

revoke all on function public.member_from_token(text) from public;
revoke all on function public.admin_ban_member(uuid, text, text, boolean) from public;
grant execute on function public.admin_ban_member(uuid, text, text, boolean) to service_role;
