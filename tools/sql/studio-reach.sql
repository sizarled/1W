-- ==================================================================
-- studio-reach — how far a studio's content travels, and how high it ranks
-- ------------------------------------------------------------------
-- Two different numbers, on purpose:
--
--   reach points     the studio's own authority, spent as impressions. A
--                    studio with 500 reach points shows its work to 500
--                    interested people a day; a studio with 10 000 can cover
--                    five thousand and still have five thousand left for the
--                    rest of its shelf that day. It is **a day's budget**: at
--                    midnight it comes back whole.
--
--   ranking points   one number per item (a video, a podcast, a song, a
--                    playlist), **permanent**, and the only thing the search
--                    and the "popular" sort are ordered by. The studio hands
--                    them out from the item's own row.
--
-- The example the brief gives, in these terms:
--
--   studio 1   500 reach   video A   rank 5000   suggested first, gone after 500
--   studio 2  1500 reach   video B   rank 1500   next, gone after 1500
--   studio 3 10000 reach   video C   rank  500   last, gone after 5000 — and it
--                                                keeps 5000 for its other work
--
-- and in a search the three come back in rank order (A, B, C) until A and B
-- have spent their reach, at which point C is the first result left standing.
--
-- The reach is only spent on **someone new**: a person who has already been
-- shown the item today costs nothing, and the studio's own members are never
-- counted. A hub that has never been configured is not gated at all, so this
-- migration cannot hide anything that exists today.
--
-- Applied on 2026-12-05 as one migration.
--
--   §1 hub_reach     the studio's day: its points, what it has spent
--   §2 reach_items   one allocation per item, and its ranking points
--   §3 reach_seen    who has already been shown what, so a refresh is free
--   §4 reach_screen  the gate the pages ask before they suggest or search
--   §5 hub_reach_get / hub_reach_save   the studio's Reach tab
--
-- and two one-row helpers, reach_visible / reach_visible_content, that the
-- feeds call so an item whose day is spent never reaches the page.
-- ==================================================================

begin;

-- ------------------------------------------------------------------
-- 1. the studio's day
-- ------------------------------------------------------------------
create table if not exists public.hub_reach (
  hub_id    uuid primary key references public.creator_hubs (id) on delete cascade,
  points    integer not null default 0 check (points >= 0),
  day       date not null default current_date,
  spent     integer not null default 0 check (spent >= 0),
  updated_at timestamptz not null default now()
);

comment on table public.hub_reach is
  'A studio''s reach points: a day''s budget of impressions, spent on people who have not seen the item yet.';

alter table public.hub_reach enable row level security;

-- ------------------------------------------------------------------
-- 2. one allocation per item — and the number search is ordered by
-- ------------------------------------------------------------------
-- a ranking column for member content, so a podcast ranks like a video does
alter table public.member_content
  add column if not exists rank_points integer not null default 0 check (rank_points >= 0);

create table if not exists public.reach_items (
  id        uuid primary key default gen_random_uuid(),
  hub_id    uuid not null references public.creator_hubs (id) on delete cascade,
  kind      text not null check (kind in ('post', 'content')),
  ref       uuid not null,
  code      text not null,
  points    integer not null default 0 check (points >= 0),
  shown     integer not null default 0 check (shown >= 0),
  day       date not null default current_date,
  constraint reach_items_once unique (kind, ref)
);

create index if not exists reach_items_hub_idx on public.reach_items (hub_id);
create index if not exists reach_items_code_idx on public.reach_items (upper(code));

alter table public.reach_items enable row level security;

-- ------------------------------------------------------------------
-- 3. who has already been shown what
-- ------------------------------------------------------------------
create table if not exists public.reach_seen (
  kind       text not null,
  ref        uuid not null,
  profile_id uuid not null references public.profiles (id) on delete cascade,
  day        date not null default current_date,
  primary key (kind, ref, profile_id, day)
);

alter table public.reach_seen enable row level security;

-- ------------------------------------------------------------------
-- 4. the gate
-- ------------------------------------------------------------------
/**
 * A day rolls over: the budget is whole again and every item starts at zero.
 * Called by both doors below, so a studio that is never on the page still
 * starts its day when it opens the tab.
 */
create or replace function public.reach_tick(p_hub uuid)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  update public.hub_reach
     set spent = 0,
         day = current_date,
         updated_at = now()
   where hub_id = p_hub and day < current_date;

  update public.reach_items
     set shown = 0,
         day = current_date
   where hub_id = p_hub and day < current_date;
end;
$function$;

/**
 * One item, one person: may it be shown right now?
 *
 *   allowed   the person sees it, and a reach point is spent (unless they had
 *             already seen it today — a refresh is free)
 *   blocked   the studio's day is finished, or the item's own allowance is
 *
 * The studio's own members are always allowed and never counted.
 */
create or replace function public.reach_claim(p_hub uuid, p_kind text, p_ref uuid, p_profile uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_budget public.hub_reach%rowtype;
  v_item   public.reach_items%rowtype;
  v_owner  uuid;
  v_seen   boolean;
  v_cap    integer;
begin
  select * into v_budget from public.hub_reach where hub_id = p_hub;
  /* never configured: nothing to gate */
  if v_budget.hub_id is null then
    return true;
  end if;

  select owner into v_owner from public.creator_hubs where id = p_hub;
  if v_owner = p_profile then
    return true;
  end if;

  perform public.reach_tick(p_hub);
  select * into v_budget from public.hub_reach where hub_id = p_hub;

  /* the day is finished: nothing more goes out until tomorrow */
  if v_budget.spent >= v_budget.points then
    return false;
  end if;

  select * into v_item from public.reach_items where kind = p_kind and ref = p_ref;

  /* an item with an allowance of its own: it is spent first. An item with none
     draws on whatever the studio has left — the brief's "the rest of the day
     serves the other videos". */
  if v_item.id is not null and v_item.points > 0 then
    v_cap := v_item.points;
    if v_item.shown >= v_cap then
      return false;
    end if;
  end if;

  /* somebody with no session cannot be remembered, so every look is a new
     person and costs a point — the gate stays honest for visitors */
  if p_profile is not null then
    select exists (
      select 1 from public.reach_seen s
       where s.kind = p_kind and s.ref = p_ref and s.profile_id = p_profile and s.day = current_date
    ) into v_seen;

    if v_seen then
      return true;
    end if;

    insert into public.reach_seen (kind, ref, profile_id, day)
    values (p_kind, p_ref, p_profile, current_date)
    on conflict do nothing;
  end if;

  if v_item.id is not null then
    update public.reach_items
       set shown = shown + 1,
           day = current_date
     where id = v_item.id;
  end if;

  update public.hub_reach
     set spent = spent + 1,
         updated_at = now()
   where hub_id = p_hub;

  return true;
end;
$function$;

/**
 * The same gate, but from inside a list: one video, one person.
 *
 * The pages call this while they build a feed, so an item that has spent its
 * reach simply never reaches the page — the next item moves up on its own.
 * Anything that is not the studio's item, or a studio that has never been
 * configured, passes without a word.
 */
create or replace function public.reach_visible(p_post uuid, p_profile uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hub uuid;
begin
  select p.hub_id into v_hub from public.posts p where p.id = p_post;
  if v_hub is null then
    return true;
  end if;
  return public.reach_claim(v_hub, 'post', p_post, p_profile);
end;
$function$;

/** The same for a podcast, a song or a playlist. */
create or replace function public.reach_visible_content(p_content uuid, p_profile uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hub uuid;
begin
  select c.hub into v_hub from public.member_content c where c.id = p_content;
  if v_hub is null then
    return true;
  end if;
  return public.reach_claim(v_hub, 'content', p_content, p_profile);
end;
$function$;

/**
 * The gate the pages ask: a list of codes in, the ones that may be shown now
 * out — in the order they were given. Anything that is not a studio's item
 * passes untouched, so a page can hand it everything it was about to draw.
 */
create or replace function public.reach_screen(p_token text, p_codes jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me      public.members%rowtype := public.member_from_token(p_token);
  v_code    text;
  v_allowed text[] := '{}';
  v_blocked text[] := '{}';
  v_left    jsonb := '[]'::jsonb;
  v_total   integer := 0;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  for v_code in
    select value from jsonb_array_elements_text(case when jsonb_typeof(coalesce(p_codes, '[]'::jsonb)) = 'array'
                                                     then coalesce(p_codes, '[]'::jsonb) else '[]'::jsonb end)
  loop
    declare
      v_ref   uuid;
      v_kind  text;
      v_hub   uuid;
      v_budget public.hub_reach%rowtype;
      v_item  public.reach_items%rowtype;
    begin
      v_total := v_total + 1;

      /* a video — a row in posts */
      select p.id, 'post', p.hub_id into v_ref, v_kind, v_hub
        from public.posts p
       where p.post_code = v_code and p.status = 'published'
       limit 1;

      /* a podcast, a song, a playlist — a row in member_content */
      if v_ref is null then
        select c.id, 'content', c.hub into v_ref, v_kind, v_hub
          from public.member_content c
         where upper(left(replace(c.id::text, '-', ''), 8)) = upper(v_code)
           and c.status = 'published'
         limit 1;
      end if;

      /* not a studio's item at all: it passes */
      if v_ref is null or v_hub is null then
        v_allowed := array_append(v_allowed, v_code);
        continue;
      end if;

      if public.reach_claim(v_hub, v_kind, v_ref, v_me.id) then
        v_allowed := array_append(v_allowed, v_code);
        select * into v_budget from public.hub_reach where hub_id = v_hub;
        select * into v_item from public.reach_items where kind = v_kind and ref = v_ref;
        v_left := v_left || jsonb_build_array(jsonb_build_object(
          'code', v_code,
          'points', coalesce(v_item.points, 0),
          'shown', coalesce(v_item.shown, 0),
          'left', case when coalesce(v_item.points, 0) > 0
                       then greatest(0, coalesce(v_item.points, 0) - coalesce(v_item.shown, 0))
                       else greatest(0, coalesce(v_budget.points, 0) - coalesce(v_budget.spent, 0)) end
        ));
      else
        v_blocked := array_append(v_blocked, v_code);
        v_left := v_left || jsonb_build_array(jsonb_build_object(
          'code', v_code, 'points', coalesce(v_item.points, 0), 'shown', coalesce(v_item.shown, 0), 'left', 0
        ));
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'ok', true,
    'asked', v_total,
    'allowed', to_jsonb(v_allowed),
    'blocked', to_jsonb(v_blocked),
    'rows', v_left
  );
end;
$function$;

-- ------------------------------------------------------------------
-- 5. the studio's Reach tab
-- ------------------------------------------------------------------
/** Everything one hub can reach with: its day, and a row per item. */
create or replace function public.hub_reach_get(p_token text, p_hub text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_budget public.hub_reach%rowtype;
  v_rows   jsonb := '[]'::jsonb;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub
    from public.creator_hubs h
   where h.code = btrim(coalesce(p_hub, '')) or h.id::text = btrim(coalesce(p_hub, ''))
   limit 1;

  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;
  if not public.creator_hub_manage(v_hub, v_me) then
    return jsonb_build_object('ok', false, 'error', 'hub_role');
  end if;

  select * into v_budget from public.hub_reach where hub_id = v_hub.id;
  if v_budget.hub_id is not null then
    perform public.reach_tick(v_hub.id);
    select * into v_budget from public.hub_reach where hub_id = v_hub.id;
  end if;

  select coalesce(jsonb_agg(row order by row ->> 'sort', row ->> 'title'), '[]'::jsonb)
    into v_rows
    from (
      /* a video, from posts */
      select jsonb_build_object(
               'kind', 'post',
               'ref', p.id,
               'code', p.post_code,
               'title', p.title,
               'sort', to_char(coalesce(p.published_at, p.created_at), 'YYYYMMDDHH24MISS'),
               'points', coalesce(r.points, 0),
               'shown', coalesce(r.shown, 0),
               'rank', p.rank_points
             ) as row
        from public.posts p
        left join public.reach_items r on r.kind = 'post' and r.ref = p.id
       where p.hub_id = v_hub.id and p.status = 'published' and p.content_type = 'video'

      union all

      /* a podcast, or a song on the music shelf — one row each, each with its
         own ranking points */
      select jsonb_build_object(
               'kind', 'content',
               'ref', c.id,
               'code', upper(left(replace(c.id::text, '-', ''), 8)),
               'title', c.title,
               'sort', to_char(coalesce(c.published_at, c.created_at), 'YYYYMMDDHH24MISS'),
               'points', coalesce(r.points, 0),
               'shown', coalesce(r.shown, 0),
               'rank', c.rank_points
             ) as row
        from public.member_content c
        left join public.reach_items r on r.kind = 'content' and r.ref = c.id
       where c.hub = v_hub.id and c.status = 'published' and c.kind in ('podcast', 'video')
    ) boxed;

  return jsonb_build_object(
    'ok', true,
    'hub', jsonb_build_object('code', v_hub.code, 'name', v_hub.name, 'kind', v_hub.kind),
    'configured', v_budget.hub_id is not null,
    'points', coalesce(v_budget.points, 0),
    'spent', coalesce(v_budget.spent, 0),
    'remaining', greatest(0, coalesce(v_budget.points, 0) - coalesce(v_budget.spent, 0)),
    'day', current_date,
    'resets', current_date + 1,
    'rows', v_rows
  );
end;
$function$;

/**
 * The tab's save: the studio's own reach, and one line per item —
 * `{"points": 300, "rank": 5000}`.
 *
 * What it refuses:
 *   • a hub this member does not run;
 *   • an allocation that spends more than the studio has for the day;
 *   • a negative number anywhere.
 *
 * The allocations are a standing plan: they survive the night, while `shown`
 * starts again at zero. Ranking points are permanent and are written to the
 * item itself.
 */
create or replace function public.hub_reach_save(p_token text, p_hub text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me     public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype;
  v_data   jsonb := case when jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object'
                         then coalesce(p_payload, '{}'::jsonb) else '{}'::jsonb end;
  v_points integer;
  v_rows   jsonb;
  v_row    jsonb;
  v_total  integer := 0;
  v_item   public.reach_items%rowtype;
  v_saved  integer := 0;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_hub
    from public.creator_hubs h
   where h.code = btrim(coalesce(p_hub, '')) or h.id::text = btrim(coalesce(p_hub, ''))
   limit 1;

  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;
  if not public.creator_hub_manage(v_hub, v_me) then
    return jsonb_build_object('ok', false, 'error', 'hub_role');
  end if;

  v_points := greatest(0, coalesce((v_data ->> 'points')::integer, 0));
  v_rows := case when jsonb_typeof(v_data -> 'rows') = 'array' then v_data -> 'rows' else '[]'::jsonb end;

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    declare
      v_alloc integer := greatest(0, coalesce((v_row ->> 'points')::integer, 0));
    begin
      v_total := v_total + v_alloc;
    end;
  end loop;

  if v_total > v_points then
    return jsonb_build_object('ok', false, 'error', 'over_budget', 'points', v_points, 'asked', v_total);
  end if;

  insert into public.hub_reach (hub_id, points, day, spent)
  values (v_hub.id, v_points, current_date, 0)
  on conflict (hub_id) do update
    set points = excluded.points,
        updated_at = now();

  for v_row in select value from jsonb_array_elements(v_rows)
  loop
    declare
      v_kind  text := case when (v_row ->> 'kind') = 'content' then 'content' else 'post' end;
      v_ref   uuid := nullif(v_row ->> 'ref', '')::uuid;
      v_alloc integer := greatest(0, coalesce((v_row ->> 'points')::integer, 0));
      v_rank  integer := greatest(0, coalesce((v_row ->> 'rank')::integer, 0));
      v_code  text := btrim(coalesce(v_row ->> 'code', ''));
      v_owns  uuid;
    begin
      if v_ref is null then
        continue;
      end if;

      if v_kind = 'post' then
        select p.hub_id into v_owns from public.posts p where p.id = v_ref;
      else
        select c.hub into v_owns from public.member_content c where c.id = v_ref;
      end if;

      /* a row from another hub is not this studio's to place */
      if v_owns is distinct from v_hub.id then
        continue;
      end if;

      insert into public.reach_items (hub_id, kind, ref, code, points, shown, day)
      values (v_hub.id, v_kind, v_ref, v_code, v_alloc, 0, current_date)
      on conflict (kind, ref) do update
        set points = excluded.points,
            hub_id = excluded.hub_id,
            code = excluded.code;

      if v_kind = 'post' then
        update public.posts set rank_points = v_rank where id = v_ref;
      else
        update public.member_content set rank_points = v_rank where id = v_ref;
      end if;

      v_saved := v_saved + 1;
    end;
  end loop;

  return jsonb_build_object('ok', true, 'saved', v_saved, 'points', v_points, 'allocated', v_total);
end;
$function$;

-- ------------------------------------------------------------------
-- 6. grants — the gate, the screen, and the studio's own tab
-- ------------------------------------------------------------------
revoke all on function public.reach_tick(uuid) from public;
revoke all on function public.reach_claim(uuid, text, uuid, uuid) from public;
revoke all on function public.reach_visible(uuid, uuid) from public;
revoke all on function public.reach_visible_content(uuid, uuid) from public;
revoke all on function public.reach_screen(text, jsonb) from public;
revoke all on function public.hub_reach_get(text, text) from public;
revoke all on function public.hub_reach_save(text, text, jsonb) from public;

/* the feeds and the pages ask the gate as the person looking, so anon may ask
   too — a visitor with no session is never remembered, and each look spends */
grant execute on function public.reach_visible(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.reach_visible_content(uuid, uuid) to anon, authenticated, service_role;
grant execute on function public.reach_screen(text, jsonb) to anon, authenticated, service_role;
grant execute on function public.hub_reach_get(text, text) to anon, authenticated, service_role;
grant execute on function public.hub_reach_save(text, text, jsonb) to anon, authenticated, service_role;

commit;

-- ------------------------------------------------------------------
-- check
-- ------------------------------------------------------------------
--   select * from public.hub_reach;
--   select * from public.reach_items order by shown desc limit 20;
--
--   -- hand a studio its authority (no admin panel yet: this is the operator's line)
--   insert into public.hub_reach (hub_id, points)
--   select id, 1500 from public.creator_hubs where code = 'IDST100001'
--   on conflict (hub_id) do update set points = excluded.points;
