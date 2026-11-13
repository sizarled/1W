/* ------------------------------------------------------------------ */
/* vertical.html — the vertical (9:16) video feed                      */
/* ------------------------------------------------------------------ */
/*
 * A vertical video is a video whose publisher ticked "vertical": the row is
 * `posts.content_type = 'video'` with `video_meta->>'vertical'` true, and its
 * code carries the `VSR-` prefix (see video-codes.sql). Nothing new is stored
 * here — this file only adds the one call the page needs to ask for *those*
 * videos, so the 9:16 feed never has to wade through the landscape one.
 *
 * The rules are the ones the videos page already lives by: published, visible
 * to this viewer (`post_visible_to`), and within the studio's reach for the
 * day (`reach_visible`) — with the surface named, so a search inside the
 * vertical feed counts as a search.
 *
 *   video_vertical_feed(token, sort, search, limit, offset)
 *     sort   new | popular | liked      (anything else is `new`)
 *     search the title or the description
 *   → { ok, rows[], total, limit, offset }
 *
 * The rows are `video_card` rows, exactly like the videos page: same code,
 * same counters, same `video.meta`, same publisher — so the page can hand a
 * card to the same viewer, the same reaction calls and the same comments.
 */
create or replace function public.video_vertical_feed(
  p_token  text,
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
  v_sort   text := lower(coalesce(nullif(btrim(p_sort), ''), 'new'));
  v_search text := btrim(coalesce(p_search, ''));
  v_limit  int := least(greatest(coalesce(p_limit, 24), 1), 60);
  v_offset int := greatest(coalesce(p_offset, 0), 0);
  v_rows   jsonb;
  v_total  int;
begin
  if v_sort not in ('new', 'popular', 'liked') then
    v_sort := 'new';
  end if;

  with base as (
    select p.id,
           p.published_at,
           p.rank_points,
           p.likes
      from public.posts p
     where p.content_type = 'video'
       and p.status = 'published'
       and p.deleted_at is null
       and lower(coalesce(p.video_meta ->> 'vertical', 'false')) in ('true', 't', '1', 'yes', 'on')
       and public.post_visible_to(p.id, v_me.id)
       and (v_search = ''
            or p.title ilike '%' || v_search || '%'
            or coalesce(p.description, '') ilike '%' || v_search || '%')
       /* reach gates the page, rank orders it — the same two rules the videos
          page obeys, so the vertical shelf cannot outrun a studio's day */
       and public.reach_visible(p.id, v_me.id, case when v_search <> '' then 'search' else 'suggestion' end)
  )
  select count(*) into v_total from base;

  with base as (
    select p.id,
           p.published_at,
           p.rank_points,
           p.likes
      from public.posts p
     where p.content_type = 'video'
       and p.status = 'published'
       and p.deleted_at is null
       and lower(coalesce(p.video_meta ->> 'vertical', 'false')) in ('true', 't', '1', 'yes', 'on')
       and public.post_visible_to(p.id, v_me.id)
       and (v_search = ''
            or p.title ilike '%' || v_search || '%'
            or coalesce(p.description, '') ilike '%' || v_search || '%')
       and public.reach_visible(p.id, v_me.id, case when v_search <> '' then 'search' else 'suggestion' end)
  ),
  picked as (
    select b.id,
           row_number() over (
             order by case when v_sort = 'popular' then b.rank_points end desc nulls last,
                      case when v_sort = 'liked' then b.likes end desc nulls last,
                      b.published_at desc nulls last
           ) as ord
      from base b
  )
  select coalesce(jsonb_agg(public.video_card(p.id, v_me.id) order by p.ord), '[]'::jsonb)
    into v_rows
    from (select id, ord from picked order by ord limit v_limit offset v_offset) p;

  return jsonb_build_object(
    'ok', true,
    'rows', coalesce(v_rows, '[]'::jsonb),
    'total', v_total,
    'limit', v_limit,
    'offset', v_offset
  );
end;
$$;

revoke all on function public.video_vertical_feed(text, text, text, int, int) from public;
grant execute on function public.video_vertical_feed(text, text, text, int, int) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
