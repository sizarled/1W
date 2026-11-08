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
      'creator',    (select m.member_id from public.members m where m.id = v_hub.owner)
    )
  );
end;
$$;

revoke all on function public.video_hub(text) from public;
grant execute on function public.video_hub(text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
