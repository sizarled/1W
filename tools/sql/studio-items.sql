/* ==================================================================
   A studio reads its members' posts, not only its own shelf
   ------------------------------------------------------------------
   `creator_hub_view` drew a hub's items from `member_content` alone, while
   every video a member publishes is written to `posts` — so a studio could
   count a video (the counters come from `creator_hub_posts`, which reads
   `posts`) and still say "Nothing published yet": the number was one, the
   shelf was empty.

   The owner's own table (`creator_items`) had already learned to read both
   tables. This is the same union on the public side: the studio's own shelf
   first, then the rows that name it in `posts.hub_id`, in the same shape and
   with the same visibility mapping the table uses.

     general   → public
     limited   → exclusive
     followers → exclusive
     private   → private

   A visitor sees what the feed would show them (public and general); the
   owner and the studio's approved publishers see everything that is not
   deleted. `shape` is carried the way the feed carries it, so a vertical
   video lands in the portrait rail and not in the grid.

   Applied: 2026-11-10. Test: `node tools/studio-smoke.mjs`.
   ================================================================== */

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
  v_vip    := v_member.id is not null and coalesce(v_member.member_id, '') = any(v_hub.vip);
  v_pub    := v_member.id is not null and coalesce(v_member.member_id, '') = any(v_hub.publishers);
  v_adv    := v_member.id is not null and coalesce(v_member.member_id, '') = any(v_hub.advertisers);
  v_excl   := v_member.id is not null and coalesce(v_member.member_id, '') = any(v_hub.excluded);
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
        'links', v_hub.links,
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
        'can_subscribe', coalesce(v_hub.auto_accept, true) and v_hub.owner <> coalesce(v_member.id, v_hub.owner),
        'reason', case when v_excl then 'excluded'
                       when v_hub.visibility = 'private' then 'password'
                       when v_hub.visibility = 'exclusive' then 'audience'
                       else 'closed' end
      )
    );
  end if;

  /* the shelf: what the studio wrote itself, then what was published into it.
     One aggregate over the two tables, newest first, one shape. */
  select coalesce(jsonb_agg(s.row_json order by s.published_at desc nulls last), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id',          c.id,
               'code',        upper(left(replace(c.id::text, '-', ''), 8)),
               'kind',        c.kind,
               'title',       c.title,
               'summary',     c.summary,
               'thumbnail',   c.thumbnail_url,
               'media_url',   c.media_url,
               'cover_url',   c.cover_url,
               'meta',        c.meta,
               'shape',       case when lower(coalesce(c.meta ->> 'shape', c.meta ->> 'orientation', ''))
                                     in ('v', 'vertical', 'portrait', '9:16', 'reel', 'short')
                                   then 'v' else 'h' end,
               'visibility',  c.visibility,
               'excluded',    c.excluded,
               'audience',    c.audience,
               'seats',       c.seats,
               'cap',         case when c.seats is null
                                   then least(coalesce(public.creator_viewer_limit(v_hub.kind, coalesce(v_level, 1), c.kind), 2147483647),
                                              coalesce(v_hub.max_viewers, 2147483647))
                                   else least(c.seats,
                                              coalesce(public.creator_viewer_limit(v_hub.kind, coalesce(v_level, 1), c.kind), 2147483647),
                                              coalesce(v_hub.max_viewers, 2147483647)) end,
               'minutes',     coalesce(nullif(c.view_minutes, 0), c.minutes),
               'likes',       c.likes,
               'comments',    c.comments_count,
               'published_at', c.published_at
             ) as row_json,
             c.published_at
        from public.member_content c
       where c.hub = v_hub.id
         and c.status = 'published'
         and public.creator_item_open_to(c, v_member, v_manage or v_vip or v_pw, v_sub)

      union all

      select jsonb_build_object(
               'id',          p.id,
               'code',        p.post_code,
               'kind',        case p.content_type when 'video' then 'video' else p.content_type end,
               'title',       p.title,
               'summary',     coalesce(p.description, ''),
               'thumbnail',   p.thumbnail_url,
               'media_url',   p.embed_url,
               'cover_url',   p.thumbnail_url,
               'meta',        coalesce(p.video_meta, p.article_meta, '{}'::jsonb),
               'shape',       case when lower(coalesce(p.video_meta ->> 'vertical', 'false'))
                                     in ('true', 't', '1', 'yes', 'on')
                                   then 'v' else 'h' end,
               'visibility',  case p.visibility
                                when 'general'   then 'public'
                                when 'limited'   then 'exclusive'
                                when 'followers' then 'exclusive'
                                when 'private'   then 'private'
                                else 'public'
                              end,
               'excluded',    '{}'::text[],
               'audience',    coalesce(p.video_meta -> 'audience', '{}'::jsonb),
               'seats',       null,
               'cap',         null,
               'minutes',     nullif(round(coalesce(p.watch_minutes, 0) / 60.0), 0),
               'likes',       coalesce(p.likes, 0),
               'comments',    coalesce(p.comments_pos, 0) + coalesce(p.comments_neg, 0),
               'published_at', p.published_at
             ) as row_json,
             p.published_at
        from public.posts p
       where p.hub_id = v_hub.id
         and p.status = 'published'
         and p.deleted_at is null
         and p.content_type in ('video', 'article', 'question')
         and (v_manage or v_pub or p.visibility in ('general', 'public'))
    ) s;

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
      'can_subscribe', coalesce(v_hub.auto_accept, true)
                       and v_hub.owner <> coalesce(v_member.id, v_hub.owner),
      'can', jsonb_build_object('publish', v_pub or v_manage, 'advertise', v_adv or v_manage),
      'request', v_req,
      'ads', v_ads
    ),
    'items', v_rows
  );
end;
$$;

revoke all on function public.creator_hub_view(text, text, text) from public;
grant execute on function public.creator_hub_view(text, text, text) to anon, authenticated, service_role;
