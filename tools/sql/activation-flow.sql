-- ==================================================================
-- Activation flow — first activation, reactivation, upgrade
-- ==================================================================
-- Migration `activation_flow`.
--
-- Tables
--   membership_prices  points cost per tier and duration
--   codeactivation     activation / reactivation / upgrade codes
--   payment            one row per activation, reactivation or upgrade
--   paymentlog         every status change of a payment
--
-- Rules from the brief
--   • first activation: free plan only, once, 1-month membership
--   • reactivation: same plan; free = 1 month, premium = 3…24 months
--   • upgrade: a strictly higher tier, premium only, 3…24 months
--   • a new period starts from the current expiry while it is still valid,
--     otherwise from now (no lost days)
--   • points payment, code consumption and the membership change happen in
--     one transaction
--   • activation codes are issued by the server after the 30-second ad gate
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. prices
-- ------------------------------------------------------------------
create table if not exists public.membership_prices (
  tier   text not null check (tier in ('silver', 'gold', 'diamond')),
  months integer not null check (months in (3, 6, 9, 12, 18, 24)),
  points integer not null check (points > 0),
  primary key (tier, months)
);
alter table public.membership_prices enable row level security;

insert into public.membership_prices (tier, months, points) values
  ('silver', 3, 900), ('silver', 6, 1700), ('silver', 9, 2400),
  ('silver', 12, 3000), ('silver', 18, 4200), ('silver', 24, 5200),
  ('gold', 3, 1500), ('gold', 6, 2800), ('gold', 9, 3900),
  ('gold', 12, 4900), ('gold', 18, 6900), ('gold', 24, 8500),
  ('diamond', 3, 2400), ('diamond', 6, 4500), ('diamond', 9, 6300),
  ('diamond', 12, 7900), ('diamond', 18, 11000), ('diamond', 24, 13500)
on conflict (tier, months) do nothing;

-- ------------------------------------------------------------------
-- 2. activation codes
-- ------------------------------------------------------------------
create table if not exists public.codeactivation (
  id                uuid primary key default gen_random_uuid(),
  code              text unique,
  member_id         uuid references public.members(id) on delete cascade,
  activation_type   text not null check (activation_type in ('initial', 'reactivation', 'upgrade')),
  target_membership text not null check (target_membership in ('free', 'silver', 'gold', 'diamond')),
  duration_months   integer not null default 1 check (duration_months > 0),
  payment_method    text not null default 'ad' check (payment_method in ('ad', 'patreon', 'points', 'manual')),
  points_cost       integer not null default 0,
  code_status       text not null default 'pending'
                    check (code_status in ('pending', 'issued', 'used', 'expired', 'abandoned')),
  ad_started_at     timestamptz,
  ad_seconds        integer not null default 30,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null default now() + interval '7 days',
  used_at           timestamptz
);

create unique index if not exists codeactivation_code_key on public.codeactivation (code) where code is not null;
create index if not exists codeactivation_member_idx on public.codeactivation (member_id, created_at desc);
create index if not exists codeactivation_status_idx on public.codeactivation (code_status);
alter table public.codeactivation enable row level security;

-- ------------------------------------------------------------------
-- 3. payments
-- ------------------------------------------------------------------
create table if not exists public.payment (
  id              uuid primary key default gen_random_uuid(),
  member_id       uuid references public.members(id) on delete set null,
  member_ref      text,
  payment_kind    text not null check (payment_kind in ('initial', 'reactivation', 'upgrade', 'points')),
  membership      text not null,
  duration_months integer not null default 1,
  amount_usd      numeric(10, 2) not null default 0,
  points_spent    integer not null default 0,
  method          text not null check (method in ('ad', 'patreon', 'points', 'manual')),
  status          text not null default 'submitted'
                  check (status in ('submitted', 'seen', 'reviewed', 'approved', 'sent', 'received', 'rejected', 'appealed')),
  reference       text,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists payment_member_idx on public.payment (member_id, created_at desc);
alter table public.payment enable row level security;

create table if not exists public.paymentlog (
  id         bigserial primary key,
  payment_id uuid references public.payment(id) on delete set null,
  member_id  uuid,
  member_ref text,
  from_status text,
  to_status   text,
  note        text,
  created_at  timestamptz not null default now()
);
create index if not exists paymentlog_payment_idx on public.paymentlog (payment_id);
alter table public.paymentlog enable row level security;

-- ------------------------------------------------------------------
-- 4. profile columns on members (Profile step)
-- ------------------------------------------------------------------
alter table public.members add column if not exists bio text;
alter table public.members add column if not exists language text default 'en';
alter table public.members add column if not exists profile_updated_at timestamptz;

-- profiles.id mirrors members.id (1:1); the wizard inserts that id explicitly
alter table public.profiles alter column id set default gen_random_uuid();
alter table public.profiles add column if not exists member_id uuid references public.members(id) on delete cascade;
create unique index if not exists profiles_member_key on public.profiles (member_id) where member_id is not null;

-- ------------------------------------------------------------------
-- 5. helpers
-- ------------------------------------------------------------------
create or replace function public.membership_rank(p_membership text)
returns integer
language sql
immutable
as $$
  select case lower(coalesce(p_membership, 'free'))
           when 'free' then 0
           when 'silver' then 1
           when 'gold' then 2
           when 'diamond' then 3
           else -1
         end;
$$;

create or replace function public.activation_code_new()
returns text
language plpgsql
volatile
as $function$
declare
  v_code text;
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  i integer;
begin
  loop
    v_code := 'ACT-';
    for i in 1..4 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    v_code := v_code || '-';
    for i in 1..4 loop
      v_code := v_code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.codeactivation c where c.code = v_code);
  end loop;
  return v_code;
end;
$function$;

create or replace function public.activation_price(p_tier text, p_months integer)
returns integer
language sql
stable
as $$
  select coalesce((select points from public.membership_prices
                    where tier = lower(p_tier) and months = p_months), 0);
$$;

-- ------------------------------------------------------------------
-- 6. what the page may offer
-- ------------------------------------------------------------------
create or replace function public.member_activation_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member   public.members%rowtype;
  v_status   text;
  v_plan     text;
  v_rank     integer;
  v_first    boolean;
  v_requested timestamptz;
  v_codes    integer;
  v_targets  text[] := '{}';
  v_prices   jsonb := '{}'::jsonb;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  v_status := lower(coalesce(v_member.status, 'inactive'));
  v_plan   := lower(coalesce(v_member.membership, 'free'));
  v_rank   := public.membership_rank(v_plan);

  select max(n.created_at) into v_requested
    from public.notifications n
   where n.id_member = v_member.id and n.source = 'activation';

  select count(*) into v_codes from public.viewing_codes c where c.member_id = v_member.id;

  v_first := v_member.account_activated_at is null
             and v_status = 'inactive'
             and v_plan = 'free';

  -- upgrade targets: strictly higher tiers, never for diamond
  if v_status <> 'banned' and v_rank >= 0 and v_rank < 3 then
    if v_rank < 1 then v_targets := array_append(v_targets, 'silver'); end if;
    if v_rank < 2 then v_targets := array_append(v_targets, 'gold'); end if;
    if v_rank < 3 then v_targets := array_append(v_targets, 'diamond'); end if;
  end if;

  select coalesce(jsonb_object_agg(tier, prices), '{}'::jsonb) into v_prices
    from (
      select tier, jsonb_object_agg(months::text, points) as prices
        from public.membership_prices group by tier
    ) p;

  return jsonb_build_object(
    'ok', true,
    'member', public.member_payload(v_member),
    'status', v_status,
    'membership', v_plan,
    'membership_expires_at', v_member.membership_expires_at,
    'activated_at', v_member.account_activated_at,
    'requested_at', v_requested,
    'pending', v_status = 'inactive' and v_requested is not null and v_requested > now() - interval '7 days',
    'deadline', case when v_member.account_activated_at is null
                     then v_member.created_at + interval '30 days'
                     else coalesce(v_member.membership_expires_at, v_member.created_at) + interval '30 days' end,
    'first_activation', coalesce(v_first, false),
    'can_activate', coalesce(v_first, false),
    -- renewal before the expiry date is allowed: the new period starts where the old one ends
    'can_reactivate', v_status <> 'banned' and v_member.account_activated_at is not null,
    'already_active', v_status = 'active',
    'can_upgrade', v_status <> 'banned' and cardinality(v_targets) > 0,
    'upgrade_targets', to_jsonb(v_targets),
    'prices', v_prices,
    'durations', jsonb_build_array(3, 6, 9, 12, 18, 24),
    'ad_seconds', 30,
    'ad_url', 'https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a',
    'profile', jsonb_build_object(
      'name', v_member.full_name,
      'description', v_member.bio,
      'avatar', v_member.avatar_url,
      'cover', v_member.cover_url,
      'language', coalesce(v_member.language, 'en'),
      'country', v_member.country,
      'complete', v_member.profile_updated_at is not null
    ),
    'viewing_codes', v_codes,
    'mode', case
              when v_status = 'banned' then 'blocked'
              when coalesce(v_first, false) then 'activate'
              else 'choose'
            end
  );
end;
$function$;

-- ------------------------------------------------------------------
-- 7. step 1 — profile
-- ------------------------------------------------------------------
create or replace function public.activation_profile_save(
  p_token text, p_name text, p_description text default null, p_avatar text default null,
  p_cover text default null, p_language text default 'en', p_country text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
  v_name text := btrim(coalesce(p_name, ''));
  v_desc text := btrim(coalesce(p_description, ''));
  v_lang text := lower(btrim(coalesce(p_language, 'en')));
  v_country text := btrim(coalesce(p_country, ''));
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then
    return jsonb_build_object('ok', false, 'error', 'name');
  end if;
  if length(v_desc) > 300 then
    return jsonb_build_object('ok', false, 'error', 'description');
  end if;
  if v_lang !~ '^[a-z]{2}(-[a-z]{2})?$' then
    return jsonb_build_object('ok', false, 'error', 'language');
  end if;

  update public.members
     set full_name = v_name,
         bio = nullif(v_desc, ''),
         avatar_url = coalesce(nullif(btrim(coalesce(p_avatar, '')), ''), avatar_url),
         cover_url = coalesce(nullif(btrim(coalesce(p_cover, '')), ''), cover_url),
         language = v_lang,
         country = coalesce(nullif(v_country, ''), country),
         profile_updated_at = now(),
         updated_at = now()
   where id = v_member.id
   returning * into v_member;

  -- profiles.id mirrors members.id (historical 1:1 relation)
  insert into public.profiles (id, member_id, profile_name, profile_username, description, country, avatar_url, cover_url)
  values (v_member.id, v_member.id, v_name, v_member.username, nullif(v_desc, ''), v_member.country, v_member.avatar_url, v_member.cover_url)
  on conflict (id) do update set profile_name = excluded.profile_name,
                description = excluded.description,
                country = excluded.country,
                avatar_url = excluded.avatar_url,
                cover_url = excluded.cover_url,
                member_id = excluded.member_id,
                updated_at = now();

  perform public.member_log_write(v_member.id, null, 'profile_saved',
    jsonb_build_object('avatar', v_member.avatar_url, 'cover', v_member.cover_url, 'language', v_lang), null, null);

  return jsonb_build_object('ok', true, 'profile', jsonb_build_object(
    'name', v_member.full_name, 'description', v_member.bio, 'avatar', v_member.avatar_url,
    'cover', v_member.cover_url, 'language', v_member.language, 'country', v_member.country, 'complete', true));
end;
$function$;

-- ------------------------------------------------------------------
-- 8. step 2 — viewing code (free plan: one month at most)
-- ------------------------------------------------------------------
create or replace function public.activation_viewing_code_save(
  p_token text,
  p_code text default null,
  p_months integer default 1,
  p_age text default 'unspecified',
  p_device text default null,
  p_device_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
  v_plan   text;
  v_code   text;
  v_age    text := lower(coalesce(p_age, 'unspecified'));
  v_row    public.viewing_codes%rowtype;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  v_plan := lower(coalesce(v_member.membership, 'free'));

  if lower(coalesce(v_member.status, '')) not in ('inactive', 'expired') then
    return jsonb_build_object('ok', false, 'error', 'status');
  end if;
  if v_plan = 'free' and coalesce(p_months, 1) > 1 then
    return jsonb_build_object('ok', false, 'error', 'duration');
  end if;
  if v_age not in ('unspecified', '13', '16', '18') then
    return jsonb_build_object('ok', false, 'error', 'age');
  end if;

  v_code := btrim(coalesce(p_code, ''));
  if v_code = '' then
    v_code := public.viewing_code_new();
  end if;
  if v_code !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'code_format');
  end if;
  if exists (select 1 from public.viewing_codes c where c.code = v_code) then
    return jsonb_build_object('ok', false, 'error', 'code_taken');
  end if;

  insert into public.viewing_codes (member_id, code, is_active, duration_months, age_rating,
                                    device_mac, device_name, status, created_at, expires_at, updated_at)
  values (v_member.id, v_code, true, greatest(1, least(coalesce(p_months, 1), 1)),
          case when v_age = 'unspecified' then 'none' else v_age end,
          nullif(btrim(coalesce(p_device, '')), ''), nullif(btrim(coalesce(p_device_name, '')), ''),
          'active', now(), now() + interval '1 month', now())
  returning * into v_row;

  if v_row.device_mac is not null then
    insert into public.watch_code_devices (code_id, device_id, idmember, first_used_at, last_used_at)
    values (v_row.id, v_row.device_mac, v_member.id, now(), now());
  end if;

  perform public.member_log_write(v_member.id, null, 'viewing_code_created',
    jsonb_build_object('code', v_row.code, 'device', v_row.device_mac), null, null);

  return jsonb_build_object('ok', true, 'code', jsonb_build_object(
    'id', v_row.id, 'code', v_row.code, 'months', v_row.duration_months,
    'age', v_row.age_rating, 'device', v_row.device_mac, 'device_name', v_row.device_name,
    'expires_at', v_row.expires_at));
end;
$function$;

-- ------------------------------------------------------------------
-- 9. step 3 — the 30-second advertisement gate
-- ------------------------------------------------------------------
create or replace function public.activation_ad_open(
  p_token text,
  p_type text,
  p_target text default 'free',
  p_duration integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
  v_type   text := lower(btrim(coalesce(p_type, '')));
  v_target text := lower(btrim(coalesce(p_target, 'free')));
  v_dur    integer := greatest(1, coalesce(p_duration, 1));
  v_row    public.codeactivation%rowtype;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_type not in ('initial', 'reactivation', 'upgrade') then
    return jsonb_build_object('ok', false, 'error', 'type');
  end if;
  if v_target not in ('free', 'silver', 'gold', 'diamond') then
    return jsonb_build_object('ok', false, 'error', 'target');
  end if;

  -- the 30-second ad gate issues free-plan codes only
  if v_target <> 'free' then
    return jsonb_build_object('ok', false, 'error', 'payment');
  end if;
  if v_dur <> 1 then
    return jsonb_build_object('ok', false, 'error', 'duration');
  end if;

  insert into public.codeactivation (member_id, activation_type, target_membership, duration_months,
                                     payment_method, code_status, ad_started_at, ad_seconds)
  values (v_member.id, v_type, v_target, 1, 'ad', 'pending', now(), 30)
  returning * into v_row;

  perform public.member_log_write(v_member.id, null, 'activation_ad_opened',
    jsonb_build_object('session', v_row.id, 'type', v_type), null, null);

  return jsonb_build_object('ok', true, 'session', v_row.id, 'seconds', 30,
    'started_at', v_row.ad_started_at,
    'ad_url', 'https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a');
end;
$function$;

create or replace function public.activation_ad_claim(p_token text, p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
  v_row    public.codeactivation%rowtype;
  v_elapsed numeric;
  v_code   text;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_row from public.codeactivation c
   where c.id = p_session and c.member_id = v_member.id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_row.code_status = 'issued' then
    return jsonb_build_object('ok', true, 'code', v_row.code, 'reused', true,
      'type', v_row.activation_type, 'target', v_row.target_membership, 'duration', v_row.duration_months);
  end if;
  if v_row.code_status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  v_elapsed := extract(epoch from (now() - v_row.ad_started_at));
  if v_elapsed < v_row.ad_seconds then
    return jsonb_build_object('ok', false, 'error', 'too_soon',
      'remaining', ceil(v_row.ad_seconds - v_elapsed)::int);
  end if;

  v_code := public.activation_code_new();
  update public.codeactivation
     set code = v_code, code_status = 'issued', expires_at = now() + interval '7 days'
   where id = v_row.id
   returning * into v_row;

  perform public.member_log_write(v_member.id, null, 'activation_code_issued',
    jsonb_build_object('session', v_row.id, 'type', v_row.activation_type), null, null);

  return jsonb_build_object('ok', true, 'code', v_row.code, 'reused', false,
    'type', v_row.activation_type, 'target', v_row.target_membership, 'duration', v_row.duration_months);
end;
$function$;

create or replace function public.activation_ad_cancel(p_token text, p_session uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  update public.codeactivation
     set code_status = 'abandoned'
   where id = p_session and member_id = v_member.id and code_status = 'pending';
  perform public.member_log_write(v_member.id, null, 'activation_ad_cancelled',
    jsonb_build_object('session', p_session), null, null);
  return jsonb_build_object('ok', true);
end;
$function$;

-- ------------------------------------------------------------------
-- 10. paying with points (premium only)
-- ------------------------------------------------------------------
create or replace function public.activation_pay_points(
  p_token text, p_type text, p_target text default 'silver', p_duration integer default 3)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
  v_type text := lower(btrim(coalesce(p_type, '')));
  v_target text := lower(btrim(coalesce(p_target, '')));
  v_dur integer := coalesce(p_duration, 0);
  v_price integer;
  v_code text := public.activation_code_new();
  v_row public.codeactivation%rowtype;
  v_balance integer;
  v_pay_id uuid;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_type not in ('reactivation', 'upgrade') then
    return jsonb_build_object('ok', false, 'error', 'type');
  end if;
  if v_dur not in (3, 6, 9, 12, 18, 24) then
    return jsonb_build_object('ok', false, 'error', 'duration');
  end if;

  if v_type = 'upgrade' then
    if public.membership_rank(v_target) <= public.membership_rank(v_member.membership) then
      return jsonb_build_object('ok', false, 'error', 'not_higher');
    end if;
  else
    v_target := lower(coalesce(v_member.membership, 'free'));
    if public.membership_rank(v_target) < 1 then
      return jsonb_build_object('ok', false, 'error', 'free_uses_ad');
    end if;
  end if;

  v_price := public.activation_price(v_target, v_dur);
  if v_price <= 0 then
    return jsonb_build_object('ok', false, 'error', 'price');
  end if;

  begin
    -- the balance is applied by the points_ledger trigger (points_apply)
    select points into v_balance from public.members where id = v_member.id for update;
    if coalesce(v_balance, 0) < v_price then
      return jsonb_build_object('ok', false, 'error', 'points', 'needed', v_price, 'balance', coalesce(v_balance, 0));
    end if;

    insert into public.points_ledger (member_id, delta, balance_after, reason, source)
    values (v_member.id, -v_price, 0, 'Membership ' || v_type, 'activation')
    returning balance_after into v_balance;

    insert into public.codeactivation (code, member_id, activation_type, target_membership,
                                       duration_months, payment_method, points_cost, code_status)
    values (v_code, v_member.id, v_type, v_target, v_dur, 'points', v_price, 'issued')
    returning * into v_row;

    insert into public.payment (member_id, member_ref, payment_kind, membership, duration_months,
                                points_spent, method, status, reference)
    values (v_member.id, v_member.member_id, v_type, v_target, v_dur, v_price, 'points', 'approved', v_row.id::text)
    returning id into v_pay_id;

    insert into public.paymentlog (payment_id, member_id, member_ref, from_status, to_status, note)
    values (v_pay_id, v_member.id, v_member.member_id, null, 'approved', 'Paid with points');

    perform public.member_log_write(v_member.id, null, 'activation_points_paid',
      jsonb_build_object('type', v_type, 'target', v_target, 'months', v_dur, 'points', v_price), null, null);
  exception when others then
    return jsonb_build_object('ok', false, 'error', 'transaction');
  end;

  return jsonb_build_object('ok', true, 'code', v_code, 'points', v_price,
    'balance', v_balance, 'type', v_type, 'target', v_target, 'duration', v_dur);
end;
$function$;

-- ------------------------------------------------------------------
-- 11. step 4 — redeem a code and move the membership
-- ------------------------------------------------------------------
create or replace function public.activation_redeem(
  p_token text,
  p_code text,
  p_type text,
  p_target text default 'free',
  p_duration integer default 1
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member   public.members%rowtype;
  v_row      public.codeactivation%rowtype;
  v_type     text := lower(btrim(coalesce(p_type, '')));
  v_target   text := lower(btrim(coalesce(p_target, 'free')));
  v_dur      integer := greatest(1, coalesce(p_duration, 1));
  v_base     timestamptz;
  v_end      timestamptz;
  v_status   text;
  v_plan     text;
  v_method   text;
  v_pay_id   uuid;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_type not in ('initial', 'reactivation', 'upgrade') then
    return jsonb_build_object('ok', false, 'error', 'type');
  end if;

  select * into v_row from public.codeactivation c
   where upper(c.code) = upper(btrim(coalesce(p_code, '')));
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;
  if v_row.code_status = 'used' or v_row.used_at is not null then
    return jsonb_build_object('ok', false, 'error', 'used');
  end if;
  if v_row.code_status <> 'issued' then
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;
  if v_row.expires_at is not null and v_row.expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if v_row.member_id is not null and v_row.member_id <> v_member.id then
    return jsonb_build_object('ok', false, 'error', 'other_member');
  end if;
  if v_row.activation_type <> v_type then
    return jsonb_build_object('ok', false, 'error', 'type_mismatch');
  end if;
  if v_type = 'upgrade' then
    if public.membership_rank(v_target) <= public.membership_rank(v_member.membership) then
      return jsonb_build_object('ok', false, 'error', 'not_higher');
    end if;
  else
    v_target := lower(coalesce(v_member.membership, 'free'));
  end if;
  if v_row.target_membership <> v_target then
    return jsonb_build_object('ok', false, 'error', 'target_mismatch');
  end if;
  if v_row.duration_months <> v_dur then
    return jsonb_build_object('ok', false, 'error', 'duration_mismatch');
  end if;

  -- rules per operation
  if v_type = 'initial' then
    if v_member.account_activated_at is not null then
      return jsonb_build_object('ok', false, 'error', 'already_activated');
    end if;
    if lower(coalesce(v_member.status, '')) <> 'inactive' then
      return jsonb_build_object('ok', false, 'error', 'status');
    end if;
    if lower(coalesce(v_member.membership, 'free')) <> 'free' then
      return jsonb_build_object('ok', false, 'error', 'plan');
    end if;
    if v_dur <> 1 then
      return jsonb_build_object('ok', false, 'error', 'duration');
    end if;
  else
    if v_member.account_activated_at is null then
      return jsonb_build_object('ok', false, 'error', 'not_activated_yet');
    end if;
    if lower(coalesce(v_member.status, '')) = 'banned' then
      return jsonb_build_object('ok', false, 'error', 'banned');
    end if;
    if lower(coalesce(v_member.membership, 'free')) = 'free' and v_dur <> 1 then
      return jsonb_build_object('ok', false, 'error', 'duration');
    end if;
    if v_dur not in (3, 6, 9, 12, 18, 24) and v_dur <> 1 then
      return jsonb_build_object('ok', false, 'error', 'duration');
    end if;
  end if;

  -- a new period starts after the current one while it is still valid
  v_base := case when v_member.membership_expires_at is not null and v_member.membership_expires_at > now()
                 then v_member.membership_expires_at
                 else now() end;
  v_end := v_base + (v_dur || ' months')::interval;

  begin
    update public.codeactivation
       set code_status = 'used', used_at = now()
     where id = v_row.id and code_status = 'issued';
    if not found then
      raise exception 'code already used';
    end if;

    if v_type = 'initial' then
      update public.members
         set status = 'active',
             membership = 'free',
             membership_started_at = now(),
             membership_expires_at = v_end,
             account_activated_at = coalesce(account_activated_at, now()),
             updated_at = now()
       where id = v_member.id
       returning status, membership into v_status, v_plan;
    elsif v_type = 'upgrade' then
      update public.members
         set status = 'active',
             membership = v_target,
             membership_started_at = now(),
             membership_expires_at = v_end,
             updated_at = now()
       where id = v_member.id
       returning status, membership into v_status, v_plan;
    else
      update public.members
         set status = 'active',
             membership = coalesce(membership, 'free'),
             membership_started_at = coalesce(membership_started_at, now()),
             membership_expires_at = v_end,
             updated_at = now()
       where id = v_member.id
       returning status, membership into v_status, v_plan;
    end if;

    v_method := case when v_row.payment_method in ('ad', 'patreon', 'points')
                     then v_row.payment_method else 'manual' end;

    -- a points payment already exists for this code: close it instead of duplicating it
    if v_row.payment_method = 'points' then
      update public.payment set note = 'Code redeemed', updated_at = now()
       where reference = v_row.id::text
       returning id into v_pay_id;
    end if;

    if v_pay_id is null then
      insert into public.payment (member_id, member_ref, payment_kind, membership, duration_months,
                                  points_spent, method, status, reference, note)
      values (v_member.id, v_member.member_id, v_type, v_plan, v_dur, 0, v_method, 'approved',
              v_row.id::text, 'Activation code consumed')
      returning id into v_pay_id;
    end if;

    insert into public.paymentlog (payment_id, member_id, member_ref, from_status, to_status, note)
    values (v_pay_id, v_member.id, v_member.member_id, null, 'approved', 'Code redeemed');

  exception when others then
    return jsonb_build_object('ok', false, 'error', 'transaction');
  end;

  perform public.member_log_write(v_member.id, null, 'activation_' || v_type,
    jsonb_build_object('membership', v_plan, 'months', v_dur, 'until', v_end), null, null);

  return jsonb_build_object(
    'ok', true,
    'type', v_type,
    'status', v_status,
    'membership', v_plan,
    'duration', v_dur,
    'started_at', v_base,
    'expires_at', v_end,
    'code', v_row.code
  );
end;
$function$;

-- ------------------------------------------------------------------
-- 12. 30-day policy: accounts that never activate (or never come back)
-- ------------------------------------------------------------------
create or replace function public.member_purge_stale(p_dry boolean default true)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_never   integer := 0;
  v_expired integer := 0;
begin
  select count(*) into v_never from public.members m
   where m.account_activated_at is null
     and lower(coalesce(m.status, '')) in ('inactive')
     and m.created_at < now() - interval '30 days';

  select count(*) into v_expired from public.members m
   where m.account_activated_at is not null
     and lower(coalesce(m.status, '')) = 'expired'
     and coalesce(m.membership_expires_at, m.created_at) < now() - interval '30 days';

  if not coalesce(p_dry, true) then
    delete from public.members m
     where lower(coalesce(m.status, '')) in ('inactive', 'expired')
       and m.status <> 'banned'
       and (
         (m.account_activated_at is null and m.created_at < now() - interval '30 days')
         or (m.account_activated_at is not null
             and coalesce(m.membership_expires_at, m.created_at) < now() - interval '30 days')
       );
  end if;

  return jsonb_build_object('ok', true, 'dry_run', coalesce(p_dry, true),
    'never_activated', v_never, 'lapsed', v_expired,
    'policy', 'Accounts that are not activated, or not reactivated, within 30 days are removed.');
end;
$function$;

revoke all on function public.member_purge_stale(boolean) from public;
grant execute on function public.member_purge_stale(boolean) to service_role;

grant execute on function public.member_activation_state(text) to anon, authenticated, service_role;
grant execute on function public.activation_profile_save(text, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.activation_viewing_code_save(text, text, integer, text, text, text) to anon, authenticated, service_role;
grant execute on function public.activation_ad_open(text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.activation_ad_claim(text, uuid) to anon, authenticated, service_role;
grant execute on function public.activation_ad_cancel(text, uuid) to anon, authenticated, service_role;
grant execute on function public.activation_pay_points(text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.activation_redeem(text, text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.activation_price(text, integer) to anon, authenticated, service_role;
grant execute on function public.membership_rank(text) to anon, authenticated, service_role;
