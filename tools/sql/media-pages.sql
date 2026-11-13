/**
 * 1World — the audio page and the playlist page.
 * ------------------------------------------------------------------
 * Two addresses, two calls, and one new kind.
 *
 *   audio.html#/p/ID=<podcast>        audio_get(token, ref, 'podcast')
 *   audio.html#/m/ID=<song>           audio_get(token, ref, 'song')
 *
 *   playlist.html#/videos/ID=<id>     playlist_get(token, ref, 'videos')
 *   playlist.html#/podcasts/ID=<id>   playlist_get(token, ref, 'podcasts')
 *   playlist.html#/songs/ID=<id>      playlist_get(token, ref, 'songs')
 *
 * The `<ref>` is the item's code — the first eight hex digits of its uuid,
 * the same `code` every other surface shows — never its uuid and never its
 * title, so an address survives a rename.
 *
 * A song is a member_content row like a podcast is: same table, same
 * editor, same rules. Only the word is new, so the kind check learns it.
 *
 * Nothing here opens a door the hub page would keep shut. An item is
 * readable exactly when `creator_hub_view` would have shown it, and a
 * locked hub returns `locked:true` with the cover and the name only — the
 * page renders the gate instead of the file.
 */

-- ------------------------------------------------------------------
-- 1. a song is a kind of content, not a new table
-- ------------------------------------------------------------------
alter table public.member_content drop constraint if exists member_content_kind;
alter table public.member_content add constraint member_content_kind check (
  kind in ('video', 'article', 'podcast', 'image', 'document', 'post',
           'playlist', 'book', 'question', 'answer', 'song',
           'channel', 'channel_list', 'xtream', 'film', 'episode')
);

create index if not exists member_content_code
  on public.member_content (upper(left(replace(id::text, '-', ''), 8)));

-- ------------------------------------------------------------------
-- 2. the item behind one code
-- ------------------------------------------------------------------
create or replace function public.media_item(p_code text)
returns public.member_content
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select c.*
    from public.member_content c
   where upper(left(replace(c.id::text, '-', ''), 8)) = upper(btrim(coalesce(p_code, '')))
      or c.id::text = btrim(coalesce(p_code, ''))
   limit 1;
$$;

-- ------------------------------------------------------------------
-- 3. audio_get — one podcast, one song
-- ------------------------------------------------------------------
/*
 * audio_get(token, ref, kind)
 *
 * → { ok:true, locked:false,
 *     item:{ id, code, kind, title, summary, media_url, cover, minutes,
 *            visibility, published_at, creator, creator_id, locked:false },
 *     queue:[ … the same kind, in the same hub, published … ],
 *     hub:{ id, code, name, kind } }
 * → { ok:true, locked:true, item:{ title, cover, kind, locked:true },
 *     gate_note, hub:{…} }                      the hub or the item is shut
 * → { ok:false, error:'not_found' }
 *
 * The queue is what plays next: the same creator's same kind, newest last
 * so the page reads like a list and not like a feed.
 */
create or replace function public.audio_get(p_token text, p_ref text, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_item   public.member_content%rowtype;
  v_hub    public.creator_hubs%rowtype;
  v_kind   text := case when lower(btrim(coalesce(p_kind, 'podcast'))) = 'song'
                        then 'song' else 'podcast' end;
  v_manage boolean := false;
  v_vip    boolean := false;
  v_sub    boolean := false;
  v_hub_ok boolean := true;
  v_queue  jsonb;
  v_hub_json jsonb;
begin
  v_item := public.media_item(p_ref);
  if v_item.id is null or v_item.kind <> v_kind then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_item.hub is not null then
    select * into v_hub from public.creator_hubs where id = v_item.hub;
  end if;

  if v_hub.id is not null then
    v_manage := public.creator_hub_manage(v_hub, v_member);
    v_vip    := coalesce(v_member.member_id, '') = any(v_hub.vip);
    v_sub    := v_member.id is not null
                and exists (select 1 from public.creator_subscriptions s
                             where s.hub = v_hub.id and s.member = v_member.id);
    v_hub_ok := v_hub.status = 'active'
                and (v_hub.visibility <> 'private' or v_manage or v_vip);
    v_hub_json := jsonb_build_object(
      'id',   v_hub.id,
      'code', v_hub.code,
      'name', v_hub.name,
      'kind', v_hub.kind,
      'owner', (select m.member_id from public.members m where m.id = v_hub.owner)
    );
  else
    v_hub_json := '{}'::jsonb;
  end if;

  /* the item's own door, on top of the hub's */
  if not v_hub_ok
     or v_item.status <> 'published'
     or not (v_manage or v_vip or v_sub
             or v_item.visibility in ('public', 'unlisted')
             or (v_item.visibility = 'exclusive' and v_item.member = v_member.id)) then
    return jsonb_build_object(
      'ok', true,
      'locked', true,
      'item', jsonb_build_object(
        'code',    upper(left(replace(v_item.id::text, '-', ''), 8)),
        'kind',    v_item.kind,
        'title',   v_item.title,
        'cover',   v_item.cover_url,
        'minutes', v_item.minutes,
        'locked',  true
      ),
      'gate_note', case
        when not v_hub_ok and v_hub.has_password then 'This hub is private: ask its owner for the password.'
        when not v_hub_ok then 'This hub is private: ask its owner to add your code.'
        when v_item.visibility = 'exclusive' then 'This one is for the hub''s subscribers.'
        else 'This one is not published yet.'
      end,
      'hub', v_hub_json
    );
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code',      upper(left(replace(c.id::text, '-', ''), 8)),
           'kind',      c.kind,
           'title',     c.title,
           'minutes',   coalesce(nullif(c.view_minutes, 0), c.minutes),
           'thumbnail', c.thumbnail_url,
           'published_at', c.published_at
         ) order by c.published_at asc nulls first), '[]'::jsonb)
    into v_queue
    from public.member_content c
   where c.kind = v_item.kind
     and c.hub is not distinct from v_item.hub
     and c.status = 'published'
     and c.id <> v_item.id
     and (v_manage or c.visibility in ('public', 'unlisted')
          or (c.visibility = 'exclusive' and v_sub));

  return jsonb_build_object(
    'ok', true,
    'locked', false,
    'item', jsonb_build_object(
      'id',          v_item.id,
      'code',        upper(left(replace(v_item.id::text, '-', ''), 8)),
      'kind',        v_item.kind,
      'title',       v_item.title,
      'summary',     v_item.summary,
      'media_url',   v_item.media_url,
      'cover',       coalesce(nullif(v_item.cover_url, ''), v_item.thumbnail_url),
      'minutes',     coalesce(nullif(v_item.view_minutes, 0), v_item.minutes),
      'meta',        coalesce(v_item.meta, '{}'::jsonb) - 'host_file',
      'visibility',  v_item.visibility,
      'published_at', v_item.published_at,
      'creator',     (select coalesce(nullif(m.username, ''), m.member_id)
                        from public.members m where m.id = v_item.member),
      'creator_id',  (select m.member_id from public.members m where m.id = v_item.member),
      'locked',      false
    ),
    'queue', v_queue,
    'hub',   v_hub_json
  );
end;
$$;

-- ------------------------------------------------------------------
-- 4. playlist_get — a playlist, one shelf at a time
-- ------------------------------------------------------------------
/*
 * playlist_get(token, ref, shelf)
 *
 * → { ok:true, playlist:{ id, code, title, summary, cover, visibility,
 *                         creator, creator_id, hub:{id,code,name} },
 *     rows:[ { code, kind, title, minutes, thumbnail, orientation } ] }
 * → { ok:false, error:'not_found' }
 *
 * A playlist row is a `playlist` item; what is on it is the rows whose
 * `parent` is that item. The shelf is the filter, and it is also the
 * address: `#/videos/`, `#/podcasts/`, `#/songs/`. A row's `orientation`
 * is `v` when its `audience->>'shape'` says vertical — that is the only
 * thing that turns a video into a 9:16 piece.
 */
create or replace function public.playlist_get(p_token text, p_ref text, p_shelf text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_pl     public.member_content%rowtype;
  v_kind   text := case lower(btrim(coalesce(p_shelf, 'videos')))
                     when 'podcasts' then 'podcast'
                     when 'songs'    then 'song'
                     else 'video' end;
  v_manage boolean := false;
  v_vip    boolean := false;
  v_sub    boolean := false;
  v_rows   jsonb;
  v_hub_json jsonb := '{}'::jsonb;
  v_hub    public.creator_hubs%rowtype;
begin
  v_pl := public.media_item(p_ref);
  if v_pl.id is null or v_pl.kind <> 'playlist' then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_pl.hub is not null then
    select * into v_hub from public.creator_hubs where id = v_pl.hub;
    v_manage := public.creator_hub_manage(v_hub, v_member);
    v_vip    := coalesce(v_member.member_id, '') = any(v_hub.vip);
    v_sub    := v_member.id is not null
                and exists (select 1 from public.creator_subscriptions s
                             where s.hub = v_hub.id and s.member = v_member.id);
    v_hub_json := jsonb_build_object(
      'id',   v_hub.id,
      'code', v_hub.code,
      'name', v_hub.name
    );
  end if;

  if v_pl.status <> 'published' and not v_manage and v_pl.member <> v_member.id then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code',        upper(left(replace(c.id::text, '-', ''), 8)),
           'kind',        c.kind,
           'title',       c.title,
           'minutes',     coalesce(nullif(c.view_minutes, 0), c.minutes),
           'thumbnail',   coalesce(nullif(c.thumbnail_url, ''), c.cover_url),
           'visibility',  c.visibility,
           'orientation', case when coalesce(c.audience->>'shape', '') in ('v', 'vertical', 'portrait')
                               then 'v' else 'h' end
         ) order by c.published_at asc nulls first, c.created_at asc), '[]'::jsonb)
    into v_rows
    from public.member_content c
   where c.parent = v_pl.id
     and c.kind = v_kind
     and c.status = 'published'
     and (v_manage or c.visibility in ('public', 'unlisted')
          or (c.visibility = 'exclusive' and v_sub));

  return jsonb_build_object(
    'ok', true,
    'playlist', jsonb_build_object(
      'id',          v_pl.id,
      'code',        upper(left(replace(v_pl.id::text, '-', ''), 8)),
      'title',       v_pl.title,
      'summary',     v_pl.summary,
      'cover',       coalesce(nullif(v_pl.cover_url, ''), v_pl.thumbnail_url),
      'visibility',  v_pl.visibility,
      'shelf',       case v_kind when 'podcast' then 'podcasts' when 'song' then 'songs' else 'videos' end,
      'creator',     (select coalesce(nullif(m.username, ''), m.member_id)
                        from public.members m where m.id = v_pl.member),
      'creator_id',  (select m.member_id from public.members m where m.id = v_pl.member),
      'hub',         v_hub_json
    ),
    'rows', v_rows
  );
end;
$$;

-- ------------------------------------------------------------------
-- 5. grants
-- ------------------------------------------------------------------
revoke all on function public.media_item(text) from public;
revoke all on function public.audio_get(text, text, text) from public;
revoke all on function public.playlist_get(text, text, text) from public;

grant execute on function public.audio_get(text, text, text) to anon, authenticated, service_role;
grant execute on function public.playlist_get(text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
