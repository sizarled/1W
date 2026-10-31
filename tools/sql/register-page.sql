-- =====================================================================
-- register.html — account registration (1World Web / Cineaura)
-- ---------------------------------------------------------------------
-- Everything lands in `members` — no extra registration table and no
-- separate recovery-code table.
--
--   full_name            text
--   username             text   @handle, unique (case-insensitive), locked
--   email                text   unique (case-insensitive, trimmed)
--   phone_number         text
--   password_hash        text   bcrypt, written server-side, never returned
--   birth_date           date
--   country              text
--   terms_accepted       bool   + terms_accepted_at
--   status               'inactive' for every new account
--   account_status       generated mirror of `status` (read alias)
--   account_activated_at timestamptz, set by the guard trigger
--   recovery_code_hash   text   sha256 of the shown-once code
--   last_login_at        timestamptz
--
-- Functions (all SECURITY DEFINER — the table itself stays closed to anon):
--   member_register(...)       creates the row, returns the plain recovery
--                              code exactly once + the public account data
--   member_check(user, email)  live availability for the form
--   member_status(login)       username / email → account status only
--   member_recovery_code()     OW-XXXX-XXXX-XXXX generator
-- =====================================================================

begin;

-- ---------------------------------------------------------------------
-- 1. the missing columns
-- ---------------------------------------------------------------------
alter table public.members
  add column if not exists full_name            text,
  add column if not exists phone_number         text,
  add column if not exists birth_date           date,
  add column if not exists country              text,
  add column if not exists terms_accepted       boolean not null default false,
  add column if not exists terms_accepted_at    timestamptz,
  add column if not exists account_activated_at timestamptz,
  add column if not exists recovery_code_hash   text,
  add column if not exists last_login_at        timestamptz;

-- read alias so both `status` (existing) and `account_status` (spec) work
alter table public.members
  add column if not exists account_status text generated always as (status) stored;

-- ---------------------------------------------------------------------
-- 2. uniqueness — case-insensitive, trimmed
-- ---------------------------------------------------------------------
create unique index if not exists members_username_lower_key
  on public.members (lower(username));

create unique index if not exists members_email_lower_key
  on public.members (lower(btrim(email)));

create index if not exists members_recovery_idx
  on public.members (recovery_code_hash) where recovery_code_hash is not null;

-- ---------------------------------------------------------------------
-- 3. guard: the username can never change, activation is stamped
-- ---------------------------------------------------------------------
create or replace function public.members_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.username is distinct from old.username then
    raise exception 'The username cannot be changed once the account exists.' using errcode = '42501';
  end if;
  if new.status = 'active'
     and coalesce(old.status, '') <> 'active'
     and new.account_activated_at is null then
    new.account_activated_at := now();
  end if;
  if new.terms_accepted and old.terms_accepted is not true and new.terms_accepted_at is null then
    new.terms_accepted_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists members_guard on public.members;
create trigger members_guard
  before update on public.members
  for each row execute function public.members_guard();

-- ---------------------------------------------------------------------
-- 4. recovery code: OW-XXXX-XXXX-XXXX, no I / O / 0 / 1
-- ---------------------------------------------------------------------
create or replace function public.member_recovery_code()
returns text
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  bytes bytea := gen_random_bytes(12);
  raw text := '';
  i integer;
begin
  for i in 0..11 loop
    raw := raw || substr(alphabet, (get_byte(bytes, i) % 32) + 1, 1);
  end loop;
  return 'OW-' || substr(raw, 1, 4) || '-' || substr(raw, 5, 4) || '-' || substr(raw, 9, 4);
end;
$$;

-- ---------------------------------------------------------------------
-- 5. live availability check for the form
-- ---------------------------------------------------------------------
create or replace function public.member_check(
  p_username text default null,
  p_email    text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_handle text := regexp_replace(lower(btrim(coalesce(p_username, ''))), '^@+', '');
  v_email  text := lower(btrim(coalesce(p_email, '')));
begin
  return jsonb_build_object(
    'username_taken', v_handle <> '' and exists (
      select 1 from public.members m where lower(m.username) = '@' || v_handle),
    'email_taken', v_email <> '' and exists (
      select 1 from public.members m where lower(btrim(m.email)) = v_email)
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 6. registration
-- ---------------------------------------------------------------------
create or replace function public.member_register(
  p_full_name  text,
  p_username   text,
  p_email      text,
  p_phone      text,
  p_password   text,
  p_birth_date date,
  p_country    text,
  p_terms      boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_full    text := btrim(coalesce(p_full_name, ''));
  v_handle  text;
  v_email   text := lower(btrim(coalesce(p_email, '')));
  v_phone   text := btrim(coalesce(p_phone, ''));
  v_country text := btrim(coalesce(p_country, ''));
  v_code    text;
  v_row     public.members%rowtype;
begin
  -- ---- field rules -------------------------------------------------
  if length(v_full) < 3 or v_full !~ '[[:alpha:]]' then
    return jsonb_build_object('ok', false, 'error', 'full_name');
  end if;

  v_handle := regexp_replace(lower(btrim(coalesce(p_username, ''))), '^@+', '');
  if v_handle !~ '^[a-z0-9](?:[a-z0-9._-]{1,22})[a-z0-9]$' then
    return jsonb_build_object('ok', false, 'error', 'username_format');
  end if;
  v_handle := '@' || v_handle;

  if v_email !~ '^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'email_format');
  end if;

  if v_phone !~ '^\+?[0-9][0-9 ()\-]{6,19}$' then
    return jsonb_build_object('ok', false, 'error', 'phone');
  end if;

  if p_password is null or length(p_password) < 8 or length(p_password) > 72 then
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;

  if p_birth_date is null or p_birth_date > current_date - interval '13 years'
     or p_birth_date < date '1900-01-01' then
    return jsonb_build_object('ok', false, 'error', 'birth_date');
  end if;

  if v_country = '' or length(v_country) > 64 then
    return jsonb_build_object('ok', false, 'error', 'country');
  end if;

  if coalesce(p_terms, false) is not true then
    return jsonb_build_object('ok', false, 'error', 'terms');
  end if;

  -- ---- uniqueness (case-insensitive, trimmed) ----------------------
  if exists (select 1 from public.members m where lower(m.username) = v_handle) then
    return jsonb_build_object('ok', false, 'error', 'username_taken');
  end if;
  if exists (select 1 from public.members m where lower(btrim(m.email)) = v_email) then
    return jsonb_build_object('ok', false, 'error', 'email_taken');
  end if;

  -- ---- create ------------------------------------------------------
  v_code := public.member_recovery_code();

  begin
    insert into public.members (
      full_name, username, email, phone_number, password_hash, birth_date, country,
      terms_accepted, terms_accepted_at, recovery_code_hash, status
    ) values (
      v_full,
      v_handle,
      v_email,
      v_phone,
      crypt(p_password, gen_salt('bf', 10)),
      p_birth_date,
      v_country,
      true,
      now(),
      encode(digest(v_code, 'sha256'), 'hex'),
      'inactive'           -- a new account is never active
    )
    returning * into v_row;
  exception when unique_violation then
    if exists (select 1 from public.members m where lower(m.username) = v_handle) then
      return jsonb_build_object('ok', false, 'error', 'username_taken');
    end if;
    return jsonb_build_object('ok', false, 'error', 'email_taken');
  end;

  return jsonb_build_object(
    'ok', true,
    'recovery_code', v_code,
    'member', jsonb_build_object(
      'id', v_row.id,
      'member_code', v_row.member_code,
      'full_name', v_row.full_name,
      'username', v_row.username,
      'email', v_row.email,
      'phone_number', v_row.phone_number,
      'birth_date', v_row.birth_date,
      'country', v_row.country,
      'status', v_row.status,
      'terms_accepted', v_row.terms_accepted,
      'terms_accepted_at', v_row.terms_accepted_at,
      'created_at', v_row.created_at
    )
  );
end;
$$;

-- ---------------------------------------------------------------------
-- 7. account status by username or email (no personal data returned)
-- ---------------------------------------------------------------------
create or replace function public.member_status(p_login text)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_login  text := lower(btrim(coalesce(p_login, '')));
  v_handle text;
  v_row    public.members%rowtype;
begin
  if v_login = '' then
    return jsonb_build_object('found', false);
  end if;
  v_handle := case when v_login like '@%' then v_login else '@' || v_login end;

  select * into v_row
    from public.members m
   where lower(m.username) = v_handle or lower(btrim(m.email)) = v_login
   limit 1;

  if v_row.id is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'username', v_row.username,
    'status', v_row.status,
    'account_status', v_row.status,
    'activated_at', v_row.account_activated_at
  );
end;
$$;

-- ---------------------------------------------------------------------
-- grants
-- ---------------------------------------------------------------------
grant execute on function public.member_register(text, text, text, text, text, date, text, boolean)
  to anon, authenticated, service_role;
grant execute on function public.member_check(text, text) to anon, authenticated, service_role;
grant execute on function public.member_status(text)     to anon, authenticated, service_role;
grant execute on function public.member_recovery_code()  to service_role;

commit;

notify pgrst, 'reload schema';
