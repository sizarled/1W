-- ==================================================================
-- Login page — members · sessions · log
-- ------------------------------------------------------------------
-- Only three tables take part in the sign-in flow:
--   members   who you are + whether the account may sign in
--   sessions  one row per successful sign-in (hash of the token only)
--   log       every action on the account, written server-side
--
-- The password never leaves the RPC as plaintext: `crypt()` compares it
-- against `members.password_hash` (bcrypt). The session token is returned
-- to the browser once; the table only keeps its sha256 fingerprint.
-- ==================================================================

-- ------------------------------------------------------------------
-- sessions: the spec columns, on top of the existing ones
-- ------------------------------------------------------------------
alter table public.sessions add column if not exists member_id uuid references public.members(id) on delete cascade;
alter table public.sessions add column if not exists login_method text;
alter table public.sessions add column if not exists remember_me boolean not null default false;
alter table public.sessions add column if not exists session_status text not null default 'active';
alter table public.sessions add column if not exists last_activity_at timestamptz not null default now();
alter table public.sessions add column if not exists logged_out_at timestamptz;

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'sessions'
                    and column_name = 'session_token_hash') then
    alter table public.sessions
      add column session_token_hash text generated always as (token_hash) stored;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sessions_status_check') then
    alter table public.sessions
      add constraint sessions_status_check
      check (session_status in ('active', 'ended', 'revoked', 'expired'));
  end if;
end $$;

update public.sessions set member_id = user_id where member_id is null;

create index if not exists sessions_member_idx on public.sessions (member_id, created_at desc);
create index if not exists sessions_status_idx on public.sessions (session_status, expires_at);
create index if not exists sessions_token_hash_idx on public.sessions (session_token_hash);

alter table public.sessions enable row level security;

-- ------------------------------------------------------------------
-- log: server-side audit trail
-- ------------------------------------------------------------------
create table if not exists public.log (
  log_id         uuid primary key default gen_random_uuid(),
  member_id      uuid references public.members(id) on delete set null,
  session_id     uuid references public.sessions(id) on delete set null,
  action         text not null,
  action_details jsonb not null default '{}'::jsonb,
  ip_address     inet,
  user_agent     text,
  created_at     timestamptz not null default now()
);

create index if not exists log_member_idx on public.log (member_id, created_at desc);
create index if not exists log_session_idx on public.log (session_id);
create index if not exists log_action_idx on public.log (action, created_at desc);

alter table public.log enable row level security;
-- no policies on purpose: the log is written and read server-side only,
-- so a member can neither edit nor delete their own history.

-- ------------------------------------------------------------------
-- helpers
-- ------------------------------------------------------------------
create or replace function public.member_ip(p_ip text)
returns inet
language plpgsql
immutable
as $function$
begin
  if p_ip is null or btrim(p_ip) = '' then
    return null;
  end if;
  begin
    return btrim(p_ip)::inet;   -- also accepts "1.2.3.4/32"
  exception when others then
    return null;
  end;
end;
$function$;

create or replace function public.member_log_write(
  p_member uuid,
  p_session uuid,
  p_action text,
  p_details jsonb,
  p_ip text,
  p_agent text
)
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  insert into public.log (member_id, session_id, action, action_details, ip_address, user_agent)
  values (
    p_member,
    p_session,
    left(coalesce(p_action, 'unknown'), 64),
    coalesce(p_details, '{}'::jsonb),
    public.member_ip(p_ip),
    nullif(left(coalesce(p_agent, ''), 400), '')
  );
$$;

revoke all on function public.member_log_write(uuid, uuid, text, jsonb, text, text) from public;

-- accounts that stay inactive for 30 days are banned automatically ----
create or replace function public.member_sweep_inactive()
returns integer
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_row   record;
  v_count integer := 0;
begin
  for v_row in
    select id from public.members
     where status = 'inactive'
       and created_at < now() - interval '30 days'
  loop
    update public.members set status = 'banned' where id = v_row.id;
    perform public.member_log_write(
      v_row.id, null, 'account_banned',
      jsonb_build_object('reason', 'inactive_30_days'), null, null);
    v_count := v_count + 1;
  end loop;
  return v_count;
end;
$function$;

revoke all on function public.member_sweep_inactive() from public;
grant execute on function public.member_sweep_inactive() to service_role;

-- ------------------------------------------------------------------
-- public shape of a member (never the hashes)
-- ------------------------------------------------------------------
create or replace function public.member_payload(m public.members)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'id', m.id,
    'member_id', m.member_id,
    'member_code', m.member_code,
    'auth_user_id', m.auth_user_id,
    'username', m.username,
    'full_name', m.full_name,
    'email', m.email,
    'phone_number', m.phone_number,
    'country', m.country,
    'avatar_url', m.avatar_url,
    'cover_url', m.cover_url,
    'level', m.level,
    'points', m.points,
    'membership', m.membership,
    'membership_started_at', m.membership_started_at,
    'membership_expires_at', m.membership_expires_at,
    'status', m.status,
    'account_status', m.account_status,
    'created_at', m.created_at,
    'last_login_at', m.last_login_at
  );
$$;

-- ------------------------------------------------------------------
-- log in
-- ------------------------------------------------------------------
create or replace function public.member_login(
  p_login text,
  p_password text,
  p_remember boolean default false,
  p_ip text default null,
  p_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_ident   text := btrim(coalesce(p_login, ''));
  v_key     text := lower(btrim(coalesce(p_login, '')));
  v_handle  text;
  v_row     public.members%rowtype;
  v_method  text;
  v_token   text;
  v_hash    text;
  v_session uuid;
  v_expires timestamptz;
  v_remember boolean := coalesce(p_remember, false);
begin
  perform public.member_sweep_inactive();

  if v_ident = '' or p_password is null or p_password = '' then
    return jsonb_build_object('ok', false, 'error', 'empty');
  end if;

  -- usernames are stored with the "@", the field accepts both spellings
  v_handle := case when v_key like '@%' then v_key else '@' || v_key end;

  select * into v_row
    from public.members m
   where lower(m.username) = v_handle
      or lower(btrim(m.email)) = v_key
      or lower(coalesce(m.member_id, '')) = v_key
      or lower(coalesce(m.member_code, '')) = v_key
   limit 1;

  if v_row.id is null then
    perform public.member_log_write(null, null, 'login_failed',
      jsonb_build_object('reason', 'not_found', 'login', left(v_ident, 80)), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_method := case
                when lower(coalesce(v_row.member_id, '')) = v_key then 'member_id'
                when lower(coalesce(v_row.member_code, '')) = v_key then 'member_code'
                when lower(v_row.username) = v_handle then 'username'
                else 'email'
              end;

  -- the password is checked before the account state, so a wrong secret
  -- never learns whether the account exists, is inactive or is banned
  if v_row.password_hash is null
     or lower(v_row.password_hash) = 'pending'
     or crypt(p_password, v_row.password_hash) <> v_row.password_hash then
    perform public.member_log_write(v_row.id, null, 'login_failed',
      jsonb_build_object('reason', 'password', 'method', v_method), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;

  if v_row.status = 'banned' then
    perform public.member_log_write(v_row.id, null, 'login_blocked',
      jsonb_build_object('reason', 'banned'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'banned');
  end if;

  if v_row.status = 'expired' then
    perform public.member_log_write(v_row.id, null, 'login_blocked',
      jsonb_build_object('reason', 'expired'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if v_row.status <> 'active' then
    perform public.member_log_write(v_row.id, null, 'login_blocked',
      jsonb_build_object('reason', 'inactive'), p_ip, p_agent);
    return jsonb_build_object(
      'ok', false,
      'error', 'inactive',
      'status', v_row.status,
      'activate_deadline', v_row.created_at + interval '30 days',
      'member', jsonb_build_object('member_id', v_row.member_id, 'username', v_row.username)
    );
  end if;

  v_token   := encode(gen_random_bytes(32), 'hex');
  v_hash    := encode(digest(v_token, 'sha256'), 'hex');
  v_expires := case when v_remember then now() + interval '30 days' else now() + interval '12 hours' end;

  insert into public.sessions (
    user_id, member_id, token_hash, login_method, remember_me, session_status,
    ip_address, user_agent, expires_at, last_activity_at
  ) values (
    v_row.id, v_row.id, v_hash, v_method, v_remember, 'active',
    public.member_ip(p_ip), nullif(left(coalesce(p_agent, ''), 400), ''), v_expires, now()
  )
  returning id into v_session;

  update public.members set last_login_at = now() where id = v_row.id;

  perform public.member_log_write(v_row.id, v_session, 'login_success',
    jsonb_build_object('method', v_method), p_ip, p_agent);
  perform public.member_log_write(v_row.id, v_session, 'session_created',
    jsonb_build_object('remember_me', v_remember, 'expires_at', v_expires), p_ip, p_agent);

  select * into v_row from public.members m where m.id = v_row.id; -- last_login_at

  return jsonb_build_object(
    'ok', true,
    'login_method', v_method,
    'session', jsonb_build_object(
      'id', v_session,
      'token', v_token,
      'expires_at', v_expires,
      'remember_me', v_remember
    ),
    'member', public.member_payload(v_row)
  );
end;
$function$;

-- ------------------------------------------------------------------
-- restore / refresh a session from its token
-- ------------------------------------------------------------------
create or replace function public.member_session(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_hash    text := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v_session public.sessions%rowtype;
  v_member  public.members%rowtype;
begin
  if coalesce(p_token, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'unknown');
  end if;

  select * into v_session from public.sessions s where s.token_hash = v_hash limit 1;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown');
  end if;

  if v_session.logged_out_at is not null or v_session.session_status in ('ended', 'revoked') then
    return jsonb_build_object('ok', false, 'error', 'ended');
  end if;

  if v_session.expires_at <= now() then
    update public.sessions
       set session_status = 'expired', revoked_at = coalesce(revoked_at, now())
     where id = v_session.id;
    perform public.member_log_write(v_session.member_id, v_session.id, 'session_expired', '{}'::jsonb,
                                    v_session.ip_address::text, v_session.user_agent);
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  select * into v_member from public.members m where m.id = coalesce(v_session.member_id, v_session.user_id);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown');
  end if;

  if v_member.status <> 'active' then
    update public.sessions
       set session_status = 'revoked', revoked_at = coalesce(revoked_at, now())
     where id = v_session.id;
    perform public.member_log_write(v_member.id, v_session.id, 'session_revoked',
      jsonb_build_object('reason', v_member.status), v_session.ip_address::text, v_session.user_agent);
    return jsonb_build_object('ok', false, 'error', v_member.status);
  end if;

  update public.sessions
     set last_activity_at = now(), last_seen_at = now()
   where id = v_session.id;
  update public.members set last_action_at = now() where id = v_member.id;

  return jsonb_build_object(
    'ok', true,
    'member', public.member_payload(v_member),
    'session', jsonb_build_object(
      'id', v_session.id,
      'created_at', v_session.created_at,
      'expires_at', v_session.expires_at,
      'remember_me', v_session.remember_me,
      'last_activity_at', now()
    )
  );
end;
$function$;

-- ------------------------------------------------------------------
-- log out
-- ------------------------------------------------------------------
create or replace function public.member_logout(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_hash    text := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v_session public.sessions%rowtype;
begin
  select * into v_session from public.sessions s where s.token_hash = v_hash limit 1;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'error', 'unknown');
  end if;

  update public.sessions
     set session_status = 'ended',
         logged_out_at = coalesce(logged_out_at, now()),
         revoked_at = coalesce(revoked_at, now()),
         last_activity_at = now()
   where id = v_session.id;

  perform public.member_log_write(
    coalesce(v_session.member_id, v_session.user_id), v_session.id, 'logout', '{}'::jsonb,
    v_session.ip_address::text, v_session.user_agent);

  return jsonb_build_object('ok', true, 'ended_at', now());
end;
$function$;

-- ------------------------------------------------------------------
-- generic server-side action log (for the signed-in pages)
-- ------------------------------------------------------------------
create or replace function public.member_log(p_token text, p_action text, p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_hash    text := encode(digest(coalesce(p_token, ''), 'sha256'), 'hex');
  v_session public.sessions%rowtype;
begin
  if coalesce(btrim(p_action), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'action');
  end if;

  select * into v_session from public.sessions s
   where s.token_hash = v_hash and s.session_status = 'active' and s.expires_at > now()
   limit 1;
  if v_session.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  perform public.member_log_write(
    coalesce(v_session.member_id, v_session.user_id), v_session.id, p_action,
    coalesce(p_details, '{}'::jsonb), v_session.ip_address::text, v_session.user_agent);

  update public.sessions set last_activity_at = now(), last_seen_at = now() where id = v_session.id;

  return jsonb_build_object('ok', true);
end;
$function$;

-- ------------------------------------------------------------------
-- every account edit lands in the log (server-side, field names only)
-- ------------------------------------------------------------------
create or replace function public.members_log_changes()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
declare
  v_fields text[] := array[]::text[];
begin
  if new.full_name is distinct from old.full_name then v_fields := array_append(v_fields, 'full_name'); end if;
  if new.username is distinct from old.username then v_fields := array_append(v_fields, 'username'); end if;
  if new.email is distinct from old.email then v_fields := array_append(v_fields, 'email'); end if;
  if new.phone_number is distinct from old.phone_number then v_fields := array_append(v_fields, 'phone_number'); end if;
  if new.birth_date is distinct from old.birth_date then v_fields := array_append(v_fields, 'birth_date'); end if;
  if new.country is distinct from old.country then v_fields := array_append(v_fields, 'country'); end if;
  if new.avatar_url is distinct from old.avatar_url then v_fields := array_append(v_fields, 'avatar_url'); end if;
  if new.cover_url is distinct from old.cover_url then v_fields := array_append(v_fields, 'cover_url'); end if;
  if new.status is distinct from old.status then v_fields := array_append(v_fields, 'status'); end if;
  if new.level is distinct from old.level then v_fields := array_append(v_fields, 'level'); end if;
  if new.points is distinct from old.points then v_fields := array_append(v_fields, 'points'); end if;
  if new.membership is distinct from old.membership then v_fields := array_append(v_fields, 'membership'); end if;
  if new.password_hash is distinct from old.password_hash then v_fields := array_append(v_fields, 'password'); end if;
  if new.recovery_code_hash is distinct from old.recovery_code_hash then v_fields := array_append(v_fields, 'recovery_code'); end if;

  if array_length(v_fields, 1) is null then
    return new;
  end if;

  insert into public.log (member_id, action, action_details)
  values (new.id, 'account_updated', jsonb_build_object('fields', to_jsonb(v_fields)));

  return new;
end;
$function$;

drop trigger if exists members_log_changes on public.members;
create trigger members_log_changes
  after update on public.members
  for each row execute function public.members_log_changes();

-- ------------------------------------------------------------------
-- grants
-- ------------------------------------------------------------------
grant execute on function public.member_login(text, text, boolean, text, text) to anon, authenticated, service_role;
grant execute on function public.member_session(text) to anon, authenticated, service_role;
grant execute on function public.member_logout(text) to anon, authenticated, service_role;
grant execute on function public.member_log(text, text, jsonb) to anon, authenticated, service_role;
grant execute on function public.member_payload(public.members) to anon, authenticated, service_role;
