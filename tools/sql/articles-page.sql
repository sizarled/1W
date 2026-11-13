/* ==================================================================
   The articles page — the feed, the reader and the editor
   ------------------------------------------------------------------
   An article is a row of `posts` with content_type = 'article', the
   same row likes, comments, reports and reach already live on. This
   file adds the little it needs and nothing more:

     posts.article_meta      the editor's own details (help page, source)
     post_keys               the doors' passwords, shared by every member
                             post page (renamed from video_keys)
     post_save_tags          the tags of any member post (renamed)

   ... and the calls the three screens read:

     member_post_save(token, payload, type)   one save for video and article
     video_save / article_save                thin wrappers, same payload
     article_card / article_feed              the cards and the rails
     article_get(token, ref, key)             the reader, or the door
     article_mine(token)                      the member's own rows

   The three doors are the site's own: general, limited (a country, a
   language, a level), private (the nominated list) and followers. A
   password opens one visit, for anybody, without granting a reaction.
   ================================================================== */

/* ------------------------------------------------------------------ */
/* 1. what an article knows about itself                              */
/* ------------------------------------------------------------------ */
alter table public.posts
  add column if not exists article_meta jsonb not null default '{}'::jsonb;

create index if not exists posts_article_idx
  on public.posts (published_at desc)
  where content_type = 'article' and status = 'published';

/* ------------------------------------------------------------------ */
/* 2. one door table for every member post, one name for its helpers   */
/* ------------------------------------------------------------------ */
do $$
begin
  if exists (select 1 from information_schema.tables
              where table_schema = 'public' and table_name = 'video_keys')
     and not exists (select 1 from information_schema.tables
                      where table_schema = 'public' and table_name = 'post_keys') then
    alter table public.video_keys rename to post_keys;
    alter index if exists public.video_keys_post_idx rename to post_keys_post_idx;
  end if;
end $$;

do $$
begin
  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'video_save_tags')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'post_save_tags') then
    alter function public.video_save_tags(uuid, text, uuid, jsonb) rename to post_save_tags;
  end if;

  if exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
              where n.nspname = 'public' and p.proname = 'video_keyword')
     and not exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                      where n.nspname = 'public' and p.proname = 'post_keyword') then
    alter function public.video_keyword(text, text, uuid) rename to post_keyword;
  end if;
end $$;

/* the rename above does not rewrite the bodies that call it: restate the
   one function that named the old spelling. */
create or replace function public.post_save_tags(p_post uuid, p_language text, p_member uuid, p_tags jsonb)
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_item jsonb;
  v_kw   text;
  v_id   uuid;
  v_n    int := 0;
begin
  if jsonb_typeof(p_tags) <> 'array' then
    return 0;
  end if;
  for v_item in select value from jsonb_array_elements(p_tags) loop
    exit when v_n >= 12;
    v_kw := left(btrim(coalesce(v_item #>> '{}', '')), 40);
    if v_kw = '' then
      continue;
    end if;
    v_id := public.post_keyword(v_kw, p_language, p_member);
    if v_id is not null then
      insert into public.post_keywords (post_id, keyword_id, role)
      values (p_post, v_id, 'main') on conflict (post_id, keyword_id) do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

/* the body of a post, counted in words — the site's rule, ceil(words / 200) */
create or replace function public.post_words(p_text text)
returns integer
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select greatest(0, coalesce(array_length(
    regexp_split_to_array(
      btrim(regexp_replace(coalesce(p_text, ''), '<[^>]*>', ' ', 'g')), '\s+'), 1), 1) - 1);
$$;

/* ------------------------------------------------------------------ */
/* 3. one save for every member post page                             */
/* ------------------------------------------------------------------ */
/*
 * member_post_save(token, payload, type)
 *
 *   type  'video' or 'article'
 *
 *   payload  title, description, body (article), embed (video),
 *            thumbnail, language, visibility, status, scheduled_at,
 *            tags[], audience[{kind, value, mode}], profiles[],
 *            passwords[], meta{}
 *
 * A key that is not in the payload is a list this save leaves alone, so
 * a partial save can never wipe an audience, the nominated people, the
 * door's passwords or the tags of the post it edits.
 */
create or replace function public.member_post_save(p_token text, p_payload jsonb, p_type text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_type    text := lower(coalesce(nullif(btrim(p_type), ''), 'article'));
  v_me      public.members%rowtype := public.member_from_token(p_token);
  v_data    jsonb := case when jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object'
                          then coalesce(p_payload, '{}'::jsonb) else '{}'::jsonb end;
  v_id      uuid := public.post_resolve(nullif(btrim(coalesce(v_data ->> 'id', '')), ''));
  v_post    public.posts%rowtype;
  v_title   text := btrim(coalesce(v_data ->> 'title', ''));
  v_desc    text := nullif(btrim(coalesce(v_data ->> 'description', '')), '');
  v_body    text := nullif(btrim(coalesce(v_data ->> 'body', '')), '');
  v_thumb   text := nullif(btrim(coalesce(v_data ->> 'thumbnail', '')), '');
  v_embed   text := nullif(btrim(coalesce(v_data ->> 'embed', '')), '');
  v_lang    text := coalesce(nullif(btrim(coalesce(v_data ->> 'language', '')), ''), 'en');
  v_vis     text := lower(coalesce(nullif(btrim(coalesce(v_data ->> 'visibility', '')), ''), 'general'));
  v_status  text := lower(coalesce(nullif(btrim(coalesce(v_data ->> 'status', '')), ''), 'draft'));
  v_when    timestamptz := null;
  v_meta    jsonb := case when jsonb_typeof(v_data -> 'meta') = 'object'
                          then v_data -> 'meta' else '{}'::jsonb end;
  v_item    jsonb;
  v_ref     uuid;
  v_hash    text;
  v_pass    text;
  v_tags    int := 0;
  v_host    uuid;
  v_words   int;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_type not in ('video', 'article') then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;
  if char_length(v_title) < 1 then
    return jsonb_build_object('ok', false, 'error', 'title');
  end if;
  if char_length(v_title) > 200 then
    return jsonb_build_object('ok', false, 'error', 'title_long');
  end if;
  if v_vis not in ('general', 'limited', 'private', 'followers') then
    return jsonb_build_object('ok', false, 'error', 'visibility');
  end if;
  /* pending is the help queue: the piece waits for the moderators */
  if v_status not in ('draft', 'published', 'scheduled', 'pending') then
    return jsonb_build_object('ok', false, 'error', 'status');
  end if;
  if v_embed is not null and v_embed !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'embed');
  end if;
  if v_thumb is not null and v_thumb !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'embed');
  end if;

  if v_status = 'scheduled' then
    begin
      v_when := nullif(btrim(coalesce(v_data ->> 'scheduled_at', '')), '')::timestamptz;
    exception when others then
      return jsonb_build_object('ok', false, 'error', 'schedule');
    end;
    if v_when is null or v_when <= now() then
      return jsonb_build_object('ok', false, 'error', 'schedule');
    end if;
  elsif v_status = 'published' then
    v_when := null;
  end if;

  /* an article is counted in the words of its body, a video in its description */
  v_words := case when v_type = 'video'
                  then coalesce(array_length(regexp_split_to_array(btrim(coalesce(v_desc, '')), '\s+'), 1), 0)
                  else public.post_words(coalesce(v_body, '')) end;

  if v_type = 'article' and v_status = 'published' and v_words < 1 then
    return jsonb_build_object('ok', false, 'error', 'body');
  end if;

  v_host := public.profile_resolve(v_me.id::text);
  if v_host is null then
    return jsonb_build_object('ok', false, 'error', 'profile');
  end if;

  if v_id is null then
    insert into public.posts (
      author_profile_id, host_profile_id, content_type, title, description, body,
      thumbnail_url, embed_url, language, translation_status, visibility,
      status, scheduled_at, published_at, word_count, video_meta, article_meta
    ) values (
      v_me.id, v_host, v_type, left(v_title, 200), v_desc,
      case when v_type = 'article' then v_body else null end,
      v_thumb, case when v_type = 'video' then v_embed else null end,
      left(v_lang, 8), 'none', v_vis,
      v_status, v_when,
      case when v_status = 'published' then now() else null end,
      v_words,
      case when v_type = 'video' then v_meta else '{}'::jsonb end,
      case when v_type = 'article' then v_meta else '{}'::jsonb end
    )
    returning * into v_post;
  else
    select * into v_post from public.posts where id = v_id;
    if v_post.id is null or v_post.content_type <> v_type then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if v_me.id not in (v_post.author_profile_id, v_post.host_profile_id) then
      return jsonb_build_object('ok', false, 'error', 'role');
    end if;

    update public.posts p
       set title         = left(v_title, 200),
           description   = v_desc,
           body          = case when v_type = 'article' then v_body else p.body end,
           thumbnail_url = v_thumb,
           embed_url     = case when v_type = 'video' then v_embed else p.embed_url end,
           language      = left(v_lang, 8),
           visibility    = v_vis,
           status        = v_status,
           scheduled_at  = v_when,
           published_at  = case when v_status = 'published'
                                then coalesce(p.published_at, now())
                                else p.published_at end,
           word_count    = v_words,
           video_meta    = case when v_type = 'video' then v_meta else p.video_meta end,
           article_meta  = case when v_type = 'article' then v_meta else p.article_meta end,
           updated_at    = now()
     where p.id = v_post.id
    returning * into v_post;

    /* a key we were not given is a list we leave alone */
    if v_data ? 'audience' then
      delete from public.post_audience_rules where post_id = v_post.id;
    end if;
    if v_data ? 'profiles' then
      delete from public.post_authorized_profiles where post_id = v_post.id;
    end if;
    if v_data ? 'passwords' then
      delete from public.post_keys where post_id = v_post.id;
    end if;
    if v_data ? 'tags' then
      delete from public.post_keywords where post_id = v_post.id;
    end if;
  end if;

  /* the tags — main keywords, shared with the rest of the site */
  v_tags := public.post_save_tags(v_post.id, v_post.language, v_me.id, v_data -> 'tags');

  if jsonb_typeof(v_data -> 'audience') = 'array' then
    for v_item in select value from jsonb_array_elements(v_data -> 'audience') loop
      if coalesce(v_item ->> 'kind', '') in ('country', 'language', 'level', 'wealth', 'entity')
         and btrim(coalesce(v_item ->> 'value', '')) <> '' then
        insert into public.post_audience_rules (post_id, kind, value, mode)
        values (v_post.id, v_item ->> 'kind', left(btrim(v_item ->> 'value'), 60),
                case when lower(coalesce(v_item ->> 'mode', 'include')) = 'exclude'
                     then 'exclude' else 'include' end)
        on conflict do nothing;
      end if;
    end loop;
  end if;

  /* who may read a private one */
  if jsonb_typeof(v_data -> 'profiles') = 'array' then
    for v_item in select value from jsonb_array_elements(v_data -> 'profiles') loop
      v_ref := public.profile_resolve(coalesce(v_item #>> '{}', ''));
      if v_ref is not null then
        insert into public.post_authorized_profiles (post_id, profile_id)
        values (v_post.id, v_ref) on conflict do nothing;
      end if;
    end loop;
  end if;

  /* the join passwords — stored as a hash, never as typed */
  if jsonb_typeof(v_data -> 'passwords') = 'array' then
    for v_item in select value from jsonb_array_elements(v_data -> 'passwords') loop
      v_pass := btrim(coalesce(v_item #>> '{}', ''));
      if char_length(v_pass) < 4 then
        continue;
      end if;
      v_hash := extensions.crypt(left(v_pass, 60), extensions.gen_salt('bf'));
      insert into public.post_keys (post_id, password_hash) values (v_post.id, v_hash);
    end loop;
  end if;

  perform public.member_log_write(v_me.id, null, v_type || '_saved',
    jsonb_build_object('post', v_post.id, 'status', v_post.status,
                       'visibility', v_post.visibility, 'tags', v_tags), null, null);

  return jsonb_build_object(
    'ok', true,
    'type', v_type,
    'code', v_post.post_code,
    'status', v_post.status,
    'scheduled_at', v_post.scheduled_at,
    'card', case when v_type = 'video'
                 then public.video_card(v_post.id, v_me.id)
                 else public.article_card(v_post.id, v_me.id) end
  );
end;
$$;

/* the video editor keeps its own name and its own answer */
create or replace function public.video_save(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  r jsonb := public.member_post_save(p_token, p_payload, 'video');
begin
  if coalesce((r ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', true, 'video', r -> 'card', 'code', r ->> 'code',
      'status', r ->> 'status', 'scheduled_at', r -> 'scheduled_at');
  end if;
  return r;
end;
$$;

/* the article editor answers with `article`, the same shape */
create or replace function public.article_save(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  r jsonb := public.member_post_save(p_token, p_payload, 'article');
begin
  if coalesce((r ->> 'ok')::boolean, false) then
    return jsonb_build_object('ok', true, 'article', r -> 'card', 'code', r ->> 'code',
      'status', r ->> 'status', 'scheduled_at', r -> 'scheduled_at');
  end if;
  return r;
end;
$$;

/* ------------------------------------------------------------------ */
/* 4. one article, as the pages read it                               */
/* ------------------------------------------------------------------ */
create or replace function public.article_card(p_post uuid, p_viewer uuid)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select public.post_card(p_post, p_viewer) || jsonb_build_object(
    'article', jsonb_build_object(
      'meta', coalesce(p.article_meta, '{}'::jsonb),
      'words', coalesce(p.word_count, 0),
      'reading', greatest(1, ceil(coalesce(p.word_count, 0) / 200.0)::int),
      'host', (select jsonb_build_object(
                        'id', h.id,
                        'username', h.profile_username,
                        'name', coalesce(nullif(btrim(h.profile_name), ''), h.profile_username),
                        'avatar', h.avatar_url,
                        'followers', h.followers_count,
                        'posts', h.posts_count,
                        'country', h.country)
                 from public.profiles h where h.id = p.host_profile_id)
    )
  )
  from public.posts p
  where p.id = p_post;
$$;

/* ------------------------------------------------------------------ */
/* 5. the feed — rows, the fields that have articles, and the rails    */
/* ------------------------------------------------------------------ */
create or replace function public.article_feed(
  p_token  text,
  p_field  text,
  p_sort   text,
  p_search text,
  p_limit  int,
  p_offset int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me     public.members%rowtype := public.member_from_token(p_token);
  v_field  text := nullif(btrim(coalesce(p_field, '')), '');
  v_sort   text := lower(coalesce(nullif(btrim(p_sort), ''), 'popular'));
  v_search text := btrim(coalesce(p_search, ''));
  v_limit  int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows   jsonb;
  v_fields jsonb;
  v_rails  jsonb := '[]'::jsonb;
  v_total  int;
begin
  if v_sort not in ('popular', 'new', 'liked', 'discussed', 'long') then
    v_sort := 'popular';
  end if;

  with base as (
    select p.id from public.posts p
     where p.content_type = 'article' and p.status = 'published'
       and public.post_visible_to(p.id, v_me.id)
       and (v_search = '' or p.title ilike '%' || v_search || '%'
            or coalesce(p.description, '') ilike '%' || v_search || '%'
            or coalesce(p.body, '') ilike '%' || v_search || '%')
       and (v_field is null or exists (
              select 1 from public.post_keywords pk
                join public.keywords k on k.id = pk.keyword_id
               where pk.post_id = p.id and lower(k.keyword) = lower(v_field)))
  )
  select count(*) into v_total from base;

  with base as (
    select p.id, p.published_at, p.rank_points, p.likes, p.word_count,
           (p.comments_pos + p.comments_neg) as talk
      from public.posts p
     where p.content_type = 'article' and p.status = 'published'
       and public.post_visible_to(p.id, v_me.id)
       and (v_search = '' or p.title ilike '%' || v_search || '%'
            or coalesce(p.description, '') ilike '%' || v_search || '%'
            or coalesce(p.body, '') ilike '%' || v_search || '%')
       and (v_field is null or exists (
              select 1 from public.post_keywords pk
                join public.keywords k on k.id = pk.keyword_id
               where pk.post_id = p.id and lower(k.keyword) = lower(v_field)))
     order by (case when v_sort = 'new' then extract(epoch from p.published_at) else p.rank_points end) desc nulls last,
              (case when v_sort = 'liked' then p.likes
                    when v_sort = 'discussed' then p.comments_pos + p.comments_neg
                    when v_sort = 'long' then p.word_count
                    else extract(epoch from p.published_at) end) desc nulls last
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(public.article_card(b.id, v_me.id)), '[]'::jsonb)
    into v_rows from base b;

  select coalesce(jsonb_agg(jsonb_build_object('name', k.keyword, 'count', c.n)
                            order by c.n desc, k.keyword), '[]'::jsonb)
    into v_fields
    from (select pk.keyword_id, count(distinct pk.post_id) as n
            from public.post_keywords pk
            join public.posts p on p.id = pk.post_id
           where p.content_type = 'article' and p.status = 'published' and pk.role = 'main'
             and public.post_visible_to(p.id, v_me.id)
           group by pk.keyword_id
           order by count(distinct pk.post_id) desc
           limit 14) c
    join public.keywords k on k.id = c.keyword_id;

  /* no field, no search: the index is a shelf per field, as the mock draws it */
  if v_field is null and v_search = '' then
    select coalesce(jsonb_agg(jsonb_build_object('field', f.name, 'count', f.n, 'rows', f.rows)
                              order by f.n desc, f.name), '[]'::jsonb)
      into v_rails
      from (select k.keyword as name,
                   count(distinct p.id) as n,
                   (select coalesce(jsonb_agg(public.article_card(x.id, v_me.id) order by x.rank_points desc), '[]'::jsonb)
                      from (select p2.id, p2.rank_points
                              from public.posts p2
                              join public.post_keywords pk2 on pk2.post_id = p2.id
                              join public.keywords k2 on k2.id = pk2.keyword_id
                             where p2.content_type = 'article' and p2.status = 'published'
                               and pk2.role = 'main' and lower(k2.keyword) = lower(k.keyword)
                               and public.post_visible_to(p2.id, v_me.id)
                             order by p2.rank_points desc, p2.published_at desc
                             limit 8) x) as rows
              from public.posts p
              join public.post_keywords pk on pk.post_id = p.id
              join public.keywords k on k.id = pk.keyword_id
             where p.content_type = 'article' and p.status = 'published' and pk.role = 'main'
               and public.post_visible_to(p.id, v_me.id)
             group by k.keyword
             order by count(distinct p.id) desc
             limit 5) f;
  end if;

  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb),
    'fields', coalesce(v_fields, '[]'::jsonb), 'rails', coalesce(v_rails, '[]'::jsonb),
    'total', v_total, 'limit', v_limit, 'offset', v_offset,
    'can_write', v_me.id is not null);
end;
$$;

/* ------------------------------------------------------------------ */
/* 6. one article, with its neighbours — or its door                   */
/* ------------------------------------------------------------------ */
create or replace function public.article_get(p_token text, p_ref text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_me   public.members%rowtype := public.member_from_token(p_token);
  v_id   uuid := public.post_resolve(p_ref);
  v_post public.posts%rowtype;
  v_open boolean := false;
  v_key  boolean := false;
  v_mine boolean := false;
  v_asks boolean := false;
  v_card jsonb;
  v_rel  jsonb;
  v_more jsonb;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_post from public.posts where id = v_id and content_type = 'article';
  if v_post.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_asks := exists (select 1 from public.post_keys k where k.post_id = v_id);
  v_mine := v_me.id is not null and v_me.id in (v_post.author_profile_id, v_post.host_profile_id);
  v_open := public.post_visible_to(v_id, v_me.id);

  if not v_open and coalesce(btrim(p_key), '') <> '' then
    select exists (
      select 1 from public.post_keys k
       where k.post_id = v_id
         and extensions.crypt(btrim(p_key), k.password_hash) = k.password_hash
    ) into v_key;
    v_open := v_key;
  end if;

  if not v_open then
    return jsonb_build_object(
      'ok', true,
      'locked', true,
      'asks_password', v_asks,
      'audience', (select coalesce(jsonb_agg(jsonb_build_object(
                     'kind', r.kind, 'value', r.value, 'mode', r.mode)
                     order by r.kind, r.value), '[]'::jsonb)
                   from public.post_audience_rules r where r.post_id = v_id),
      'allowed', (select count(*) from public.post_authorized_profiles a where a.post_id = v_id),
      'followers_only', v_post.visibility = 'followers',
      'viewer', case when v_me.id is null
                     then jsonb_build_object('signed_in', false)
                     else jsonb_build_object(
                       'signed_in', true,
                       'username', v_me.username,
                       'level', public.viewer_attr(v_me.id, 'level'),
                       'wealth', public.viewer_attr(v_me.id, 'wealth'),
                       'country', public.viewer_attr(v_me.id, 'country'),
                       'language', public.viewer_attr(v_me.id, 'language'))
                     end,
      'article', jsonb_build_object(
        'id', v_post.id,
        'code', v_post.post_code,
        'title', v_post.title,
        'description', v_post.description,
        'thumbnail', v_post.thumbnail_url,
        'visibility', v_post.visibility,
        'status', v_post.status,
        'language', v_post.language,
        'published_at', v_post.published_at,
        'asks_password', v_asks,
        'host', (select jsonb_build_object('id', h.id,
                                           'username', h.profile_username,
                                           'name', coalesce(nullif(btrim(h.profile_name), ''), h.profile_username),
                                           'avatar', h.avatar_url)
                   from public.profiles h where h.id = v_post.host_profile_id)
      )
    );
  end if;

  /* one read, counted once per open — never the author's own */
  if not v_mine then
    update public.posts p set impressions = p.impressions + 1 where p.id = v_id;
  end if;

  v_card := public.article_card(v_id, v_me.id) || jsonb_build_object(
    'body', coalesce(v_post.body, ''));

  select coalesce(jsonb_agg(public.article_card(r.id, v_me.id) order by r.rank_points desc), '[]'::jsonb)
    into v_rel
    from (select p.id, p.rank_points
            from public.posts p
           where p.content_type = 'article' and p.status = 'published' and p.id <> v_id
             and public.post_visible_to(p.id, v_me.id)
             and exists (select 1 from public.post_keywords a
                           join public.post_keywords b on b.keyword_id = a.keyword_id
                          where a.post_id = v_id and b.post_id = p.id)
           order by p.rank_points desc
           limit 10) r;

  select coalesce(jsonb_agg(public.article_card(m.id, v_me.id) order by m.published_at desc), '[]'::jsonb)
    into v_more
    from (select p.id, p.published_at
            from public.posts p
           where p.content_type = 'article' and p.status = 'published' and p.id <> v_id
             and p.host_profile_id = v_post.host_profile_id
             and public.post_visible_to(p.id, v_me.id)
           order by p.published_at desc
           limit 6) m;

  return jsonb_build_object(
    'ok', true,
    'locked', false,
    'unlocked', v_key,
    'asks_password', v_asks,
    'mine', v_mine,
    'authorized', case when v_mine then (
      select coalesce(jsonb_agg(p.profile_username order by p.profile_username), '[]'::jsonb)
        from public.post_authorized_profiles a
        join public.profiles p on p.id = a.profile_id
       where a.post_id = v_id) else null end,
    'article', v_card,
    'related', coalesce(v_rel, '[]'::jsonb),
    'more', coalesce(v_more, '[]'::jsonb)
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 7. the member's own articles                                       */
/* ------------------------------------------------------------------ */
create or replace function public.article_mine(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me   public.members%rowtype := public.member_from_token(p_token);
  v_rows jsonb;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  select coalesce(jsonb_agg(public.article_card(p.id, v_me.id) order by
                            coalesce(p.published_at, p.created_at) desc), '[]'::jsonb)
    into v_rows
    from public.posts p
   where p.content_type = 'article'
     and (p.author_profile_id = v_me.id or p.host_profile_id = v_me.id)
     and p.status in ('draft', 'scheduled', 'published', 'pending');
  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

/* ------------------------------------------------------------------ */
/* 7b. agreeing with a comment                                        */
/* ------------------------------------------------------------------ */
/*
 * post_comment_vote(token, comment_id, agree)
 *
 * The reader's "agree" / "disagree" under somebody else's comment. One
 * vote per member per comment; a second press takes the first back.
 * → { ok, agree, disagree, mine }
 */
create or replace function public.post_comment_vote(p_token text, p_comment_id bigint, p_agree boolean)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_me   public.members%rowtype := public.member_from_token(p_token);
  v_loc  text;
  v_post uuid;
  v_want text;
  v_was  text;
  v_like int := 0;
  v_dis  int := 0;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if p_agree is null then
    return jsonb_build_object('ok', false, 'error', 'vote');
  end if;
  select c.location into v_loc from public.comment c
   where c.id = p_comment_id and c.status = 'visible';
  if v_loc is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  v_post := public.post_resolve(replace(v_loc, 'post:', ''));
  if v_post is null or not public.post_visible_to(v_post, v_me.id) then
    return jsonb_build_object('ok', false, 'error', 'hidden');
  end if;

  v_want := case when p_agree then 'agree' else 'disagree' end;
  select r.reaction into v_was from public.comment_reaction r
   where r.comment_id = p_comment_id and r.idmember = v_me.id limit 1;

  delete from public.comment_reaction r
   where r.comment_id = p_comment_id and r.idmember = v_me.id;
  if v_was is distinct from v_want then
    insert into public.comment_reaction (comment_id, idmember, reaction)
    values (p_comment_id, v_me.id, v_want);
  end if;

  select count(*) filter (where r.reaction = 'agree'),
         count(*) filter (where r.reaction = 'disagree')
    into v_like, v_dis
    from public.comment_reaction r where r.comment_id = p_comment_id;

  update public.comment c
     set agree_count = v_like, disagree_count = v_dis,
         like_count = v_like, dislike_count = v_dis
   where c.id = p_comment_id;

  return jsonb_build_object('ok', true, 'agree', v_like, 'disagree', v_dis,
    'mine', case when v_was is distinct from v_want then v_want else null end);
end;
$$;

/* ------------------------------------------------------------------ */
/* 8. the video reader, on the shared door table                      */
/* ------------------------------------------------------------------ */
create or replace function public.video_get(p_token text, p_ref text, p_key text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_me    public.members%rowtype := public.member_from_token(p_token);
  v_id    uuid := public.post_resolve(p_ref);
  v_post  public.posts%rowtype;
  v_open  boolean := false;
  v_key   boolean := false;
  v_mine  boolean := false;
  v_card  jsonb;
  v_rel   jsonb;
  v_more  jsonb;
  v_asks  boolean := false;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_post from public.posts where id = v_id and content_type = 'video';
  if v_post.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_asks := exists (select 1 from public.post_keys k where k.post_id = v_id);
  v_mine := v_me.id is not null and v_me.id in (v_post.author_profile_id, v_post.host_profile_id);
  v_open := public.post_visible_to(v_id, v_me.id);

  if not v_open and coalesce(btrim(p_key), '') <> '' then
    select exists (
      select 1 from public.post_keys k
       where k.post_id = v_id
         and extensions.crypt(btrim(p_key), k.password_hash) = k.password_hash
    ) into v_key;
    v_open := v_key;
  end if;

  if not v_open then
    return jsonb_build_object('ok', true, 'locked', true, 'asks_password', v_asks,
      'video', jsonb_build_object(
        'id', v_post.id, 'code', v_post.post_code, 'title', v_post.title,
        'thumbnail', v_post.thumbnail_url, 'visibility', v_post.visibility,
        'status', v_post.status, 'asks_password', v_asks,
        'host', (select jsonb_build_object('id', h.id,
                                           'username', h.profile_username,
                                           'name', coalesce(nullif(btrim(h.profile_name), ''), h.profile_username),
                                           'avatar', h.avatar_url)
                   from public.profiles h where h.id = v_post.host_profile_id)));
  end if;

  if not v_mine then
    update public.posts p set impressions = p.impressions + 1 where p.id = v_id;
  end if;

  v_card := public.video_card(v_id, v_me.id);

  select coalesce(jsonb_agg(public.video_card(r.id, v_me.id) order by r.rank_points desc), '[]'::jsonb)
    into v_rel
    from (select p.id, p.rank_points
            from public.posts p
           where p.content_type = 'video' and p.status = 'published' and p.id <> v_id
             and public.post_visible_to(p.id, v_me.id)
             and exists (select 1 from public.post_keywords a
                           join public.post_keywords b on b.keyword_id = a.keyword_id
                          where a.post_id = v_id and b.post_id = p.id)
           order by p.rank_points desc
           limit 10) r;

  select coalesce(jsonb_agg(public.video_card(m.id, v_me.id) order by m.published_at desc), '[]'::jsonb)
    into v_more
    from (select p.id, p.published_at
            from public.posts p
           where p.content_type = 'video' and p.status = 'published' and p.id <> v_id
             and p.host_profile_id = v_post.host_profile_id
             and public.post_visible_to(p.id, v_me.id)
           order by p.published_at desc
           limit 8) m;

  return jsonb_build_object('ok', true, 'locked', false, 'unlocked', v_key,
    'asks_password', v_asks, 'mine', v_mine, 'video', v_card,
    'related', coalesce(v_rel, '[]'::jsonb), 'more', coalesce(v_more, '[]'::jsonb));
end;
$$;

/* ------------------------------------------------------------------ */
/* 9. grants                                                          */
/* ------------------------------------------------------------------ */
grant execute on function public.post_words(text) to anon, authenticated, service_role;
grant execute on function public.member_post_save(text, jsonb, text) to anon, authenticated, service_role;
grant execute on function public.video_save(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.article_save(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.article_card(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.article_feed(text, text, text, text, int, int) to anon, authenticated, service_role;
grant execute on function public.article_get(text, text, text) to anon, authenticated, service_role;
grant execute on function public.article_mine(text) to anon, authenticated, service_role;
grant execute on function public.post_comment_vote(text, bigint, boolean) to anon, authenticated, service_role;
grant execute on function public.post_keyword(text, text, uuid) to anon, authenticated, service_role;
grant execute on function public.post_save_tags(uuid, text, uuid, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
