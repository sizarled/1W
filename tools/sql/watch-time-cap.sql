-- ---------------------------------------------------------------------
-- log_watchtime with a per-title ceiling
-- ---------------------------------------------------------------------
-- The site counts watch time only while the visitor is really watching, and
-- a title can never count more than its own TMDB runtime:
--   · movies      -> `runtime` minutes
--   · tv episodes -> the runtime of that exact episode
-- The browser enforces the exact limit; the function enforces a daily
-- backstop per device + title so the ledger cannot be farmed by a script.
--
-- drop the old overload first: PostgREST would see two candidates otherwise
drop function if exists public.log_watchtime(uuid, uuid, bigint, text, int, int, int, boolean, uuid, text);

create or replace function public.log_watchtime(
  p_member    uuid default null,
  p_publisher uuid default null,
  p_tmdb      bigint default null,
  p_type      text default 'movie',
  p_season    int default null,
  p_episode   int default null,
  p_seconds   int default 0,
  p_eligible  boolean default true,
  p_link      uuid default null,
  p_device    text default null,
  p_cap       int default null          -- seconds this title may count per day
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id       bigint;
  v_seconds  int := greatest(0, least(coalesce(p_seconds, 0), 86400));
  v_type     text := case when p_type in ('movie', 'tv') then p_type else 'movie' end;
  v_device   text := left(coalesce(p_device, ''), 80);
  -- never trust the client: 60 s floor, 6 h ceiling
  v_cap      int := least(greatest(coalesce(p_cap, 21600), 60), 21600);
  v_used     int;
  v_allow    int;
begin
  if coalesce(p_tmdb, 0) <= 0 then
    return null;
  end if;

  select coalesce(sum(seconds), 0) into v_used
    from public.watchtime
   where idtmdb = p_tmdb
     and media_type = v_type
     and device_id = v_device
     and coalesce(season, 0)  = case when v_type = 'tv' then coalesce(p_season, 0)  else 0 end
     and coalesce(episode, 0) = case when v_type = 'tv' then coalesce(p_episode, 0) else 0 end
     and watch_date >= date_trunc('day', now());

  v_allow := v_cap - v_used;
  if v_allow <= 0 then
    return null;                       -- the title already counted its full runtime today
  end if;
  v_seconds := least(v_seconds, v_allow);
  if v_seconds <= 0 then
    return null;
  end if;

  insert into public.watchtime (
    idmember, idpublisher, idtmdb, media_type, season, episode, seconds, is_eligible, link_id, device_id
  ) values (
    p_member, p_publisher, p_tmdb, v_type,
    case when v_type = 'tv' then p_season end,
    case when v_type = 'tv' then p_episode end,
    v_seconds, coalesce(p_eligible, true), p_link, v_device
  ) returning id into v_id;

  return v_id;
end $$;

grant execute on function public.log_watchtime(uuid, uuid, bigint, text, int, int, int, boolean, uuid, text, int)
  to anon, authenticated;
