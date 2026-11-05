/* ==================================================================
   creator.html — the public side
   ------------------------------------------------------------------
   The studio (tools/sql/creator-studio.sql) is the owner's working
   area. This file is the other half: the front door everybody gets.

     the directory   creators_search(token, query, kind, country, sort)
     one creator     creator_public(token, ref)      ref = code / @handle / uuid
     one hub         creator_hub_view(token, hub, password)  — as a visitor
     a hub's count   creator_hub_subscribers(hub)

   Privacy lives here, on the server:

     · a member with no non-private hub never appears in the directory;
     · a private hub is in nobody's list but the owner's, its staff's and
       its VIP list's — and the hub view answers it *locked*: name, logo,
       cover and whether a password exists, and not one item;
     · `exclusive` items are only in the reply of a subscriber (or of the
       owner, the staff and the VIP list);
     · `creator_hub_view` never returns the password hash.

   The directory's rows carry the totals the cards show, so the browser
   makes one call per page, not one per card.

   Requires creator-studio.sql (creator_hubs, creator_hub_json,
   creator_hub_manage, creator_subscriptions, member_content).
   ================================================================== */

/* ------------------------------------------------------------------ */
/* 1. the seven kinds                                                 */
/* ------------------------------------------------------------------ */
/* studio (the old `channel`), blog, space, library, gallery, server, cinema */

alter table public.creator_hubs drop constraint if exists creator_hubs_kind;

alter table public.creator_hubs
  add constraint creator_hubs_kind
  check (kind in ('channel', 'blog', 'space', 'library', 'gallery', 'server', 'cinema'));

create or replace function public.creator_kind_allowed(p_kind text, p_item text)
returns boolean
language sql
immutable
as $$
  select case lower(coalesce(p_kind, ''))
    when 'channel' then lower(coalesce(p_item, '')) in ('video', 'podcast', 'playlist')
    when 'server'  then lower(coalesce(p_item, '')) in ('video', 'podcast', 'playlist')
    when 'cinema'  then lower(coalesce(p_item, '')) = 'video'
    when 'blog'    then lower(coalesce(p_item, '')) = 'article'
    when 'space'   then lower(coalesce(p_item, '')) in ('question', 'answer')
    when 'library' then lower(coalesce(p_item, '')) in ('book', 'document')
    when 'gallery' then lower(coalesce(p_item, '')) = 'image'
    else false
  end;
$$;

/* ------------------------------------------------------------------ */
/* 2. how many subscribers a hub has                                  */
/* ------------------------------------------------------------------ */
create or replace function public.creator_hub_subscribers(p_hub uuid)
returns int
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select count(*)::int from public.creator_subscriptions s where s.hub = p_hub;
$$;

/* ------------------------------------------------------------------ */
/* 3. the directory                                                   */
/* ------------------------------------------------------------------ */
/*
 * creators_search(token, query, kind, country, sort)
 *   query   name, @handle or member code, case-insensitive, partial
 *   kind    one of the seven hub kinds ('' = any; 'studio' is accepted
 *           as the UI word for `channel`)
 *   country the member's country, as stored ('' = any)
 *   sort    subscribers | items | new
 *
 * → { ok, rows:[ … ], countries:[ … ], count }
 *
 * A row is everything a card shows:
 *   { ref, code, name, username, avatar, country, fields[],
 *     hubs, subscribers, items, minutes, likes, joined, counts:{kind:n} }
 *
 * Totals only ever count non-private hubs; sixty rows at most.
 */
create or replace function public.creators_search(
  p_token   text,
  p_query   text,
  p_kind    text,
  p_country text,
  p_sort    text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_query     text := btrim(coalesce(p_query, ''));
  v_kind      text := lower(btrim(coalesce(p_kind, '')));
  v_country   text := btrim(coalesce(p_country, ''));
  v_sort      text := lower(btrim(coalesce(p_sort, 'subscribers')));
  v_rows      jsonb;
  v_countries jsonb;
begin
  if v_kind = 'studio' then
    v_kind := 'channel';
  end if;

  select coalesce(jsonb_agg(row_json), '[]'::jsonb) into v_rows
    from (
      select jsonb_build_object(
               'ref',         m.member_id,
               'code',        m.member_id,
               'name',        coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id),
               'username',    m.username,
               'avatar',      m.avatar_url,
               'country',     m.country,
               'fields',      m.fields,
               'hubs',        m.hubs,
               'subscribers', m.subscribers,
               'items',       m.items,
               'minutes',     m.minutes,
               'likes',       m.likes,
               'joined',      m.created_at,
               'counts',      m.counts
             ) as row_json
        from (
          select mm.*,
                 (select count(*) from public.creator_hubs h
                   where h.owner = mm.id and h.visibility <> 'private') as hubs,
                 (select coalesce(sum(public.creator_hub_subscribers(h.id)), 0) from public.creator_hubs h
                   where h.owner = mm.id and h.visibility <> 'private') as subscribers,
                 (select count(*) from public.member_content c
                    join public.creator_hubs h on h.id = c.hub
                   where h.owner = mm.id and h.visibility <> 'private' and c.status = 'published') as items,
                 (select coalesce(sum(c.view_minutes), 0) from public.member_content c
                    join public.creator_hubs h on h.id = c.hub
                   where h.owner = mm.id and h.visibility <> 'private') as minutes,
                 (select coalesce(sum(c.likes), 0) from public.member_content c
                    join public.creator_hubs h on h.id = c.hub
                   where h.owner = mm.id and h.visibility <> 'private') as likes,
                 (select coalesce(jsonb_object_agg(k.kind, k.n), '{}'::jsonb)
                    from (select h.kind, count(*) as n
                            from public.creator_hubs h
                           where h.owner = mm.id and h.visibility <> 'private'
                           group by h.kind) k) as counts,
                 (select coalesce(array_agg(distinct btrim(h.field)), '{}')
                    from public.creator_hubs h
                   where h.owner = mm.id and h.visibility <> 'private'
                     and nullif(btrim(h.field), '') is not null) as fields
            from public.members mm
           where mm.status <> 'banned'
             and exists (select 1 from public.creator_hubs h
                          where h.owner = mm.id and h.visibility <> 'private')
        ) m
       where (v_query = ''
              or coalesce(m.full_name, '') ilike '%' || v_query || '%'
              or coalesce(m.username, '') ilike '%' || v_query || '%'
              or coalesce(m.member_id, '') ilike '%' || v_query || '%')
         and (v_country = '' or lower(coalesce(m.country, '')) = lower(v_country))
         and (v_kind = '' or exists (
               select 1 from public.creator_hubs h
                where h.owner = m.id and h.kind = v_kind and h.visibility <> 'private'))
       order by (case when v_sort = 'items' then m.items
                      when v_sort = 'subscribers' then m.subscribers
                      else 0 end) desc,
                (case when v_sort = 'new' then m.created_at end) desc nulls last,
                coalesce(m.full_name, m.username, m.member_id)
       limit 60
    ) s;

  select coalesce(jsonb_agg(c.code order by c.code), '[]'::jsonb)
    into v_countries
    from (select distinct btrim(m.country) as code
            from public.members m
           where nullif(btrim(m.country), '') is not null
             and m.status <> 'banned'
             and exists (select 1 from public.creator_hubs h
                          where h.owner = m.id and h.visibility <> 'private')) c;

  return jsonb_build_object(
    'ok', true,
    'rows', v_rows,
    'countries', v_countries,
    'count', jsonb_array_length(v_rows)
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 4. one creator and every hub they run                              */
/* ------------------------------------------------------------------ */
/*
 * creator_public(token, ref)     ref = ID100015 / @jhon007 / the uuid,
 *                                or '' for the caller's own page
 *
 * → { ok, is_self, creator:{ref,code,name,username,avatar,country,bio,
 *                           fields[],joined},
 *     totals:{hubs,subscribers,items,minutes,likes}, hubs:[ … ] }
 *
 * A hub row: { id, kind, name, description, logo_url, cover_url, field,
 *              niches[], visibility, locked, subscribers, items, minutes,
 *              likes, staff, created_at }
 *
 * `staff` on a hub row means *the caller* may manage it (staff or VIP).
 * A private hub belongs to the owner, the staff and the VIP list only.
 */
create or replace function public.creator_public(p_token text, p_ref text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_ref    text := btrim(coalesce(p_ref, ''));
  v_bare   text := lower(btrim(replace(coalesce(p_ref, ''), '@', '')));
  v_owner  public.members%rowtype;
  v_self   boolean := false;
  v_hubs   jsonb;
  v_totals jsonb;
begin
  if v_ref = '' then
    if v_member.id is null then
      return jsonb_build_object('ok', false, 'error', 'ref');
    end if;
    v_owner := v_member;
  else
    select * into v_owner
      from public.members m
     where (m.status <> 'banned' or m.id = v_member.id)
       and (upper(m.member_id) = upper(replace(v_ref, '@', ''))
            or lower(replace(m.username, '@', '')) = v_bare
            or m.id::text = lower(v_ref))
     limit 1;
  end if;

  if v_owner.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_self := v_member.id is not null and v_member.id = v_owner.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          h.id,
           'kind',        h.kind,
           'name',        h.name,
           'description', h.description,
           'logo_url',    h.logo_url,
           'cover_url',   h.cover_url,
           'field',       h.field,
           'niches',      h.niches,
           'visibility',  h.visibility,
           'locked',      h.visibility = 'private',
           'subscribers', public.creator_hub_subscribers(h.id),
           'items',       (select count(*) from public.member_content c where c.hub = h.id and c.status = 'published'),
           'minutes',     (select coalesce(sum(c.view_minutes), 0) from public.member_content c where c.hub = h.id),
           'likes',       (select coalesce(sum(c.likes), 0) from public.member_content c where c.hub = h.id),
           'staff',       (coalesce(v_member.member_id, '') = any(h.staff) or coalesce(v_member.member_id, '') = any(h.vip)),
           'created_at',  h.created_at
         ) order by h.kind, h.name), '[]'::jsonb)
    into v_hubs
    from public.creator_hubs h
   where h.owner = v_owner.id
     and (h.visibility <> 'private'
          or v_self
          or coalesce(v_member.member_id, '') = any(h.staff)
          or coalesce(v_member.member_id, '') = any(h.vip));

  select jsonb_build_object(
           'hubs',        jsonb_array_length(v_hubs),
           'subscribers', coalesce((select sum(public.creator_hub_subscribers(h.id)) from public.creator_hubs h where h.owner = v_owner.id), 0),
           'items',       coalesce((select count(*) from public.member_content c join public.creator_hubs h on h.id = c.hub
                                     where h.owner = v_owner.id and c.status = 'published'), 0),
           'minutes',     coalesce((select sum(c.view_minutes) from public.member_content c join public.creator_hubs h on h.id = c.hub
                                     where h.owner = v_owner.id), 0),
           'likes',       coalesce((select sum(c.likes) from public.member_content c join public.creator_hubs h on h.id = c.hub
                                     where h.owner = v_owner.id), 0))
    into v_totals;

  return jsonb_build_object(
    'ok', true,
    'is_self', v_self,
    'creator', jsonb_build_object(
      'ref',         v_owner.member_id,
      'code',        v_owner.member_id,
      'name',        coalesce(nullif(btrim(v_owner.full_name), ''), v_owner.username, v_owner.member_id),
      'username',    v_owner.username,
      'avatar',      v_owner.avatar_url,
      'country',     v_owner.country,
      'bio',         v_owner.bio,
      'fields',      (select coalesce(array_agg(distinct btrim(h.field)), '{}')
                        from public.creator_hubs h
                       where h.owner = v_owner.id and h.visibility <> 'private'
                         and nullif(btrim(h.field), '') is not null),
      'joined',      v_owner.created_at
    ),
    'totals', v_totals,
    'hubs', v_hubs
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 5. one hub, as a visitor                                           */
/* ------------------------------------------------------------------ */
/*
 * creator_hub_view(token, hub, password)
 *
 * → { ok, locked:false, hub:{ …creator_hub_json…, owner, role, subscribed,
 *                             unlocked }, items:[ … ] }
 * → { ok, locked:true,  hub:{ id, kind, name, description, logo_url,
 *                             cover_url, visibility, locked, has_password,
 *                             password_until, staff, vip, owner,
 *                             subscribers } }
 *
 * `role` is owner / staff / visitor. The password is the same door as
 * creator_hub_unlock (bcrypt, and the window must still be open) — an
 * unlock only lasts for the visit, nothing is stored.
 *
 * Items: published only; `public` always, `exclusive` for a subscriber
 * (and for the owner / staff / VIP / someone who just unlocked).
 */
create or replace function public.creator_hub_view(p_token text, p_hub uuid, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_manage boolean := false;
  v_vip    boolean := false;
  v_sub    boolean := false;
  v_pw     boolean := false;
  v_rows   jsonb;
begin
  select * into v_hub from public.creator_hubs where id = p_hub;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_manage := public.creator_hub_manage(v_hub, v_member);
  v_vip    := coalesce(v_member.member_id, '') = any(v_hub.vip);
  v_sub    := v_member.id is not null
              and exists (select 1 from public.creator_subscriptions s
                           where s.hub = v_hub.id and s.member = v_member.id);

  if v_hub.visibility = 'private' and not v_manage and not v_vip then
    if coalesce(p_password, '') <> '' and coalesce(v_hub.password_hash, '') <> ''
       and (v_hub.password_until is null or v_hub.password_until >= now())
       and extensions.crypt(p_password, v_hub.password_hash) = v_hub.password_hash then
      v_pw := true;
    end if;
    if not v_pw then
      return jsonb_build_object(
        'ok', true,
        'locked', true,
        'hub', jsonb_build_object(
          'id', v_hub.id, 'kind', v_hub.kind, 'name', v_hub.name,
          'description', v_hub.description, 'logo_url', v_hub.logo_url, 'cover_url', v_hub.cover_url,
          'visibility', v_hub.visibility, 'locked', true,
          'has_password', coalesce(v_hub.password_hash, '') <> '',
          'password_until', v_hub.password_until,
          'staff', v_hub.staff, 'vip', v_hub.vip,
          'owner', (select m.member_id from public.members m where m.id = v_hub.owner),
          'subscribers', public.creator_hub_subscribers(v_hub.id)
        )
      );
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          c.id,
           'code',        upper(left(replace(c.id::text, '-', ''), 8)),
           'kind',        c.kind,
           'title',       c.title,
           'summary',     c.summary,
           'thumbnail',   c.thumbnail_url,
           'media_url',   c.media_url,
           'visibility',  c.visibility,
           'minutes',     coalesce(nullif(c.view_minutes, 0), c.minutes),
           'likes',       c.likes,
           'comments',    c.comments_count,
           'published_at', c.published_at
         ) order by c.published_at desc nulls last), '[]'::jsonb)
    into v_rows
    from public.member_content c
   where c.hub = v_hub.id
     and c.status = 'published'
     and (v_manage or v_vip or v_pw
          or c.visibility = 'public'
          or (c.visibility = 'exclusive' and v_sub));

  return jsonb_build_object(
    'ok', true,
    'locked', false,
    'hub', public.creator_hub_json(v_hub) || jsonb_build_object(
      'owner', (select m.member_id from public.members m where m.id = v_hub.owner),
      'role', case when v_hub.owner = v_member.id then 'owner'
                   when v_manage then 'staff' else 'visitor' end,
      'subscribed', v_sub,
      'unlocked', v_pw
    ),
    'items', v_rows
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 6. grants                                                          */
/* ------------------------------------------------------------------ */
revoke all on function public.creator_hub_subscribers(uuid) from public;
revoke all on function public.creators_search(text, text, text, text, text) from public;
revoke all on function public.creator_public(text, text) from public;
revoke all on function public.creator_hub_view(text, uuid, text) from public;

grant execute on function public.creator_hub_subscribers(uuid) to anon, authenticated, service_role;
grant execute on function public.creators_search(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.creator_public(text, text) to anon, authenticated, service_role;
grant execute on function public.creator_hub_view(text, uuid, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
