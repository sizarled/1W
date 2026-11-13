-- =====================================================================
-- cast.html — TMDB person profiles (1World Web / Cineaura)
-- ---------------------------------------------------------------------
-- 7 tables
--   tmdb_people                cached person record (never hit TMDB on every visit)
--   tmdb_person_external_links official social links from TMDB external ids
--   tmdb_person_credits        one row per person + title + job/character
--                              (media_type 'movie' | 'tv' — no separate tables)
--   member_person_actions      follow / repost / block, one row per member+person
--   person_reactions           fan / hater / critic, one row per member+person
--   content_person_mentions    which review / article / video mentions the person
--   person_work_deliveries     dedupe: one notification and one repost per work
--
-- Reused as-is: members, profiles, notifications, postrecommendation (the
-- member post table — there is no `posts` table in this project), reviewwatch,
-- blogarticle, channelsvideo, watch links (movie_links / tv_episode_links stay
-- untouched: viewing links never move into the person tables).
--
-- All writes go through SECURITY DEFINER functions (RLS-safe, no RETURNING
-- problems); catalogue tables stay publicly readable.
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. people
-- ---------------------------------------------------------------------
create table if not exists public.tmdb_people (
  id                  uuid primary key default gen_random_uuid(),
  tmdb_person_id      bigint not null unique,
  name                text not null,
  also_known_as       text[] not null default '{}',
  biography           text,
  profile_path        text,
  known_for_department text,
  birthday            date,
  deathday            date,
  place_of_birth      text,
  gender              smallint,
  popularity          numeric(12, 3),
  imdb_id             text,
  homepage            text,
  last_synced_at      timestamptz not null default now(),
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists tmdb_people_name_idx on public.tmdb_people (lower(name));
create index if not exists tmdb_people_sync_idx on public.tmdb_people (last_synced_at);

-- ---------------------------------------------------------------------
-- 2. official links (facebook, instagram, twitter, tiktok, youtube, …)
-- ---------------------------------------------------------------------
create table if not exists public.tmdb_person_external_links (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.tmdb_people (id) on delete cascade,
  tmdb_person_id bigint not null,
  network        text not null,
  url            text not null,
  handle         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (person_id, network)
);
create index if not exists tmdb_person_links_tmdb_idx on public.tmdb_person_external_links (tmdb_person_id);

-- ---------------------------------------------------------------------
-- 3. credits (films and series share the table; media_type splits them)
-- ---------------------------------------------------------------------
create table if not exists public.tmdb_person_credits (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.tmdb_people (id) on delete cascade,
  tmdb_person_id bigint not null,
  media_type     text not null check (media_type in ('movie', 'tv')),
  tmdb_media_id  bigint not null,
  title          text not null,
  original_title text,
  character      text not null default '',
  job            text not null default '',
  department     text not null default '',
  release_date   date,
  poster_path    text,
  vote_average   numeric(4, 2),
  popularity     numeric(12, 3),
  episode_count  integer,
  is_cast        boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (person_id, media_type, tmdb_media_id, job, character)
);
create index if not exists tmdb_person_credits_person_idx
  on public.tmdb_person_credits (person_id, media_type, release_date desc);
create index if not exists tmdb_person_credits_tmdb_idx
  on public.tmdb_person_credits (tmdb_person_id);
create index if not exists tmdb_person_credits_media_idx
  on public.tmdb_person_credits (media_type, tmdb_media_id);

-- ---------------------------------------------------------------------
-- 4. member dials — follow / repost / block
-- ---------------------------------------------------------------------
create table if not exists public.member_person_actions (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.members (id) on delete cascade,
  person_id      uuid not null references public.tmdb_people (id) on delete cascade,
  tmdb_person_id bigint not null,
  follow         boolean not null default false,
  repost         boolean not null default false,
  block          boolean not null default false,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (member_id, person_id)
);
create index if not exists member_person_actions_member_idx
  on public.member_person_actions (member_id) where block or follow or repost;
create index if not exists member_person_actions_person_idx
  on public.member_person_actions (person_id);

-- ---------------------------------------------------------------------
-- 5. reactions — fans / haters / critics (read-only in the UI counts)
-- ---------------------------------------------------------------------
create table if not exists public.person_reactions (
  id             uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.members (id) on delete cascade,
  person_id      uuid not null references public.tmdb_people (id) on delete cascade,
  tmdb_person_id bigint not null,
  reaction       text not null check (reaction in ('fan', 'hater', 'critic')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (member_id, person_id)
);
create index if not exists person_reactions_person_idx
  on public.person_reactions (person_id, reaction);

-- ---------------------------------------------------------------------
-- 6. mentions — which review / article / video includes the person
-- ---------------------------------------------------------------------
create table if not exists public.content_person_mentions (
  id             uuid primary key default gen_random_uuid(),
  person_id      uuid not null references public.tmdb_people (id) on delete cascade,
  tmdb_person_id bigint not null,
  content_type   text not null check (content_type in ('review', 'article', 'video')),
  content_id     uuid not null,
  content_table  text not null default '',
  title          text,
  created_at     timestamptz not null default now(),
  unique (person_id, content_type, content_id)
);
create index if not exists content_person_mentions_person_idx
  on public.content_person_mentions (person_id, content_type, created_at desc);

-- ---------------------------------------------------------------------
-- 7. deliveries — the same work is delivered once as notification and
--    once as a repost, never twice
-- ---------------------------------------------------------------------
create table if not exists public.person_work_deliveries (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid not null references public.members (id) on delete cascade,
  person_id       uuid not null references public.tmdb_people (id) on delete cascade,
  tmdb_person_id  bigint not null,
  media_type      text not null check (media_type in ('movie', 'tv')),
  tmdb_media_id   bigint not null,
  delivery_type   text not null check (delivery_type in ('notification', 'repost')),
  title           text,
  notification_id uuid,
  post_id         uuid,
  created_at      timestamptz not null default now(),
  unique (member_id, person_id, media_type, tmdb_media_id, delivery_type)
);
create index if not exists person_work_deliveries_member_idx
  on public.person_work_deliveries (member_id, created_at desc);
create index if not exists person_work_deliveries_person_idx
  on public.person_work_deliveries (person_id, tmdb_person_id);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.tmdb_people               enable row level security;
alter table public.tmdb_person_external_links enable row level security;
alter table public.tmdb_person_credits       enable row level security;
alter table public.member_person_actions     enable row level security;
alter table public.person_reactions          enable row level security;
alter table public.content_person_mentions   enable row level security;
alter table public.person_work_deliveries    enable row level security;

drop policy if exists tmdb_people_read on public.tmdb_people;
create policy tmdb_people_read on public.tmdb_people for select using (true);

drop policy if exists tmdb_person_links_read on public.tmdb_person_external_links;
create policy tmdb_person_links_read on public.tmdb_person_external_links for select using (true);

drop policy if exists tmdb_person_credits_read on public.tmdb_person_credits;
create policy tmdb_person_credits_read on public.tmdb_person_credits for select using (true);

drop policy if exists content_person_mentions_read on public.content_person_mentions;
create policy content_person_mentions_read on public.content_person_mentions for select using (true);

-- member tables: no direct access at all — the functions below own them
drop policy if exists member_person_actions_none on public.member_person_actions;
drop policy if exists person_reactions_none on public.person_reactions;
drop policy if exists person_work_deliveries_none on public.person_work_deliveries;

-- ---------------------------------------------------------------------
-- stats: fans / haters / critics + dials + my own state
-- ---------------------------------------------------------------------
create or replace function public.person_stats(p_tmdb bigint, p_member uuid default null)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  with p as (select id from public.tmdb_people where tmdb_person_id = p_tmdb),
  r as (
    select count(*) filter (where reaction = 'fan')   as fans,
           count(*) filter (where reaction = 'hater') as haters,
           count(*) filter (where reaction = 'critic') as critics
    from public.person_reactions where person_id = (select id from p)
  ),
  a as (
    select count(*) filter (where follow) as followers,
           count(*) filter (where repost) as reposters,
           count(*) filter (where block)  as blocks
    from public.member_person_actions where person_id = (select id from p)
  ),
  mine_r as (
    select reaction from public.person_reactions
    where person_id = (select id from p) and p_member is not null and member_id = p_member limit 1
  ),
  mine_a as (
    select follow, repost, block from public.member_person_actions
    where person_id = (select id from p) and p_member is not null and member_id = p_member limit 1
  )
  select jsonb_build_object(
    'tmdb_person_id', p_tmdb,
    'fans',    coalesce((select fans from r), 0),
    'haters',  coalesce((select haters from r), 0),
    'critics', coalesce((select critics from r), 0),
    'followers', coalesce((select followers from a), 0),
    'reposters', coalesce((select reposters from a), 0),
    'blocks',    coalesce((select blocks from a), 0),
    'mine', jsonb_build_object(
      'reaction', (select reaction from mine_r),
      'follow',   coalesce((select follow from mine_a), false),
      'repost',   coalesce((select repost from mine_a), false),
      'block',    coalesce((select block from mine_a), false)
    )
  );
$$;

-- ---------------------------------------------------------------------
-- cached read (used when TMDB is unreachable, and by the smoke test)
-- ---------------------------------------------------------------------
create or replace function public.person_get(p_tmdb bigint)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'person', to_jsonb(p) - 'id',
    'links', coalesce((
      select jsonb_agg(jsonb_build_object('network', l.network, 'url', l.url, 'handle', l.handle) order by l.network)
      from public.tmdb_person_external_links l where l.person_id = p.id
    ), '[]'::jsonb),
    'credits', coalesce((
      select jsonb_agg(jsonb_build_object(
        'media_type', c.media_type, 'tmdb_media_id', c.tmdb_media_id, 'title', c.title,
        'original_title', c.original_title, 'character', c.character, 'job', c.job,
        'department', c.department, 'release_date', c.release_date, 'poster_path', c.poster_path,
        'vote_average', c.vote_average, 'popularity', c.popularity, 'episode_count', c.episode_count,
        'is_cast', c.is_cast
      ) order by c.media_type, c.release_date desc nulls last)
      from public.tmdb_person_credits c where c.person_id = p.id
    ), '[]'::jsonb)
  )
  from public.tmdb_people p
  where p.tmdb_person_id = p_tmdb;
$$;

-- ---------------------------------------------------------------------
-- save / refresh a person (person + official links + credits)
-- returns {person_id, tmdb_person_id, credits_added, links}
-- ---------------------------------------------------------------------
create or replace function public.person_save(
  p_person  jsonb,
  p_links   jsonb default '[]'::jsonb,
  p_credits jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tmdb    bigint := nullif(p_person ->> 'tmdb_person_id', '')::bigint;
  v_person  uuid;
  v_links   integer := 0;
  v_added   integer := 0;
  v_new     boolean;
  l         record;
  c         record;
begin
  if v_tmdb is null then
    raise exception 'person_save: tmdb_person_id is required';
  end if;

  insert into public.tmdb_people as tp (
    tmdb_person_id, name, also_known_as, biography, profile_path, known_for_department,
    birthday, deathday, place_of_birth, gender, popularity, imdb_id, homepage,
    last_synced_at, updated_at
  ) values (
    v_tmdb,
    coalesce(nullif(p_person ->> 'name', ''), 'Unknown'),
    coalesce((
      select array_agg(x) from jsonb_array_elements_text(coalesce(p_person -> 'also_known_as', '[]'::jsonb)) as t(x)
    ), '{}'::text[]),
    nullif(p_person ->> 'biography', ''),
    nullif(p_person ->> 'profile_path', ''),
    nullif(p_person ->> 'known_for_department', ''),
    nullif(p_person ->> 'birthday', '')::date,
    nullif(p_person ->> 'deathday', '')::date,
    nullif(p_person ->> 'place_of_birth', ''),
    nullif(p_person ->> 'gender', '')::smallint,
    nullif(p_person ->> 'popularity', '')::numeric,
    nullif(p_person ->> 'imdb_id', ''),
    nullif(p_person ->> 'homepage', ''),
    now(), now()
  )
  on conflict (tmdb_person_id) do update set
    name                 = excluded.name,
    also_known_as        = excluded.also_known_as,
    biography            = coalesce(excluded.biography, tp.biography),
    profile_path         = coalesce(excluded.profile_path, tp.profile_path),
    known_for_department = coalesce(excluded.known_for_department, tp.known_for_department),
    birthday             = coalesce(excluded.birthday, tp.birthday),
    deathday             = coalesce(excluded.deathday, tp.deathday),
    place_of_birth       = coalesce(excluded.place_of_birth, tp.place_of_birth),
    gender               = coalesce(excluded.gender, tp.gender),
    popularity           = coalesce(excluded.popularity, tp.popularity),
    imdb_id              = coalesce(excluded.imdb_id, tp.imdb_id),
    homepage             = coalesce(excluded.homepage, tp.homepage),
    last_synced_at       = now(),
    updated_at           = now()
  returning id into v_person;

  -- official links: TMDB is the only source, never invent one
  delete from public.tmdb_person_external_links where person_id = v_person;
  for l in select value from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) loop
    if nullif(l.value ->> 'url', '') is null or nullif(l.value ->> 'network', '') is null then
      continue;
    end if;
    insert into public.tmdb_person_external_links (person_id, tmdb_person_id, network, url, handle)
    values (v_person, v_tmdb, lower(l.value ->> 'network'), l.value ->> 'url', nullif(l.value ->> 'handle', ''))
    on conflict (person_id, network) do update
      set url = excluded.url, handle = excluded.handle, updated_at = now();
    v_links := v_links + 1;
  end loop;

  for c in select value from jsonb_array_elements(coalesce(p_credits, '[]'::jsonb)) loop
    continue when nullif(c.value ->> 'media_type', '') is null
                  or (c.value ->> 'media_type') not in ('movie', 'tv')
                  or nullif(c.value ->> 'tmdb_media_id', '') is null;
    if nullif(c.value ->> 'title', '') is null then
      continue;
    end if;
    insert into public.tmdb_person_credits as cr (
      person_id, tmdb_person_id, media_type, tmdb_media_id, title, original_title,
      character, job, department, release_date, poster_path, vote_average, popularity,
      episode_count, is_cast, updated_at
    ) values (
      v_person, v_tmdb,
      c.value ->> 'media_type',
      (c.value ->> 'tmdb_media_id')::bigint,
      c.value ->> 'title',
      nullif(c.value ->> 'original_title', ''),
      coalesce(c.value ->> 'character', ''),
      coalesce(c.value ->> 'job', ''),
      coalesce(c.value ->> 'department', ''),
      nullif(c.value ->> 'release_date', '')::date,
      nullif(c.value ->> 'poster_path', ''),
      nullif(c.value ->> 'vote_average', '')::numeric,
      nullif(c.value ->> 'popularity', '')::numeric,
      nullif(c.value ->> 'episode_count', '')::integer,
      coalesce((c.value ->> 'is_cast')::boolean, false),
      now()
    )
    on conflict (person_id, media_type, tmdb_media_id, job, character) do update set
      title          = excluded.title,
      original_title = excluded.original_title,
      department     = excluded.department,
      release_date   = excluded.release_date,
      poster_path    = coalesce(excluded.poster_path, cr.poster_path),
      vote_average   = excluded.vote_average,
      popularity     = excluded.popularity,
      episode_count  = coalesce(excluded.episode_count, cr.episode_count),
      is_cast        = excluded.is_cast,
      updated_at     = now()
    returning (xmax = 0) into v_new;
    if v_new then
      v_added := v_added + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'person_id', v_person,
    'tmdb_person_id', v_tmdb,
    'links', v_links,
    'credits_added', v_added
  );
end;
$$;

-- ---------------------------------------------------------------------
-- take action: follow / repost / block
--   block switches follow and repost off; unblocking never re-enables them
-- ---------------------------------------------------------------------
create or replace function public.person_action_set(
  p_member uuid,
  p_tmdb   bigint,
  p_follow boolean default false,
  p_repost boolean default false,
  p_block  boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_person uuid;
  v_row    public.member_person_actions%rowtype;
begin
  if p_member is null then
    raise exception 'person_action_set: member required';
  end if;
  select id into v_person from public.tmdb_people where tmdb_person_id = p_tmdb;
  if v_person is null then
    raise exception 'person_action_set: unknown person %', p_tmdb;
  end if;

  if coalesce(p_block, false) then
    p_follow := false;
    p_repost := false;
  end if;

  insert into public.member_person_actions (member_id, person_id, tmdb_person_id, follow, repost, block)
  values (p_member, v_person, p_tmdb, coalesce(p_follow, false), coalesce(p_repost, false), coalesce(p_block, false))
  on conflict (member_id, person_id) do update set
    follow = excluded.follow,
    repost = excluded.repost,
    block  = excluded.block,
    updated_at = now()
  returning * into v_row;

  return jsonb_build_object(
    'follow', v_row.follow,
    'repost', v_row.repost,
    'block',  v_row.block,
    'stats',  public.person_stats(p_tmdb, p_member)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- fan / hater / critic — same reaction twice removes it
-- ---------------------------------------------------------------------
create or replace function public.person_reaction_set(
  p_member   uuid,
  p_tmdb     bigint,
  p_reaction text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_person    uuid;
  v_reaction  text := nullif(lower(trim(coalesce(p_reaction, ''))), '');
  v_current   text;
begin
  if p_member is null then
    raise exception 'person_reaction_set: member required';
  end if;
  select id into v_person from public.tmdb_people where tmdb_person_id = p_tmdb;
  if v_person is null then
    raise exception 'person_reaction_set: unknown person %', p_tmdb;
  end if;
  if v_reaction is not null and v_reaction not in ('fan', 'hater', 'critic') then
    raise exception 'person_reaction_set: bad reaction %', v_reaction;
  end if;

  select reaction into v_current from public.person_reactions
   where member_id = p_member and person_id = v_person;

  if v_reaction is null or v_reaction = v_current then
    delete from public.person_reactions where member_id = p_member and person_id = v_person;
  else
    insert into public.person_reactions (member_id, person_id, tmdb_person_id, reaction)
    values (p_member, v_person, p_tmdb, v_reaction)
    on conflict (member_id, person_id) do update
      set reaction = excluded.reaction, updated_at = now();
  end if;

  return public.person_stats(p_tmdb, p_member);
end;
$$;

-- ---------------------------------------------------------------------
-- mentions: which reviews / articles / videos talk about the person
-- ---------------------------------------------------------------------
create or replace function public.person_mention_add(
  p_tmdb    bigint,
  p_type    text,
  p_content uuid,
  p_title   text default null
)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_person uuid;
  v_table  text;
begin
  if p_type not in ('review', 'article', 'video') then
    return false;
  end if;
  select id into v_person from public.tmdb_people where tmdb_person_id = p_tmdb;
  if v_person is null or p_content is null then
    return false;
  end if;
  v_table := case p_type when 'review' then 'reviewwatch' when 'article' then 'blogarticle' else 'channelsvideo' end;

  insert into public.content_person_mentions (person_id, tmdb_person_id, content_type, content_id, content_table, title)
  values (v_person, p_tmdb, p_type, p_content, v_table, nullif(p_title, ''))
  on conflict (person_id, content_type, content_id) do nothing;
  return true;
end;
$$;

create or replace function public.person_mentions(p_tmdb bigint)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select coalesce(jsonb_agg(row_json order by row_json ->> 'published_at' desc nulls last), '[]'::jsonb)
  from (
    select jsonb_build_object(
      'content_type', m.content_type,
      'content_id', m.content_id,
      'title', coalesce(nullif(m.title, ''), r.title, a.title, v.title),
      'description', coalesce(r.description, a.description, v.description),
      'thumbnail_url', coalesce(r.thumbnail_url, a.thumbnail_url, v.thumbnail_url),
      'rating', r.rating,
      'member_id', coalesce(r.idmember, a.idmember, v.idmember),
      'published_at', coalesce(r.created_at, a.created_at, v.created_at)
    ) as row_json
    from public.content_person_mentions m
    left join public.reviewwatch   r on m.content_type = 'review'  and r.id = m.content_id
    left join public.blogarticle    a on m.content_type = 'article' and a.id = m.content_id
    left join public.channelsvideo  v on m.content_type = 'video'   and v.id = m.content_id
    where m.tmdb_person_id = p_tmdb
  ) t;
$$;

-- ---------------------------------------------------------------------
-- deliveries: new work of a followed / reposted person
--   follow  → notification
--   repost  → postrecommendation (the member post table) + notification feed
--   each work is delivered once per type (person_work_deliveries)
-- ---------------------------------------------------------------------
-- a delivery run handles a handful of works at a time (p_limit) so a member
-- who follows someone with 120 credits is not flooded on the first visit
drop function if exists public.person_sync_deliveries(uuid, bigint);

create or replace function public.person_sync_deliveries(
  p_member uuid default null,
  p_tmdb   bigint default null,
  p_limit  integer default 3
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r          record;
  v_notif    uuid;
  v_post     uuid;
  v_notified integer := 0;
  v_reposted integer := 0;
begin
  -- follows → one notification per new work
  for r in
    select a.member_id, a.person_id, a.tmdb_person_id, c.media_type, c.tmdb_media_id,
           c.title, p.name
      from public.member_person_actions a
      join public.tmdb_people p        on p.id = a.person_id
      join public.tmdb_person_credits c on c.person_id = a.person_id
     where a.follow
       and not a.block
       and (p_member is null or a.member_id = p_member)
       and (p_tmdb   is null or a.tmdb_person_id = p_tmdb)
       and not exists (
         select 1 from public.person_work_deliveries d
          where d.member_id = a.member_id and d.person_id = a.person_id
            and d.media_type = c.media_type and d.tmdb_media_id = c.tmdb_media_id
            and d.delivery_type = 'notification')
     order by c.release_date desc nulls last, c.created_at desc
     limit greatest(coalesce(p_limit, 3), 1)
  loop
    insert into public.notifications (notification_code, id_member, source, title, subject, read_or_unread, created_at)
    values (
      'cast-work-' || left(md5(r.member_id::text || ':' || r.tmdb_person_id || ':' || r.media_type || ':' || r.tmdb_media_id), 16),
      r.member_id,
      'cast',
      'New work from ' || r.name,
      r.title,
      'unread',
      now()
    )
    returning id into v_notif;

    insert into public.person_work_deliveries
      (member_id, person_id, tmdb_person_id, media_type, tmdb_media_id, delivery_type, title, notification_id)
    values (r.member_id, r.person_id, r.tmdb_person_id, r.media_type, r.tmdb_media_id, 'notification', r.title, v_notif)
    on conflict do nothing;

    v_notified := v_notified + 1;
  end loop;

  -- reposts → the work shows on the member profile and in Updates
  for r in
    select a.member_id, a.person_id, a.tmdb_person_id, c.media_type, c.tmdb_media_id,
           c.title, c.character, c.job, c.poster_path, p.name
      from public.member_person_actions a
      join public.tmdb_people p        on p.id = a.person_id
      join public.tmdb_person_credits c on c.person_id = a.person_id
     where a.repost
       and not a.block
       and (p_member is null or a.member_id = p_member)
       and (p_tmdb   is null or a.tmdb_person_id = p_tmdb)
       and not exists (
         select 1 from public.person_work_deliveries d
          where d.member_id = a.member_id and d.person_id = a.person_id
            and d.media_type = c.media_type and d.tmdb_media_id = c.tmdb_media_id
            and d.delivery_type = 'repost')
     order by c.release_date desc nulls last, c.created_at desc
     limit greatest(coalesce(p_limit, 3), 1)
  loop
    insert into public.postrecommendation
      (idrecommendation, idtmdb, media_type, title, description, thumbnail_url, idmember,
       views_minutes, keywords, is_published, created_at)
    values (
      'cast-' || left(md5(r.member_id::text || ':' || r.tmdb_person_id || ':' || r.media_type || ':' || r.tmdb_media_id), 16),
      r.tmdb_media_id,
      r.media_type,
      r.title,
      'Reposted from ' || r.name
        || case when coalesce(r.character, '') <> '' then ' as ' || r.character
                when coalesce(r.job, '') <> '' then ' — ' || r.job
                else '' end,
      case when r.poster_path is null or r.poster_path = '' then null
           else 'https://image.tmdb.org/t/p/w500' || r.poster_path end,
      r.member_id,
      0,
      array['cast', r.name],
      true,
      now()
    )
    returning id into v_post;

    insert into public.person_work_deliveries
      (member_id, person_id, tmdb_person_id, media_type, tmdb_media_id, delivery_type, title, post_id)
    values (r.member_id, r.person_id, r.tmdb_person_id, r.media_type, r.tmdb_media_id, 'repost', r.title, v_post)
    on conflict do nothing;

    v_reposted := v_reposted + 1;
  end loop;

  return jsonb_build_object('notifications', v_notified, 'reposts', v_reposted);
end;
$$;

-- ---------------------------------------------------------------------
-- block map — every list, search, recommendation, update and share can
-- drop the blocked person's works with this one call
-- ---------------------------------------------------------------------
create or replace function public.person_block_map(p_member uuid)
returns jsonb
language sql
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'people', coalesce((
      select jsonb_agg(a.tmdb_person_id) from public.member_person_actions a
       where a.member_id = p_member and a.block
    ), '[]'::jsonb),
    'media', coalesce((
      select jsonb_agg(distinct jsonb_build_object('media_type', c.media_type, 'tmdb_media_id', c.tmdb_media_id))
        from public.member_person_actions a
        join public.tmdb_person_credits c on c.person_id = a.person_id
       where a.member_id = p_member and a.block
    ), '[]'::jsonb)
  );
$$;

-- ---------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------
grant select on public.tmdb_people, public.tmdb_person_external_links,
                public.tmdb_person_credits, public.content_person_mentions
  to anon, authenticated;

grant execute on function public.person_stats(bigint, uuid)            to anon, authenticated, service_role;
grant execute on function public.person_get(bigint)                    to anon, authenticated, service_role;
grant execute on function public.person_save(jsonb, jsonb, jsonb)      to anon, authenticated, service_role;
grant execute on function public.person_action_set(uuid, bigint, boolean, boolean, boolean) to anon, authenticated, service_role;
grant execute on function public.person_reaction_set(uuid, bigint, text) to anon, authenticated, service_role;
grant execute on function public.person_mention_add(bigint, text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.person_mentions(bigint)               to anon, authenticated, service_role;
grant execute on function public.person_sync_deliveries(uuid, bigint, integer) to anon, authenticated, service_role;
grant execute on function public.person_block_map(uuid)                to anon, authenticated, service_role;

commit;

notify pgrst, 'reload schema';
