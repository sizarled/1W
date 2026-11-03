-- ==================================================================
-- Signing in with a linked account
-- ------------------------------------------------------------------
-- Linking (tools/sql/oauth-linking.sql) proves who the member is. This
-- file spends that proof: the same Google account that carried a link can
-- open the session, with no password typed.
--
--   member_oauth_login_start(p_provider)      login.html → "Continue with Google"
--   oauth_login_providers()                   which buttons the page may draw
--   oauth_attempt_take(state)                 the callback: login, or a link?
--   oauth_login_complete(login, external, …)  the callback: the member, or `unlinked`
--   member_oauth_login(ticket, remember, …)   the browser: a ticket → a session
--   oauth_login_sweep()                       forget the states nobody finished
--
-- Three rules, and they are why this is a table of its own rather than a
-- column on member_identities:
--
--   1. A login starts with **nobody signed in**, so there is no member to
--      hang the state on. `member_identities` needs one.
--   2. The ticket is a one-use, five-minute secret, never the OAuth code.
--      It is delivered by `postMessage` to the window that opened the
--      popup — never in a URL — so no return-address can be poisoned.
--   3. Nothing here creates a link. If the provider's account is not
--      already verified for some member, the answer is `unlinked` and the
--      page says to sign in with the password and link it first.
-- ==================================================================

create table if not exists public.oauth_logins (
  login_id     uuid primary key default gen_random_uuid(),
  state        text unique,
  provider     text not null,
  code_verifier text not null,
  status       text not null default 'pending' check (status in ('pending', 'ready', 'used', 'failed')),
  member_id    uuid references public.members(id) on delete cascade,
  external_id  text,
  handle       text,
  ticket       text unique,
  ticket_expires_at timestamptz,
  reason       text,
  ip_address   inet,
  user_agent   text,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '20 minutes',
  used_at      timestamptz
);

create index if not exists oauth_logins_pending_idx
  on public.oauth_logins (state)
  where status = 'pending' and state is not null;

create index if not exists oauth_logins_ticket_idx
  on public.oauth_logins (ticket)
  where status = 'ready' and ticket is not null;

alter table public.oauth_logins enable row level security;
-- no policies: only the definer functions below read or write it

-- ------------------------------------------------------------------
-- 1. which buttons the login page may draw
-- ------------------------------------------------------------------
create or replace function public.oauth_login_providers()
returns text[]
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(array_agg(p order by p), '{}'::text[])
    from unnest(public.identity_providers()) as p
   where public.identity_provider_kind(p) = 'oauth'
     and public.oauth_ready(p);
$$;

-- ------------------------------------------------------------------
-- 2. the start: a state, a verifier, and the provider's URL
-- ------------------------------------------------------------------
create or replace function public.member_oauth_login_start(
  p_provider text,
  p_ip       text default null,
  p_agent    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_state    text;
  v_verifier text;
  v_url      text;
begin
  if public.identity_provider_kind(v_provider) is distinct from 'oauth' then
    return jsonb_build_object('ok', false, 'error', 'provider');
  end if;
  if not public.oauth_ready(v_provider) then
    return jsonb_build_object('ok', false, 'error', 'oauth');
  end if;

  -- housekeeping: nothing older than a day is worth keeping
  delete from public.oauth_logins where expires_at < now() - interval '1 day';

  v_state    := public.oauth_random(24);
  v_verifier := public.oauth_random(48);
  v_url      := public.oauth_authorize_url(v_provider, v_state, v_verifier);

  if v_url is null then
    return jsonb_build_object('ok', false, 'error', 'oauth');
  end if;

  insert into public.oauth_logins (state, provider, code_verifier, ip_address, user_agent)
  values (v_state, v_provider, v_verifier,
          public.member_ip(p_ip), nullif(left(coalesce(p_agent, ''), 400), ''));

  return jsonb_build_object(
    'ok', true, 'provider', v_provider, 'url', v_url,
    'expires_at', now() + interval '20 minutes'
  );
end;
$$;

-- ------------------------------------------------------------------
-- 3. the callback asks one question: login, or link?
-- ------------------------------------------------------------------
create or replace function public.oauth_attempt_take(p_state text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_state text := btrim(coalesce(p_state, ''));
  v_login public.oauth_logins%rowtype;
  v_link  jsonb;
begin
  if v_state = '' then
    return jsonb_build_object('ok', false, 'error', 'state');
  end if;

  select * into v_login
    from public.oauth_logins
   where state = v_state
     and status = 'pending'
   for update;

  if v_login.login_id is not null then
    if v_login.expires_at < now() then
      update public.oauth_logins set state = null, status = 'failed', reason = 'expired'
       where login_id = v_login.login_id;
      return jsonb_build_object('ok', false, 'error', 'expired');
    end if;

    -- the state is spent whether or not the provider finishes
    update public.oauth_logins set state = null where login_id = v_login.login_id;

    return jsonb_build_object(
      'ok', true, 'kind', 'login',
      'login_id', v_login.login_id,
      'provider', v_login.provider,
      'code_verifier', v_login.code_verifier
    );
  end if;

  v_link := public.oauth_state_take(p_state);

  if coalesce((v_link ->> 'ok')::boolean, false) then
    return v_link || jsonb_build_object('kind', 'link');
  end if;

  return v_link;
end;
$$;

revoke all on function public.oauth_attempt_take(text) from public;

/** The provider said who this is: is that account already linked to a member? */
create or replace function public.oauth_login_complete(
  p_login    uuid,
  p_external text,
  p_handle   text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_row      public.oauth_logins%rowtype;
  v_member   uuid;
  v_ticket   text;
begin
  select * into v_row from public.oauth_logins where login_id = p_login for update;
  if v_row.login_id is null then
    return jsonb_build_object('ok', false, 'error', 'state');
  end if;

  select i.member_id into v_member
    from public.member_identities i
   where i.provider = v_row.provider
     and i.status = 'verified'
     and i.external_id = btrim(coalesce(p_external, ''))
   limit 1;

  if v_member is null then
    update public.oauth_logins
       set status = 'failed', reason = 'unlinked',
           external_id = nullif(btrim(coalesce(p_external, '')), ''),
           handle = nullif(btrim(coalesce(p_handle, '')), ''),
           used_at = now()
     where login_id = v_row.login_id;
    return jsonb_build_object('ok', false, 'error', 'unlinked',
                             'provider', v_row.provider, 'handle', p_handle);
  end if;

  v_ticket := public.oauth_random(24);

  update public.oauth_logins
     set status = 'ready',
         member_id = v_member,
         external_id = btrim(coalesce(p_external, '')),
         handle = nullif(btrim(coalesce(p_handle, '')), ''),
         ticket = v_ticket,
         ticket_expires_at = now() + interval '5 minutes'
   where login_id = v_row.login_id;

  perform public.member_log_write(v_member, null, 'login_oauth_ticket',
    jsonb_build_object('provider', v_row.provider), null, 'oauth');

  return jsonb_build_object('ok', true, 'ticket', v_ticket, 'provider', v_row.provider);
end;
$$;

revoke all on function public.oauth_login_complete(uuid, text, text) from public;

-- ------------------------------------------------------------------
-- 4. the ticket becomes a session
-- ------------------------------------------------------------------
create or replace function public.member_oauth_login(
  p_ticket   text,
  p_remember boolean default false,
  p_ip       text default null,
  p_agent    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_row      public.oauth_logins%rowtype;
  v_member   public.members%rowtype;
  v_token    text;
  v_hash     text;
  v_session  uuid;
  v_expires  timestamptz;
  v_remember boolean := coalesce(p_remember, false);
  v_restricted boolean := false;
begin
  select * into v_row
    from public.oauth_logins
   where ticket = btrim(coalesce(p_ticket, ''))
   for update;

  if v_row.login_id is null or v_row.status <> 'ready' then
    return jsonb_build_object('ok', false, 'error', 'ticket');
  end if;
  if coalesce(v_row.ticket_expires_at, '-infinity'::timestamptz) < now() then
    update public.oauth_logins set status = 'failed', reason = 'ticket_expired' where login_id = v_row.login_id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  select * into v_member from public.members m where m.id = v_row.member_id;
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  -- one ticket, one session
  update public.oauth_logins
     set status = 'used', used_at = now(), ticket = null
   where login_id = v_row.login_id;

  if v_member.status is distinct from 'active' then
    v_restricted := true;
  end if;

  v_token   := encode(extensions.gen_random_bytes(32), 'hex');
  v_hash    := encode(extensions.digest(v_token, 'sha256'), 'hex');
  v_expires := case when v_remember then now() + interval '30 days' else now() + interval '12 hours' end;

  insert into public.sessions (
    user_id, member_id, token_hash, login_method, remember_me, session_status,
    ip_address, user_agent, expires_at, last_activity_at
  ) values (
    v_member.id, v_member.id, v_hash, 'oauth_' || v_row.provider, v_remember, 'active',
    public.member_ip(p_ip), nullif(left(coalesce(p_agent, ''), 400), ''), v_expires, now()
  )
  returning id into v_session;

  update public.members set last_login_at = now() where id = v_member.id;

  perform public.member_log_write(v_member.id, v_session, 'login_success',
    jsonb_build_object('method', 'oauth_' || v_row.provider, 'status', v_member.status,
                       'restricted', v_restricted), p_ip, p_agent);
  perform public.member_log_write(v_member.id, v_session, 'session_created',
    jsonb_build_object('remember_me', v_remember, 'expires_at', v_expires), p_ip, p_agent);
  if v_restricted then
    perform public.member_log_write(v_member.id, v_session, 'login_restricted',
      jsonb_build_object('status', v_member.status), p_ip, p_agent);
  end if;

  select * into v_member from public.members m where m.id = v_member.id; -- last_login_at

  return jsonb_build_object(
    'ok', true,
    'restricted', v_restricted,
    'status', v_member.status,
    'login_method', 'oauth_' || v_row.provider,
    'provider', v_row.provider,
    'session', jsonb_build_object(
      'id', v_session,
      'token', v_token,
      'expires_at', v_expires,
      'remember_me', v_remember
    ),
    'member', public.member_payload(v_member)
  );
end;
$$;

-- ------------------------------------------------------------------
-- 5. housekeeping
-- ------------------------------------------------------------------
/** Drop the states nobody finished. Safe to call from a cron job. */
create or replace function public.oauth_login_sweep()
returns int
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_gone int;
begin
  delete from public.oauth_logins
   where created_at < now() - interval '1 day'
     and status <> 'used';
  get diagnostics v_gone = row_count;
  return v_gone;
end;
$$;
