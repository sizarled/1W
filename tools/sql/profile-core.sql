-- ==================================================================
-- M1 — profile core: settings, links, blocks, follow states
-- ==================================================================
-- Migration `profile_core` (see docs/profile-schema-plan.md §2.1 and §8).
--
--   profiles          + language, birth_date, is_online_visible, reach_daily_cap,
--                       posts_count, rank_avg (reach_count already exists, no seed)
--   profile_settings   NEW — what the owner shows, what is auto-accepted
--   profile_links      NEW — social accounts (never stores a token)
--   profile_blocks     NEW — seven independent action flags
--   profile_follows    + status (pending/active/declined), requested_at, accepted_at, source
--
-- Rules from the brief
--   • there is no starting reach balance: reach grows from external shares,
--     from the ads page (later) and from content published as a host
--   • a follow is pending until the profile accepts it, unless
--     profile_settings.auto_accept_follow is on
--   • blocking removes the follows of both directions
--   • nothing is readable from the browser: RLS on, RPC only
--
-- Applied as four migrations on 2026-11-01 (project vtbqbhuywdhnvitbcsfy):
--   profile_core_tables        §1-§5
--   profile_core_counters      §6  (+ profile_resolve, profile_online, settings RPCs)
--   profile_core_rpcs          §7  (profile_public, follow toggle/respond/lists)
--   profile_core_blocks_links  §8  (block set/remove/list, links list/save)
-- §9 is the one-time mirror of members -> profiles for rows that predate it.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. profiles
-- ------------------------------------------------------------------
alter table public.profiles add column if not exists language text default 'en';
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists is_online_visible boolean not null default false;
alter table public.profiles add column if not exists reach_daily_cap integer;
alter table public.profiles add column if not exists posts_count integer not null default 0;
alter table public.profiles add column if not exists rank_avg numeric(10, 2) not null default 0;
alter table public.profiles add column if not exists last_seen_at timestamptz;

-- the balance already exists and starts at zero: no grant, no seed
alter table public.profiles alter column reach_count set default 0;
update public.profiles set reach_count = 0 where reach_count is null;

create index if not exists profiles_reach_idx on public.profiles (reach_count desc, followers_count desc);
create index if not exists profiles_username_idx on public.profiles (lower(profile_username));

-- ------------------------------------------------------------------
-- 2. profile settings
-- ------------------------------------------------------------------
create table if not exists public.profile_settings (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  show_country boolean not null default true,
  show_language boolean not null default true,
  show_age boolean not null default false,
  show_level boolean not null default true,
  show_wealth boolean not null default false,
  show_connection boolean not null default false,
  auto_accept_follow boolean not null default false,
  auto_accept_message boolean not null default false,
  auto_accept_publish boolean not null default false,
  auto_accept_participate boolean not null default false,
  allow_keyword_follows boolean not null default true,
  updated_at timestamptz not null default now()
);
alter table public.profile_settings enable row level security;

insert into public.profile_settings (profile_id)
select p.id from public.profiles p
on conflict (profile_id) do nothing;

create or replace function public.profiles_create_settings()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  insert into public.profile_settings (profile_id) values (new.id)
  on conflict (profile_id) do nothing;
  return new;
end;
$function$;

drop trigger if exists profiles_settings_after_insert on public.profiles;
create trigger profiles_settings_after_insert
  after insert on public.profiles
  for each row execute function public.profiles_create_settings();

-- ------------------------------------------------------------------
-- 3. social links
-- ------------------------------------------------------------------
create table if not exists public.profile_links (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  platform text not null check (platform in ('facebook', 'instagram', 'tiktok', 'youtube', 'x', 'pinterest', 'reddit', 'threads', 'telegram')),
  handle text,
  url text,
  connected boolean not null default false,
  sync_direction text not null default 'out' check (sync_direction in ('in', 'out', 'both')),
  token_ref text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (profile_id, platform)
);
alter table public.profile_links enable row level security;

-- ------------------------------------------------------------------
-- 4. blocks (one row, seven independent actions)
-- ------------------------------------------------------------------
create table if not exists public.profile_blocks (
  id uuid primary key default gen_random_uuid(),
  blocker_id uuid not null references public.profiles(id) on delete cascade,
  blocked_id uuid not null references public.profiles(id) on delete cascade,
  view_profile boolean not null default true,
  view_posts boolean not null default true,
  message boolean not null default true,
  publish boolean not null default true,
  participate boolean not null default true,
  react boolean not null default true,
  comment boolean not null default true,
  reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (blocker_id, blocked_id),
  check (blocker_id <> blocked_id)
);
create index if not exists profile_blocks_blocked_idx on public.profile_blocks (blocked_id);
alter table public.profile_blocks enable row level security;

-- ------------------------------------------------------------------
-- 5. follow state
-- ------------------------------------------------------------------
alter table public.profile_follows add column if not exists status text not null default 'active';
alter table public.profile_follows add column if not exists requested_at timestamptz not null default now();
alter table public.profile_follows add column if not exists accepted_at timestamptz;
alter table public.profile_follows add column if not exists source text not null default 'profile';

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'profile_follows_status_check') then
    alter table public.profile_follows
      add constraint profile_follows_status_check check (status in ('pending', 'active', 'declined'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'profile_follows_source_check') then
    alter table public.profile_follows
      add constraint profile_follows_source_check check (source in ('profile', 'keyword', 'post', 'import'));
  end if;
end $$;

update public.profile_follows
   set status = 'active',
       accepted_at = coalesce(accepted_at, created_at),
       requested_at = coalesce(requested_at, created_at)
 where status is null or (status = 'active' and accepted_at is null);

create index if not exists profile_follows_following_idx on public.profile_follows (following_id, status);
create index if not exists profile_follows_follower_idx on public.profile_follows (follower_id, status);

-- ------------------------------------------------------------------
-- 6. counters
-- ------------------------------------------------------------------
create or replace function public.profile_follow_counts_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_a uuid := coalesce(new.follower_id, old.follower_id);
  v_b uuid := coalesce(new.following_id, old.following_id);
begin
  update public.profiles p
     set followers_count = (select count(*) from public.profile_follows f
                             where f.following_id = p.id and f.status = 'active'),
         following_count = (select count(*) from public.profile_follows f
                             where f.follower_id = p.id and f.status = 'active'),
         updated_at = now()
   where p.id in (v_a, v_b);
  return null;
end;
$function$;

drop trigger if exists profile_follows_counts on public.profile_follows;
create trigger profile_follows_counts
  after insert or update or delete on public.profile_follows
  for each row execute function public.profile_follow_counts_sync();

-- recompute the caches once, so the old rows stop lying
update public.profiles p
   set followers_count = (select count(*) from public.profile_follows f
                           where f.following_id = p.id and f.status = 'active'),
       following_count = (select count(*) from public.profile_follows f
                           where f.follower_id = p.id and f.status = 'active');


-- ------------------------------------------------------------------
-- 9. mirror members -> profiles once (no overwrite of curated values)
-- ------------------------------------------------------------------
update public.profiles p
   set country = coalesce(p.country, m.country),
       language = coalesce(p.language, m.language),
       birth_date = coalesce(p.birth_date, m.birth_date),
       description = coalesce(p.description, m.bio),
       avatar_url = coalesce(p.avatar_url, m.avatar_url),
       cover_url = coalesce(p.cover_url, m.cover_url)
  from public.members m
 where m.id = p.id
   and (p.country is null or p.language is null or p.description is null or p.avatar_url is null);

-- ------------------------------------------------------------------
-- 7. RPCs applied in `profile_core_rpcs` (bodies live in the migration)
-- ------------------------------------------------------------------
-- profile_resolve(p_ref text) -> uuid            uuid, @username or IDxxxxxx
-- profile_online(p_profile uuid) -> bool         an active session seen < 5 min ago
-- profile_settings_get(p_token) -> jsonb         owner row, created on demand
-- profile_settings_save(p_token, p_settings)     booleans only, whitelisted keys
-- profile_public(p_token, p_ref) -> jsonb        header + stats + relationship; hides blocked
-- profile_follow_toggle(p_token, p_ref)          pending unless auto_accept_follow
-- profile_follow_respond(p_token, p_ref, accept) finalise a pending follow
-- profile_follow_lists(p_token, p_ref)           actual + pending, both directions
--
-- ------------------------------------------------------------------
-- 8. RPCs applied in `profile_core_blocks_links`
-- ------------------------------------------------------------------
-- profile_block_set(p_token, p_ref, flags)       upsert, defaults all true, drops follows
-- profile_block_remove(p_token, p_ref)
-- profile_blocks_list(p_token)
-- profile_links_list(p_token, p_ref)             a visitor only sees connected links
-- profile_links_save(p_token, platform, ..., remove)   never accepts a token
