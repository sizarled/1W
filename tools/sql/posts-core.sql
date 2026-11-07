-- ==================================================================
-- M2 — posts_core: the one table every published thing lives in
-- ==================================================================
-- Applied on 2026-11-01 as two migrations (project vtbqbhuywdhnvitbcsfy):
--   posts_core     §1 posts, §2 audience rules + authorized profiles, §3 translations
--   keywords_core  §4 keywords + post_keywords, §5 related content, §6 site_archive
-- Interactions, reach, analytics, search, publish links and messaging are the
-- migrations listed in docs/profile-tables-applied.md.
--
--   posts                      every published item, whatever its type
--   post_audience_rules        country / language / level / wealth / entity
--   post_authorized_profiles   the private list, followers, following, "others"
--   post_translations          manual translations, shown in Updates/Suggestions
--   keywords                   the tree: a main keyword, five sub-keywords
--   post_keywords              the ≤3 mains and ≤5 subs of one post
--   keyword_follows            a profile following a keyword
--   post_related_content       the "related links" of a post
--   site_archive               what the 30-day purge saves before deleting
--
-- Rules from the brief
--   • one table for every content type; the source tables are imported, not dropped
--   • a post always has a host profile: its author when self-published, the
--     other profile when a participant publishes there
--   • visibility is one value plus optional rules; "private" and "others" use
--     post_authorized_profiles
--   • at most 3 main keywords per post and 5 sub-keywords per main keyword
--   • watch minutes stop at the estimated reading time (read_minutes_cap)
--   • a deleted post is archived to site_archive within 30 days
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. posts
-- ------------------------------------------------------------------
create sequence if not exists public.post_seq start 1000;

create table if not exists public.posts (
  id                 uuid primary key default gen_random_uuid(),
  post_code          text not null default ('PST-' || lpad((nextval('public.post_seq'))::text, 6, '0')),
  author_profile_id  uuid not null references public.profiles (id) on delete cascade,
  host_profile_id    uuid not null references public.profiles (id) on delete cascade,
  content_type       text not null default 'article'
                       check (content_type in ('article', 'video', 'recommendation', 'link')),
  title              text not null check (char_length(btrim(title)) between 1 and 200),
  description        text,
  body               text,
  thumbnail_url      text,
  embed_url          text,
  related_links      jsonb not null default '[]'::jsonb,
  tmdb_id            bigint,
  media_type         text check (media_type in ('movie', 'tv')),
  language           text not null default 'en',
  translation_status text not null default 'none'
                       check (translation_status in ('none', 'auto', 'manual')),
  visibility         text not null default 'general'
                       check (visibility in ('general', 'excluded', 'limited', 'private',
                                             'followers', 'following', 'others')),
  status             text not null default 'draft'
                       check (status in ('draft', 'scheduled', 'published', 'hidden',
                                         'deleted', 'pending')),
  scheduled_at       timestamptz,
  published_at       timestamptz,
  deleted_at         timestamptz,
  source_table       text check (source_table in ('blogarticle', 'channelsvideo',
                                                  'postrecommendation', 'manual')),
  source_id          uuid,
  reach_daily_points integer not null default 0 check (reach_daily_points >= 0),
  rank_points        integer not null default 0,
  reach_points       integer not null default 0,
  word_count         integer not null default 0 check (word_count >= 0),
  read_minutes_cap   integer not null default 0 check (read_minutes_cap >= 0),
  likes              integer not null default 0,
  dislikes           integer not null default 0,
  comments_pos       integer not null default 0,
  comments_neg       integer not null default 0,
  reshares           integer not null default 0,
  external_shares    integer not null default 0,
  reports            integer not null default 0,
  impressions        integer not null default 0,
  clicks             integer not null default 0,
  watch_minutes      integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint posts_code_key unique (post_code),
  constraint posts_source_key unique (source_table, source_id),
  constraint posts_schedule_check check (status <> 'scheduled' or scheduled_at is not null),
  constraint posts_publish_check check (status <> 'published' or published_at is not null)
);

create index if not exists posts_host_idx
  on public.posts (host_profile_id, status, published_at desc);
create index if not exists posts_author_idx
  on public.posts (author_profile_id, created_at desc);
create index if not exists posts_rank_idx
  on public.posts (status, rank_points desc, published_at desc);
create index if not exists posts_language_idx
  on public.posts (language, status, published_at desc);
create index if not exists posts_scheduled_idx
  on public.posts (scheduled_at) where status = 'scheduled';

alter table public.posts enable row level security;

create or replace function public.posts_touch_meta()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  new.updated_at := now();
  new.word_count := coalesce(new.word_count, 0);
  if coalesce(new.word_count, 0) > 0 then
    new.read_minutes_cap := greatest(1, ceil(new.word_count / 200.0)::int);
  end if;
  if new.status = 'published' and new.published_at is null then
    new.published_at := now();
  end if;
  if new.status = 'deleted' and new.deleted_at is null then
    new.deleted_at := now();
  end if;
  return new;
end;
$function$;

drop trigger if exists posts_touch on public.posts;
create trigger posts_touch
  before insert or update on public.posts
  for each row execute function public.posts_touch_meta();

-- ------------------------------------------------------------------
-- 2. audience rules and authorized profiles
-- ------------------------------------------------------------------
create table if not exists public.post_audience_rules (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  kind       text not null
               check (kind in ('country', 'language', 'level', 'wealth', 'entity')),
  value      text not null check (char_length(btrim(value)) between 1 and 80),
  mode       text not null default 'exclude' check (mode in ('include', 'exclude')),
  created_at timestamptz not null default now(),
  constraint post_audience_unique unique (post_id, kind, value, mode)
);

create index if not exists post_audience_post_idx on public.post_audience_rules (post_id);
alter table public.post_audience_rules enable row level security;

create table if not exists public.post_authorized_profiles (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  added_at   timestamptz not null default now(),
  constraint post_authorized_unique unique (post_id, profile_id)
);

create index if not exists post_authorized_profile_idx
  on public.post_authorized_profiles (profile_id);
alter table public.post_authorized_profiles enable row level security;

-- ------------------------------------------------------------------
-- 3. translations
-- ------------------------------------------------------------------
create table if not exists public.post_translations (
  id                   uuid primary key default gen_random_uuid(),
  post_id              uuid not null references public.posts (id) on delete cascade,
  language             text not null,
  title                text not null check (char_length(btrim(title)) between 1 and 200),
  description          text,
  body                 text,
  kind                 text not null default 'manual' check (kind in ('manual', 'auto')),
  status               text not null default 'ready' check (status in ('draft', 'ready')),
  translator_profile_id uuid references public.profiles (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint post_translations_unique unique (post_id, language)
);

create index if not exists post_translations_lang_idx
  on public.post_translations (language, status);
alter table public.post_translations enable row level security;

-- ------------------------------------------------------------------
-- 4. keywords: one tree, mains on top
-- ------------------------------------------------------------------
create table if not exists public.keywords (
  id             uuid primary key default gen_random_uuid(),
  keyword        text not null check (char_length(btrim(keyword)) between 1 and 80),
  parent_id      uuid references public.keywords (id) on delete cascade,
  language       text,
  created_by     uuid references public.profiles (id) on delete set null,
  followers_count integer not null default 0 check (followers_count >= 0),
  posts_count    integer not null default 0 check (posts_count >= 0),
  created_at     timestamptz not null default now(),
  constraint keywords_unique unique (keyword, parent_id)
);

create unique index if not exists keywords_main_unique
  on public.keywords (lower(keyword)) where parent_id is null;
create index if not exists keywords_parent_idx on public.keywords (parent_id);
create index if not exists keywords_lookup_idx on public.keywords (lower(keyword));

alter table public.keywords enable row level security;

create table if not exists public.post_keywords (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  keyword_id uuid not null references public.keywords (id) on delete cascade,
  role       text not null default 'main' check (role in ('main', 'sub')),
  added_at   timestamptz not null default now(),
  constraint post_keywords_unique unique (post_id, keyword_id)
);

create index if not exists post_keywords_keyword_idx
  on public.post_keywords (keyword_id, role);
alter table public.post_keywords enable row level security;

-- 3 mains per post, 5 subs per main keyword — counted from the tree
create or replace function public.post_keywords_guard()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_main uuid;
  v_mains integer;
  v_subs integer;
begin
  if new.role = 'main' then
    if (select parent_id from public.keywords where id = new.keyword_id) is not null then
      raise exception 'a main keyword cannot have a parent' using errcode = '23514';
    end if;
    select count(*) into v_mains
      from public.post_keywords pk
     where pk.post_id = new.post_id and pk.role = 'main' and pk.id <> new.id;
    if v_mains >= 3 then
      raise exception 'a post takes at most 3 main keywords' using errcode = '23514';
    end if;
    return new;
  end if;

  select parent_id into v_main from public.keywords where id = new.keyword_id;
  if v_main is null then
    raise exception 'a sub-keyword needs a main keyword' using errcode = '23514';
  end if;
  if not exists (select 1 from public.post_keywords pk
                  where pk.post_id = new.post_id and pk.keyword_id = v_main) then
    raise exception 'the main keyword of a sub-keyword must be on the same post'
      using errcode = '23514';
  end if;
  select count(*) into v_subs
    from public.post_keywords pk
    join public.keywords k on k.id = pk.keyword_id
   where pk.post_id = new.post_id and pk.role = 'sub'
     and k.parent_id = v_main and pk.id <> new.id;
  if v_subs >= 5 then
    raise exception 'a main keyword takes at most 5 sub-keywords' using errcode = '23514';
  end if;
  return new;
end;
$function$;

drop trigger if exists post_keywords_guard_trg on public.post_keywords;
create trigger post_keywords_guard_trg
  before insert or update on public.post_keywords
  for each row execute function public.post_keywords_guard();

-- keep keywords.posts_count honest
create or replace function public.keyword_posts_count_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.keywords k
     set posts_count = (select count(*) from public.post_keywords pk where pk.keyword_id = k.id)
   where k.id in (coalesce(new.keyword_id, old.keyword_id));
  return null;
end;
$function$;

drop trigger if exists post_keywords_count on public.post_keywords;
create trigger post_keywords_count
  after insert or delete on public.post_keywords
  for each row execute function public.keyword_posts_count_sync();

create table if not exists public.keyword_follows (
  profile_id uuid not null references public.profiles (id) on delete cascade,
  keyword_id uuid not null references public.keywords (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (profile_id, keyword_id)
);

create index if not exists keyword_follows_keyword_idx
  on public.keyword_follows (keyword_id);
alter table public.keyword_follows enable row level security;

create or replace function public.keyword_follows_count_sync()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.keywords k
     set followers_count = (select count(*) from public.keyword_follows f where f.keyword_id = k.id)
   where k.id in (coalesce(new.keyword_id, old.keyword_id));
  return null;
end;
$function$;

drop trigger if exists keyword_follows_count on public.keyword_follows;
create trigger keyword_follows_count
  after insert or delete on public.keyword_follows
  for each row execute function public.keyword_follows_count_sync();

-- ------------------------------------------------------------------
-- 5. related links of a post
-- ------------------------------------------------------------------
create table if not exists public.post_related_content (
  id         uuid primary key default gen_random_uuid(),
  post_id    uuid not null references public.posts (id) on delete cascade,
  source     text not null default 'manual'
               check (source in ('manual', 'blogarticle', 'channelsvideo',
                                 'postrecommendation', 'watchlink')),
  row_id     uuid,
  label      text not null check (char_length(btrim(label)) between 1 and 120),
  url        text,
  created_at timestamptz not null default now()
);

create index if not exists post_related_post_idx on public.post_related_content (post_id);
alter table public.post_related_content enable row level security;

-- ------------------------------------------------------------------
-- 6. site_archive: what the 30-day purge keeps
-- ------------------------------------------------------------------
create table if not exists public.site_archive (
  id          uuid primary key default gen_random_uuid(),
  entity      text not null check (entity in ('post', 'profile', 'comment', 'translation',
                                              'analytics', 'other')),
  entity_id   uuid,
  member_id   uuid,
  payload     jsonb not null,
  reason      text,
  archived_at timestamptz not null default now(),
  purge_after timestamptz not null default (now() + interval '30 days')
);

create index if not exists site_archive_entity_idx
  on public.site_archive (entity, archived_at desc);
create index if not exists site_archive_purge_idx on public.site_archive (purge_after);
alter table public.site_archive enable row level security;
