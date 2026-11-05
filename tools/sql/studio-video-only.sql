-- ─────────────────────────────────────────────────────────────────────────────
-- A video is published only from video-editor.html.
--
-- **Applied** to the live project (vtbqbhuywdhnvitbcsfy). Both functions already
-- existed on the server, and the repo copies of them are older than the server's
-- (creator-requests.sql carries a stub-ish, pre-`private` body; creator-studio.sql
-- predates the `code` in the reply). So this file does not paste a body it cannot
-- trust: it patches the definition **in place** — one string replacement of a
-- guard that is already in the text, then `execute` of the result — and it is
-- safe to run twice, because the second run finds the guard and stops.
--
--   creator_submit_item   a publisher hands in a podcast or a playlist (an
--                         article in a blog). Never a video.   → error `video_editor`
--   creator_item_save     the studio's table writes no **new** video row; a row
--                         that already exists still opens and saves, so nothing
--                         already in a hub is stranded.        → error `video_editor`
--
-- `video_save` — the editor's own door — is untouched: that is where a video is
-- written, with its player, its thumbnail, its audience and its schedule.
--
-- Verified on the live database inside a block that rolled itself back: a real
-- session token on @ledsizar7's studio (`IDST100001`, kind `channel`, which does
-- allow videos) got `{ok:false, error:"video_editor"}` for `video` from both
-- functions, while the same calls with `podcast` succeeded (one `{ok:true,…}` per
-- function). `member_content` went back to its one row, no session was left.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1 · what a publisher hands in ───────────────────────────────────────────────
do $do$
declare
  src text;
  out text;
begin
  src := pg_get_functiondef(
    'public.creator_submit_item(text,text,text,text,text,text,text,text)'::regprocedure
  );
  if position('video_editor' in src) > 0 then
    raise notice 'creator_submit_item already refuses a video';
    return;
  end if;

  out := replace(src,
$old$  if not public.creator_kind_allowed(v_hub.kind, v_kind) then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;$old$,
$new$  if not public.creator_kind_allowed(v_hub.kind, v_kind) then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;
  /* a video is not handed in by a publisher: it is published from
     video-editor.html by the owner or the staff */
  if v_kind = 'video' then
    return jsonb_build_object('ok', false, 'error', 'video_editor');
  end if;$new$);

  if out = src then
    raise exception 'anchor not found for creator_submit_item';
  end if;
  execute out;
end $do$;

-- 2 · the studio's table writes no new video row ──────────────────────────────
do $do$
declare
  src text;
  out text;
begin
  src := pg_get_functiondef(
    'public.creator_item_save(text,uuid,uuid,text,text,text,text,text,text,text,text[],text,text,text,uuid,uuid,text,text,text,text,boolean)'::regprocedure
  );
  if position('video_editor' in src) > 0 then
    raise notice 'creator_item_save already refuses a new video';
    return;
  end if;

  out := replace(src,
$old$  if not public.creator_kind_allowed(v_hub.kind, v_kind) then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;$old$,
$new$  if not public.creator_kind_allowed(v_hub.kind, v_kind) then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;
  /* a video is not written in this table any more: video-editor.html is its
     form and video_save writes it. A row that already exists may still be
     edited, so nothing already in a hub is stranded. */
  if v_kind = 'video' and p_id is null then
    return jsonb_build_object('ok', false, 'error', 'video_editor');
  end if;$new$);

  if out = src then
    raise exception 'anchor not found for creator_item_save';
  end if;
  execute out;
end $do$;
