/* ==================================================================
   creator.html — the search finds two kinds of people
   ------------------------------------------------------------------
   A creator page is run by an **owner** (مالك): the member whose hubs
   these are. The same hubs can be written in by **publishers** (ناشرون)
   who own nothing there — they asked, the owner approved, and their
   member code sits in `creator_hubs.publishers`.

   One search covers both, and it says which one a row is:

     creators_search(token, role, query, kind, country, sort)
       role    '' | all      everybody — owners and publishers
               owner        only the members who own at least one hub
               publisher    only the members who write in a hub they do
                            not own

   A publisher row carries the hubs they write in (`writes`, `writes_hubs`)
   on top of the owner row's shape, so one card can draw either.

   Privacy is unchanged and it is the server's: a private hub is never in a
   publisher's list, so a member who writes only inside a private hub is
   not listed at all — the hub's existence is the owner's business.

   `creator_public` also grows a `pubhubs` array: the hubs a member writes
   in without owning them, so their own page says both halves of who they
   are.

   Requires creator-studio.sql, creator-public.sql and creator-requests.sql
   (the `publishers` column and the public hub codes).
   ================================================================== */

/* ------------------------------------------------------------------ */
/* 1. the hubs a member publishes for and does not own                */
/* ------------------------------------------------------------------ */
/*
 * creator_published_hubs(p_member, p_kind, p_limit)
 *
 * → [ { id, code, kind, name, logo_url, owner, owner_name, owner_code,
 *       items } ] ordered by kind, then name. Private hubs never appear.
 */
create or replace function public.creator_published_hubs(
  p_member uuid,
  p_kind   text default '',
  p_limit  int  default 8
)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(jsonb_agg(row_json order by sort_kind, sort_name), '[]'::jsonb)
    from (
      select h.kind as sort_kind,
             h.name as sort_name,
             jsonb_build_object(
               'id',         h.id,
               'code',       h.code,
               'kind',       h.kind,
               'name',       h.name,
               'logo_url',   h.logo_url,
               'owner',      o.member_id,
               'owner_name', coalesce(nullif(btrim(o.full_name), ''), o.username, o.member_id),
               'owner_code', o.member_id,
               'items',      (select count(*) from public.member_content c
                               where c.hub = h.id and c.member = p_member and c.status = 'published')
             ) as row_json
        from public.creator_hubs h
        join public.members o on o.id = h.owner
       where h.owner <> p_member
         and h.visibility <> 'private'
         and (select m.member_id from public.members m where m.id = p_member) = any (h.publishers)
         and (coalesce(btrim(p_kind), '') = '' or h.kind = lower(btrim(p_kind)))
       order by h.kind, h.name
       limit greatest(1, least(coalesce(p_limit, 8), 40))
    ) s;
$$;

/* ------------------------------------------------------------------ */
/* 2. the search                                                      */
/* ------------------------------------------------------------------ */
/*
 * creators_search(token, role, query, kind, country, sort)
 *   role    '' | all | owner | publisher
 *   query   name, @handle or member code, case-insensitive, partial
 *   kind    one of the seven hub kinds ('' = any; 'studio' = channel)
 *   country the member's country, as stored ('' = any)
 *   sort    subscribers | items | new
 *
 * → { ok, role, rows:[ … ], countries:[ … ], count, owners, publishers }
 *
 * A row is a card:
 *   { ref, code, name, username, avatar, country, fields[],
 *     hubs, subscribers, items, minutes, likes, joined, counts:{kind:n},
 *     role: owner | publisher | both,
 *     writes, writes_hubs:[ { id, code, kind, name, owner_name, items } ] }
 *
 * `hubs`/`subscribers`/`counts` count what the member owns; `writes` and
 * `writes_hubs` count where they write without owning. `items` counts
 * everything they published in either place, which is why a publisher with
 * no hub of their own still has a number.
 */
create or replace function public.creators_search(
  p_token   text,
  p_role    text,
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
  v_role      text := lower(btrim(coalesce(p_role, '')));
  v_query     text := btrim(coalesce(p_query, ''));
  v_kind      text := lower(btrim(coalesce(p_kind, '')));
  v_country   text := btrim(coalesce(p_country, ''));
  v_sort      text := lower(btrim(coalesce(p_sort, 'subscribers')));
  v_owner     boolean;
  v_pub       boolean;
  v_rows      jsonb;
  v_countries jsonb;
  v_owners    int := 0;
  v_pubs      int := 0;
begin
  if v_role = 'all' then
    v_role := '';
  end if;
  if v_role not in ('', 'owner', 'publisher') then
    v_role := '';
  end if;
  if v_kind = 'studio' then
    v_kind := 'channel';
  end if;

  v_owner := v_role in ('', 'owner');
  v_pub   := v_role in ('', 'publisher');

  select coalesce(jsonb_agg(row_json), '[]'::jsonb),
         count(*) filter (where owns > 0),
         count(*) filter (where writes > 0)
    into v_rows, v_owners, v_pubs
    from (
      select jsonb_build_object(
               'ref',         m.member_id,
               'code',        m.member_id,
               'name',        coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id),
               'username',    m.username,
               'avatar',      m.avatar_url,
               'country',     m.country,
               'fields',      m.fields,
               'hubs',        m.owns,
               'subscribers', m.subscribers,
               'items',       m.items,
               'minutes',     m.minutes,
               'likes',       m.likes,
               'joined',      m.created_at,
               'counts',      m.counts,
               'role',        case when m.owns > 0 and m.writes > 0 then 'both'
                                   when m.writes > 0 then 'publisher'
                                   else 'owner' end,
               'writes',      m.writes,
               'writes_hubs', public.creator_published_hubs(m.id, v_kind)
             ) as row_json,
             m.owns,
             m.writes
        from (
          select mm.id, mm.member_id, mm.full_name, mm.username, mm.avatar_url,
                 mm.country, mm.created_at,
                 (select count(*) from public.creator_hubs h
                   where h.owner = mm.id and h.visibility <> 'private') as owns,
                 (select count(*) from public.creator_hubs h
                   where h.owner <> mm.id and h.visibility <> 'private'
                     and mm.member_id = any (h.publishers)) as writes,
                 (select coalesce(sum(public.creator_hub_subscribers(h.id)), 0)
                    from public.creator_hubs h
                   where h.owner = mm.id and h.visibility <> 'private') as subscribers,
                 (select count(*) from public.member_content c
                    join public.creator_hubs h on h.id = c.hub
                   where c.member = mm.id and c.status = 'published'
                     and h.visibility <> 'private'
                     and (h.owner = mm.id or mm.member_id = any (h.publishers))) as items,
                 (select coalesce(sum(c.view_minutes), 0) from public.member_content c
                    join public.creator_hubs h on h.id = c.hub
                   where c.member = mm.id and h.visibility <> 'private'
                     and (h.owner = mm.id or mm.member_id = any (h.publishers))) as minutes,
                 (select coalesce(sum(c.likes), 0) from public.member_content c
                    join public.creator_hubs h on h.id = c.hub
                   where c.member = mm.id and h.visibility <> 'private'
                     and (h.owner = mm.id or mm.member_id = any (h.publishers))) as likes,
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
        ) m
       where ((v_owner and m.owns > 0) or (v_pub and m.writes > 0))
         and (v_query = ''
              or coalesce(m.full_name, '') ilike '%' || v_query || '%'
              or coalesce(m.username, '') ilike '%' || v_query || '%'
              or coalesce(m.member_id, '') ilike '%' || v_query || '%')
         and (v_country = '' or lower(coalesce(m.country, '')) = lower(v_country))
         and (v_kind = ''
              or (v_owner and exists (select 1 from public.creator_hubs h
                                       where h.owner = m.id and h.kind = v_kind
                                         and h.visibility <> 'private'))
              or (v_pub and exists (select 1 from public.creator_hubs h
                                     where h.owner <> m.id and h.kind = v_kind
                                       and h.visibility <> 'private'
                                       and m.member_id = any (h.publishers))))
       order by (case when v_sort = 'items' then m.items
                      when v_sort = 'subscribers' then m.subscribers
                      else 0 end) desc,
                (case when v_sort = 'new' then m.created_at end) desc nulls last,
                coalesce(m.full_name, m.username, m.member_id)
       limit 60
    ) s;

  select coalesce(jsonb_agg(c.code order by c.code), '[]'::jsonb)
    into v_countries
    from (
      select distinct btrim(m.country) as code
        from public.members m
       where nullif(btrim(m.country), '') is not null
         and m.status <> 'banned'
         and ((v_owner and exists (select 1 from public.creator_hubs h
                                    where h.owner = m.id and h.visibility <> 'private'))
              or (v_pub and exists (select 1 from public.creator_hubs h
                                     where h.owner <> m.id and h.visibility <> 'private'
                                       and m.member_id = any (h.publishers))))
    ) c;

  return jsonb_build_object(
    'ok',         true,
    'role',       case when v_owner and v_pub then 'all' else v_role end,
    'rows',       v_rows,
    'countries',  v_countries,
    'count',      jsonb_array_length(v_rows),
    'owners',     v_owners,
    'publishers', v_pubs
  );
end;
$$;

/* the old five-argument shape has no role; drop it so nothing calls it */
drop function if exists public.creators_search(text, text, text, text, text);

/* ------------------------------------------------------------------ */
/* 3. one creator — owners and publishers in one page                 */
/* ------------------------------------------------------------------ */
/*
 * creator_public(token, ref) is creator-public.sql's, with one addition:
 *
 *   pubhubs  the hubs this member writes in without owning them
 *   totals.writes  how many of those hubs there are
 *
 * A member can be both: an owner of a blog and a publisher in two
 * libraries. Their page lists both, and `is_publisher` says the second
 * list is not empty.
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
  v_pubhubs jsonb;
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
           'code',        h.code,
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

  v_pubhubs := public.creator_published_hubs(v_owner.id, '', 20);

  select jsonb_build_object(
           'hubs',        jsonb_array_length(v_hubs),
           'writes',      jsonb_array_length(v_pubhubs),
           'subscribers', coalesce((select sum(public.creator_hub_subscribers(h.id)) from public.creator_hubs h where h.owner = v_owner.id), 0),
           'items',       coalesce((select count(*) from public.member_content c join public.creator_hubs h on h.id = c.hub
                                     where c.member = v_owner.id and c.status = 'published'
                                       and (h.owner = v_owner.id or v_owner.member_id = any (h.publishers))), 0),
           'minutes',     coalesce((select sum(c.view_minutes) from public.member_content c join public.creator_hubs h on h.id = c.hub
                                     where h.owner = v_owner.id), 0),
           'likes',       coalesce((select sum(c.likes) from public.member_content c join public.creator_hubs h on h.id = c.hub
                                     where h.owner = v_owner.id), 0))
    into v_totals;

  return jsonb_build_object(
    'ok', true,
    'is_self', v_self,
    'is_publisher', jsonb_array_length(v_pubhubs) > 0,
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
    'hubs', v_hubs,
    'pubhubs', v_pubhubs
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 4. grants                                                          */
/* ------------------------------------------------------------------ */
revoke all on function public.creators_search(text, text, text, text, text, text) from public;
revoke all on function public.creator_published_hubs(uuid, text, int) from public;
revoke all on function public.creator_public(text, text) from public;

grant execute on function public.creators_search(text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.creator_published_hubs(uuid, text, int) to anon, authenticated, service_role;
grant execute on function public.creator_public(text, text) to anon, authenticated, service_role;
