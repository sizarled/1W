/* ==================================================================
   A video chooses the studio it is published in
   ------------------------------------------------------------------
   `video-editor.html` publishes a *member* video — a row in `posts`
   with content_type = 'video'. Until now that row belonged to the
   member's own feed and nowhere else, while the studio's Videos tab
   read `member_content`, a different table. So a creator with a studio
   could not say "this film belongs to my studio".

   This file closes that gap:

     1. posts.hub_id       the studio a member video lands in
                           (null = the member's own feed)
     2. video_card         carries the hub, so the editor and the pages
                           can name it
     3. video_save         accepts `hub` — a code (IDST100001) or the
                           hub's uuid — and refuses a hub the member does
                           not manage, or one whose kind cannot hold a
                           video. It stays the thin wrapper it was: the
                           post itself is written by member_post_save,
                           and the studio is set right after
     4. creator_items      a studio's Videos tab lists both the hub's own
                           rows and the member videos published into it
     5. creator_hub_json   counts them, so the header and the table agree

   Run order: after videos-page.sql, creator-studio.sql and
   creator-server-cinema.sql (all applied).
   ================================================================== */

/* ------------------------------------------------------------------ */
/* 1. the studio a video goes into                                     */
/* ------------------------------------------------------------------ */
alter table public.posts
  add column if not exists hub_id uuid references public.creator_hubs (id) on delete set null;

create index if not exists posts_hub_idx
  on public.posts (hub_id, updated_at desc)
  where hub_id is not null;

comment on column public.posts.hub_id is
  'The studio / server / cinema hub a member video was published into. Null = the member''s own feed.';

/* ------------------------------------------------------------------ */
/* 2. one video, as the pages read it — now with its studio            */
/* ------------------------------------------------------------------ */
create or replace function public.video_card(p_post uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.post_card(p_post, p_viewer) || jsonb_build_object(
    'video', jsonb_build_object(
      'meta', coalesce(p.video_meta, '{}'::jsonb),
      'embed', p.embed_url,
      'file', case when coalesce(p.embed_url, '') ~* '\.(mp4|webm|ogv|m3u8|mov)(\?|#|$)'
                   then p.embed_url else null end,
      'host', (select jsonb_build_object(
                        'id', h.id,
                        'username', h.profile_username,
                        'name', coalesce(nullif(btrim(h.profile_name), ''), h.profile_username),
                        'avatar', h.avatar_url,
                        'followers', h.followers_count,
                        'posts', h.posts_count,
                        'country', h.country)
                 from public.profiles h where h.id = p.host_profile_id),
      'hub', (select jsonb_build_object(
                        'id', h.id,
                        'code', h.code,
                        'kind', h.kind,
                        'name', h.name,
                        'visibility', h.visibility)
                 from public.creator_hubs h where h.id = p.hub_id)
    )
  )
  from public.posts p
  where p.id = p_post;
$$;

/* ------------------------------------------------------------------ */
/* 3. saving — the studio is part of the payload                       */
/* ------------------------------------------------------------------ */
create or replace function public.video_save(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_me     public.members%rowtype := public.member_from_token(p_token);
  v_data   jsonb := case when jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object'
                         then coalesce(p_payload, '{}'::jsonb) else '{}'::jsonb end;
  /* the studio this video goes into: a code (IDST100001) or the hub's uuid */
  v_ref    text := nullif(btrim(coalesce(v_data ->> 'hub', '')), '');
  v_hub    public.creator_hubs%rowtype;
  v_hub_id uuid;
  r        jsonb;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  /* where it goes is checked before anything is written: a studio the member
     does not own or staff, a hub whose kind cannot hold a video, or a code we
     do not know, is refused and the video is left untouched. */
  if v_data ? 'hub' and v_ref is not null then
    select * into v_hub
      from public.creator_hubs h
     where upper(h.code) = upper(v_ref)
        or h.id::text = lower(v_ref)
     limit 1;
    if v_hub.id is null then
      return jsonb_build_object('ok', false, 'error', 'hub');
    end if;
    if not public.creator_hub_manage(v_hub, v_me) then
      return jsonb_build_object('ok', false, 'error', 'hub_role');
    end if;
    if not public.creator_kind_allowed(v_hub.kind, 'video') then
      return jsonb_build_object('ok', false, 'error', 'hub_kind');
    end if;
    v_hub_id := v_hub.id;
  end if;

  r := public.member_post_save(p_token, v_data, 'video');
  if not coalesce((r ->> 'ok')::boolean, false) then
    return r;
  end if;

  /* the post is written; now it belongs to the studio. A payload without the
     key leaves the studio it already had, so a partial save never moves it. */
  if v_data ? 'hub' then
    update public.posts p
       set hub_id = v_hub_id
     where p.post_code = (r ->> 'code');
  end if;

  return jsonb_build_object(
    'ok', true,
    'video', public.video_card(public.post_resolve(r ->> 'code'), v_me.id),
    'code', r ->> 'code',
    'status', r ->> 'status',
    'scheduled_at', r -> 'scheduled_at'
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 4. what a hub's member videos count as                              */
/* ------------------------------------------------------------------ */
/** The member videos a hub holds, as the studio's own numbers. */
create or replace function public.creator_hub_posts(p_hub uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'items',     count(*),
    'published', count(*) filter (where p.status = 'published'),
    'drafts',    count(*) filter (where p.status = 'draft'),
    'minutes',   coalesce(sum(p.watch_minutes), 0),
    'likes',     coalesce(sum(p.likes), 0),
    'dislikes',  coalesce(sum(p.dislikes), 0),
    'comments',  coalesce(sum(p.comments_pos + p.comments_neg), 0),
    'shares',    coalesce(sum(p.reshares + p.external_shares), 0),
    'reports',   coalesce(sum(p.reports), 0)
  )
  from public.posts p
  where p.hub_id = p_hub
    and p.content_type = 'video'
    and p.status <> 'deleted';
$$;

/* ------------------------------------------------------------------ */
/* ------------------------------------------------------------------ */
/* 5. the hub's numbers include the videos published into it           */
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
    /* the hub's own rows plus the member videos published into it */
    'items',         (select count(*) from public.member_content c where c.hub = h.id)
                     + coalesce((public.creator_hub_posts(h.id) ->> 'items')::int, 0),
    'published',     (select count(*) from public.member_content c where c.hub = h.id and c.status = 'published')
                     + coalesce((public.creator_hub_posts(h.id) ->> 'published')::int, 0),
    'drafts',        (select count(*) from public.member_content c where c.hub = h.id and c.status = 'draft')
                     + coalesce((public.creator_hub_posts(h.id) ->> 'drafts')::int, 0),
    'minutes',       (select coalesce(sum(c.view_minutes), 0) from public.member_content c where c.hub = h.id)
                     + coalesce((public.creator_hub_posts(h.id) ->> 'minutes')::bigint, 0),
    'likes',         (select coalesce(sum(c.likes), 0) from public.member_content c where c.hub = h.id)
                     + coalesce((public.creator_hub_posts(h.id) ->> 'likes')::bigint, 0),
    'dislikes',      (select coalesce(sum(c.dislikes), 0) from public.member_content c where c.hub = h.id)
                     + coalesce((public.creator_hub_posts(h.id) ->> 'dislikes')::bigint, 0),
    'comments',      (select coalesce(sum(c.comments_count), 0) from public.member_content c where c.hub = h.id)
                     + coalesce((public.creator_hub_posts(h.id) ->> 'comments')::bigint, 0),
    'shares',        (select coalesce(sum(c.shares), 0) from public.member_content c where c.hub = h.id)
                     + coalesce((public.creator_hub_posts(h.id) ->> 'shares')::bigint, 0),
    'reports',       (select coalesce(sum(c.reports), 0) from public.member_content c where c.hub = h.id)
                     + coalesce((public.creator_hub_posts(h.id) ->> 'reports')::bigint, 0),
    'categories',    (select count(*) from public.creator_categories g where g.hub = h.id),
    'created_at',    h.created_at,
    'updated_at',    h.updated_at
  )
  from public.creator_hubs h
  where h.id = p_hub.id;
$$;

/* 6. the studio's Videos tab — both stores, one table                 */
/* ------------------------------------------------------------------ */
/*
 * creator_items(token, hub, kind, status, search)
 *
 *   the hub's own rows (member_content) and the member videos published
 *   into it from video-editor.html. A post row carries
 *   'source': 'video-editor' so the table knows which editor owns it.
 */
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

  select coalesce(jsonb_agg(s.row_json order by s.updated_at desc), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
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
               'updated_at',  c.updated_at,
               'source',      'hub'
             ) as row_json,
             c.updated_at
        from public.member_content c
        left join public.creator_categories g on g.id = c.category
       where c.hub = v_hub.id
         and (v_kind is null or c.kind = v_kind)
         and (v_status is null or c.status = v_status)
         and (v_search = '' or c.title ilike '%' || v_search || '%'
              or c.summary ilike '%' || v_search || '%')

      union all

      /* the member videos published into this hub from video-editor.html */
      select jsonb_build_object(
               'id',          p.id,
               'code',        p.post_code,
               'kind',        'video',
               'title',       p.title,
               'summary',     coalesce(p.description, ''),
               'status',      p.status,
               /* the post's own words, in the studio's: general → public,
                  limited/followers → exclusive */
               'visibility',  case p.visibility
                                when 'general'   then 'public'
                                when 'limited'   then 'exclusive'
                                when 'followers' then 'exclusive'
                                when 'private'   then 'private'
                                else 'public'
                              end,
               'thumbnail',   p.thumbnail_url,
               'media_url',   p.embed_url,
               'category',    null,
               'category_name', null,
               'parent',      null,
               'parent_title', null,
               'micro',       null,
               'nano',        null,
               'views',       p.impressions,
               'minutes',     p.watch_minutes,
               'likes',       p.likes,
               'dislikes',    p.dislikes,
               'comments',    p.comments_pos + p.comments_neg,
               'shares',      p.reshares + p.external_shares,
               'reports',     p.reports,
               'downloads',   0,
               'answers',     0,
               'followers',   0,
               'refollows',   0,
               'words',       p.word_count,
               'lines',       0,
               'chars',       char_length(coalesce(p.description, '')),
               'published_at', p.published_at,
               'created_at',  p.created_at,
               'updated_at',  p.updated_at,
               'source',      'video-editor'
             ) as row_json,
             p.updated_at
        from public.posts p
       where p.hub_id = v_hub.id
         and p.content_type = 'video'
         and p.status <> 'deleted'
         and (v_kind is null or v_kind = 'video')
         and (v_status is null or p.status = v_status)
         and (v_search = '' or p.title ilike '%' || v_search || '%'
              or coalesce(p.description, '') ilike '%' || v_search || '%')
    ) s;

  select jsonb_build_object(
           'all',       count(*),
           'published', count(*) filter (where x.status = 'published'),
           'draft',     count(*) filter (where x.status = 'draft'),
           'minutes',   coalesce(sum(x.minutes), 0),
           'likes',     coalesce(sum(x.likes), 0),
           'dislikes',  coalesce(sum(x.dislikes), 0),
           'comments',  coalesce(sum(x.comments), 0),
           'shares',    coalesce(sum(x.shares), 0),
           'reports',   coalesce(sum(x.reports), 0),
           'downloads', coalesce(sum(x.downloads), 0))
    into v_counts
    from (
      select c.status, c.view_minutes as minutes, c.likes, c.dislikes,
             c.comments_count as comments, c.shares, c.reports, c.downloads
        from public.member_content c
       where c.hub = v_hub.id
         and (v_kind is null or c.kind = v_kind)
      union all
      select p.status, p.watch_minutes, p.likes, p.dislikes,
             p.comments_pos + p.comments_neg, p.reshares + p.external_shares, p.reports, 0
        from public.posts p
       where p.hub_id = v_hub.id
         and p.content_type = 'video'
         and p.status <> 'deleted'
         and (v_kind is null or v_kind = 'video')
    ) x;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'counts', v_counts);
end;
$$;

/* ------------------------------------------------------------------ */
/* 7. grants                                                          */
/* ------------------------------------------------------------------ */
revoke all on function public.creator_hub_posts(uuid) from public;
revoke all on function public.creator_items(text, uuid, text, text, text) from public;

grant execute on function public.creator_hub_posts(uuid) to anon, authenticated, service_role;
grant execute on function public.creator_items(text, uuid, text, text, text) to anon, authenticated, service_role;
grant execute on function public.video_card(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.video_save(text, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
