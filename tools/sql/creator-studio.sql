/**
 * 1World — the Creator studio.
 * ------------------------------------------------------------------
 * One editor for the five things a member runs: a channel, a blog, a
 * space, a library and a gallery. They are the same object — a *hub* —
 * because their settings are the same object: a name, a logo, a cover, a
 * description, related links, one field, up to five niches, a visibility
 * (public / exclusive / private), an optional password with an expiry, a
 * staff list and a VIP list. What differs is what hangs underneath:
 *
 *   channel   videos, podcasts, playlists
 *   blog      articles (published) and drafts, in categories three deep
 *   space     questions and answers, in categories
 *   library   books (ebooks) and documents
 *   gallery   images and sets
 *
 * One table holds every item — `public.member_content`, the table the
 * first editor wrote — extended here with the hub, the category, the
 * parent (an answer points at its question), the thumbnail, the two deep
 * niches and the counters the public surfaces will fill (minutes watched,
 * likes, dislikes, comments, shares, reports, downloads).
 *
 * Ownership and access
 * --------------------
 * Every function resolves the caller from the session token and then asks
 * `creator_hub_manage()`: the owner, or a member whose code sits in the
 * hub's staff list. A hub is visible to its staff in the studio exactly
 * like the owner's own — that is what "the staff see the channel in the
 * management tab" means.
 *
 * The password is stored as a bcrypt hash with an expiry (one hour to one
 * month, 1..720 hours). `creator_hub_unlock()` is the only door that reads
 * it, it is callable without a session (a visitor on the public page), and
 * it answers `{ok:true, unlocked:true}` only while the window is open.
 */

-- ------------------------------------------------------------------
-- 1. the hub — a channel, a blog, a space, a library or a gallery
-- ------------------------------------------------------------------
create table if not exists public.creator_hubs (
  id             uuid primary key default gen_random_uuid(),
  owner          uuid not null references public.members(id) on delete cascade,
  kind           text not null,
  name           text not null default '',
  description    text not null default '',
  logo_url       text not null default '',
  cover_url      text not null default '',
  links          jsonb not null default '[]'::jsonb,
  field          text not null default '',
  niches         text[] not null default '{}',
  visibility     text not null default 'public',
  password_hash  text not null default '',
  password_until timestamptz,
  staff          text[] not null default '{}',
  vip            text[] not null default '{}',
  status         text not null default 'active',
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint creator_hubs_kind check (kind in ('channel', 'blog', 'space', 'library', 'gallery', 'server', 'cinema')),
  constraint creator_hubs_visibility check (visibility in ('public', 'exclusive', 'private')),
  constraint creator_hubs_status check (status in ('active', 'hidden')),
  constraint creator_hubs_name check (char_length(name) <= 80),
  constraint creator_hubs_niches check (coalesce(array_length(niches, 1), 0) <= 5)
);

create unique index if not exists creator_hubs_name
  on public.creator_hubs (owner, kind, lower(name));

create index if not exists creator_hubs_owner on public.creator_hubs (owner, kind);

alter table public.creator_hubs enable row level security;

-- ------------------------------------------------------------------
-- 2. who is subscribed to a hub
-- ------------------------------------------------------------------
create table if not exists public.creator_subscriptions (
  hub        uuid not null references public.creator_hubs(id) on delete cascade,
  member     uuid not null references public.members(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (hub, member)
);

alter table public.creator_subscriptions enable row level security;

-- ------------------------------------------------------------------
-- 3. the categories — main → second → last, three levels
-- ------------------------------------------------------------------
create table if not exists public.creator_categories (
  id         uuid primary key default gen_random_uuid(),
  hub        uuid not null references public.creator_hubs(id) on delete cascade,
  owner      uuid not null references public.members(id) on delete cascade,
  kind       text not null,
  parent     uuid references public.creator_categories(id) on delete cascade,
  level      smallint not null default 1,
  name       text not null default '',
  created_at timestamptz not null default now(),
  constraint creator_categories_level check (level between 1 and 3),
  constraint creator_categories_name check (char_length(name) between 1 and 60)
);

create index if not exists creator_categories_hub on public.creator_categories (hub, level);

alter table public.creator_categories enable row level security;

-- ------------------------------------------------------------------
-- 4. the items — the table the first editor wrote, widened
-- ------------------------------------------------------------------
alter table public.member_content
  add column if not exists hub            uuid references public.creator_hubs(id) on delete cascade,
  add column if not exists category       uuid references public.creator_categories(id) on delete set null,
  add column if not exists parent         uuid references public.member_content(id) on delete cascade,
  add column if not exists thumbnail_url  text not null default '',
  add column if not exists micro_niche    text not null default '',
  add column if not exists nano_niche     text not null default '',
  add column if not exists dislikes       int not null default 0,
  add column if not exists comments_count int not null default 0,
  add column if not exists shares         int not null default 0,
  add column if not exists reports        int not null default 0,
  add column if not exists downloads      int not null default 0,
  add column if not exists refollows      int not null default 0,
  add column if not exists follows        int not null default 0,
  add column if not exists view_minutes   int not null default 0;

alter table public.member_content drop constraint if exists member_content_visibility;
alter table public.member_content add constraint member_content_visibility check (
  visibility in ('public', 'exclusive', 'private', 'followers', 'unlisted')
);

alter table public.member_content drop constraint if exists member_content_kind;
alter table public.member_content add constraint member_content_kind check (
  kind in ('video', 'article', 'podcast', 'image', 'document', 'post',
           'playlist', 'book', 'question', 'answer')
);

create index if not exists member_content_hub on public.member_content (hub, kind, status, updated_at desc);
create index if not exists member_content_parent on public.member_content (parent);

-- ------------------------------------------------------------------
-- 5. the rules, in one place
-- ------------------------------------------------------------------
/** How many hubs of one kind a member may run at a level (1..10). */
create or replace function public.creator_hub_limit(p_kind text, p_level int)
returns int
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case p_kind
           when 'channel' then 1 + greatest(0, floor((coalesce(p_level, 1) - 1) / 3.0))::int
           when 'blog'    then 3 + greatest(0, floor((coalesce(p_level, 1) - 1) / 4.0))::int
           else                2 + greatest(0, floor((coalesce(p_level, 1) - 1) / 4.0))::int
         end;
$$;

/** The owner, or a member whose code is in the staff list. */
create or replace function public.creator_hub_manage(p_hub public.creator_hubs, p_member public.members)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select p_hub.id is not null
     and (p_hub.owner = p_member.id
          or coalesce(p_member.member_id, '') = any(p_hub.staff));
$$;

/** What each kind of hub holds — a video cannot hang under a blog. */
create or replace function public.creator_kind_allowed(p_hub_kind text, p_kind text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case p_hub_kind
           when 'channel' then p_kind in ('video', 'podcast', 'playlist')
           when 'server'  then p_kind in ('video', 'podcast', 'playlist')
           when 'cinema'  then p_kind in ('video')
           when 'blog'    then p_kind in ('article')
           when 'space'   then p_kind in ('question', 'answer')
           when 'library' then p_kind in ('book', 'document')
           when 'gallery' then p_kind in ('image')
           else false
         end;
$$;

/** A member code (`ID100003`) → the member, or null. */
create or replace function public.creator_member_by_ref(p_ref text)
returns public.members
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select *
    from public.members m
   where m.member_id = btrim(upper(coalesce(p_ref, '')))
      or lower(m.username) = lower(btrim(coalesce(p_ref, '')))
   limit 1;
$$;

/** The hub as the studio reads it: settings plus what hangs under it. */
create or replace function public.creator_hub_json(p_hub public.creator_hubs)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'id',            h.id,
    'kind',          h.kind,
    'name',          h.name,
    'description',   h.description,
    'logo_url',      h.logo_url,
    'cover_url',     h.cover_url,
    'links',         h.links,
    'field',         h.field,
    'niches',        h.niches,
    'visibility',    h.visibility,
    'password_until', h.password_until,
    'locked',        coalesce(h.password_hash, '') <> '',
    'staff',         h.staff,
    'vip',           h.vip,
    'status',        h.status,
    'subscribers',   (select count(*) from public.creator_subscriptions s where s.hub = h.id),
    'items',         (select count(*) from public.member_content c where c.hub = h.id),
    'published',     (select count(*) from public.member_content c where c.hub = h.id and c.status = 'published'),
    'drafts',        (select count(*) from public.member_content c where c.hub = h.id and c.status = 'draft'),
    'minutes',       (select coalesce(sum(c.view_minutes), 0) from public.member_content c where c.hub = h.id),
    'likes',         (select coalesce(sum(c.likes), 0) from public.member_content c where c.hub = h.id),
    'dislikes',      (select coalesce(sum(c.dislikes), 0) from public.member_content c where c.hub = h.id),
    'comments',      (select coalesce(sum(c.comments_count), 0) from public.member_content c where c.hub = h.id),
    'shares',        (select coalesce(sum(c.shares), 0) from public.member_content c where c.hub = h.id),
    'reports',       (select coalesce(sum(c.reports), 0) from public.member_content c where c.hub = h.id),
    'categories',    (select count(*) from public.creator_categories g where g.hub = h.id),
    'created_at',    h.created_at,
    'updated_at',    h.updated_at
  )
  from public.creator_hubs h
  where h.id = p_hub.id;
$$;

-- ------------------------------------------------------------------
-- 6. the hubs — list, read, save, delete, staff, VIP, password
-- ------------------------------------------------------------------
create or replace function public.creator_hubs_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_level  int := greatest(1, least(10, coalesce((public.member_from_token(p_token)).level, 1)));
  v_hubs   jsonb;
  v_limits jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select coalesce(jsonb_agg(
           public.creator_hub_json(h) || jsonb_build_object('owned', h.owner = v_member.id)
           order by h.created_at), '[]'::jsonb)
    into v_hubs
    from public.creator_hubs h
   where h.owner = v_member.id
      or coalesce(v_member.member_id, '') = any(h.staff);

  select jsonb_object_agg(k.kind, jsonb_build_object(
           'used',  (select count(*) from public.creator_hubs h where h.owner = v_member.id and h.kind = k.kind),
           'limit', public.creator_hub_limit(k.kind, v_level)))
    into v_limits
    from (values ('channel'), ('blog'), ('space'), ('library'), ('gallery'), ('server'), ('cinema')) as k(kind);

  return jsonb_build_object('ok', true, 'level', v_level, 'hubs', v_hubs, 'limits', v_limits);
end;
$$;

create or replace function public.creator_hub_get(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_id;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object(
    'ok', true,
    'hub', public.creator_hub_json(v_hub) || jsonb_build_object('owned', v_hub.owner = v_member.id)
  );
end;
$$;

create or replace function public.creator_hub_save(
  p_token       text,
  p_id          uuid,
  p_kind        text,
  p_name        text,
  p_description text,
  p_logo_url    text,
  p_cover_url   text,
  p_links       jsonb,
  p_field       text,
  p_niches      text[],
  p_visibility  text,
  p_password    text,
  p_hours       int,
  p_staff       text[],
  p_vip         text[]
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member  public.members%rowtype := public.member_from_token(p_token);
  v_hub     public.creator_hubs%rowtype;
  v_kind    text := lower(btrim(coalesce(p_kind, 'channel')));
  v_name    text := btrim(coalesce(p_name, ''));
  v_desc    text := left(btrim(coalesce(p_description, '')), 600);
  v_logo    text := btrim(coalesce(p_logo_url, ''));
  v_cover   text := btrim(coalesce(p_cover_url, ''));
  v_links   jsonb := case when jsonb_typeof(coalesce(p_links, '[]'::jsonb)) = 'array' then coalesce(p_links, '[]'::jsonb) else '[]'::jsonb end;
  v_field   text := left(btrim(coalesce(p_field, '')), 40);
  v_niches  text[];
  v_vis     text := lower(btrim(coalesce(p_visibility, 'public')));
  v_pass    text := coalesce(p_password, '');
  v_hours   int := greatest(1, least(720, coalesce(p_hours, 24)));
  v_staff   text[];
  v_vip     text[];
  v_level   int := greatest(1, least(10, coalesce((public.member_from_token(p_token)).level, 1)));
  v_used    int;
  v_link    jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  if v_kind not in ('channel', 'blog', 'space', 'library', 'gallery') then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 80 then
    return jsonb_build_object('ok', false, 'error', 'name');
  end if;
  if v_vis not in ('public', 'exclusive', 'private') then
    return jsonb_build_object('ok', false, 'error', 'visibility');
  end if;
  if v_logo <> '' and v_logo !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'url');
  end if;
  if v_cover <> '' and v_cover !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'url');
  end if;
  if jsonb_array_length(v_links) > 10 then
    return jsonb_build_object('ok', false, 'error', 'links');
  end if;
  for v_link in select * from jsonb_array_elements(v_links) loop
    if coalesce(v_link->>'url', '') !~* '^https?://' then
      return jsonb_build_object('ok', false, 'error', 'url');
    end if;
  end loop;

  -- one field, at most five niches
  select coalesce((array_agg(distinct n) filter (where n <> ''))[1:5], '{}')
    into v_niches
    from (select left(btrim(unnest(coalesce(p_niches, '{}'))), 30) as n) niche;

  -- staff and VIP are member codes (`ID100003`), never the owner's own
  select coalesce(array_agg(distinct left(btrim(upper(s)), 12)) filter (where btrim(s) <> ''), '{}')
    into v_staff
    from unnest(coalesce(p_staff, '{}')) s;
  v_staff := array_remove(coalesce(v_staff, '{}'), upper(coalesce(v_member.member_id, '')));
  if array_length(v_staff, 1) > 20 then
    v_staff := v_staff[1:20];
  end if;
  if exists (select 1 from unnest(v_staff) s
              where not exists (select 1 from public.members m where m.member_id = s)) then
    return jsonb_build_object('ok', false, 'error', 'staff');
  end if;

  select coalesce(array_agg(distinct left(btrim(upper(v)), 12)) filter (where btrim(v) <> ''), '{}')
    into v_vip
    from unnest(coalesce(p_vip, '{}')) v;
  if array_length(v_vip, 1) > 200 then
    v_vip := v_vip[1:200];
  end if;
  if exists (select 1 from unnest(v_vip) v
              where not exists (select 1 from public.members m where m.member_id = v)) then
    return jsonb_build_object('ok', false, 'error', 'vip');
  end if;

  if p_id is null then
    select count(*) into v_used
      from public.creator_hubs h
     where h.owner = v_member.id and h.kind = v_kind;
    if v_used >= public.creator_hub_limit(v_kind, v_level) then
      return jsonb_build_object('ok', false, 'error', 'limit',
        'used', v_used, 'limit', public.creator_hub_limit(v_kind, v_level), 'level', v_level);
    end if;

    insert into public.creator_hubs (
      owner, kind, name, description, logo_url, cover_url, links, field, niches,
      visibility, password_hash, password_until, staff, vip
    ) values (
      v_member.id, v_kind, v_name, v_desc, v_logo, v_cover, v_links, v_field, v_niches,
      v_vis,
      case when v_pass <> '' and v_vis = 'private' then extensions.crypt(v_pass, extensions.gen_salt('bf')) else '' end,
      case when v_pass <> '' and v_vis = 'private' then now() + make_interval(hours => v_hours) else null end,
      coalesce(v_staff, '{}'), coalesce(v_vip, '{}')
    )
    returning * into v_hub;

  else
    select * into v_hub from public.creator_hubs where id = p_id;
    if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if exists (
      select 1 from public.creator_hubs h
       where h.owner = v_hub.owner and h.kind = v_hub.kind
         and lower(h.name) = lower(v_name) and h.id <> v_hub.id
    ) then
      return jsonb_build_object('ok', false, 'error', 'name');
    end if;

    update public.creator_hubs h
       set name        = v_name,
           description = v_desc,
           logo_url    = v_logo,
           cover_url   = v_cover,
           links       = v_links,
           field       = v_field,
           niches      = v_niches,
           visibility  = v_vis,
           staff       = coalesce(v_staff, '{}'),
           vip         = coalesce(v_vip, '{}'),
           password_hash = case
                             when v_vis <> 'private' then ''
                             when v_pass <> '' then extensions.crypt(v_pass, extensions.gen_salt('bf'))
                             else h.password_hash
                           end,
           password_until = case
                              when v_vis <> 'private' then null
                              when v_pass <> '' then now() + make_interval(hours => v_hours)
                              else h.password_until
                            end,
           updated_at  = now()
     where h.id = v_hub.id
    returning * into v_hub;
  end if;

  return jsonb_build_object(
    'ok', true,
    'hub', public.creator_hub_json(v_hub) || jsonb_build_object('owned', v_hub.owner = v_member.id)
  );
end;
$$;

create or replace function public.creator_hub_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_gone   int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_id;
  if v_hub.id is null or v_hub.owner <> v_member.id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  delete from public.creator_hubs where id = v_hub.id;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', true, 'removed', v_gone > 0);
end;
$$;

create or replace function public.creator_hub_staff(p_token text, p_id uuid, p_action text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_target public.members%rowtype := public.creator_member_by_ref(p_ref);
  v_code   text := btrim(upper(coalesce(p_ref, '')));
  v_staff  text[];
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_id;
  if v_hub.id is null or v_hub.owner <> v_member.id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'member');
  end if;
  if v_target.id = v_hub.owner then
    return jsonb_build_object('ok', false, 'error', 'owner');
  end if;

  if lower(coalesce(p_action, 'add')) = 'remove' then
    v_staff := array_remove(v_hub.staff, upper(v_target.member_id));
  else
    if array_length(v_hub.staff, 1) >= 20 then
      return jsonb_build_object('ok', false, 'error', 'limit');
    end if;
    v_staff := coalesce(v_hub.staff, '{}') || upper(v_target.member_id);
  end if;

  v_staff := coalesce((select array_agg(distinct s) from unnest(v_staff) s), '{}');

  update public.creator_hubs
     set staff = v_staff, updated_at = now()
   where id = v_hub.id
  returning * into v_hub;

  return jsonb_build_object('ok', true, 'staff', v_hub.staff, 'member', jsonb_build_object(
    'code', v_target.member_id, 'name', v_target.full_name, 'username', v_target.username));
end;
$$;

create or replace function public.creator_hub_vip(p_token text, p_id uuid, p_action text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_target public.members%rowtype := public.creator_member_by_ref(p_ref);
  v_vip    text[];
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_id;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_target.id is null then
    return jsonb_build_object('ok', false, 'error', 'member');
  end if;

  if lower(coalesce(p_action, 'add')) = 'remove' then
    v_vip := array_remove(v_hub.vip, upper(v_target.member_id));
  else
    if array_length(v_hub.vip, 1) >= 200 then
      return jsonb_build_object('ok', false, 'error', 'limit');
    end if;
    v_vip := coalesce(v_hub.vip, '{}') || upper(v_target.member_id);
  end if;

  v_vip := coalesce((select array_agg(distinct v) from unnest(v_vip) v), '{}');

  update public.creator_hubs
     set vip = v_vip, updated_at = now()
   where id = v_hub.id
  returning * into v_hub;

  return jsonb_build_object('ok', true, 'vip', v_hub.vip, 'member', jsonb_build_object(
    'code', v_target.member_id, 'name', v_target.full_name, 'username', v_target.username));
end;
$$;

create or replace function public.creator_hub_unlock(p_hub uuid, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_hub public.creator_hubs%rowtype;
begin
  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_hub.visibility <> 'private' then
    return jsonb_build_object('ok', true, 'unlocked', true);
  end if;
  if coalesce(v_hub.password_hash, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;
  if v_hub.password_until is not null and v_hub.password_until < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if extensions.crypt(coalesce(p_password, ''), v_hub.password_hash) = v_hub.password_hash then
    return jsonb_build_object('ok', true, 'unlocked', true, 'until', v_hub.password_until);
  end if;
  return jsonb_build_object('ok', false, 'error', 'denied');
end;
$$;

-- ------------------------------------------------------------------
-- 7. subscribers
-- ------------------------------------------------------------------
create or replace function public.creator_subscribe(p_token text, p_hub uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_on     boolean;
  v_count  int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_hub.owner = v_member.id then
    return jsonb_build_object('ok', false, 'error', 'own');
  end if;

  delete from public.creator_subscriptions s
   where s.hub = p_hub and s.member = v_member.id;
  get diagnostics v_count = row_count;
  v_on := v_count = 0;

  if v_on then
    insert into public.creator_subscriptions (hub, member) values (p_hub, v_member.id)
    on conflict do nothing;
  end if;

  select count(*) into v_count from public.creator_subscriptions s where s.hub = p_hub;
  return jsonb_build_object('ok', true, 'subscribed', v_on, 'subscribers', v_count);
end;
$$;

create or replace function public.creator_subscribers(p_token text, p_hub uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_rows   jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code',     m.member_id,
           'name',     m.full_name,
           'username', m.username,
           'avatar',   m.avatar_url,
           'country',  m.country,
           'since',    s.created_at
         ) order by s.created_at desc), '[]'::jsonb)
    into v_rows
    from public.creator_subscriptions s
    join public.members m on m.id = s.member
   where s.hub = v_hub.id;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'counts', jsonb_build_object(
      'subscribers', jsonb_array_length(v_rows),
      'vip', coalesce(array_length(v_hub.vip, 1), 0),
      'staff', coalesce(array_length(v_hub.staff, 1), 0))
  );
end;
$$;

-- ------------------------------------------------------------------
-- 8. categories — three levels under one hub
-- ------------------------------------------------------------------
create or replace function public.creator_categories(p_token text, p_hub uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_rows   jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',     g.id,
           'name',   g.name,
           'level',  g.level,
           'parent', g.parent,
           'items',  (select count(*) from public.member_content c where c.category = g.id),
           'order',  g.created_at
         ) order by g.level, g.name), '[]'::jsonb)
    into v_rows
    from public.creator_categories g
   where g.hub = v_hub.id;

  return jsonb_build_object('ok', true, 'rows', v_rows);
end;
$$;

create or replace function public.creator_category_save(
  p_token text, p_id uuid, p_hub uuid, p_parent uuid, p_name text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_name   text := btrim(coalesce(p_name, ''));
  v_parent public.creator_categories%rowtype;
  v_row    public.creator_categories%rowtype;
  v_level  smallint := 1;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if char_length(v_name) < 1 or char_length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'error', 'name');
  end if;

  if p_parent is not null then
    select * into v_parent from public.creator_categories where id = p_parent;
    if v_parent.id is null or v_parent.hub <> v_hub.id then
      return jsonb_build_object('ok', false, 'error', 'parent');
    end if;
    if v_parent.level >= 3 then
      return jsonb_build_object('ok', false, 'error', 'deep');
    end if;
    v_level := v_parent.level + 1;
  end if;

  if exists (
    select 1 from public.creator_categories g
     where g.hub = v_hub.id
       and lower(g.name) = lower(v_name)
       and coalesce(g.parent, '00000000-0000-0000-0000-000000000000'::uuid)
         = coalesce(p_parent, '00000000-0000-0000-0000-000000000000'::uuid)
       and (p_id is null or g.id <> p_id)
  ) then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
  end if;

  if p_id is null then
    insert into public.creator_categories (hub, owner, kind, parent, level, name)
    values (v_hub.id, v_member.id, v_hub.kind, p_parent, v_level, v_name)
    returning * into v_row;
  else
    update public.creator_categories g
       set name = v_name, parent = p_parent, level = v_level
     where g.id = p_id and g.hub = v_hub.id
    returning * into v_row;
    if v_row.id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'row', jsonb_build_object(
    'id', v_row.id, 'name', v_row.name, 'level', v_row.level, 'parent', v_row.parent, 'items', 0));
end;
$$;

create or replace function public.creator_category_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.creator_categories%rowtype;
  v_hub    public.creator_hubs%rowtype;
  v_gone   int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_row from public.creator_categories where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_hub from public.creator_hubs where id = v_row.hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  delete from public.creator_categories where id = v_row.id;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', true, 'removed', v_gone > 0);
end;
$$;

-- ------------------------------------------------------------------
-- 9. the items — the tables under every tab
-- ------------------------------------------------------------------
create or replace function public.creator_items(
  p_token text, p_hub uuid, p_kind text, p_status text, p_search text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_kind   text := nullif(btrim(coalesce(p_kind, '')), '');
  v_status text := nullif(btrim(coalesce(p_status, '')), '');
  v_search text := btrim(coalesce(p_search, ''));
  v_rows   jsonb;
  v_counts jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          c.id,
           'code',        upper(left(replace(c.id::text, '-', ''), 8)),
           'kind',        c.kind,
           'title',       c.title,
           'summary',     c.summary,
           'status',      c.status,
           'visibility',  c.visibility,
           'thumbnail',   c.thumbnail_url,
           'media_url',   c.media_url,
           'category',    c.category,
           'category_name', g.name,
           'parent',      c.parent,
           'parent_title', (select p.title from public.member_content p where p.id = c.parent),
           'micro',       c.micro_niche,
           'nano',        c.nano_niche,
           'views',       c.views,
           'minutes',     c.view_minutes,
           'likes',       c.likes,
           'dislikes',    c.dislikes,
           'comments',    c.comments_count,
           'shares',      c.shares,
           'reports',     c.reports,
           'downloads',   c.downloads,
           'answers',     (select count(*) from public.member_content a where a.parent = c.id),
           'followers',   c.follows,
           'refollows',   c.refollows,
           'words',       c.word_count,
           'lines',       case when c.body = '' then 0
                               else length(c.body) - length(replace(c.body, chr(10), '')) + 1 end,
           'chars',       char_length(c.body),
           'published_at', c.published_at,
           'created_at',  c.created_at,
           'updated_at',  c.updated_at
         ) order by c.updated_at desc), '[]'::jsonb)
    into v_rows
    from public.member_content c
    left join public.creator_categories g on g.id = c.category
   where c.hub = v_hub.id
     and (v_kind is null or c.kind = v_kind)
     and (v_status is null or c.status = v_status)
     and (v_search = '' or c.title ilike '%' || v_search || '%'
          or c.summary ilike '%' || v_search || '%');

  select jsonb_build_object(
           'all',       count(*),
           'published', count(*) filter (where status = 'published'),
           'draft',     count(*) filter (where status = 'draft'),
           'minutes',   coalesce(sum(view_minutes), 0),
           'likes',     coalesce(sum(likes), 0),
           'dislikes',  coalesce(sum(dislikes), 0),
           'comments',  coalesce(sum(comments_count), 0),
           'shares',    coalesce(sum(shares), 0),
           'reports',   coalesce(sum(reports), 0),
           'downloads', coalesce(sum(downloads), 0))
    into v_counts
    from public.member_content c
   where c.hub = v_hub.id
     and (v_kind is null or c.kind = v_kind);

  return jsonb_build_object('ok', true, 'rows', v_rows, 'counts', v_counts);
end;
$$;

create or replace function public.creator_item_get(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.member_content%rowtype;
  v_hub    public.creator_hubs%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_row from public.member_content where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_hub from public.creator_hubs where id = v_row.hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'row', to_jsonb(v_row) - 'member');
end;
$$;

create or replace function public.creator_item_save(
  p_token       text,
  p_id          uuid,
  p_hub         uuid,
  p_kind        text,
  p_title       text,
  p_summary     text,
  p_body        text,
  p_media_url   text,
  p_thumbnail   text,
  p_cover_url   text,
  p_tags        text[],
  p_language    text,
  p_age         text,
  p_visibility  text,
  p_category    uuid,
  p_parent      uuid,
  p_field       text,
  p_niche       text,
  p_micro       text,
  p_nano        text,
  p_publish     boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_title  text := btrim(coalesce(p_title, ''));
  v_body   text := coalesce(p_body, '');
  v_media  text := btrim(coalesce(p_media_url, ''));
  v_thumb  text := btrim(coalesce(p_thumbnail, ''));
  v_cover  text := btrim(coalesce(p_cover_url, ''));
  v_vis    text := lower(btrim(coalesce(p_visibility, 'public')));
  v_age    text := coalesce(nullif(btrim(p_age), ''), 'none');
  v_tags   text[];
  v_row    public.member_content%rowtype;
  v_pub    boolean := coalesce(p_publish, false);
  v_cat    uuid := p_category;
  v_parent public.member_content%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;
  if not public.creator_kind_allowed(v_hub.kind, v_kind) then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;
  if v_vis not in ('public', 'exclusive', 'private') then
    return jsonb_build_object('ok', false, 'error', 'visibility');
  end if;
  if v_age not in ('none', '13', '16', '18') then
    v_age := 'none';
  end if;
  if char_length(v_title) > 200 then
    return jsonb_build_object('ok', false, 'error', 'title');
  end if;
  if v_media <> '' and v_media !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'url');
  end if;
  if v_thumb <> '' and v_thumb !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'url');
  end if;
  if v_cover <> '' and v_cover !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'url');
  end if;

  if v_cat is not null and not exists (
    select 1 from public.creator_categories g where g.id = v_cat and g.hub = v_hub.id
  ) then
    v_cat := null;
  end if;

  if v_kind = 'answer' then
    if p_parent is null then
      return jsonb_build_object('ok', false, 'error', 'parent');
    end if;
    select * into v_parent from public.member_content where id = p_parent;
    if v_parent.id is null or v_parent.hub <> v_hub.id then
      return jsonb_build_object('ok', false, 'error', 'parent');
    end if;
  end if;

  select coalesce((array_agg(distinct t) filter (where t <> ''))[1:8], '{}')
    into v_tags
    from (select left(btrim(unnest(coalesce(p_tags, '{}'))), 24) as t) tag;

  if v_pub then
    if char_length(v_title) < 3 then
      return jsonb_build_object('ok', false, 'error', 'title');
    end if;
    if coalesce(v_member.status, '') <> 'active' then
      return jsonb_build_object('ok', false, 'error', 'inactive');
    end if;
    if v_kind in ('video', 'podcast', 'image', 'document', 'book') and v_media = '' then
      return jsonb_build_object('ok', false, 'error', 'media');
    end if;
    if v_kind = 'article' and public.content_words(v_body) < 12 then
      return jsonb_build_object('ok', false, 'error', 'body');
    end if;
    if v_kind in ('question', 'answer') and public.content_words(v_body) < 6 then
      return jsonb_build_object('ok', false, 'error', 'body');
    end if;
  end if;

  if p_id is null then
    insert into public.member_content (
      member, hub, kind, title, summary, body, media_url, cover_url, thumbnail_url,
      tags, language, age_rating, visibility, category, parent,
      micro_niche, nano_niche, status, word_count, minutes, published_at
    ) values (
      v_member.id, v_hub.id, v_kind, v_title, left(btrim(coalesce(p_summary, '')), 320), v_body,
      v_media, v_cover, v_thumb, v_tags, lower(left(btrim(coalesce(p_language, 'en')), 8)), v_age,
      v_vis, v_cat, case when v_kind = 'answer' then p_parent else null end,
      left(btrim(coalesce(p_micro, '')), 30), left(btrim(coalesce(p_nano, '')), 30),
      case when v_pub then 'published' else 'draft' end,
      public.content_words(v_body), public.content_minutes(v_body),
      case when v_pub then now() else null end
    )
    returning * into v_row;
  else
    select * into v_row from public.member_content where id = p_id;
    if v_row.id is null or v_row.hub <> v_hub.id then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if v_row.member <> v_member.id and v_hub.owner <> v_member.id then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;

    update public.member_content c
       set kind         = v_kind,
           title        = v_title,
           summary      = left(btrim(coalesce(p_summary, '')), 320),
           body         = v_body,
           media_url    = v_media,
           cover_url    = v_cover,
           thumbnail_url = v_thumb,
           tags         = v_tags,
           language     = lower(left(btrim(coalesce(p_language, 'en')), 8)),
           age_rating   = v_age,
           visibility   = v_vis,
           category     = v_cat,
           micro_niche  = left(btrim(coalesce(p_micro, '')), 30),
           nano_niche   = left(btrim(coalesce(p_nano, '')), 30),
           status       = case
                            when v_pub then 'published'
                            when c.status = 'published' then 'published'
                            else 'draft'
                          end,
           word_count   = public.content_words(v_body),
           minutes      = public.content_minutes(v_body),
           published_at = case
                            when v_pub and c.published_at is null then now()
                            else c.published_at
                          end,
           updated_at   = now()
     where c.id = v_row.id
    returning * into v_row;
  end if;

  return jsonb_build_object('ok', true, 'row', jsonb_build_object(
    'id', v_row.id,
    'code', upper(left(replace(v_row.id::text, '-', ''), 8)),
    'kind', v_row.kind,
    'title', v_row.title,
    'status', v_row.status,
    'visibility', v_row.visibility,
    'published_at', v_row.published_at,
    'updated_at', v_row.updated_at
  ));
end;
$$;

create or replace function public.creator_item_status(p_token text, p_id uuid, p_status text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.member_content%rowtype;
  v_hub    public.creator_hubs%rowtype;
  v_status text := lower(btrim(coalesce(p_status, '')));
  v_new    public.member_content%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_status not in ('published', 'draft', 'hidden') then
    return jsonb_build_object('ok', false, 'error', 'status');
  end if;

  select * into v_row from public.member_content where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_hub from public.creator_hubs where id = v_row.hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_status = 'published' and coalesce(v_member.status, '') <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'inactive');
  end if;

  update public.member_content c
     set status = v_status,
         published_at = case when v_status = 'published' and c.published_at is null then now()
                             else c.published_at end,
         updated_at = now()
   where c.id = v_row.id
  returning * into v_new;

  return jsonb_build_object('ok', true, 'id', v_new.id, 'status', v_new.status);
end;
$$;

create or replace function public.creator_item_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.member_content%rowtype;
  v_hub    public.creator_hubs%rowtype;
  v_gone   int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_row from public.member_content where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_hub from public.creator_hubs where id = v_row.hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  delete from public.member_content where id = v_row.id;
  get diagnostics v_gone = row_count;
  return jsonb_build_object('ok', true, 'removed', v_gone > 0);
end;
$$;

-- ------------------------------------------------------------------
-- 10. grants — the studio's doors, and nothing else
-- ------------------------------------------------------------------
revoke all on function public.creator_hub_limit(text, int) from public;
revoke all on function public.creator_hub_manage(public.creator_hubs, public.members) from public;
revoke all on function public.creator_kind_allowed(text, text) from public;
revoke all on function public.creator_member_by_ref(text) from public;
revoke all on function public.creator_hub_json(public.creator_hubs) from public;
revoke all on function public.creator_hubs_list(text) from public;
revoke all on function public.creator_hub_get(text, uuid) from public;
revoke all on function public.creator_hub_save(text, uuid, text, text, text, text, text, jsonb, text, text[], text, text, int, text[], text[]) from public;
revoke all on function public.creator_hub_delete(text, uuid) from public;
revoke all on function public.creator_hub_staff(text, uuid, text, text) from public;
revoke all on function public.creator_hub_vip(text, uuid, text, text) from public;
revoke all on function public.creator_hub_unlock(uuid, text) from public;
revoke all on function public.creator_subscribe(text, uuid) from public;
revoke all on function public.creator_subscribers(text, uuid) from public;
revoke all on function public.creator_categories(text, uuid) from public;
revoke all on function public.creator_category_save(text, uuid, uuid, uuid, text) from public;
revoke all on function public.creator_category_delete(text, uuid) from public;
revoke all on function public.creator_items(text, uuid, text, text, text) from public;
revoke all on function public.creator_item_get(text, uuid) from public;
revoke all on function public.creator_item_save(text, uuid, uuid, text, text, text, text, text, text, text, text[], text, text, text, uuid, uuid, text, text, text, text, boolean) from public;
revoke all on function public.creator_item_status(text, uuid, text) from public;
revoke all on function public.creator_item_delete(text, uuid) from public;

grant execute on function public.creator_hubs_list(text) to anon, authenticated, service_role;
grant execute on function public.creator_hub_get(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_hub_save(text, uuid, text, text, text, text, text, jsonb, text, text[], text, text, int, text[], text[]) to anon, authenticated, service_role;
grant execute on function public.creator_hub_delete(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_hub_staff(text, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.creator_hub_vip(text, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.creator_hub_unlock(uuid, text) to anon, authenticated, service_role;
grant execute on function public.creator_subscribe(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_subscribers(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_categories(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_category_save(text, uuid, uuid, uuid, text) to anon, authenticated, service_role;
grant execute on function public.creator_category_delete(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_items(text, uuid, text, text, text) to anon, authenticated, service_role;
grant execute on function public.creator_item_get(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_item_save(text, uuid, uuid, text, text, text, text, text, text, text, text[], text, text, text, uuid, uuid, text, text, text, text, boolean) to anon, authenticated, service_role;
grant execute on function public.creator_item_status(text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.creator_item_delete(text, uuid) to anon, authenticated, service_role;
