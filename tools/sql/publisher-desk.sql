-- ─────────────────────────────────────────────────────────────────────────────
-- The publisher's desk — publisher.html
--
-- A publisher (ناشر) is a member an owner approved into `creator_hubs.publishers`.
-- Until now that member's only door was the form on the hub page, which writes a
-- draft the owner reviews. The desk gives them the real editor instead:
-- video-editor.html's form, **embedded in publisher.html**, publishing straight
-- into the hub they were approved in.
--
-- Two changes, both applied to the live project (vtbqbhuywdhnvitbcsfy):
--
--   1. `publisher_hubs(token)` — the hubs where this member may publish: the ones
--      they own or staff (role `staff`) and the ones that approved them as a
--      publisher (role `publisher`), with their own video counters on each.
--   2. `video_save` — its `hub_role` guard now also accepts an approved
--      publisher, not only the owner or the staff. Everything else is untouched:
--      the hub must still exist, and its kind must still be able to hold a video.
--
-- The patch is a string replacement of a guard the definition already contains,
-- so it can run twice safely and it never pastes a body that may have drifted.
-- ─────────────────────────────────────────────────────────────────────────────

create or replace function public.publisher_hubs(p_token text)
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

  select coalesce(jsonb_agg(j order by (j ->> 'name')), '[]'::jsonb)
    into v_rows
    from (
      select jsonb_build_object(
               'id',         h.id,
               'code',       upper(h.code),
               'kind',       h.kind,
               'name',       h.name,
               'logo_url',   h.logo_url,
               'cover_url',  h.cover_url,
               'visibility', h.visibility,
               'role',       case when public.creator_hub_manage(h, v_me) then 'staff' else 'publisher' end,
               'published',  (select count(*) from public.posts p
                               where p.hub_id = h.id and p.content_type = 'video'
                                 and p.status = 'published' and p.author_profile_id = v_me.id),
               'drafts',     (select count(*) from public.posts p
                               where p.hub_id = h.id and p.content_type = 'video'
                                 and p.status = 'draft' and p.author_profile_id = v_me.id),
               'mine',       (select count(*) from public.posts p
                               where p.hub_id = h.id and p.content_type = 'video'
                                 and p.author_profile_id = v_me.id)
             ) as j
        from public.creator_hubs h
       where h.status = 'active'
         and (public.creator_hub_manage(h, v_me)
              or coalesce(v_me.member_id, '') = any (coalesce(h.publishers, '{}')))
    ) s;

  return jsonb_build_object('ok', true, 'hubs', coalesce(v_rows, '[]'::jsonb));
end $$;

revoke all on function public.publisher_hubs(text) from public;
grant execute on function public.publisher_hubs(text) to anon, authenticated, service_role;

-- 2 · a publisher may save a video into the hub that approved them ───────────
do $do$
declare
  src text;
  out text;
begin
  src := pg_get_functiondef('public.video_save(text,jsonb)'::regprocedure);
  if position('approved publisher' in src) > 0 then
    raise notice 'video_save already accepts a publisher';
    return;
  end if;

  out := replace(src,
$old$    if not public.creator_hub_manage(v_hub, v_me) then
      return jsonb_build_object('ok', false, 'error', 'hub_role');
    end if;$old$,
$new$    /* the owner and the staff manage a hub; an approved publisher may
       publish their own video into it — that is what the desk is for */
    if not public.creator_hub_manage(v_hub, v_me)
       and not (coalesce(v_me.member_id, '') = any (coalesce(v_hub.publishers, '{}'))) then
      return jsonb_build_object('ok', false, 'error', 'hub_role');
    end if;$new$);

  if out = src then
    raise exception 'anchor not found for video_save';
  end if;
  execute out;
end $do$;

notify pgrst, 'reload schema';
