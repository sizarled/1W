-- ─────────────────────────────────────────────────────────────────────────────
-- The article editor inside the studio — creator.html writes a blog's articles
--
-- The blog's *Article · new* was a table form: a title, a summary, a plain
-- <textarea>, and none of what the real editor has (the rich text surface, the
-- cover, the tags, the audience, the reader preview, the autosaved draft).
-- creator.html now embeds `article-editor.html`'s own form instead, and a piece
-- written there belongs to the blog it was written in.
--
-- That needs two things on the server, both applied to the live project
-- (vtbqbhuywdhnvitbcsfy):
--
--   1. `article_save` learns the `hub` key — the same shape `video_save` uses.
--      A code or a uuid names the hub; the caller must own it, staff it, or be
--      an approved publisher of it; the hub's kind must be able to hold an
--      article (a blog). Without the key nothing changes, so
--      article-editor.html keeps publishing to the member's own index.
--
--   2. `creator_items` and `creator_hub_posts` stop meaning "videos only": a
--      post row in a hub is now a video **or** an article, and the studio's
--      tables say which editor owns the row (`source`: `video-editor` /
--      `article-editor`). A legacy `member_content` article keeps `source: hub`.
--
-- The two places are patched in place by string replacement of text they
-- already contain, so the file can be run twice and never pastes a body that
-- may have drifted.
-- ─────────────────────────────────────────────────────────────────────────────

/* ------------------------------------------------------------------ */
/* 1. saving an article into a hub                                     */
/* ------------------------------------------------------------------ */
create or replace function public.article_save(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_me     public.members%rowtype := public.member_from_token(p_token);
  v_data   jsonb := case when jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object'
                         then coalesce(p_payload, '{}'::jsonb) else '{}'::jsonb end;
  /* the blog this piece belongs to: a code (IDBL100003) or the hub's uuid */
  v_ref    text := nullif(btrim(coalesce(v_data ->> 'hub', '')), '');
  v_hub    public.creator_hubs%rowtype;
  v_hub_id uuid;
  r        jsonb;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  /* where it goes is checked before anything is written: a blog the member
     does not own, staff or publish in, a hub whose kind cannot hold an
     article, or a code we do not know, is refused and the piece is untouched */
  if v_data ? 'hub' and v_ref is not null then
    select * into v_hub
      from public.creator_hubs h
     where upper(h.code) = upper(v_ref)
        or h.id::text = lower(v_ref)
     limit 1;
    if v_hub.id is null then
      return jsonb_build_object('ok', false, 'error', 'hub');
    end if;
    if not public.creator_hub_manage(v_hub, v_me)
       and not (coalesce(v_me.member_id, '') = any (coalesce(v_hub.publishers, '{}'))) then
      return jsonb_build_object('ok', false, 'error', 'hub_role');
    end if;
    if not public.creator_kind_allowed(v_hub.kind, 'article') then
      return jsonb_build_object('ok', false, 'error', 'hub_kind');
    end if;
    v_hub_id := v_hub.id;
  end if;

  r := public.member_post_save(p_token, v_data, 'article');
  if not coalesce((r ->> 'ok')::boolean, false) then
    return r;
  end if;

  /* the piece is written; now it belongs to the blog. A payload without the
     key leaves the blog it already had, so a partial save never moves it. */
  if v_data ? 'hub' then
    update public.posts p
       set hub_id = v_hub_id
     where p.post_code = (r ->> 'code');
  end if;

  return jsonb_build_object(
    'ok', true,
    'article', r -> 'card',
    'code', r ->> 'code',
    'status', r ->> 'status',
    'scheduled_at', r -> 'scheduled_at',
    'hub', v_hub_id
  );
end $$;

revoke all on function public.article_save(text, jsonb) from public;
grant execute on function public.article_save(text, jsonb) to anon, authenticated, service_role;

/* ------------------------------------------------------------------ */
/* 2. a hub's tables hold articles too                                 */
/* ------------------------------------------------------------------ */
do $do$
declare
  src text;
  out text;
  changed int;
begin
  src := pg_get_functiondef('public.creator_items(text,uuid,text,text,text)'::regprocedure);
  if position('article-editor' in src) > 0 then
    raise notice 'creator_items already lists articles';
    return;
  end if;

  out := replace(src, 'and p.content_type = ''video''', 'and p.content_type in (''video'', ''article'')');
  if out = src then
    raise exception 'anchor 1 not found for creator_items (the post filter)';
  end if;

  changed := length(replace(src, '''kind'',        ''video'',', '')) <> length(src);
  src := out;
  out := replace(src, '''kind'',        ''video'',', '''kind'',        p.content_type,');
  if out = src then
    raise exception 'anchor 2 not found for creator_items (the kind of a post)';
  end if;

  src := out;
  out := replace(src, '''source'',      ''video-editor''',
    '''source'',      case p.content_type when ''article'' then ''article-editor'' else ''video-editor'' end');
  if out = src then
    raise exception 'anchor 3 not found for creator_items (the source of a post)';
  end if;

  src := out;
  out := replace(src, 'v_kind = ''video''', 'v_kind = p.content_type');
  if out = src then
    raise exception 'anchor 4 not found for creator_items (the kind filter)';
  end if;

  execute out;
end $do$;

/* ------------------------------------------------------------------ */
/* 3. the hub's numbers count both                                     */
/* ------------------------------------------------------------------ */
do $do$
declare
  src text;
  out text;
begin
  src := pg_get_functiondef('public.creator_hub_posts(uuid)'::regprocedure);
  if position('''article''' in src) > 0 then
    raise notice 'creator_hub_posts already counts articles';
    return;
  end if;

  out := replace(src, 'and p.content_type = ''video''', 'and p.content_type in (''video'', ''article'')');
  if out = src then
    raise exception 'anchor not found for creator_hub_posts';
  end if;
  execute out;
end $do$;

notify pgrst, 'reload schema';
