-- ─────────────────────────────────────────────────────────────────────────────
-- The publisher's seat — creator.html
--
-- `publisher.html` is the program for creators **outside** the site: a channel,
-- a newsletter, a group of one's own, paid in points for the people their links
-- bring here. It is not a writing desk.
--
-- The publisher an **owner** admits into a hub is somebody else: they write
-- *inside* the site, in a hub they do not own, and the page for making content
-- here is `creator.html`. Until now that page only knew the owner and the staff,
-- because every reading and writing function asked `creator_hub_manage`. So a
-- member sitting in `creator_hubs.publishers` had a seat and no door.
--
-- Five patches, applied to the live project (vtbqbhuywdhnvitbcsfy). Each one
-- rewrites the definition it finds, so it keeps whatever the function has grown
-- since and it is safe to run twice (a marker in the body stops the second run).
--
--   1. `creator_hubs_list`  — the hubs where the member holds a publisher seat
--      are listed too, each with its `role`: owner · staff · publisher.
--   2. `creator_items`      — a publisher reads the published rows (the hub as
--      a reader sees it) plus **their own** drafts, and each row says `mine`.
--      The owner's unfinished drafts stay invisible.
--   3. `creator_item_get`   — opens a row they may see, and nothing else.
--   4. `creator_item_save`  — a publisher may write into the hub, but only as a
--      draft: `p_publish` is refused with `seat`. Publishing stays the owner's.
--   5. `creator_item_delete`— a publisher may drop **their own draft**.
--
-- `creator_submit_item` already accepts a publisher, and still does the one
-- thing a publisher may not do by hand here: a video. A video is published from
-- `video-editor.html`, which `video_save` already lets a publisher write with.
--
-- Requires creator-studio.sql, creator-server-cinema.sql and publisher-program.sql.
-- ─────────────────────────────────────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/* 1 · the hubs a member may open, and the seat they hold             */
/* ------------------------------------------------------------------ */
do $seat$
declare
  src text := pg_get_functiondef('public.creator_hubs_list(text)'::regprocedure);
  out text := '';
begin
  if position('publisher seat' in src) > 0 then
    raise notice 'creator_hubs_list: already lists a publisher seat';
    return;
  end if;

  out := replace(
    src,
    $a$           public.creator_hub_json(h) || jsonb_build_object('owned', h.owner = v_member.id)$a$,
    $b$           public.creator_hub_json(h) || jsonb_build_object(
             'owned', h.owner = v_member.id,
             /* publisher seat — the role this page reads to decide what to show */
             'role',  case when h.owner = v_member.id then 'owner'
                           when coalesce(v_member.member_id, '') = any (coalesce(h.staff, '{}')) then 'staff'
                           else 'publisher' end)$b$
  );
  out := replace(
    out,
    $a$   where h.owner = v_member.id
      or coalesce(v_member.member_id, '') = any(h.staff);$a$,
    $b$   where h.owner = v_member.id
      or coalesce(v_member.member_id, '') = any(coalesce(h.staff, '{}'))
      or coalesce(v_member.member_id, '') = any(coalesce(h.publishers, '{}'));$b$
  );

  if out = src then
    raise exception 'creator_hubs_list: neither anchor was found — the body has moved';
  end if;
  execute out;
end $seat$;

/* ------------------------------------------------------------------ */
/* 2 · what a publisher may read                                      */
/* ------------------------------------------------------------------ */
do $seat$
declare
  src text := pg_get_functiondef('public.creator_items(text,uuid,text,text,text)'::regprocedure);
  out text := '';
begin
  if position('publisher seat' in src) > 0 then
    raise notice 'creator_items: already reads a publisher seat';
    return;
  end if;

  out := replace(src, $a$  v_rows   jsonb;$a$, $b$  v_manage boolean;
  v_rows   jsonb;$b$);

  /* the door: a publisher seat is a seat */
  out := replace(
    out,
    $a$  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;$a$,
    $b$  v_manage := public.creator_hub_manage(v_hub, v_member);
  /* publisher seat — an approved publisher reads the hub, but not the
     owner's unfinished drafts */
  if v_hub.id is null
     or not (v_manage
             or coalesce(v_member.member_id, '') = any (coalesce(v_hub.publishers, '{}'))) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;$b$
  );

  /* the rows, and the same filter on the counters underneath */
  out := replace(
    out,
    $a$       where c.hub = v_hub.id
         and (v_kind is null or c.kind = v_kind)$a$,
    $b$       where c.hub = v_hub.id
         and (v_manage or c.status = 'published' or c.member = v_member.id)
         and (v_kind is null or c.kind = v_kind)$b$
  );
  out := replace(
    out,
    $a$       where p.hub_id = v_hub.id
         and p.content_type in ('video', 'article', 'question')$a$,
    $b$       where p.hub_id = v_hub.id
         and (v_manage or p.status = 'published' or p.author_profile_id = v_member.id)
         and p.content_type in ('video', 'article', 'question')$b$
  );

  /* whose row it is — the table marks the member's own with a pencil */
  out := replace(
    out,
    $a$               'source',      'hub'$a$,
    $b$               'mine',        c.member = v_member.id,
               'source',      'hub'$b$
  );
  out := replace(
    out,
    $a$               'source',      case p.content_type when 'article' then 'article-editor'$a$,
    $b$               'mine',        p.author_profile_id = v_member.id,
               'source',      case p.content_type when 'article' then 'article-editor'$b$
  );

  if out = src then
    raise exception 'creator_items: no anchor was found — the body has moved';
  end if;
  execute out;
end $seat$;

/* ------------------------------------------------------------------ */
/* 3 · a row opens to the publisher who wrote it                      */
/* ------------------------------------------------------------------ */
do $seat$
declare
  src text := pg_get_functiondef('public.creator_item_get(text,uuid)'::regprocedure);
  out text := '';
begin
  if position('publisher seat' in src) > 0 then
    raise notice 'creator_item_get: already opens a publisher seat';
    return;
  end if;

  out := replace(
    src,
    $a$  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;$a$,
    $b$  /* publisher seat — their own row, in a hub that approved them */
  if v_hub.id is null
     or not (public.creator_hub_manage(v_hub, v_member)
             or (v_row.member = v_member.id
                 and coalesce(v_member.member_id, '') = any (coalesce(v_hub.publishers, '{}')))) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;$b$
  );

  if out = src then
    raise exception 'creator_item_get: the anchor was not found — the body has moved';
  end if;
  execute out;
end $seat$;

/* ------------------------------------------------------------------ */
/* 4 · a publisher writes, and does not publish                       */
/* ------------------------------------------------------------------ */
do $seat$
declare
  src text := pg_get_functiondef(
    'public.creator_item_save(text,uuid,uuid,text,text,text,text,text,text,text,text[],text,text,text,uuid,uuid,text,text,text,text,boolean)'::regprocedure
  );
  out text := '';
begin
  if position('publisher seat' in src) > 0 then
    raise notice 'creator_item_save: already accepts a publisher seat';
    return;
  end if;

  out := replace(
    src,
    $a$  v_pub    boolean := coalesce(p_publish, false);$a$,
    $b$  v_manage boolean;
  v_pub    boolean := coalesce(p_publish, false);$b$
  );

  out := replace(
    out,
    $a$  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;$a$,
    $b$  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;
  /* publisher seat — they write here; the owner is the one who lets a row out */
  v_manage := public.creator_hub_manage(v_hub, v_member);
  if not v_manage then
    if coalesce(v_member.member_id, '') <> all (coalesce(v_hub.publishers, '{}')) then
      return jsonb_build_object('ok', false, 'error', 'hub');
    end if;
    if coalesce(p_publish, false) then
      return jsonb_build_object('ok', false, 'error', 'seat');
    end if;
  end if;$b$
  );

  /* a row that is already somebody else's, and not the owner's to give */
  out := replace(
    out,
    $a$    if v_row.member <> v_member.id and v_hub.owner <> v_member.id then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;$a$,
    $b$    if v_row.member <> v_member.id and v_hub.owner <> v_member.id then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    /* publisher seat — their own row, and it stays where its status is */
    if not v_manage and (v_row.member <> v_member.id or v_row.status <> 'draft') then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;$b$
  );

  if out = src then
    raise exception 'creator_item_save: no anchor was found — the body has moved';
  end if;
  execute out;
end $seat$;

/* ------------------------------------------------------------------ */
/* 5 · their own draft, and nothing else                              */
/* ------------------------------------------------------------------ */
do $seat$
declare
  src text := pg_get_functiondef('public.creator_item_delete(text,uuid)'::regprocedure);
  out text := '';
begin
  if position('publisher seat' in src) > 0 then
    raise notice 'creator_item_delete: already accepts a publisher seat';
    return;
  end if;

  out := replace(
    src,
    $a$  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;$a$,
    $b$  /* publisher seat — a draft of their own, and nothing else */
  if v_hub.id is null
     or not (public.creator_hub_manage(v_hub, v_member)
             or (v_row.member = v_member.id
                 and v_row.status = 'draft'
                 and coalesce(v_member.member_id, '') = any (coalesce(v_hub.publishers, '{}')))) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;$b$
  );

  if out = src then
    raise exception 'creator_item_delete: the anchor was not found — the body has moved';
  end if;
  execute out;
end $seat$;

/* ------------------------------------------------------------------ */
/* 6 · grants — nothing new is exposed, but say so                    */
/* ------------------------------------------------------------------ */
do $seat$
declare
  fn text;
begin
  foreach fn in array array[
    'public.creator_hubs_list(text)',
    'public.creator_items(text,uuid,text,text,text)',
    'public.creator_item_get(text,uuid)',
    'public.creator_item_delete(text,uuid)'
  ] loop
    execute format('revoke all on function %s from public', fn);
    execute format('grant execute on function %s to anon, authenticated, service_role', fn);
  end loop;
end $seat$;

/* ------------------------------------------------------------------ */
/* 7 · a quick look                                                   */
/* ------------------------------------------------------------------ */
select
  (select count(*) from public.creator_hubs where cardinality(coalesce(publishers, '{}')) > 0) as hubs_with_publishers,
  (select count(*) from public.creator_hubs where cardinality(coalesce(staff, '{}')) > 0)        as hubs_with_staff;
