-- blog-page.sql — a blog's own reading page
-- ------------------------------------------------------------------
-- The studio's blog section writes articles; articles.html lists every article
-- on the platform. What was missing is the blog itself as a reader meets it:
-- one cover, one logo, one name, its sections, its most-read, and one row per
-- section — `blog.html?studio=<code>`.
--
-- The blog is a hub of kind 'blog'. Its articles are `posts` with
-- `content_type = 'article'` and `hub_id` pointing at it. Its sections are its
-- `creator_categories` when it has any, and the articles' own `field` when it
-- has none — the same fallback the studio's tree implies, so a blog that never
-- made a category still reads as a set of sections.
--
--   blog_page(token, ref, password)          the cover, the name, the sections
--   blog_feed(token, ref, section, by, ...)   the articles of one section
--
-- The door is the hub's own door: `creator_hub_view` decides whether the visitor
-- may walk in, and every card is filtered by `post_visible_to` on top of it, so
-- an exclusive piece still keeps its audience inside a public blog.
--
-- APPLIED on the live project.

/* 1. blog_page — the blog as a reader meets it ------------------------ */
create or replace function public.blog_page(p_token text, p_ref text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_me       public.members%rowtype := public.member_from_token(p_token);
  v_view     jsonb;
  v_hub      jsonb;
  v_hub_id   uuid;
  v_hub_row  public.creator_hubs%rowtype;
  v_locked   boolean := false;
  v_sections jsonb;
  v_stats    jsonb;
  v_cats     int := 0;
begin
  if coalesce(btrim(p_ref), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  /* the hub's own door: owner, staff, VIP, password, exclusivity — one place */
  v_view := public.creator_hub_view(p_token, p_ref, p_password);
  if not coalesce((v_view ->> 'ok')::boolean, false) then
    return v_view;
  end if;
  v_hub := v_view -> 'hub';
  if coalesce(v_hub ->> 'kind', '') <> 'blog' then
    return jsonb_build_object('ok', false, 'error', 'hub_kind', 'kind', v_hub ->> 'kind', 'hub', v_hub);
  end if;

  v_hub_id := (v_hub ->> 'id')::uuid;
  select * into v_hub_row from public.creator_hubs h where h.id = v_hub_id;
  v_locked := coalesce((v_view ->> 'locked')::boolean, false);

  v_hub := v_hub || jsonb_build_object(
    'has_password', coalesce(v_hub_row.password_hash, '') <> '',
    'password_until', v_hub_row.password_until
  );

  /* a locked blog tells the visitor nothing but its name and its door */
  if v_locked then
    return jsonb_build_object(
      'ok', true, 'locked', true,
      'has_password', coalesce(v_hub_row.password_hash, '') <> '',
      'password_until', v_hub_row.password_until,
      'hub', v_hub, 'sections', '[]'::jsonb,
      'stats', jsonb_build_object('articles', 0, 'writers', 0, 'reads', 0, 'comments', 0)
    );
  end if;

  /* the sections: the blog's categories when its articles carry them, its
     fields when not — a blog that made categories and never used them still
     reads as a set of shelves rather than one empty one */
  select count(*) into v_cats from public.creator_categories c where c.hub = v_hub_id;

  if v_cats > 0 then
    select coalesce(jsonb_agg(jsonb_build_object('name', s.name, 'by', 'category', 'count', s.n)
                              order by s.n desc, s.name), '[]'::jsonb)
      into v_sections
      from (
        select c.name,
               (select count(*)
                  from public.posts p
                 where p.hub_id = v_hub_id
                   and p.content_type = 'article' and p.status = 'published'
                   and lower(btrim(coalesce(p.article_meta ->> 'category', ''))) = lower(c.name)
                   and public.post_visible_to(p.id, v_me.id)) as n
          from public.creator_categories c
         where c.hub = v_hub_id
      ) s;
    if coalesce((select sum((e ->> 'count')::int) from jsonb_array_elements(v_sections) e), 0) = 0 then
      v_cats := 0;
    end if;
  end if;

  if v_cats = 0 then
    select coalesce(jsonb_agg(jsonb_build_object('name', f.field, 'by', 'field', 'count', f.n)
                              order by f.n desc, f.field), '[]'::jsonb)
      into v_sections
      from (
        select nullif(btrim(p.article_meta ->> 'field'), '') as field, count(*) as n
          from public.posts p
         where p.hub_id = v_hub_id
           and p.content_type = 'article' and p.status = 'published'
           and nullif(btrim(p.article_meta ->> 'field'), '') is not null
           and public.post_visible_to(p.id, v_me.id)
         group by 1
      ) f;
  end if;

  /* what the cover says under the name */
  select jsonb_build_object(
           'articles', count(*),
           'writers', count(distinct p.author_profile_id),
           'reads', coalesce(sum(p.impressions), 0),
           'comments', coalesce(sum(p.comments_pos + p.comments_neg), 0),
           'words', coalesce(sum(p.word_count), 0))
    into v_stats
    from public.posts p
   where p.hub_id = v_hub_id
     and p.content_type = 'article' and p.status = 'published'
     and public.post_visible_to(p.id, v_me.id);

  return jsonb_build_object(
    'ok', true,
    'locked', false,
    'hub', v_hub,
    'sections', coalesce(v_sections, '[]'::jsonb),
    'stats', coalesce(v_stats, jsonb_build_object('articles', 0, 'writers', 0, 'reads', 0, 'comments', 0, 'words', 0)),
    'signed_in', v_me.id is not null
  );
end $function$;

/* 2. blog_feed — one section of the blog, or all of it ---------------- */
create or replace function public.blog_feed(
  p_token text, p_ref text, p_section text, p_by text, p_search text,
  p_sort text, p_limit int, p_offset int)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_me      public.members%rowtype := public.member_from_token(p_token);
  v_hub     public.creator_hubs%rowtype;
  v_section text := nullif(btrim(coalesce(p_section, '')), '');
  v_by      text := case when lower(coalesce(p_by, '')) = 'field' then 'field' else 'category' end;
  v_search  text := btrim(coalesce(p_search, ''));
  v_sort    text := lower(coalesce(nullif(btrim(p_sort), ''), 'popular'));
  v_limit   int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset  int := greatest(coalesce(p_offset, 0), 0);
  v_rows    jsonb;
  v_total   int;
begin
  select * into v_hub
    from public.creator_hubs h
   where upper(h.code) = upper(btrim(coalesce(p_ref, '')))
      or h.id::text = lower(btrim(coalesce(p_ref, '')))
   limit 1;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_hub.kind <> 'blog' then
    return jsonb_build_object('ok', false, 'error', 'hub_kind');
  end if;
  if v_sort not in ('popular', 'new', 'liked', 'discussed', 'long') then
    v_sort := 'popular';
  end if;

  with base as (
    select p.id
      from public.posts p
     where p.hub_id = v_hub.id
       and p.content_type = 'article' and p.status = 'published'
       and public.post_visible_to(p.id, v_me.id)
       and (
         v_section is null
         or lower(btrim(coalesce(case when v_by = 'field'
                                      then p.article_meta ->> 'field'
                                      else p.article_meta ->> 'category' end, ''))) = lower(v_section)
       )
       and (
         v_search = ''
         or p.title ilike '%' || v_search || '%'
         or coalesce(p.description, '') ilike '%' || v_search || '%'
         or coalesce(p.body, '') ilike '%' || v_search || '%'
       )
  )
  select count(*) into v_total from base;

  with base as (
    select p.id, p.published_at, p.rank_points, p.likes, p.word_count,
           p.comments_pos + p.comments_neg as talk
      from public.posts p
     where p.hub_id = v_hub.id
       and p.content_type = 'article' and p.status = 'published'
       and public.post_visible_to(p.id, v_me.id)
       and (
         v_section is null
         or lower(btrim(coalesce(case when v_by = 'field'
                                      then p.article_meta ->> 'field'
                                      else p.article_meta ->> 'category' end, ''))) = lower(v_section)
       )
       and (
         v_search = ''
         or p.title ilike '%' || v_search || '%'
         or coalesce(p.description, '') ilike '%' || v_search || '%'
         or coalesce(p.body, '') ilike '%' || v_search || '%'
       )
     order by (case when v_sort = 'new' then extract(epoch from p.published_at) else p.rank_points end) desc nulls last,
              (case when v_sort = 'liked' then p.likes
                    when v_sort = 'discussed' then p.talk
                    when v_sort = 'long' then p.word_count
                    else extract(epoch from p.published_at) end) desc nulls last
     limit v_limit offset v_offset
  )
  select coalesce(jsonb_agg(public.article_card(b.id, v_me.id)), '[]'::jsonb)
    into v_rows from base b;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'total', v_total,
    'section', v_section,
    'by', v_by,
    'limit', v_limit,
    'offset', v_offset,
    'hub', jsonb_build_object('code', v_hub.code, 'name', v_hub.name)
  );
end $function$;

/* 3. who may call them ------------------------------------------------- */
do $do$
begin
  execute 'revoke all on function public.blog_page(text, text, text) from public';
  execute 'grant execute on function public.blog_page(text, text, text) to anon, authenticated';
  execute 'revoke all on function public.blog_feed(text, text, text, text, text, text, int, int) from public';
  execute 'grant execute on function public.blog_feed(text, text, text, text, text, text, int, int) to anon, authenticated';
end $do$;
