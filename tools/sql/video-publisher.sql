/**
 * 1World — who publishes a video.
 * ------------------------------------------------------------------
 * `video-studio.sql` put a video into a studio (`posts.hub_id`) and
 * taught `video_card` to carry that studio. The watch screen does not
 * read `video_card` — it reads `video_get` — so the studio never reached
 * the page, and the publisher line named the member's profile instead.
 *
 * This file gives the watch screen one small call for it:
 *
 *   video_hub(ref)  ref = the post's code (PST-001032) or its uuid
 *     → { ok:true, hub:{ id, code, kind, name, logo_url, cover_url,
 *                        visibility, creator } }
 *     → { ok:true, hub:null }     the video went into no studio
 *     → { ok:false, error:'not_found' }
 *
 * `creator` is the studio owner's member code (ID100019) — the second
 * half of `creator.html?studio=<code>&creator=<id>`, so the page the
 * studio name links to is the studio with its creator, not a bare name.
 *
 * Nothing is exposed that the hub page would hide: only the studio's
 * public face (name, mark, kind, code, visibility) is returned, never
 * its staff list, its password or its VIPs.
 */

create or replace function public.video_hub(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_id   uuid := public.post_resolve(p_ref);
  v_post public.posts%rowtype;
  v_hub  public.creator_hubs%rowtype;
begin
  if v_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_post from public.posts where id = v_id;
  if v_post.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_post.hub_id is null then
    return jsonb_build_object('ok', true, 'hub', null);
  end if;

  select * into v_hub from public.creator_hubs where id = v_post.hub_id;
  if v_hub.id is null then
    return jsonb_build_object('ok', true, 'hub', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'hub', jsonb_build_object(
      'id',         v_hub.id,
      'code',       v_hub.code,
      'kind',       v_hub.kind,
      'name',       v_hub.name,
      'logo_url',   v_hub.logo_url,
      'cover_url',  v_hub.cover_url,
      'visibility', v_hub.visibility,
      'description', v_hub.description,
      'field',      v_hub.field,
      'links',      coalesce(v_hub.links, '[]'::jsonb),
      'subscribers', (select count(*) from public.creator_subscriptions s where s.hub = v_hub.id),
      'published',  (select count(*) from public.member_content c
                      where c.hub = v_hub.id and c.status = 'published'),
      'host',       (select jsonb_build_object(
                        'id',       m.member_id,
                        'name',     coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id),
                        'username', m.username,
                        'avatar',   m.avatar_url)
                       from public.members m where m.id = v_hub.owner),
      'creator',    (select m.member_id from public.members m where m.id = v_hub.owner)
    )
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* the studio of the member who published it                          */
/* ------------------------------------------------------------------ */
/*
 * A video saved before `posts.hub_id` existed has no studio on its row.
 * The publisher line still must not fall back to a bare profile when the
 * member runs a studio, so this answers the other question: *which studio
 * does this member publish into?*
 *
 *   creator_studio(ref)   ref = member code (ID100019), @handle or uuid
 *     → { ok:true, hub:{ id, code, kind, name, logo_url, visibility,
 *                        creator } }   one studio, or null
 *     → { ok:false, error:'not_found' }
 *
 * A member may run several hubs; the one a video still belongs to is
 * picked in the order a video can live in one: studio, then server, then
 * cinema. Private hubs are skipped — a page a visitor cannot open is not
 * the publisher of a video they can watch.
 */
create or replace function public.creator_studio(p_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_key  text := btrim(coalesce(p_ref, ''));
  v_member public.members%rowtype;
  v_hub  public.creator_hubs%rowtype;
begin
  if v_key = '' then
    return jsonb_build_object('ok', true, 'hub', null);
  end if;

  select * into v_member
    from public.members m
   where upper(m.member_id) = upper(v_key)
      or lower(m.username) = lower(v_key)
      or lower('@' || coalesce(m.username, '')) = lower(v_key)
      or m.id::text = lower(v_key)
   limit 1;

  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_hub
    from public.creator_hubs h
   where h.owner = v_member.id
     and h.kind in ('channel', 'server', 'cinema')
     and h.status = 'active'
     and h.visibility <> 'private'
   order by case h.kind when 'channel' then 1 when 'server' then 2 else 3 end,
            h.created_at asc
   limit 1;

  if v_hub.id is null then
    return jsonb_build_object('ok', true, 'hub', null);
  end if;

  return jsonb_build_object(
    'ok', true,
    'hub', jsonb_build_object(
      'id',         v_hub.id,
      'code',       v_hub.code,
      'kind',       v_hub.kind,
      'name',       v_hub.name,
      'logo_url',   v_hub.logo_url,
      'cover_url',  v_hub.cover_url,
      'visibility', v_hub.visibility,
      'description', v_hub.description,
      'field',      v_hub.field,
      'links',      coalesce(v_hub.links, '[]'::jsonb),
      'subscribers', (select count(*) from public.creator_subscriptions s where s.hub = v_hub.id),
      'published',  (select count(*) from public.member_content c
                      where c.hub = v_hub.id and c.status = 'published'),
      'host',       jsonb_build_object(
                        'id',       v_member.member_id,
                        'name',     coalesce(nullif(btrim(v_member.full_name), ''), v_member.username, v_member.member_id),
                        'username', v_member.username,
                        'avatar',   v_member.avatar_url),
      'creator',    v_member.member_id
    )
  );
end;
$$;

revoke all on function public.video_hub(text) from public;
revoke all on function public.creator_studio(text) from public;
grant execute on function public.video_hub(text) to anon, authenticated, service_role;
grant execute on function public.creator_studio(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
