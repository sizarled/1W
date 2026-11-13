-- ==================================================================
-- reach-earnings — how a studio's points are earned
-- ------------------------------------------------------------------
-- studio-reach.sql gave every studio a day's budget and a tab to plan it.
-- This file decides **what that budget is made of**:
--
--   the level gives the floor        LV1 100 · LV2 200 … LV10 1 000 · LVMax no
--                                   number at all (first, and never spent)
--   the interactions move it        repost +60 · like +30 · dislike −30
--                                   positive comment +30 · negative −30
--                                   share link +10 · visit from it +10
--                                   report −60
--
-- **Reach points** are moved by what happens anywhere the work is shown: the
-- suggestions and updates beside it, the notifications, and the search
-- results.
--
-- **Ranking points** are moved by the same numbers, but only by what happens
-- on a **search result**. A like on a search result is worth 30 ranking
-- points; the same like on the watch page is worth none. Reach says how far
-- the work travels today, rank says where it stands in a search, and only a
-- search decides where it stands.
--
-- A comment never comes alone: `post_comment` refuses until the member has
-- liked or disliked the post, and the comment takes that reaction's sign — so
-- "positive comment" and "negative comment" are decided by the like/dislike
-- that opened the door, not by the words.
--
-- Applied on 2026-12-06 as one migration, after studio-reach.sql.
--
--   §1 reach_worth     the table of what each interaction is worth
--   §2 reach_events    every point that moved, with its source
--   §3 reach_award     one interaction, into the ledger and (on a search)
--                      into rank_points
--   §4 share visits    +10 for the link, +10 for each visit from it
--   §5 the RPCs        post_react_from / post_comment_from /
--                      post_reshare_from / post_report_from — the same calls
--                      the pages already make, plus where they came from
--   §6 post_rank_recompute  rank from search interactions only
-- ==================================================================

begin;

-- ------------------------------------------------------------------
-- 1. what an interaction is worth
-- ------------------------------------------------------------------
create table if not exists public.reach_worth (
  event text primary key,
  delta integer not null,
  note  text not null default ''
);

insert into public.reach_worth (event, delta, note) values
  ('repost',       60,  'every repost adds 60'),
  ('like',         30,  'a like adds 30'),
  ('dislike',     -30,  'a dislike takes 30'),
  ('comment_pos',  30,  'a positive comment adds 30'),
  ('comment_neg', -30,  'a negative comment takes 30'),
  ('share',        10,  'every share link adds 10'),
  ('share_visit',  10,  'every visit from that link adds 10 more'),
  ('report',      -60,  'every report takes 60')
on conflict (event) do update
  set delta = excluded.delta,
      note  = excluded.note;

alter table public.reach_worth enable row level security;

-- ------------------------------------------------------------------
-- 2. every point that moved
-- ------------------------------------------------------------------
create table if not exists public.reach_events (
  id       bigint generated always as identity primary key,
  hub_id   uuid not null references public.creator_hubs (id) on delete cascade,
  item     text not null default 'post' check (item in ('post', 'content')),
  ref      uuid not null,
  event    text not null references public.reach_worth (event),
  /* where it happened: only `search` moves the ranking points */
  source   text not null default 'feed' check (source in ('feed', 'suggestion', 'notification', 'search', 'share', 'profile')),
  delta    integer not null,
  profile  uuid,
  day      date not null default current_date,
  at       timestamptz not null default now()
);

create index if not exists reach_events_ref_idx  on public.reach_events (ref, at desc);
create index if not exists reach_events_hub_idx  on public.reach_events (hub_id, day);
create index if not exists reach_events_kind_idx on public.reach_events (ref, source);

alter table public.reach_events enable row level security;

-- ------------------------------------------------------------------
-- 3. one interaction
-- ------------------------------------------------------------------
/**
 * The one door every point goes through: move a studio's reach by `p_delta`,
 * and — when the interaction happened on a **search result** — the item's
 * ranking points by the same number.
 *
 * A studio's own member never moves its own numbers, exactly as they are never
 * charged a reach point for looking at their own work.
 */
create or replace function public.reach_move(
  p_item    text,
  p_ref     uuid,
  p_delta   integer,
  p_source  text,
  p_profile uuid,
  p_event   text
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_hub   uuid;
  v_owner uuid;
  v_src   text := case when btrim(coalesce(p_source, '')) in ('feed', 'suggestion', 'notification', 'search', 'share', 'profile')
                       then btrim(p_source) else 'feed' end;
  v_item  text := case when p_item = 'content' then 'content' else 'post' end;
begin
  if p_ref is null or coalesce(p_delta, 0) = 0 then
    return 0;
  end if;

  if v_item = 'post' then
    select p.hub_id into v_hub from public.posts p where p.id = p_ref;
  else
    select c.hub into v_hub from public.member_content c where c.id = p_ref;
  end if;

  /* not a studio's work: nothing to move */
  if v_hub is null then
    return 0;
  end if;

  select owner into v_owner from public.creator_hubs where id = v_hub;
  if v_owner is not null and v_owner = p_profile then
    return 0;
  end if;

  perform public.reach_sync(v_hub);

  update public.hub_reach b
     set earned = b.earned + p_delta,
         updated_at = now()
   where b.hub_id = v_hub;

  perform public.reach_sync(v_hub);

  insert into public.reach_events (hub_id, item, ref, event, source, delta, profile)
  values (v_hub, v_item, p_ref, p_event, v_src, p_delta, p_profile);

  /* rank moves on a search result only, and never below zero */
  if v_src = 'search' then
    if v_item = 'post' then
      update public.posts p
         set rank_points = greatest(0, p.rank_points + p_delta)
       where p.id = p_ref;
    else
      update public.member_content c
         set rank_points = greatest(0, c.rank_points + p_delta)
       where c.id = p_ref;
    end if;
  end if;

  return p_delta;
end;
$function$;

/** One interaction from the worth table. */
create or replace function public.reach_award(
  p_item    text,
  p_ref     uuid,
  p_event   text,
  p_source  text,
  p_profile uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_delta integer;
begin
  select w.delta into v_delta from public.reach_worth w where w.event = p_event;
  if v_delta is null then
    return 0;
  end if;
  return public.reach_move(p_item, p_ref, v_delta, p_source, p_profile, p_event);
end;
$function$;

/** The same, for an item handed in by its code — `VID-001032` or a podcast code. */
create or replace function public.reach_item_of(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_ref  uuid;
  v_item text;
begin
  select p.id, 'post' into v_ref, v_item
    from public.posts p
   where p.post_code = btrim(coalesce(p_code, ''))
   limit 1;

  if v_ref is null then
    select c.id, 'content' into v_ref, v_item
      from public.member_content c
     where upper(left(replace(c.id::text, '-', ''), 8)) = upper(btrim(coalesce(p_code, '')))
     limit 1;
  end if;

  if v_ref is null then
    return null;
  end if;

  return jsonb_build_object('item', v_item, 'ref', v_ref);
end;
$function$;

create or replace function public.reach_award_code(
  p_code    text,
  p_event   text,
  p_source  text,
  p_profile uuid
)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_found jsonb := public.reach_item_of(p_code);
begin
  if v_found is null then
    return 0;
  end if;
  return public.reach_award(v_found ->> 'item', (v_found ->> 'ref')::uuid, p_event, p_source, p_profile);
end;
$function$;

-- ------------------------------------------------------------------
-- 4. a share link, and the visits it brings
-- ------------------------------------------------------------------
/** The share button: the link itself is worth 10. */
create or replace function public.reach_share_link(p_token text, p_code text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me    public.members%rowtype := public.member_from_token(p_token);
  v_found jsonb := public.reach_item_of(p_code);
begin
  if v_found is null then
    return jsonb_build_object('ok', true, 'credited', 0);
  end if;
  return jsonb_build_object(
    'ok', true,
    'credited', public.reach_award(v_found ->> 'item', (v_found ->> 'ref')::uuid, 'share', p_source, v_me.id)
  );
end;
$function$;

/**
 * A visit that arrived from somebody's share link: +20 in all — 10 for the
 * share, 10 for the reader it brought.
 *
 * Once per member per day: a refresh is not a new reader, and the same link
 * opened twice is not two visits.
 */
create or replace function public.reach_share_visit(p_token text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me    public.members%rowtype := public.member_from_token(p_token);
  v_found jsonb := public.reach_item_of(p_code);
  v_ref   uuid;
  v_item  text;
  v_twice boolean;
  v_delta integer := 0;
begin
  if v_found is null then
    return jsonb_build_object('ok', true, 'credited', 0);
  end if;

  v_ref := (v_found ->> 'ref')::uuid;
  v_item := v_found ->> 'item';

  if v_me.id is not null then
    select exists (
      select 1 from public.reach_events e
       where e.ref = v_ref and e.event = 'share_visit'
         and e.profile = v_me.id and e.day = current_date
    ) into v_twice;
    if v_twice then
      return jsonb_build_object('ok', true, 'credited', 0);
    end if;
  end if;

  v_delta := v_delta + public.reach_award(v_item, v_ref, 'share', 'share', v_me.id);
  v_delta := v_delta + public.reach_award(v_item, v_ref, 'share_visit', 'share', v_me.id);

  return jsonb_build_object('ok', true, 'credited', v_delta);
end;
$function$;

-- ------------------------------------------------------------------
-- 5. the calls the pages already make, plus where they came from
-- ------------------------------------------------------------------
/*
 * Everything below is a thin shell around a function that is already live: it
 * calls the same function, and then moves the points. A page says only where
 * the reader came from — `search` on a search result, `feed` everywhere else —
 * and reach always moves, while rank moves on a search result only.
 */

/**
 * A reaction. `p_was` is the reaction the member had before this call (0, 1
 * or −1), so a like turned into a dislike moves the number from +30 to −30 as
 * one −60 step instead of counting both twice.
 */
create or replace function public.post_react_from(p_token text, p_ref text, p_value int, p_source text, p_was int default 0)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me    public.members%rowtype := public.member_from_token(p_token);
  v_res   jsonb;
  v_found jsonb;
  v_worth integer;
  v_delta integer;
  v_now   integer := case when coalesce(p_value, 0) > 0 then 1
                          when coalesce(p_value, 0) < 0 then -1 else 0 end;
  v_was   integer := case when coalesce(p_was, 0) > 0 then 1
                          when coalesce(p_was, 0) < 0 then -1 else 0 end;
begin
  v_res := public.post_react(p_token, p_ref, p_value);

  if v_res is null or not coalesce((v_res ->> 'ok')::boolean, false) then
    return v_res;
  end if;

  v_found := public.reach_item_of(p_ref);
  if v_found is null or v_was = v_now then
    return v_res;
  end if;

  select w.delta into v_worth from public.reach_worth w where w.event = 'like';
  v_delta := (case v_now when 1 then v_worth when -1 then -v_worth else 0 end)
           - (case v_was when 1 then v_worth when -1 then -v_worth else 0 end);

  perform public.reach_move(v_found ->> 'item', (v_found ->> 'ref')::uuid, v_delta, p_source, v_me.id,
                            case when v_delta > 0 then 'like' else 'dislike' end);

  return v_res;
end;
$function$;

/** A comment — the sign is the reaction that opened the door. */
create or replace function public.post_comment_from(p_token text, p_ref text, p_body text, p_parent_id bigint, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me   public.members%rowtype := public.member_from_token(p_token);
  v_res  jsonb;
  v_sign integer := 1;
begin
  v_res := public.post_comment(p_token, p_ref, p_body, p_parent_id);

  if v_res is null or not coalesce((v_res ->> 'ok')::boolean, false) then
    return v_res;
  end if;

  v_sign := case when coalesce((v_res ->> 'sentiment')::integer, 1) < 0 then -1 else 1 end;
  perform public.reach_award_code(p_ref, case when v_sign > 0 then 'comment_pos' else 'comment_neg' end, p_source, v_me.id);

  return v_res;
end;
$function$;

/** A repost. */
create or replace function public.post_reshare_from(p_token text, p_ref text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me  public.members%rowtype := public.member_from_token(p_token);
  v_res jsonb;
begin
  v_res := public.post_reshare(p_token, p_ref);

  if v_res is not null and coalesce((v_res ->> 'ok')::boolean, false) then
    perform public.reach_award_code(p_ref, 'repost', p_source, v_me.id);
  end if;

  return v_res;
end;
$function$;

/** A report. */
create or replace function public.post_report_from(p_token text, p_ref text, p_reason text, p_note text, p_source text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_me  public.members%rowtype := public.member_from_token(p_token);
  v_res jsonb;
begin
  v_res := public.post_report(p_token, p_ref, p_reason, p_note);

  if v_res is not null and coalesce((v_res ->> 'ok')::boolean, false) then
    perform public.reach_award_code(p_ref, 'report', p_source, v_me.id);
  end if;

  return v_res;
end;
$function$;

-- ------------------------------------------------------------------
-- 6. ranking points are what a search brought
-- ------------------------------------------------------------------
/**
 * The ranking number of one item, worked out from the interactions that came
 * from a search result — and from nothing else.
 *
 * Replaces the old recompute (which mixed in every like and report wherever
 * it happened). Called by the same triggers, so nothing else has to change.
 */
create or replace function public.post_rank_recompute(p_post uuid)
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_rank integer;
begin
  select greatest(0, coalesce(sum(e.delta), 0)) into v_rank
    from public.reach_events e
   where e.ref = p_post and e.source = 'search';

  update public.posts p set rank_points = v_rank where p.id = p_post;
  return v_rank;
end;
$function$;

-- ------------------------------------------------------------------
-- 7. grants
-- ------------------------------------------------------------------
revoke all on function public.reach_move(text, uuid, integer, text, uuid, text) from public;
revoke all on function public.reach_award(text, uuid, text, text, uuid) from public;
revoke all on function public.reach_award_code(text, text, text, uuid) from public;
revoke all on function public.reach_item_of(text) from public;
revoke all on function public.reach_share_link(text, text, text) from public;
revoke all on function public.reach_share_visit(text, text) from public;
revoke all on function public.post_react_from(text, text, int, text, int) from public;
revoke all on function public.post_comment_from(text, text, text, bigint, text) from public;
revoke all on function public.post_reshare_from(text, text, text) from public;
revoke all on function public.post_report_from(text, text, text, text, text) from public;

grant execute on function public.reach_share_link(text, text, text) to anon, authenticated, service_role;
grant execute on function public.reach_share_visit(text, text) to anon, authenticated, service_role;
grant execute on function public.post_react_from(text, text, int, text, int) to anon, authenticated, service_role;
grant execute on function public.post_comment_from(text, text, text, bigint, text) to anon, authenticated, service_role;
grant execute on function public.post_reshare_from(text, text, text) to anon, authenticated, service_role;
grant execute on function public.post_report_from(text, text, text, text, text) to anon, authenticated, service_role;

commit;

-- ------------------------------------------------------------------
-- check
-- ------------------------------------------------------------------
--   -- what an interaction is worth
--   select * from public.reach_worth order by delta desc;
--
--   -- a studio's number: the level's floor, plus what it earned
--   select h.code, m.level, b.base, b.earned, b.points, b.spent, b.limitless
--     from public.hub_reach b
--     join public.creator_hubs h on h.id = b.hub_id
--     join public.members m on m.id = h.owner
--    order by b.points desc;
--
--   -- the last interactions, and where they happened
--   select e.at::time, e.event, e.source, e.delta, p.post_code
--     from public.reach_events e
--     left join public.posts p on p.id = e.ref
--    order by e.at desc limit 30;
--
--   -- LVMax: the open-ended level is stored as 11
--   update public.members set level = 11 where member_id = 'ID100015';
