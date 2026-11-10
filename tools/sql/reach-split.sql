-- ==================================================================
-- reach-split — the day is divided evenly, by the server, not typed
-- ------------------------------------------------------------------
-- studio-reach.sql handed the studio a plan to fill in: one number per item,
-- a "Save the plan" button, and a refusal when the numbers added up to more
-- than the day. That was one more thing to keep in step with the shelf — a
-- video published after the plan was written had no share at all, and a video
-- deleted kept one.
--
-- So the split is a rule now, and nobody types it:
--
--   every item the studio has published today gets an equal share of the
--   studio's reach — 100 points over 2 videos is 50 each, 100 over 3 is
--   34 / 33 / 33 (the odd point goes to the oldest first, so the whole day is
--   placed and none of it is left in the drawer),
--
-- and the shelf is read live, so an item that is published or removed changes
-- the share of everything else the next time anything is counted. No plan is
-- stored, and `hub_reach_save` — the manual plan — is gone.
--
--   §1 reach_split      the arithmetic, in one place
--   §2 reach_share      one item's share of one studio's day
--   §3 reach_claim      the same gate, with the share as the item's allowance
--   §4 hub_reach_get    the tab: the share per row, and the count it came from
--   §5 the manual plan  dropped
-- ==================================================================

begin;

-- ------------------------------------------------------------------
-- 1. the arithmetic
-- ------------------------------------------------------------------
/**
 * The day's points over the number of items, with the remainder handed to the
 * first few — and never less than one, so a studio with more items than points
 * still shows every one of them; the studio's own budget is what stops the
 * day, not a share of zero.
 */
create or replace function public.reach_split(p_points integer, p_total bigint, p_rank bigint)
returns integer
language sql
immutable
as $function$
  select case
           when coalesce(p_total, 0) <= 0 then 0
           else greatest(
                  1,
                  (coalesce(p_points, 0) / p_total)::integer
                    + case when p_rank <= coalesce(p_points, 0) % p_total then 1 else 0 end
                )
         end;
$function$;

-- ------------------------------------------------------------------
-- 2. one item's share of one studio's day
-- ------------------------------------------------------------------
/**
 * The shelf is `hub_reach_get`'s shelf: a published video is a row in `posts`,
 * a published podcast or song is a row in `member_content`. Ranked oldest
 * first, so the same item gets the same share all day and the odd point lands
 * on the same row.
 *
 *   -1   LVMax — no number, and no cap
 *    0   the studio has nothing to divide
 */
create or replace function public.reach_share(p_hub uuid, p_kind text, p_ref uuid)
returns integer
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  with shelf as (
    select 'post'::text as kind, p.id as ref,
           coalesce(p.published_at, p.created_at) as at
      from public.posts p
     where p.hub_id = p_hub and p.status = 'published' and p.content_type = 'video'
    union all
    select 'content', c.id, coalesce(c.published_at, c.created_at)
      from public.member_content c
     where c.hub = p_hub and c.status = 'published' and c.kind in ('podcast', 'video')
  ), ranked as (
    select kind, ref,
           row_number() over (order by at nulls last, ref) as n,
           count(*) over () as total
      from shelf
  )
  select case
           when b.hub_id is null then 0
           when b.limitless then -1
           else coalesce((select public.reach_split(b.points, r.total, r.n)
                            from ranked r
                           where r.kind = case when p_kind = 'content' then 'content' else 'post' end
                             and r.ref = p_ref), 0)
         end
    from (select 1) one
    left join public.hub_reach b on b.hub_id = p_hub;
$function$;

-- ------------------------------------------------------------------
-- 3. the gate: the share is the allowance
-- ------------------------------------------------------------------
/**
 * The same gate as before — the studio's day is a budget, one person is one
 * point, somebody who has already seen the item today costs nothing, the
 * studio's own members are never counted — with the one change that matters:
 * an item's allowance is its **share**, not a number somebody saved.
 *
 * The row it keeps in `reach_items` is now a ledger rather than a plan: how
 * many people it reached today (`shown`) and what that share was (`points`),
 * so the tab and `reach_screen` read the same two numbers the gate used.
 */
create or replace function public.reach_claim(p_hub uuid, p_kind text, p_ref uuid, p_profile uuid, p_source text default 'suggestion')
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
  v_src    text := case when btrim(coalesce(p_source, '')) in ('notification', 'suggestion', 'search', 'feed', 'share', 'profile')
                        then btrim(p_source) else 'suggestion' end;
begin
  v_budget := public.reach_sync(p_hub);
  if v_budget.hub_id is null then
    return true;
  end if;

  select owner into v_owner from public.creator_hubs where id = p_hub;
  if v_owner = p_profile then
    return true;
  end if;

  /* LVMax: always first, and the showing never runs out */
  if v_budget.limitless then
    return true;
  end if;

  /* the day is finished: nothing more goes out until tomorrow */
  if v_budget.spent >= v_budget.points then
    return false;
  end if;

  /* this item's even share of the day — read from the shelf as it is now */
  v_cap := public.reach_share(p_hub, p_kind, p_ref);
  if v_cap = 0 then
    return false;
  end if;

  select * into v_item from public.reach_items where kind = p_kind and ref = p_ref;
  if v_item.id is not null and v_item.shown >= v_cap then
    return false;
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

  /* the ledger: one more person reached, and the share it was reached under */
  insert into public.reach_items (hub_id, kind, ref, code, points, shown, day)
  values (p_hub, p_kind, p_ref, '', v_cap, 1, current_date)
  on conflict (kind, ref) do update
    set shown  = public.reach_items.shown + 1,
        points = greatest(v_cap, 0),
        hub_id = p_hub,
        day    = current_date;

  update public.hub_reach
     set spent = spent + 1,
         updated_at = now()
   where hub_id = p_hub;

  /* who was reached, and on which surface — the numbers the tab shows */
  insert into public.reach_impressions (hub_id, item, ref, source, profile, day)
  values (p_hub, case when p_kind = 'content' then 'content' else 'post' end, p_ref, v_src, p_profile, current_date);

  return true;
end;
$function$;

-- ------------------------------------------------------------------
-- 4. the tab: the share per row, and the count it came from
-- ------------------------------------------------------------------
/**
 * The shelf is read live and ranked once, so every row carries the share the
 * gate will use for it — 50 each for a studio with 100 points and two videos.
 * Nothing here is typed, so nothing here is saved: the answer is the rule.
 */
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
  v_count  integer := 0;
  v_share  integer := 0;
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

  v_budget := public.reach_sync(v_hub.id);

  /* the shelf is read live and ranked once, so every row carries the share the
     gate will use for it — and the count the whole day is divided by */
  select coalesce(jsonb_agg(row order by row ->> 'sort', row ->> 'title'), '[]'::jsonb)
    into v_rows
    from (
      with shelf as (
        select 'post'::text as kind, p.id as ref,
               coalesce(p.published_at, p.created_at) as at
          from public.posts p
         where p.hub_id = v_hub.id and p.status = 'published' and p.content_type = 'video'
        union all
        select 'content', c.id, coalesce(c.published_at, c.created_at)
          from public.member_content c
         where c.hub = v_hub.id and c.status = 'published' and c.kind in ('podcast', 'video')
      ), ranked as (
        select kind, ref,
               row_number() over (order by at nulls last, ref) as n,
               count(*) over () as total
          from shelf
      )
      /* a video, from posts — with the three surfaces counted beside it */
      select jsonb_build_object(
               'kind', 'post',
               'ref', p.id,
               'code', p.post_code,
               'title', p.title,
               'sort', to_char(coalesce(p.published_at, p.created_at), 'YYYYMMDDHH24MISS'),
               'points', case when v_budget.limitless then -1
                              else public.reach_split(v_budget.points, k.total, k.n) end,
               'shown', coalesce(r.shown, 0),
               'rank', p.rank_points,
               'reached_updates', (select count(*) from public.reach_impressions i
                                    where i.ref = p.id and i.day = current_date and i.source = 'notification'),
               'reached_suggestions', (select count(*) from public.reach_impressions i
                                        where i.ref = p.id and i.day = current_date and i.source = 'suggestion'),
               'reached_search', (select count(*) from public.reach_impressions i
                                   where i.ref = p.id and i.day = current_date and i.source = 'search')
             ) as row
        from ranked k
        join public.posts p on k.kind = 'post' and p.id = k.ref
        left join public.reach_items r on r.kind = 'post' and r.ref = p.id
       where p.hub_id = v_hub.id and p.status = 'published' and p.content_type = 'video'

      union all

      /* a podcast, or a song on the music shelf — one row each */
      select jsonb_build_object(
               'kind', 'content',
               'ref', c.id,
               'code', upper(left(replace(c.id::text, '-', ''), 8)),
               'title', c.title,
               'sort', to_char(coalesce(c.published_at, c.created_at), 'YYYYMMDDHH24MISS'),
               'points', case when v_budget.limitless then -1
                              else public.reach_split(v_budget.points, k.total, k.n) end,
               'shown', coalesce(r.shown, 0),
               'rank', c.rank_points,
               'reached_updates', (select count(*) from public.reach_impressions i
                                    where i.ref = c.id and i.day = current_date and i.source = 'notification'),
               'reached_suggestions', (select count(*) from public.reach_impressions i
                                        where i.ref = c.id and i.day = current_date and i.source = 'suggestion'),
               'reached_search', (select count(*) from public.reach_impressions i
                                   where i.ref = c.id and i.day = current_date and i.source = 'search')
             ) as row
        from ranked k
        join public.member_content c on k.kind = 'content' and c.id = k.ref
        left join public.reach_items r on r.kind = 'content' and r.ref = c.id
       where c.hub = v_hub.id and c.status = 'published' and c.kind in ('podcast', 'video')
    ) boxed;

  v_count := jsonb_array_length(v_rows);
  v_share := case when v_budget.limitless then -1
                  when v_count = 0 then 0
                  else public.reach_split(v_budget.points, v_count, 1) end;

  return jsonb_build_object(
    'ok', true,
    'hub', jsonb_build_object('code', v_hub.code, 'name', v_hub.name, 'kind', v_hub.kind),
    'configured', v_budget.hub_id is not null,
    /* the day's number: what the level gives, what the interactions added,
       and whether this studio is LVMax (limitless, and first in the order) */
    'base', coalesce(v_budget.base, 0),
    'earned', coalesce(v_budget.earned, 0),
    'limitless', coalesce(v_budget.limitless, false),
    'points', coalesce(v_budget.points, 0),
    'spent', coalesce(v_budget.spent, 0),
    'remaining', case when coalesce(v_budget.limitless, false) then -1
                      else greatest(0, coalesce(v_budget.points, 0) - coalesce(v_budget.spent, 0)) end,
    /* the split: how many items the day is shared between, and the share each
       one starts with — a row may carry one point more, and says so itself */
    'items', v_count,
    'share', v_share,
    'auto', true,
    'day', current_date,
    'resets', current_date + 1,
    'rows', v_rows
  );
end;
$function$;

-- ------------------------------------------------------------------
-- 5. the manual plan is gone
-- ------------------------------------------------------------------
/* one number per item, typed and saved, was the plan. It is a rule now, and a
   door that accepts a plan nobody reads is worse than no door: dropped. */
drop function if exists public.hub_reach_save(text, text, jsonb);

-- ------------------------------------------------------------------
-- 6. grants
-- ------------------------------------------------------------------
revoke all on function public.reach_split(integer, bigint, bigint) from public;
revoke all on function public.reach_share(uuid, text, uuid) from public;
revoke all on function public.reach_claim(uuid, text, uuid, uuid, text) from public;
revoke all on function public.hub_reach_get(text, text) from public;

grant execute on function public.reach_split(integer, bigint, bigint) to anon, authenticated, service_role;
grant execute on function public.reach_share(uuid, text, uuid) to anon, authenticated, service_role;
grant execute on function public.hub_reach_get(text, text) to anon, authenticated, service_role;

commit;

-- ------------------------------------------------------------------
-- check
-- ------------------------------------------------------------------
--   -- 100 points over two videos: 50 each
--   select public.reach_share(h.id, 'post', p.id)
--     from public.creator_hubs h join public.posts p on p.hub_id = h.id
--    where h.code = 'IDST100001' and p.content_type = 'video';
--
--   -- the tab, as the studio sees it
--   select public.hub_reach_get('<token>', 'IDST100001');
