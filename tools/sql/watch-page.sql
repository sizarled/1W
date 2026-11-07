-- =====================================================================
-- 1World Web · watch page schema
-- Tables: watchlink, hestory, watchtime, comment, playlists (+movie/tv),
--         reportlink, prizeavilable, the six community tables, tasks,
--         likes / watch-later / code-devices / milestones.
-- Run through the Supabase migration runner (see README › Database).
-- =====================================================================

create sequence if not exists public.watchlink_seq;
create sequence if not exists public.playlist_seq;
create sequence if not exists public.prize_seq;
create sequence if not exists public.comment_seq;

-- ---------------------------------------------------------------------
-- watchlink — every community / platform player source
-- ---------------------------------------------------------------------
create table if not exists public.watchlink (
  id                 uuid primary key default gen_random_uuid(),
  link_code          text not null unique default ('link' || lpad(nextval('public.watchlink_seq')::text, 6, '0')),
  idtmdb             bigint not null check (idtmdb > 0),
  media_type         text not null check (media_type in ('movie', 'tv')),
  season             int check (season is null or season >= 0),
  episode            int check (episode is null or episode >= 0),
  site_name          text,
  site_logo          text,
  url                text not null,
  quality            text check (quality is null or quality in ('SD', 'HD', 'FHD', '2K', '4K', '8K')),
  audio_language     text,
  subtitles          boolean not null default false,
  subtitle_languages text[] not null default '{}',
  has_ads            boolean not null default false,
  is_hidden          boolean not null default false,  -- hide the raw url, show site / @member only
  publisher_id       uuid references public.members(id) on delete set null, -- null = platform source
  is_default         boolean not null default false,
  is_published       boolean not null default true,
  clicks             bigint not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index if not exists watchlink_content_idx on public.watchlink (idtmdb, media_type, season, episode);
create index if not exists watchlink_publisher_idx on public.watchlink (publisher_id);

-- ---------------------------------------------------------------------
-- hestory — resume / history per member
-- ---------------------------------------------------------------------
create table if not exists public.hestory (
  id               bigserial primary key,
  idmember         uuid references public.members(id) on delete cascade,
  idtmdb           bigint not null,
  media_type       text not null check (media_type in ('movie', 'tv')),
  season           int,
  episode          int,
  progress_seconds int not null default 0,
  progress_percent numeric(5,2) not null default 0,
  status           text not null default 'watching' check (status in ('watching', 'completed', 'later', 'dismissed')),
  watched_at       timestamptz not null default now(),
  created_at       timestamptz not null default now()
);
create unique index if not exists hestory_unique_episode
  on public.hestory (idmember, idtmdb, media_type, coalesce(season, 0), coalesce(episode, 0));

-- ---------------------------------------------------------------------
-- watchtime — the minutes ledger behind every counter on the site
-- ---------------------------------------------------------------------
create table if not exists public.watchtime (
  id          bigserial primary key,
  idmember    uuid references public.members(id) on delete set null,
  idpublisher uuid references public.members(id) on delete set null,
  idtmdb      bigint not null,
  media_type  text not null check (media_type in ('movie', 'tv')),
  season      int,
  episode     int,
  watch_date  timestamptz not null default now(),
  seconds     int not null default 0 check (seconds >= 0),
  is_eligible boolean not null default true,     -- false when an ad blocker was detected
  link_id     uuid references public.watchlink(id) on delete set null,
  device_id   text,
  created_at  timestamptz not null default now()
);
create index if not exists watchtime_content_idx on public.watchtime (idtmdb, media_type, watch_date desc);
create index if not exists watchtime_member_idx on public.watchtime (idmember, watch_date desc);
create index if not exists watchtime_publisher_idx on public.watchtime (idpublisher, watch_date desc);

-- ---------------------------------------------------------------------
-- comment — public thread, one row per comment / reply
-- location examples: movie:1399 · tv:1399:season:1:episode:1
-- ---------------------------------------------------------------------
create table if not exists public.comment (
  id          bigserial primary key,
  comment_code text not null unique default ('cmt' || lpad(nextval('public.comment_seq')::text, 6, '0')),
  location    text not null,
  idmember    uuid not null references public.members(id) on delete cascade,
  parent_id   bigint references public.comment(id) on delete cascade,
  content     text not null check (char_length(content) between 1 and 4000),
  agree_count int not null default 0,
  disagree_count int not null default 0,
  status      text not null default 'visible' check (status in ('visible', 'hidden', 'deleted')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists comment_location_idx on public.comment (location, created_at desc);

create table if not exists public.comment_reaction (
  id         bigserial primary key,
  comment_id bigint not null references public.comment(id) on delete cascade,
  idmember   uuid not null references public.members(id) on delete cascade,
  reaction   text not null check (reaction in ('agree', 'disagree')),
  created_at timestamptz not null default now(),
  unique (comment_id, idmember)
);

-- ---------------------------------------------------------------------
-- likes / watch later
-- ---------------------------------------------------------------------
create table if not exists public.content_reaction (
  id         bigserial primary key,
  location   text not null,          -- movie:1399 / tv:1399
  idmember   uuid not null references public.members(id) on delete cascade,
  value      smallint not null check (value in (-1, 1)),
  created_at timestamptz not null default now(),
  unique (location, idmember)
);

create table if not exists public.watch_later (
  id         bigserial primary key,
  idmember   uuid not null references public.members(id) on delete cascade,
  idtmdb     bigint not null,
  media_type text not null check (media_type in ('movie', 'tv')),
  season     int,
  episode    int,
  created_at timestamptz not null default now(),
  unique (idmember, idtmdb, media_type)
);

-- ---------------------------------------------------------------------
-- reportlink
-- ---------------------------------------------------------------------
create table if not exists public.reportlink (
  id         uuid primary key default gen_random_uuid(),
  link_id    uuid references public.watchlink(id) on delete cascade,
  idmember   uuid references public.members(id) on delete set null,
  idtmdb     bigint,
  reason     text not null check (reason in ('broken', 'misleading', 'harmful', 'other')),
  details    text check (details is null or char_length(details) <= 2000),
  status     text not null default 'open' check (status in ('open', 'reviewing', 'resolved', 'rejected')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- playlists (shared identity) + playlistmovie / playlisttv (items)
-- visibility: public · category (only allowed_members) · private (creator)
-- system_kind: completed · later · not_interested (auto lists)
-- ---------------------------------------------------------------------
create table if not exists public.playlists (
  id           uuid primary key default gen_random_uuid(),
  idplaylist   text not null unique default ('playlist' || lpad(nextval('public.playlist_seq')::text, 6, '0')),
  idcreator    uuid references public.members(id) on delete set null,
  idmember     uuid references public.members(id) on delete cascade,
  list_name    text not null check (char_length(list_name) between 1 and 160),
  media_type   text not null default 'mixed' check (media_type in ('movie', 'tv', 'mixed')),
  visibility   text not null default 'public' check (visibility in ('public', 'category', 'private')),
  allowed_members uuid[] not null default '{}',
  system_kind  text check (system_kind in ('completed', 'later', 'not_interested', 'watch_later')),
  description  text,
  cover_url    text,
  is_published boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists playlists_system_unique
  on public.playlists (idmember, system_kind) where system_kind is not null;

create table if not exists public.playlistmovie (
  idplaylist uuid not null references public.playlists(id) on delete cascade,
  idcreator  uuid references public.members(id) on delete set null,
  idmember   uuid references public.members(id) on delete set null,
  idmovie    bigint not null,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  primary key (idplaylist, idmovie)
);

create table if not exists public.playlisttv (
  idplaylist uuid not null references public.playlists(id) on delete cascade,
  idcreator  uuid references public.members(id) on delete set null,
  idmember   uuid references public.members(id) on delete set null,
  idtv       bigint not null,
  season     int not null default 1,
  episode    int not null default 1,
  position   int not null default 0,
  created_at timestamptz not null default now(),
  primary key (idplaylist, idtv, season, episode)
);

-- ---------------------------------------------------------------------
-- prizes
-- ---------------------------------------------------------------------
create table if not exists public.prizeavilable (
  id              uuid primary key default gen_random_uuid(),
  idprize         text not null unique default ('prize' || lpad(nextval('public.prize_seq')::text, 6, '0')),
  prize_name      text not null,
  prize_description text,
  prize_image     text,
  prize_type      text not null default 'points' check (prize_type in ('points', 'product', 'cash', 'subscription')),
  points_required int not null default 0 check (points_required >= 0),
  stock           int,
  starts_at       timestamptz not null default now(),
  expires_at      timestamptz,
  is_published    boolean not null default true,
  created_at      timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- community content that mentions a title
-- ---------------------------------------------------------------------
create table if not exists public.channelsvideo (
  id uuid primary key default gen_random_uuid(),
  idvideo text not null unique,
  title text not null, description text, thumbnail_url text,
  idmember uuid references public.members(id) on delete set null,
  views_minutes bigint not null default 0, keywords text[] not null default '{}',
  is_published boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.blogarticle (
  id uuid primary key default gen_random_uuid(),
  idarticle text not null unique,
  title text not null, description text, thumbnail_url text,
  idmember uuid references public.members(id) on delete set null,
  views_minutes bigint not null default 0, keywords text[] not null default '{}',
  is_published boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.spaceanswer (
  id uuid primary key default gen_random_uuid(),
  idanswer text not null unique,
  title text not null, description text, thumbnail_url text,
  idmember uuid references public.members(id) on delete set null,
  views_minutes bigint not null default 0, keywords text[] not null default '{}',
  is_published boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.libraryducment (
  id uuid primary key default gen_random_uuid(),
  iddocument text not null unique,
  title text not null, description text, thumbnail_url text,
  idmember uuid references public.members(id) on delete set null,
  views_minutes bigint not null default 0, keywords text[] not null default '{}',
  is_published boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.reviewwatch (
  id uuid primary key default gen_random_uuid(),
  idreview text not null unique,
  idtmdb bigint, media_type text check (media_type in ('movie', 'tv')),
  title text not null, description text, thumbnail_url text, rating numeric(3,1),
  idmember uuid references public.members(id) on delete set null,
  views_minutes bigint not null default 0, keywords text[] not null default '{}',
  is_published boolean not null default true, created_at timestamptz not null default now()
);
create table if not exists public.postrecommendation (
  id uuid primary key default gen_random_uuid(),
  idrecommendation text not null unique,
  idtmdb bigint, media_type text check (media_type in ('movie', 'tv')),
  title text not null, description text, thumbnail_url text,
  idmember uuid references public.members(id) on delete set null,
  views_minutes bigint not null default 0, keywords text[] not null default '{}',
  is_published boolean not null default true, created_at timestamptz not null default now()
);
create index if not exists channelsvideo_minutes_idx on public.channelsvideo (views_minutes desc);
create index if not exists blogarticle_minutes_idx on public.blogarticle (views_minutes desc);
create index if not exists reviewwatch_content_idx on public.reviewwatch (idtmdb, media_type);

-- ---------------------------------------------------------------------
-- tasks (offers network) — impression / click / completion
-- ---------------------------------------------------------------------
create table if not exists public.taskimpretion (
  id bigserial primary key,
  offer_id text not null, idmember uuid references public.members(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.taskclick (
  id bigserial primary key,
  offer_id text not null, idmember uuid references public.members(id) on delete cascade,
  created_at timestamptz not null default now()
);
create table if not exists public.taskcomplet (
  id bigserial primary key,
  offer_id text not null, idmember uuid not null references public.members(id) on delete cascade,
  payout numeric(10,2) not null default 0, points int not null default 0,
  created_at timestamptz not null default now(),
  unique (offer_id, idmember)
);

-- ---------------------------------------------------------------------
-- watching-code device binding + playback sessions + milestones
-- ---------------------------------------------------------------------
create table if not exists public.watch_code_devices (
  id         uuid primary key default gen_random_uuid(),
  code_id    uuid not null references public.viewing_codes(id) on delete cascade,
  device_id  text not null,
  idmember   uuid references public.members(id) on delete cascade,
  first_used_at timestamptz not null default now(),
  last_used_at  timestamptz not null default now(),
  unique (code_id, device_id)
);

create table if not exists public.watch_sessions (
  id            uuid primary key default gen_random_uuid(),
  idmember      uuid references public.members(id) on delete set null,
  device_id     text,
  idtmdb        bigint not null, media_type text not null check (media_type in ('movie', 'tv')),
  season        int, episode int,
  link_id       uuid references public.watchlink(id) on delete set null,
  idpublisher   uuid references public.members(id) on delete set null,
  ad_started_at timestamptz, ad_verified_at timestamptz,
  code_verified_at timestamptz,
  started_at    timestamptz not null default now(),
  ended_at      timestamptz,
  seconds_watched int not null default 0
);

create table if not exists public.member_milestones (
  idmember   uuid not null references public.members(id) on delete cascade,
  milestone  text not null,
  fired_at   timestamptz not null default now(),
  primary key (idmember, milestone)
);

-- =====================================================================
-- triggers & functions
-- =====================================================================
drop trigger if exists watchlink_touch on public.watchlink;
create trigger watchlink_touch before update on public.watchlink
  for each row execute function public.touch_updated_at();

drop trigger if exists playlists_touch on public.playlists;
create trigger playlists_touch before update on public.playlists
  for each row execute function public.touch_updated_at();

drop trigger if exists comment_touch on public.comment;
create trigger comment_touch before update on public.comment
  for each row execute function public.touch_updated_at();

-- keep agree / disagree counters in sync with comment_reaction
create or replace function public.comment_recount() returns trigger
language plpgsql security definer set search_path = public as $$
declare target bigint := coalesce(new.comment_id, old.comment_id);
begin
  update public.comment c set
    agree_count = (select count(*) from public.comment_reaction r where r.comment_id = target and r.reaction = 'agree'),
    disagree_count = (select count(*) from public.comment_reaction r where r.comment_id = target and r.reaction = 'disagree')
  where c.id = target;
  return null;
end $$;

drop trigger if exists comment_reaction_count on public.comment_reaction;
create trigger comment_reaction_count after insert or update or delete on public.comment_reaction
  for each row execute function public.comment_recount();

-- total watched minutes for a title (used by "views per minute" chips)
create or replace function public.content_minutes(p_idtmdb bigint, p_type text)
returns bigint language sql stable security definer set search_path = public as $$
  select coalesce(sum(round(seconds / 60.0)), 0)::bigint
  from public.watchtime
  where idtmdb = p_idtmdb and media_type = p_type and is_eligible;
$$;

-- like / dislike + comment totals for a movie or tv location
create or replace function public.content_stats(p_location text)
returns json language sql stable security definer set search_path = public as $$
  select json_build_object(
    'likes', (select count(*) from public.content_reaction where location = p_location and value = 1),
    'dislikes', (select count(*) from public.content_reaction where location = p_location and value = -1),
    'comments', (select count(*) from public.comment where location = p_location and status = 'visible'),
    'minutes', (select coalesce(sum(round(seconds / 60.0)), 0)::bigint from public.watchtime w
                where p_location like (w.media_type || ':' || w.idtmdb || '%') and w.is_eligible)
  );
$$;

-- viewing-code check + optional device binding (six digits, per member)
create or replace function public.verify_watch_code(
  p_code text,
  p_device text default null,
  p_member uuid default null
) returns json
language plpgsql security definer set search_path = public as $$
declare
  v_row public.viewing_codes;
begin
  if p_code is null or p_code !~ '^[0-9]{6}$' then
    return json_build_object('ok', false, 'reason', 'format');
  end if;

  select * into v_row
  from public.viewing_codes
  where code = p_code
    and is_active
    and (expires_at is null or expires_at > now())
    and (p_member is null or member_id = p_member)
  order by created_at desc
  limit 1;

  if v_row.id is null then
    return json_build_object('ok', false, 'reason', 'invalid');
  end if;

  -- a code is bound to the first device that used it (when a device is supplied)
  if p_device is not null then
    if exists (select 1 from public.watch_code_devices d
               where d.code_id = v_row.id and d.device_id <> p_device) then
      return json_build_object('ok', false, 'reason', 'device');
    end if;
    insert into public.watch_code_devices (code_id, device_id, idmember)
    values (v_row.id, p_device, v_row.member_id)
    on conflict (code_id, device_id) do update set last_used_at = now();
  end if;

  return json_build_object('ok', true, 'reason', 'ok', 'member', v_row.member_id);
end $$;

-- 1000 qualified minutes → fire the ad-network unlock exactly once per member
create or replace function public.claim_milestone(p_idmember uuid, p_milestone text default 'watch-1000')
returns boolean language plpgsql security definer set search_path = public as $$
declare v_inserted boolean := false;
begin
  insert into public.member_milestones (idmember, milestone)
  values (p_idmember, p_milestone)
  on conflict do nothing;
  get diagnostics v_inserted = row_count;
  return coalesce(v_inserted, false);
end $$;

grant execute on function public.content_minutes(bigint, text) to anon, authenticated;
grant execute on function public.content_stats(text) to anon, authenticated;
grant execute on function public.verify_watch_code(text, text, uuid) to anon, authenticated;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.watchlink           enable row level security;
alter table public.hestory             enable row level security;
alter table public.watchtime           enable row level security;
alter table public.comment             enable row level security;
alter table public.comment_reaction    enable row level security;
alter table public.content_reaction    enable row level security;
alter table public.watch_later         enable row level security;
alter table public.reportlink          enable row level security;
alter table public.playlists           enable row level security;
alter table public.playlistmovie       enable row level security;
alter table public.playlisttv          enable row level security;
alter table public.prizeavilable       enable row level security;
alter table public.channelsvideo       enable row level security;
alter table public.blogarticle         enable row level security;
alter table public.spaceanswer         enable row level security;
alter table public.libraryducment      enable row level security;
alter table public.reviewwatch         enable row level security;
alter table public.postrecommendation  enable row level security;
alter table public.taskimpretion       enable row level security;
alter table public.taskclick           enable row level security;
alter table public.taskcomplet         enable row level security;
alter table public.watch_code_devices  enable row level security;
alter table public.watch_sessions      enable row level security;
alter table public.member_milestones   enable row level security;

-- public reads ------------------------------------------------------
drop policy if exists watchlink_public_read on public.watchlink;
create policy watchlink_public_read on public.watchlink for select to anon, authenticated using (is_published);

drop policy if exists comment_public_read on public.comment;
create policy comment_public_read on public.comment for select to anon, authenticated using (status = 'visible');

drop policy if exists playlists_public_read on public.playlists;
create policy playlists_public_read on public.playlists for select to anon, authenticated
  using (is_published and visibility = 'public');

drop policy if exists playlistmovie_read on public.playlistmovie;
create policy playlistmovie_read on public.playlistmovie for select to anon, authenticated
  using (exists (select 1 from public.playlists p where p.id = idplaylist and p.is_published and p.visibility = 'public'));

drop policy if exists playlisttv_read on public.playlisttv;
create policy playlisttv_read on public.playlisttv for select to anon, authenticated
  using (exists (select 1 from public.playlists p where p.id = idplaylist and p.is_published and p.visibility = 'public'));

drop policy if exists prize_public_read on public.prizeavilable;
create policy prize_public_read on public.prizeavilable for select to anon, authenticated using (is_published);

drop policy if exists content_public_read on public.channelsvideo;
create policy content_public_read on public.channelsvideo for select to anon, authenticated using (is_published);
drop policy if exists content_public_read on public.blogarticle;
create policy content_public_read on public.blogarticle for select to anon, authenticated using (is_published);
drop policy if exists content_public_read on public.spaceanswer;
create policy content_public_read on public.spaceanswer for select to anon, authenticated using (is_published);
drop policy if exists content_public_read on public.libraryducment;
create policy content_public_read on public.libraryducment for select to anon, authenticated using (is_published);
drop policy if exists content_public_read on public.reviewwatch;
create policy content_public_read on public.reviewwatch for select to anon, authenticated using (is_published);
drop policy if exists content_public_read on public.postrecommendation;
create policy content_public_read on public.postrecommendation for select to anon, authenticated using (is_published);

drop policy if exists content_reaction_read on public.content_reaction;
create policy content_reaction_read on public.content_reaction for select to anon, authenticated using (true);

drop policy if exists comment_reaction_read on public.comment_reaction;
create policy comment_reaction_read on public.comment_reaction for select to anon, authenticated using (true);

-- anonymous engagement writes ---------------------------------------
-- NOTE: member login is not wired to Supabase Auth yet, so the browser
-- writes with the anon key. Tighten these to `to authenticated` plus an
-- `idmember = current_member_id()` check once login.html ships.
drop policy if exists watchtime_insert on public.watchtime;
create policy watchtime_insert on public.watchtime for insert to anon, authenticated
  with check (seconds >= 0 and seconds <= 86400);

drop policy if exists hestory_write on public.hestory;
create policy hestory_write on public.hestory for insert to anon, authenticated with check (true);
drop policy if exists hestory_update on public.hestory;
create policy hestory_update on public.hestory for update to anon, authenticated using (true) with check (true);

drop policy if exists comment_insert on public.comment;
create policy comment_insert on public.comment for insert to anon, authenticated
  with check (status = 'visible' and char_length(content) between 1 and 4000);

drop policy if exists comment_reaction_write on public.comment_reaction;
create policy comment_reaction_write on public.comment_reaction for insert to anon, authenticated with check (true);
drop policy if exists comment_reaction_update on public.comment_reaction;
create policy comment_reaction_update on public.comment_reaction for update to anon, authenticated using (true) with check (true);

drop policy if exists content_reaction_write on public.content_reaction;
create policy content_reaction_write on public.content_reaction for insert to anon, authenticated with check (value in (-1, 1));
drop policy if exists content_reaction_update on public.content_reaction;
create policy content_reaction_update on public.content_reaction for update to anon, authenticated using (true) with check (value in (-1, 1));

drop policy if exists watch_later_write on public.watch_later;
create policy watch_later_write on public.watch_later for insert to anon, authenticated with check (true);
drop policy if exists watch_later_read on public.watch_later;
create policy watch_later_read on public.watch_later for select to anon, authenticated using (true);
drop policy if exists watch_later_delete on public.watch_later;
create policy watch_later_delete on public.watch_later for delete to anon, authenticated using (true);

drop policy if exists reportlink_insert on public.reportlink;
create policy reportlink_insert on public.reportlink for insert to anon, authenticated with check (true);

drop policy if exists playlists_insert on public.playlists;
create policy playlists_insert on public.playlists for insert to anon, authenticated with check (true);
drop policy if exists playlistmovie_insert on public.playlistmovie;
create policy playlistmovie_insert on public.playlistmovie for insert to anon, authenticated with check (true);
drop policy if exists playlisttv_insert on public.playlisttv;
create policy playlisttv_insert on public.playlisttv for insert to anon, authenticated with check (true);

drop policy if exists watch_sessions_write on public.watch_sessions;
create policy watch_sessions_write on public.watch_sessions for insert to anon, authenticated with check (true);
drop policy if exists watch_sessions_update on public.watch_sessions;
create policy watch_sessions_update on public.watch_sessions for update to anon, authenticated using (true) with check (true);

drop policy if exists task_events_write on public.taskimpretion;
create policy task_events_write on public.taskimpretion for insert to anon, authenticated with check (true);
drop policy if exists task_events_write on public.taskclick;
create policy task_events_write on public.taskclick for insert to anon, authenticated with check (true);
drop policy if exists task_events_write on public.taskcomplet;
create policy task_events_write on public.taskcomplet for insert to anon, authenticated with check (true);

-- grants -------------------------------------------------------------
grant select on public.watchlink, public.comment, public.playlists, public.playlistmovie,
  public.playlisttv, public.prizeavilable, public.channelsvideo, public.blogarticle,
  public.spaceanswer, public.libraryducment, public.reviewwatch, public.postrecommendation,
  public.content_reaction, public.comment_reaction, public.watch_later
  to anon, authenticated;

grant insert, update on public.hestory, public.watchtime, public.comment, public.comment_reaction,
  public.content_reaction, public.watch_later, public.reportlink, public.watch_sessions,
  public.taskimpretion, public.taskclick, public.taskcomplet
  to anon, authenticated;

grant insert on public.playlists, public.playlistmovie, public.playlisttv to anon, authenticated;
grant select on public.watchtime, public.hestory to authenticated;
grant usage, select on all sequences in schema public to anon, authenticated;

comment on table public.watchlink is 'Community + platform player sources for a movie / episode. publisher_id null = platform source.';
comment on table public.watchtime is 'Watched seconds ledger; minutes are derived (round(seconds/60)). is_eligible=false when an ad blocker was detected.';
comment on table public.comment is 'Comments keyed by location: movie:1399 or tv:1399:season:1:episode:1.';
comment on table public.playlists is 'Playlist identity (name/visibility/owner); items live in playlistmovie / playlisttv.';
