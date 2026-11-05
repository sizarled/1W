/* ==================================================================
   The videos page and the video editor
   ------------------------------------------------------------------
   A member's video is a row in `posts` with content_type = 'video'.
   That is the same table the profile feed, the reactions, the comments
   and the reports already work on, so nothing here invents a second
   content model — it only adds the three things a video page needs:

     1. video_meta   a jsonb column on `posts` for what a video knows
                     about itself: vertical, downloadable, the source
                     kind, its playlist and its age rating.
     2. video_card   post_card plus the video's own block.
     3. video_feed / video_get / video_save   the page's three calls.
        video_keys  the join passwords a private video may carry.

   Run order: after posts-core.sql and profile-core.sql (both applied).
   ================================================================== */

/* ------------------------------------------------------------------ */
/* 1. what a video knows about itself                                  */
/* ------------------------------------------------------------------ */
alter table public.posts
  add column if not exists video_meta jsonb not null default '{}'::jsonb;

create index if not exists posts_video_idx
  on public.posts (published_at desc)
  where content_type = 'video' and status = 'published';

/* ------------------------------------------------------------------ */
/* 2. a private video's join passwords                                */
/* ------------------------------------------------------------------ */
create table if not exists public.video_keys (
  id            bigserial primary key,
  post_id       uuid not null references public.posts (id) on delete cascade,
  password_hash text not null,
  created_at    timestamptz not null default now()
);

create index if not exists video_keys_post_idx on public.video_keys (post_id);

alter table public.video_keys enable row level security;

/* nobody reads the hashes; only the function below compares them */
drop policy if exists video_keys_none on public.video_keys;

/* ------------------------------------------------------------------ */
/* 3. one video, as the pages read it                                 */
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
                 from public.profiles h where h.id = p.host_profile_id)
    )
  )
  from public.posts p
  where p.id = p_post;
$$;

/* ------------------------------------------------------------------ */
/* 4. the feed                                                        */
/* ------------------------------------------------------------------ */
/*
 * video_feed(token, field, sort, search, limit, offset)
 *
 *   field   a main keyword — empty means every field
 *   sort    popular | new | liked | discussed
 *   search  the title or the description
 *
 * → { ok, rows[], fields[{name,count}], total, limit, offset, can_publish }
 */
create or replace function public.video_feed(
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
  v_total  int;
begin
  if v_sort not in ('popular', 'new', 'liked', 'discussed') then
    v_sort := 'popular';
  end if;

  with base as (
    select p.id,
           p.published_at,
           p.rank_points,
           p.likes,
           (p.comments_pos + p.comments_neg) as talk
      from public.posts p
     where p.content_type = 'video'
       and p.status = 'published'
       and public.post_visible_to(p.id, v_me.id)
       and (v_search = ''
            or p.title ilike '%' || v_search || '%'
            or coalesce(p.description, '') ilike '%' || v_search || '%')
       and (v_field is null or exists (
              select 1 from public.post_keywords pk
                join public.keywords k on k.id = pk.keyword_id
               where pk.post_id = p.id and lower(k.keyword) = lower(v_field)))
  )
  select count(*) into v_total from base;

  with base as (
    select p.id, p.published_at, p.rank_points, p.likes,
           (p.comments_pos + p.comments_neg) as talk
      from public.posts p
     where p.content_type = 'video'
       and p.status = 'published'
       and public.post_visible_to(p.id, v_me.id)
       and (v_search = ''
            or p.title ilike '%' || v_search || '%'
            or coalesce(p.description, '') ilike '%' || v_search || '%')
       and (v_field is null or exists (
              select 1 from public.post_keywords pk
                join public.keywords k on k.id = pk.keyword_id
               where pk.post_id = p.id and lower(k.keyword) = lower(v_field)))
     order by (case when v_sort = 'new' then extract(epoch from p.published_at) else p.rank_points end) desc nulls last,
              (case when v_sort = 'liked' then p.likes
                    when v_sort = 'discussed' then p.comments_pos + p.comments_neg
                    else extract(epoch from p.published_at) end) desc nulls last
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(public.video_card(b.id, v_me.id)), '[]'::jsonb)
    into v_rows
    from base b;

  select coalesce(jsonb_agg(jsonb_build_object('name', k.keyword, 'count', c.n)
                            order by c.n desc, k.keyword), '[]'::jsonb)
    into v_fields
    from (select pk.keyword_id, count(distinct pk.post_id) as n
            from public.post_keywords pk
            join public.posts p on p.id = pk.post_id
           where p.content_type = 'video'
             and p.status = 'published'
             and pk.role = 'main'
             and public.post_visible_to(p.id, v_me.id)
           group by pk.keyword_id
           order by count(distinct pk.post_id) desc
           limit 14) c
    join public.keywords k on k.id = c.keyword_id;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'fields', coalesce(v_fields, '[]'::jsonb),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset,
    'can_publish', v_me.id is not null
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 5. one video, with its neighbours                                  */
/* ------------------------------------------------------------------ */
/*
 * video_get(token, ref, key)
 *
 *   ref   the code (PST-…) or the uuid
 *   key   a join password, when the video is private and none was asked
 *
 * → { ok, locked, unlocked, asks_password, mine, video, related[], more[] }
 */
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

  /* the editor asks this before it shows its "adding one replaces them all" note */
  v_asks := exists (select 1 from public.video_keys k where k.post_id = v_id);

  v_mine := v_me.id is not null and v_me.id in (v_post.author_profile_id, v_post.host_profile_id);
  v_open := public.post_visible_to(v_id, v_me.id);

  if not v_open and coalesce(btrim(p_key), '') <> '' then
    select exists (
      select 1 from public.video_keys k
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
      'video', jsonb_build_object(
        'id', v_post.id,
        'code', v_post.post_code,
        'title', v_post.title,
        'thumbnail', v_post.thumbnail_url,
        'visibility', v_post.visibility,
        'status', v_post.status,
        'asks_password', v_asks,
        'host', (select jsonb_build_object('id', h.id,
                                           'username', h.profile_username,
                                           'name', coalesce(nullif(btrim(h.profile_name), ''), h.profile_username),
                                           'avatar', h.avatar_url)
                   from public.profiles h where h.id = v_post.host_profile_id)
      )
    );
  end if;

  /* one view, counted once per read — never the publisher's own */
  if not v_mine then
    update public.posts p set impressions = p.impressions + 1 where p.id = v_id;
  end if;

  v_card := public.video_card(v_id, v_me.id);

  select coalesce(jsonb_agg(public.video_card(r.id, v_me.id) order by r.rank_points desc), '[]'::jsonb)
    into v_rel
    from (select p.id, p.rank_points
            from public.posts p
           where p.content_type = 'video'
             and p.status = 'published'
             and p.id <> v_id
             and public.post_visible_to(p.id, v_me.id)
             and exists (
               select 1 from public.post_keywords a
                 join public.post_keywords b on b.keyword_id = a.keyword_id
                where a.post_id = v_id and b.post_id = p.id)
           order by p.rank_points desc
           limit 10) r;

  select coalesce(jsonb_agg(public.video_card(m.id, v_me.id) order by m.published_at desc), '[]'::jsonb)
    into v_more
    from (select p.id, p.published_at
            from public.posts p
           where p.content_type = 'video'
             and p.status = 'published'
             and p.id <> v_id
             and p.host_profile_id = v_post.host_profile_id
             and public.post_visible_to(p.id, v_me.id)
           order by p.published_at desc
           limit 8) m;

  return jsonb_build_object(
    'ok', true,
    'locked', false,
    'unlocked', v_key,
    'asks_password', v_asks,
    'mine', v_mine,
    'video', v_card,
    'related', coalesce(v_rel, '[]'::jsonb),
    'more', coalesce(v_more, '[]'::jsonb)
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 5b. a keyword, once — the site's main keywords are unique          */
/* ------------------------------------------------------------------ */
create or replace function public.video_keyword(p_keyword text, p_language text, p_member uuid)
returns uuid
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id uuid;
begin
  select k.id into v_id from public.keywords k
   where k.parent_id is null and lower(k.keyword) = lower(btrim(p_keyword)) limit 1;
  if v_id is not null then
    return v_id;
  end if;
  begin
    insert into public.keywords (keyword, language, created_by)
    values (btrim(p_keyword), coalesce(p_language, 'en'), p_member)
    returning id into v_id;
  exception when unique_violation then
    select k.id into v_id from public.keywords k
     where k.parent_id is null and lower(k.keyword) = lower(btrim(p_keyword)) limit 1;
  end;
  return v_id;
end;
$$;

/* the tags of one video: at most twelve main keywords */
create or replace function public.video_save_tags(p_post uuid, p_language text, p_member uuid, p_tags jsonb)
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
    v_id := public.video_keyword(v_kw, p_language, p_member);
    if v_id is not null then
      insert into public.post_keywords (post_id, keyword_id, role)
      values (p_post, v_id, 'main') on conflict (post_id, keyword_id) do nothing;
      v_n := v_n + 1;
    end if;
  end loop;
  return v_n;
end;
$$;

/* ------------------------------------------------------------------ */
/* 6. saving — the editor's one call                                  */
/* ------------------------------------------------------------------ */
/*
 * video_save(token, payload)
 *
 *   payload = {
 *     id            uuid or code, when an existing video is edited
 *     title, description, thumbnail, embed, language,
 *     visibility    general | limited | private | followers
 *     status        draft | published | scheduled
 *     scheduled_at  ISO time, for a scheduled publish
 *     tags          ["film", "review"]
 *     audience      [{ kind: country|language|level|wealth, value, mode }]
 *     profiles      ["@handle", …]    who may watch a private one
 *     passwords     ["…", …]          the join passwords
 *     meta          { vertical, download, source, playlist, age }
 *   }
 *
 * → { ok, video, code, status }
 * errors: session | title | title_long | visibility | status | schedule |
 *         embed | profile | passwords | not_found | role
 */
create or replace function public.video_save(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_me      public.members%rowtype := public.member_from_token(p_token);
  v_data    jsonb := case when jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object'
                          then coalesce(p_payload, '{}'::jsonb) else '{}'::jsonb end;
  v_id      uuid := public.post_resolve(nullif(btrim(coalesce(v_data ->> 'id', '')), ''));
  v_post    public.posts%rowtype;
  v_title   text := btrim(coalesce(v_data ->> 'title', ''));
  v_desc    text := nullif(btrim(coalesce(v_data ->> 'description', '')), '');
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

  if char_length(v_title) < 1 then
    return jsonb_build_object('ok', false, 'error', 'title');
  end if;
  if char_length(v_title) > 200 then
    return jsonb_build_object('ok', false, 'error', 'title_long');
  end if;
  if v_vis not in ('general', 'limited', 'private', 'followers') then
    return jsonb_build_object('ok', false, 'error', 'visibility');
  end if;
  if v_status not in ('draft', 'published', 'scheduled') then
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

  v_words := coalesce(array_length(
    regexp_split_to_array(btrim(coalesce(v_desc, '')), '\s+'), 1), 0);

  v_host := public.profile_resolve(v_me.id::text);
  if v_host is null then
    return jsonb_build_object('ok', false, 'error', 'profile');
  end if;

  if v_id is null then
    insert into public.posts (
      author_profile_id, host_profile_id, content_type, title, description,
      thumbnail_url, embed_url, language, translation_status, visibility,
      status, scheduled_at, published_at, word_count, video_meta
    ) values (
      v_me.id, v_host, 'video', left(v_title, 200), v_desc,
      v_thumb, v_embed, left(v_lang, 8), 'none', v_vis,
      v_status, v_when,
      case when v_status = 'published' then now() else null end,
      v_words, v_meta
    )
    returning * into v_post;
  else
    select * into v_post from public.posts where id = v_id;
    if v_post.id is null or v_post.content_type <> 'video' then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if v_me.id not in (v_post.author_profile_id, v_post.host_profile_id) then
      return jsonb_build_object('ok', false, 'error', 'role');
    end if;

    update public.posts p
       set title         = left(v_title, 200),
           description   = v_desc,
           thumbnail_url = v_thumb,
           embed_url     = v_embed,
           language      = left(v_lang, 8),
           visibility    = v_vis,
           status        = v_status,
           scheduled_at  = v_when,
           published_at  = case when v_status = 'published'
                                then coalesce(p.published_at, now())
                                else p.published_at end,
           word_count    = v_words,
           video_meta    = v_meta,
           updated_at    = now()
     where p.id = v_post.id
    returning * into v_post;

    /* a key we were not given is a list we leave alone: a partial save
       must never wipe the audience, the invited people, the door's
       passwords or the tags of the video it is editing. */
    if v_data ? 'audience' then
      delete from public.post_audience_rules where post_id = v_post.id;
    end if;
    if v_data ? 'profiles' then
      delete from public.post_authorized_profiles where post_id = v_post.id;
    end if;
    if v_data ? 'passwords' then
      delete from public.video_keys where post_id = v_post.id;
    end if;
    if v_data ? 'tags' then
      delete from public.post_keywords where post_id = v_post.id;
    end if;
  end if;

  /* the tags — main keywords, shared with the rest of the site */
  v_tags := public.video_save_tags(v_post.id, v_post.language, v_me.id, v_data -> 'tags');

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

  /* who may watch a private one */
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
      insert into public.video_keys (post_id, password_hash)
      values (v_post.id, v_hash);
    end loop;
  end if;

  perform public.member_log_write(v_me.id, null, 'video_saved',
    jsonb_build_object('post', v_post.id, 'status', v_post.status,
                       'visibility', v_post.visibility, 'tags', v_tags), null, null);

  return jsonb_build_object(
    'ok', true,
    'video', public.video_card(v_post.id, v_me.id),
    'code', v_post.post_code,
    'status', v_post.status,
    'scheduled_at', v_post.scheduled_at
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 7. my videos, for the editor's own list                            */
/* ------------------------------------------------------------------ */
create or replace function public.video_mine(p_token text)
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

  select coalesce(jsonb_agg(public.video_card(p.id, v_me.id) order by
                            coalesce(p.published_at, p.created_at) desc), '[]'::jsonb)
    into v_rows
    from public.posts p
   where p.content_type = 'video'
     and (p.author_profile_id = v_me.id or p.host_profile_id = v_me.id)
     and p.status in ('draft', 'scheduled', 'published', 'pending');

  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$$;

/* ------------------------------------------------------------------ */
/* 8. grants                                                          */
/* ------------------------------------------------------------------ */
revoke all on function public.video_card(uuid, uuid) from public;
revoke all on function public.video_feed(text, text, text, text, int, int) from public;
revoke all on function public.video_get(text, text, text) from public;
revoke all on function public.video_save(text, jsonb) from public;
revoke all on function public.video_mine(text) from public;

grant execute on function public.video_card(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.video_feed(text, text, text, text, int, int) to anon, authenticated, service_role;
grant execute on function public.video_get(text, text, text) to anon, authenticated, service_role;
grant execute on function public.video_save(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.video_mine(text) to anon, authenticated, service_role;
grant execute on function public.video_keyword(text, text, uuid) to anon, authenticated, service_role;
grant execute on function public.video_save_tags(uuid, text, uuid, jsonb) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
