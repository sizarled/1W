-- ---------------------------------------------------------------------
-- Visitor address + country
-- ---------------------------------------------------------------------
-- visitor_visits now keeps three separate things:
--   visitor_address       the visitor's IP (resolved in the browser)
--   visitor_location      the country of that IP ("Morocco")
--   visitor_country_code  the ISO-2 code of that country ("MA")
--   visitor_page          the page that was opened (was visitor_location)
--
alter table public.visitor_visits add column if not exists visitor_page text;
alter table public.visitor_visits add column if not exists visitor_country_code char(2);
alter table public.member_visits  add column if not exists member_page text;

create index if not exists visitor_visits_country_idx on public.visitor_visits (visitor_country_code);
create index if not exists visitor_visits_address_idx on public.visitor_visits (visitor_address);

-- the old overload only knew the page path
drop function if exists public.log_visit(text, text, text, text, text, uuid);

create or replace function public.log_visit(
  p_visitor text default null,
  p_link    text default null,
  p_page    text default null,
  p_purpose text default 'watching',
  p_source  text default 'web',
  p_member  uuid default null,
  p_address text default null,   -- IP of the visitor
  p_country text default null,   -- country name of that IP
  p_code    text default null    -- ISO-2 country code
) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_visitor varchar(6);
  v_digits  text;
  v_freq    int;
  v_member_freq int;
  v_visit   text;
  v_member_visit text;
  v_address inet;
  v_country text := nullif(left(btrim(coalesce(p_country, '')), 120), '');
  v_code    char(2) := case when btrim(coalesce(p_code, '')) ~ '^[A-Za-z]{2}$'
                            then upper(btrim(p_code))::char(2) end;
  v_page    text := left(coalesce(p_page, ''), 2000);
begin
  begin
    v_address := nullif(btrim(coalesce(p_address, '')), '')::inet;
  exception when others then
    v_address := null;                 -- a malformed address must never block the row
  end;

  -- the id the browser keeps must be stored exactly; an unusable one is replaced
  -- by a server-side number instead of being padded into someone else's id
  v_digits := regexp_replace(coalesce(p_visitor, ''), '\D', '', 'g');
  if v_digits ~ '^[0-9]{6}$' and v_digits <> '000000' then
    v_visitor := v_digits;
  else
    v_visitor := lpad((floor(random() * 900000) + 100000)::text, 6, '0');
  end if;

  -- the repeat rate belongs to the page: how many times this visitor opened
  -- this exact page (query string included) before, plus one
  select coalesce(count(*), 0) + 1 into v_freq
    from public.visitor_visits
   where visitor_id = v_visitor and coalesce(visitor_page, '') = v_page;

  if p_member is not null then
    select coalesce(count(*), 0) + 1 into v_member_freq
      from public.member_visits
     where member_id = p_member and coalesce(member_page, '') = v_page;
  end if;

  insert into public.visitor_visits (
    visitor_id, visitor_link, visitor_page, visitor_address, visitor_location,
    visitor_country_code, visitor_frequency, visitor_purpose, visitor_source
  ) values (
    v_visitor, left(coalesce(p_link, ''), 2000), v_page, v_address, v_country,
    v_code, v_freq,
    case when p_purpose in ('watching', 'joining') then p_purpose else 'watching' end,
    left(coalesce(p_source, 'web'), 120)
  ) returning visit_id into v_visit;

  if p_member is not null then
    insert into public.member_visits (
      member_id, visit_link, member_page, member_ip, member_location, visit_frequency, visit_source
    ) values (
      p_member, left(coalesce(p_link, ''), 2000), v_page, v_address, v_country,
      coalesce(v_member_freq, v_freq),
      left(coalesce(p_source, 'web'), 120)
    ) returning visit_id into v_member_visit;
  end if;

  return jsonb_build_object('visit_id', v_visit, 'member_visit_id', v_member_visit, 'frequency', v_freq);
end $$;

-- a slow geo-IP answer is written afterwards, without touching the page path
create or replace function public.annotate_visit(
  p_visit        text default null,
  p_visitor      text default null,
  p_member_visit text default null,
  p_address      text default null,
  p_country      text default null,
  p_code         text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_address inet;
  v_country text := nullif(left(btrim(coalesce(p_country, '')), 120), '');
  v_code    char(2) := case when btrim(coalesce(p_code, '')) ~ '^[A-Za-z]{2}$'
                            then upper(btrim(p_code))::char(2) end;
  v_visitor varchar(6) := left(regexp_replace(coalesce(p_visitor, ''), '\D', '', 'g') || '000000', 6);
  v_hit boolean := false;
begin
  begin
    v_address := nullif(btrim(coalesce(p_address, '')), '')::inet;
  exception when others then
    v_address := null;
  end;

  if v_address is null then
    return false;
  end if;

  if p_visit is not null then
    update public.visitor_visits
       set visitor_address      = v_address,
           visitor_location     = coalesce(v_country, visitor_location),
           visitor_country_code = coalesce(v_code, visitor_country_code)
     where visit_id = p_visit and visitor_id = v_visitor;
    v_hit := v_hit or found;
  end if;

  if p_member_visit is not null then
    update public.member_visits
       set member_ip = v_address,
           member_location = coalesce(v_country, member_location)
     where visit_id = p_member_visit;
    v_hit := v_hit or found;
  end if;

  return v_hit;
end $$;

grant execute on function public.log_visit(text, text, text, text, text, uuid, text, text, text) to anon, authenticated;
grant execute on function public.annotate_visit(text, text, text, text, text, text) to anon, authenticated;
