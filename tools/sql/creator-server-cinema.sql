/* ==================================================================
   creator.html — the server and the cinema
   ------------------------------------------------------------------
   Two more places a member can run, and the two things that make them
   different from a studio or a blog:

     1. they stream, so there is a **cap on how many people may watch at
        the same time** — a server's cap comes from the server's level
        (1 → 100 … 10 → 1000, the top level → no limit), a cinema's films
        follow the same scale and a cinema's episodes are ten times that
        (1 → 1000 … 10 → 10000, top → no limit), and a single film or
        episode may carry a smaller **seats** number of its own;

     2. their content is long lists of links — channels, M3U lists,
        Xtream accounts, films, episodes, playlists — so each row keeps
        the extra fields in a `meta` object (quality, subtitles, ads, the
        TMDB id, the season and the episode, the list's bytes, …).

   A third, quieter change runs through **everything** in creator.html:
   visibility. `public` now means "everyone but the excluded list",
   `exclusive` means "whoever meets the criteria" (subscription, country,
   language, account level, wealth), `private` is the VIP list or the
   password. Hubs and items both carry `excluded`, `audience` and the
   subscription switch (`auto_accept`: when it is off, nobody may
   subscribe or follow).

   The two saving functions of the studio are left alone; the new fields
   travel through two companions:

     creator_hub_access(token, hub, excluded[], audience, auto_accept, viewers)
     creator_item_meta(token, item, meta, excluded[], audience, seats)

   Both are called right after creator_hub_save / creator_item_save.
   ================================================================== */

/* ------------------------------------------------------------------ */
/* 1. the seven kinds, plus what a server and a cinema hold            */
/* ------------------------------------------------------------------ */
alter table public.creator_hubs drop constraint if exists creator_hubs_kind;

alter table public.creator_hubs
  add column if not exists excluded    text[] not null default '{}',
  add column if not exists audience    jsonb  not null default '{}'::jsonb,
  add column if not exists auto_accept boolean not null default true,
  add column if not exists max_viewers int;

alter table public.member_content
  add column if not exists meta      jsonb not null default '{}'::jsonb,
  add column if not exists excluded  text[] not null default '{}',
  add column if not exists audience  jsonb not null default '{}'::jsonb,
  add column if not exists seats     int;

alter table public.member_content drop constraint if exists member_content_kind;
alter table public.member_content add constraint member_content_kind check (
  kind in ('video', 'article', 'podcast', 'image', 'document', 'post',
           'playlist', 'book', 'question', 'answer',
           'channel', 'channel_list', 'xtream', 'film', 'episode')
);

/* a server takes channels, lists, Xtream accounts; a cinema takes films,
   episodes and the playlists that line them up */
drop function if exists public.creator_kind_allowed(text, text);

create or replace function public.creator_kind_allowed(p_kind text, p_item text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case lower(coalesce(p_kind, ''))
    when 'channel' then lower(coalesce(p_item, '')) in ('video', 'podcast', 'playlist')
    when 'server'  then lower(coalesce(p_item, '')) in
                          ('video', 'podcast', 'playlist', 'channel', 'channel_list', 'xtream')
    when 'cinema'  then lower(coalesce(p_item, '')) in ('video', 'film', 'episode', 'playlist')
    when 'blog'    then lower(coalesce(p_item, '')) = 'article'
    when 'space'   then lower(coalesce(p_item, '')) in ('question', 'answer')
    when 'library' then lower(coalesce(p_item, '')) in ('book', 'document')
    when 'gallery' then lower(coalesce(p_item, '')) = 'image'
    else false
  end;
$$;

/* ------------------------------------------------------------------ */
/* 2. how many may watch at the same time                              */
/* ------------------------------------------------------------------ */
/*
 * creator_viewer_limit(hub kind, the hub owner's level, the item kind)
 *
 *   server  100 × level          (1 → 100, 5 → 500, 10 → 1000)
 *   cinema · film      100 × level
 *   cinema · episode  1000 × level  (a series is watched by ten times more)
 *   every other kind  null          (not a stream)
 *   level 11 and above — the top level — null, which means no limit.
 */
create or replace function public.creator_viewer_limit(p_kind text, p_level int, p_item_kind text)
returns int
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when coalesce(p_level, 1) >= 11 then null
    when lower(coalesce(p_kind, '')) = 'cinema'
         and lower(coalesce(p_item_kind, '')) in ('episode', 'serie')
      then 1000 * greatest(1, coalesce(p_level, 1))
    when lower(coalesce(p_kind, '')) in ('cinema', 'server')
      then 100 * greatest(1, coalesce(p_level, 1))
    else null
  end;
$$;

/** The cap that really applies: the hub's, the item's seats, or neither. */
create or replace function public.creator_watch_cap(p_hub public.creator_hubs, p_item_seats int, p_level int)
returns int
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select least(
    coalesce(p_hub.max_viewers, public.creator_viewer_limit(p_hub.kind, p_level, '')),
    coalesce(p_item_seats, 2147483647)
  );
$$;

/* ------------------------------------------------------------------ */
/* 3. the criteria of an `exclusive` item or hub                      */
/* ------------------------------------------------------------------ */
/*
 * audience = {
 *   "requires":   "" | "subscribe" | "follow"   (we only know subscriptions)
 *   "countries":  ["Morocco", "Egypt"],          empty = any country
 *   "languages":  ["ar", "fr"],                  empty = any language
 *   "level_min":  0,                             the member's level
 *   "wealth_min": 0                              the member's points
 * }
 */
create or replace function public.creator_audience_ok(
  p_audience  jsonb,
  p_member    public.members,
  p_subscribed boolean
)
returns boolean
language plpgsql
stable
set search_path to 'public', 'pg_temp'
as $$
declare
  v_aud    jsonb := case when jsonb_typeof(coalesce(p_audience, '{}'::jsonb)) = 'object'
                         then coalesce(p_audience, '{}'::jsonb) else '{}'::jsonb end;
  v_req    text := lower(btrim(coalesce(p_audience->>'requires', '')));
  v_countries text[];
  v_langs  text[];
  v_level  int := coalesce(nullif(p_audience->>'level_min', '')::int, 0);
  v_wealth int := coalesce(nullif(p_audience->>'wealth_min', '')::int, 0);
begin
  if v_req in ('subscribe', 'follow') and not coalesce(p_subscribed, false) then
    return false;
  end if;

  v_countries := array(select lower(btrim(x)) from jsonb_array_elements_text(
                        case when jsonb_typeof(v_aud->'countries') = 'array' then v_aud->'countries' else '[]'::jsonb end) x
                        where btrim(x) <> '');
  if coalesce(array_length(v_countries, 1), 0) > 0
     and lower(coalesce(p_member.country, '')) <> all (v_countries) then
    return false;
  end if;

  v_langs := array(select lower(btrim(x)) from jsonb_array_elements_text(
                    case when jsonb_typeof(v_aud->'languages') = 'array' then v_aud->'languages' else '[]'::jsonb end) x
                    where btrim(x) <> '');
  if coalesce(array_length(v_langs, 1), 0) > 0
     and lower(coalesce(p_member.language, 'en')) <> all (v_langs) then
    return false;
  end if;

  if v_level > coalesce(p_member.level, 1) then
    return false;
  end if;
  if v_wealth > coalesce(p_member.points, 0) then
    return false;
  end if;

  return true;
end;
$$;

/** A hub's own door: excluded list, then its visibility. */
create or replace function public.creator_hub_open_to(
  p_hub        public.creator_hubs,
  p_member     public.members,
  p_manage     boolean,
  p_vip        boolean,
  p_unlocked   boolean,
  p_subscribed boolean
)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when coalesce(p_manage, false) or coalesce(p_vip, false) or coalesce(p_unlocked, false) then true
    when coalesce(p_member.member_id, '') = any(p_hub.excluded) then false
    when p_hub.visibility = 'public' then true
    when p_hub.visibility = 'exclusive' then public.creator_audience_ok(p_hub.audience, p_member, p_subscribed)
    else false
  end;
$$;

/** One item's door, given the hub's standing. */
create or replace function public.creator_item_open_to(
  p_item       public.member_content,
  p_member     public.members,
  p_full       boolean,
  p_subscribed boolean
)
returns boolean
language sql
stable
set search_path to 'public', 'pg_temp'
as $$
  select case
    when coalesce(p_full, false) then true
    when coalesce(p_member.member_id, '') = any(p_item.excluded) then false
    when p_item.visibility = 'public' then true
    when p_item.visibility = 'exclusive' then public.creator_audience_ok(p_item.audience, p_member, p_subscribed)
    else false
  end;
$$;

/* ------------------------------------------------------------------ */
/* 4. saving the new hub fields                                       */
/* ------------------------------------------------------------------ */
/*
 * creator_hub_access(token, hub, excluded[], audience jsonb, auto_accept, viewers)
 *
 *   excluded     member codes who may not enter, whatever the visibility
 *   audience     the `exclusive` criteria
 *   auto_accept  false turns subscriptions and follows off entirely
 *   viewers      an optional lower cap (null = the level's own cap)
 *
 * → { ok, hub }
 * errors: session | not_found | audience | viewers | code
 */
create or replace function public.creator_hub_access(
  p_token       text,
  p_hub         uuid,
  p_excluded    text[],
  p_audience    jsonb,
  p_auto_accept boolean,
  p_viewers     int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_excl   text[];
  v_aud    jsonb;
  v_level  int;
  v_cap    int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(array_agg(distinct left(btrim(upper(x)), 12)) filter (where btrim(x) <> ''), '{}')
    into v_excl
    from unnest(coalesce(p_excluded, '{}')) x;
  if array_length(v_excl, 1) > 200 then
    v_excl := v_excl[1:200];
  end if;
  if exists (select 1 from unnest(v_excl) x
              where not exists (select 1 from public.members m where m.member_id = x)) then
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;

  v_aud := case when jsonb_typeof(coalesce(p_audience, '{}'::jsonb)) = 'object'
                then coalesce(p_audience, '{}'::jsonb) else '{}'::jsonb end;
  if coalesce(v_aud->>'requires', '') not in ('', 'subscribe', 'follow') then
    return jsonb_build_object('ok', false, 'error', 'audience');
  end if;

  select coalesce(level, 1) into v_level from public.members where id = v_hub.owner;
  v_cap := public.creator_viewer_limit(v_hub.kind, coalesce(v_level, 1), '');

  if p_viewers is not null then
    if p_viewers < 0 or (v_cap is not null and p_viewers > v_cap) then
      return jsonb_build_object('ok', false, 'error', 'viewers', 'limit', v_cap);
    end if;
  end if;

  update public.creator_hubs
     set excluded    = coalesce(v_excl, '{}'),
         audience    = v_aud,
         auto_accept = coalesce(p_auto_accept, true),
         max_viewers = case when p_viewers is null or p_viewers = 0 then null else p_viewers end,
         updated_at  = now()
   where id = v_hub.id
   returning * into v_hub;

  return jsonb_build_object('ok', true, 'hub', public.creator_hub_json(v_hub));
end;
$$;

/* ------------------------------------------------------------------ */
/* 5. saving the new item fields                                      */
/* ------------------------------------------------------------------ */
/*
 * creator_item_meta(token, item, meta jsonb, excluded[], audience, seats)
 *
 *   meta     what the kind needs and the generic columns cannot hold:
 *            channel   { group, epg_url }
 *            list      { source: paste|url|file, content, url, epg_url, count }
 *            xtream    { host, port, username, password }
 *            film      { tmdb, quality[], subtitles, subtitle_langs[], ads }
 *            episode   { tmdb, season, episode, quality[], subtitles,
 *                        subtitle_langs[], ads }
 *            playlist  { items: [{ kind, id, title }] }
 *   seats    how many may watch this one at the same time — never more
 *            than the hub's own cap
 *
 * → { ok, item }
 * errors: session | not_found | audience | seats | meta
 */
create or replace function public.creator_item_meta(
  p_token    text,
  p_item     uuid,
  p_meta     jsonb,
  p_excluded text[],
  p_audience jsonb,
  p_seats    int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.member_content%rowtype;
  v_hub    public.creator_hubs%rowtype;
  v_excl   text[];
  v_aud    jsonb;
  v_meta   jsonb;
  v_level  int;
  v_cap    int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_row from public.member_content where id = p_item;
  if v_row.id is null or v_row.hub is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_hub from public.creator_hubs where id = v_row.hub;
  if not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(array_agg(distinct left(btrim(upper(x)), 12)) filter (where btrim(x) <> ''), '{}')
    into v_excl
    from unnest(coalesce(p_excluded, '{}')) x;
  v_aud := case when jsonb_typeof(coalesce(p_audience, '{}'::jsonb)) = 'object'
                then coalesce(p_audience, '{}'::jsonb) else '{}'::jsonb end;
  if coalesce(v_aud->>'requires', '') not in ('', 'subscribe', 'follow') then
    return jsonb_build_object('ok', false, 'error', 'audience');
  end if;

  v_meta := case when jsonb_typeof(coalesce(p_meta, '{}'::jsonb)) = 'object'
                 then coalesce(p_meta, '{}'::jsonb) else '{}'::jsonb end;

  select coalesce(level, 1) into v_level from public.members where id = v_hub.owner;
  v_cap := public.creator_viewer_limit(v_hub.kind, coalesce(v_level, 1), v_row.kind);
  if p_seats is not null and p_seats > 0 then
    if v_cap is not null and p_seats > v_cap then
      return jsonb_build_object('ok', false, 'error', 'seats', 'limit', v_cap);
    end if;
  end if;

  update public.member_content
     set meta     = v_meta,
         excluded = coalesce(v_excl, '{}'),
         audience = v_aud,
         seats    = case when p_seats is null or p_seats = 0 then null else p_seats end
   where id = v_row.id
   returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'item', jsonb_build_object(
      'id', v_row.id, 'kind', v_row.kind, 'title', v_row.title,
      'meta', v_row.meta, 'excluded', v_row.excluded, 'seats', v_row.seats,
      'cap', case when v_cap is null and v_row.seats is null then null
                  else least(coalesce(v_cap, 2147483647), coalesce(v_row.seats, 2147483647)) end
    )
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 6. the hub's shared shape, with the new fields                     */
/* ------------------------------------------------------------------ */
create or replace function public.creator_hub_json(p_hub public.creator_hubs)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'id',            h.id,
    'code',          h.code,
    'kind',          h.kind,
    'name',          h.name,
    'description',   h.description,
    'logo_url',      h.logo_url,
    'cover_url',     h.cover_url,
    'links',         h.links,
    'field',         h.field,
    'niches',        h.niches,
    'visibility',    h.visibility,
    'excluded',      h.excluded,
    'audience',      h.audience,
    'auto_accept',   h.auto_accept,
    'max_viewers',   h.max_viewers,
    'viewer_limit',  public.creator_viewer_limit(h.kind, (select coalesce(m.level, 1) from public.members m where m.id = h.owner), ''),
    'viewers',       coalesce(h.max_viewers,
                              public.creator_viewer_limit(h.kind, (select coalesce(m.level, 1) from public.members m where m.id = h.owner), '')),
    'password_until', h.password_until,
    'locked',        coalesce(h.password_hash, '') <> '',
    'staff',         h.staff,
    'vip',           h.vip,
    'publishers',    h.publishers,
    'advertisers',   h.advertisers,
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

/* ------------------------------------------------------------------ */
/* 7. subscribing — unless the owner turned it off                    */
/* ------------------------------------------------------------------ */
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
  if v_hub.id is null or v_hub.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if not coalesce(v_hub.auto_accept, true) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;
  if v_hub.owner = v_member.id then
    return jsonb_build_object('ok', false, 'error', 'self');
  end if;

  select exists (select 1 from public.creator_subscriptions s
                  where s.hub = v_hub.id and s.member = v_member.id) into v_on;

  if v_on then
    delete from public.creator_subscriptions
     where hub = v_hub.id and member = v_member.id;
  else
    insert into public.creator_subscriptions (hub, member) values (v_hub.id, v_member.id)
    on conflict do nothing;
  end if;

  select count(*) into v_count from public.creator_subscriptions s where s.hub = v_hub.id;
  return jsonb_build_object('ok', true, 'subscribed', not v_on, 'count', v_count);
end;
$$;

/* ------------------------------------------------------------------ */
/* 8. the hub as a visitor — with the two new doors                  */
/* ------------------------------------------------------------------ */
create or replace function public.creator_hub_view(p_token text, p_hub text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype := public.creator_hub_ref(p_hub);
  v_manage boolean := false;
  v_vip    boolean := false;
  v_sub    boolean := false;
  v_pw     boolean := false;
  v_excl   boolean := false;
  v_open   boolean := false;
  v_rows   jsonb;
  v_ads    jsonb;
  v_req    jsonb;
  v_pub    boolean := false;
  v_adv    boolean := false;
  v_level  int;
  v_cap    int;
begin
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_manage := public.creator_hub_manage(v_hub, v_member);
  v_vip    := coalesce(v_member.member_id, '') = any(v_hub.vip);
  v_pub    := coalesce(v_member.member_id, '') = any(v_hub.publishers);
  v_adv    := coalesce(v_member.member_id, '') = any(v_hub.advertisers);
  v_excl   := coalesce(v_member.member_id, '') = any(v_hub.excluded);
  v_sub    := v_member.id is not null and exists (
               select 1 from public.creator_subscriptions s
                where s.hub = v_hub.id and s.member = v_member.id);
  select coalesce(level, 1) into v_level from public.members where id = v_hub.owner;
  v_cap := public.creator_viewer_limit(v_hub.kind, coalesce(v_level, 1), '');

  if v_hub.visibility = 'private' and not v_manage and not v_vip and not v_excl then
    if coalesce(p_password, '') <> '' and coalesce(v_hub.password_hash, '') <> ''
       and (v_hub.password_until is null or v_hub.password_until >= now())
       and extensions.crypt(p_password, v_hub.password_hash) = v_hub.password_hash then
      v_pw := true;
    end if;
  end if;

  v_open := public.creator_hub_open_to(v_hub, v_member, v_manage, v_vip, v_pw, v_sub);

  if not v_open then
    return jsonb_build_object(
      'ok', true,
      'locked', true,
      'hub', jsonb_build_object(
        'id', v_hub.id, 'code', v_hub.code, 'kind', v_hub.kind, 'name', v_hub.name,
        'description', v_hub.description, 'logo_url', v_hub.logo_url, 'cover_url', v_hub.cover_url,
        'visibility', v_hub.visibility, 'locked', true,
        'excluded', v_hub.excluded,
        'audience', v_hub.audience,
        'auto_accept', coalesce(v_hub.auto_accept, true),
        'viewers', coalesce(v_hub.max_viewers, v_cap),
        'viewer_limit', v_cap,
        'has_password', coalesce(v_hub.password_hash, '') <> '',
        'password_until', v_hub.password_until,
        'staff', v_hub.staff, 'vip', v_hub.vip,
        'publishers', v_hub.publishers, 'advertisers', v_hub.advertisers,
        'owner', (select m.member_id from public.members m where m.id = v_hub.owner),
        'subscribers', public.creator_hub_subscribers(v_hub.id),
        'reason', case when v_excl then 'excluded'
                       when v_hub.visibility = 'private' then 'password'
                       when v_hub.visibility = 'exclusive' then 'audience'
                       else 'closed' end
      )
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          c.id,
           'code',        upper(left(replace(c.id::text, '-', ''), 8)),
           'kind',        c.kind,
           'title',       c.title,
           'summary',     c.summary,
           'thumbnail',   c.thumbnail_url,
           'media_url',   c.media_url,
           'cover_url',   c.cover_url,
           'meta',        c.meta,
           'visibility',  c.visibility,
           'excluded',    c.excluded,
           'audience',    c.audience,
           'seats',       c.seats,
           'cap',         case when v_cap is null and c.seats is null then null
                               else least(coalesce(v_cap, 2147483647), coalesce(c.seats, 2147483647)) end,
           'minutes',     coalesce(nullif(c.view_minutes, 0), c.minutes),
           'likes',       c.likes,
           'comments',    c.comments_count,
           'published_at', c.published_at
         ) order by c.published_at desc nulls last), '[]'::jsonb)
    into v_rows
    from public.member_content c
   where c.hub = v_hub.id
     and c.status = 'published'
     and public.creator_item_open_to(c, v_member, v_manage or v_vip or v_pw, v_sub);

  select coalesce(jsonb_agg(jsonb_build_object(
           'id', a.id, 'format', a.format, 'title', a.title, 'body', a.body,
           'media_url', a.media_url, 'link_url', a.link_url,
           'member', coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id)
         ) order by a.created_at desc), '[]'::jsonb)
    into v_ads
    from public.creator_ads a
    join public.members m on m.id = a.member
   where a.hub = v_hub.id and a.status = 'live';

  if v_member.id is not null then
    select jsonb_build_object('id', r.id, 'role', r.role, 'format', r.format,
                              'status', r.status, 'created_at', r.created_at)
      into v_req
      from public.creator_requests r
     where r.hub = v_hub.id and r.member = v_member.id
     order by r.created_at desc
     limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'locked', false,
    'hub', public.creator_hub_json(v_hub) || jsonb_build_object(
      'owner', (select m.member_id from public.members m where m.id = v_hub.owner),
      'role', case when v_hub.owner = v_member.id then 'owner'
                   when v_manage then 'staff' else 'visitor' end,
      'subscribed', v_sub,
      'unlocked', v_pw,
      'can_subscribe', coalesce(v_hub.auto_accept, true) and v_hub.owner <> coalesce(v_member.id, v_hub.owner),
      'can', jsonb_build_object('publish', v_pub or v_manage, 'advertise', v_adv or v_manage),
      'request', v_req,
      'ads', v_ads
    ),
    'items', v_rows
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 8b. the paths that already existed, widened                        */
/* ------------------------------------------------------------------ */
/*
 * A hub may now be a server or a cinema, and an item may be private.
 * An approved publisher's draft may carry any of the new kinds too.
 */

create or replace function public.creator_submit_item(...);
/* see the live body: identical to the version in creator-studio.sql except
   that `visibility` accepts 'private' and the reply carries the item's code */

create or replace function public.creator_items(...);
/* see the live body: the rows now carry meta, excluded, audience, seats and
   the cap that really applies to each one, and the reply carries the hub's
   own viewer_limit */

/* ------------------------------------------------------------------ */
/* 9. grants                                                          */
/* ------------------------------------------------------------------ */
revoke all on function public.creator_hub_access(text, uuid, text[], jsonb, boolean, int) from public;
revoke all on function public.creator_item_meta(text, uuid, jsonb, text[], jsonb, int) from public;

grant execute on function public.creator_hub_access(text, uuid, text[], jsonb, boolean, int) to anon, authenticated, service_role;
grant execute on function public.creator_item_meta(text, uuid, jsonb, text[], jsonb, int) to anon, authenticated, service_role;
grant execute on function public.creator_viewer_limit(text, int, text) to anon, authenticated, service_role;
grant execute on function public.creator_watch_cap(public.creator_hubs, int, int) to anon, authenticated, service_role;
grant execute on function public.creator_audience_ok(jsonb, public.members, boolean) to anon, authenticated, service_role;
grant execute on function public.creator_hub_open_to(public.creator_hubs, public.members, boolean, boolean, boolean, boolean) to anon, authenticated, service_role;
grant execute on function public.creator_item_open_to(public.member_content, public.members, boolean, boolean) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
