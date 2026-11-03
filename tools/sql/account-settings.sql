-- ==================================================================
-- dashboard.html → Settings → Account
-- ------------------------------------------------------------------
-- What a member can do about their own account:
--
--   member_account(token)              identity + linked recovery accounts
--   member_change_password(token, …)   current password → new password
--   member_identity_start(token, p)    begin linking a network / a chat
--   member_identity_verify(token, …)   the code WhatsApp sent to the number
--   member_identity_unlink(token, p)   forget a linked account
--   telegram_identity_link(code, …)    what the bot calls when /start arrives
--   telegram_identity_unlink(chat)     … and when /stop does
--
-- Two kinds of link, and the difference is honest:
--
--   **chat** (telegram, whatsapp) — the account can actually receive a recovery
--   code, so it is a real second channel for `recovery_send()`. Telegram links
--   itself through the bot (a deep link carrying a one-time code); WhatsApp is
--   verified by the code we send to the number.
--
--   **oauth** (google, facebook, x, pinterest, reddit, tiktok) — needs an OAuth
--   app per network (client id + secret + redirect URI). The row is here so the
--   table is complete, and the function answers `oauth` instead of pretending.
--
-- The email on the account is **fixed**: it cannot be changed from the
-- dashboard, and nothing in this file can change it.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. the table
-- ------------------------------------------------------------------
create table if not exists public.member_identities (
  identity_id    uuid primary key default gen_random_uuid(),
  member_id      uuid not null references public.members(id) on delete cascade,
  provider       text not null,
  status         text not null default 'pending' check (status in ('pending', 'verified')),
  handle         text,          -- @username, or a masked number
  external_id    text,          -- the chat id / the E.164 number
  link_code      text,          -- the one-time code while pending
  link_expires_at timestamptz,
  verified_at    timestamptz,
  created_at     timestamptz not null default now(),
  unique (member_id, provider)
);

create index if not exists member_identities_open_idx
  on public.member_identities (provider, link_code)
  where status = 'pending' and link_code is not null;

-- one chat belongs to one member
create unique index if not exists member_identities_chat_idx
  on public.member_identities (provider, external_id)
  where status = 'verified' and external_id is not null;

alter table public.member_identities enable row level security;
-- no policies: the security definer functions below are the only readers

-- ------------------------------------------------------------------
-- 2. helpers
-- ------------------------------------------------------------------
create or replace function public.identity_providers()
returns text[]
language sql
immutable
as $$
  select array['google', 'facebook', 'x', 'telegram', 'whatsapp', 'pinterest', 'reddit', 'tiktok'];
$$;

/** A short, unambiguous code — no 0/O, 1/I/L — for a human to type back. */
create or replace function public.identity_code(p_length int default 6)
returns text
language plpgsql
volatile
as $$
declare
  alphabet text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  out      text := '';
  i        int;
begin
  for i in 1..greatest(least(coalesce(p_length, 6), 12), 4) loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end;
$$;

/** The chat a member's recovery code can reach, or null. */
create or replace function public.member_telegram_chat(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select i.external_id
    from public.member_identities i
   where i.member_id = p_member_id
     and i.provider = 'telegram'
     and i.status = 'verified'
     and coalesce(i.external_id, '') <> ''
   limit 1;
$$;

/** The WhatsApp number a member verified, or null (the phone is the fallback). */
create or replace function public.member_whatsapp_number(p_member_id uuid)
returns text
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select i.external_id
    from public.member_identities i
   where i.member_id = p_member_id
     and i.provider = 'whatsapp'
     and i.status = 'verified'
     and coalesce(i.external_id, '') <> ''
   limit 1;
$$;

-- ------------------------------------------------------------------
-- 3. what the settings page shows
-- ------------------------------------------------------------------
create or replace function public.member_account(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_ids    jsonb;
  v_linked int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'provider',       i.provider,
           'status',         i.status,
           'handle',         i.handle,
           'verified_at',    i.verified_at,
           'pending_until',  i.link_expires_at
         ) order by i.provider), '[]'::jsonb)
    into v_ids
    from public.member_identities i
   where i.member_id = v_member.id;

  select count(*) into v_linked
    from public.member_identities i
   where i.member_id = v_member.id and i.status = 'verified';

  return jsonb_build_object(
    'ok', true,
    'member', jsonb_build_object(
      'member_id',    v_member.member_id,
      'username',     v_member.username,
      'email',        v_member.email,
      'phone_number', v_member.phone_number,
      'status',       v_member.status,
      'created_at',   v_member.created_at
    ),
    'security', jsonb_build_object(
      'email_locked',        true,
      'recovery_issued_at',  v_member.recovery_issued_at,
      'recovery_expires_at', v_member.recovery_expires_at,
      'last_channel',        v_member.recovery_last_channel,
      'linked',              coalesce(v_linked, 0)
    ),
    'identities', v_ids
  );
end;
$$;

revoke all on function public.member_account(text) from public;

-- ------------------------------------------------------------------
-- 4. the password
-- ------------------------------------------------------------------
create or replace function public.member_change_password(
  p_token    text,
  p_current  text,
  p_password text,
  p_ip       text default null,
  p_agent    text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_others int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if coalesce(p_current, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'current');
  end if;
  if crypt(p_current, v_member.password_hash) <> v_member.password_hash then
    perform public.member_log_write(v_member.id, null, 'password_failed',
      jsonb_build_object('reason', 'current'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'current');
  end if;
  if length(coalesce(p_password, '')) < 8 or length(p_password) > 72 then
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;
  if p_password = p_current then
    return jsonb_build_object('ok', false, 'error', 'same');
  end if;

  update public.members
     set password_hash = crypt(p_password, gen_salt('bf', 10))
   where id = v_member.id;

  -- every other session ends; the one that made the change stays
  with closed as (
    update public.sessions s
       set session_status = 'closed', logged_out_at = now()
     where coalesce(s.member_id, s.user_id) = v_member.id
       and s.session_status = 'active'
       and s.token_hash <> encode(digest(p_token, 'sha256'), 'hex')
    returning 1
  )
  select count(*) into v_others from closed;

  perform public.member_log_write(v_member.id, null, 'password_changed',
    jsonb_build_object('closed_sessions', v_others), p_ip, p_agent);

  return jsonb_build_object('ok', true, 'closed_sessions', coalesce(v_others, 0));
end;
$$;

revoke all on function public.member_change_password(text, text, text, text, text) from public;

-- ------------------------------------------------------------------
-- 5. linking
-- ------------------------------------------------------------------
create or replace function public.member_identity_start(
  p_token    text,
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
  v_member   public.members%rowtype := public.member_from_token(p_token);
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_code     text;
  v_wa       text;
  v_wa_url   text := coalesce(public.site_secret('whatsapp_url'), public.site_secret('gs_mail_url'));
  v_wa_token text := coalesce(public.site_secret('whatsapp_token'), public.site_secret('gs_mail_token'));
  v_bot      text := coalesce(public.site_secret('telegram_bot_username'), 'cineaura2bot');
  v_id       uuid;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if not (v_provider = any (public.identity_providers())) then
    return jsonb_build_object('ok', false, 'error', 'provider');
  end if;

  -- Telegram links itself: the bot receives the code and writes the chat id.
  if v_provider = 'telegram' then
    v_code := public.identity_code(10);
    insert into public.member_identities (member_id, provider, status, link_code, link_expires_at)
    values (v_member.id, 'telegram', 'pending', v_code, now() + interval '20 minutes')
    on conflict (member_id, provider) do update
      set status         = 'pending',
          link_code      = excluded.link_code,
          link_expires_at = excluded.link_expires_at,
          external_id    = null,
          handle         = null,
          verified_at    = null
    returning identity_id into v_id;

    perform public.member_log_write(v_member.id, null, 'identity_start',
      jsonb_build_object('provider', 'telegram'), p_ip, p_agent);

    return jsonb_build_object(
      'ok', true, 'provider', 'telegram', 'status', 'pending',
      'code', v_code,
      'url', 'https://t.me/' || replace(v_bot, '@', '') || '?start=' || v_code,
      'expires_at', now() + interval '20 minutes',
      'hint', 'Open the bot, press Start, and the account links itself.'
    );
  end if;

  -- WhatsApp is verified by what only the owner of the number can read.
  if v_provider = 'whatsapp' then
    v_wa := public.member_whatsapp_number(v_member.id);
    v_wa := coalesce(v_wa, public.whatsapp_number(v_member.phone_number, v_member.country, public.site_secret('whatsapp_cc')));
    if v_wa is null then
      return jsonb_build_object('ok', false, 'error', 'phone');
    end if;
    if v_wa_url is null or not public.delivery_ready('whatsapp') then
      return jsonb_build_object('ok', false, 'error', 'whatsapp_not_configured');
    end if;

    v_code := public.identity_code(6);
    insert into public.member_identities (member_id, provider, status, handle, external_id, link_code, link_expires_at)
    values (v_member.id, 'whatsapp', 'pending', public.mask_phone('+' || v_wa), v_wa, v_code, now() + interval '20 minutes')
    on conflict (member_id, provider) do update
      set status         = 'pending',
          handle         = excluded.handle,
          external_id    = excluded.external_id,
          link_code      = excluded.link_code,
          link_expires_at = excluded.link_expires_at,
          verified_at    = null;

    perform net.http_post(
      url  => v_wa_url,
      body => jsonb_build_object(
        'token',   coalesce(v_wa_token, ''),
        'channel', 'whatsapp',
        'to',      v_wa,
        'code',    v_code,
        'name',    v_member.username,
        'member',  v_member.member_id,
        'text',    format(E'1World — link your account\\n\\nCode: %s\\n\\nType it in Account settings within 20 minutes.', v_code)
      ),
      headers => jsonb_build_object('Content-Type', 'application/json'),
      timeout_milliseconds => 10000
    );

    perform public.member_log_write(v_member.id, null, 'identity_start',
      jsonb_build_object('provider', 'whatsapp'), p_ip, p_agent);

    return jsonb_build_object(
      'ok', true, 'provider', 'whatsapp', 'status', 'pending',
      'masked_phone', public.mask_phone(v_member.phone_number),
      'expires_at', now() + interval '20 minutes',
      'hint', 'A 6-character code is on its way to your WhatsApp. Type it here.'
    );
  end if;

  -- Google, Facebook, X, Pinterest, Reddit, TikTok: an OAuth app each.
  return jsonb_build_object(
    'ok', false, 'error', 'oauth', 'provider', v_provider,
    'hint', 'This network needs an OAuth app (client id, secret and a redirect URI) before it can be linked.'
  );
end;
$$;

revoke all on function public.member_identity_start(text, text, text, text) from public;

create or replace function public.member_identity_verify(
  p_token    text,
  p_provider text,
  p_code     text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member   public.members%rowtype := public.member_from_token(p_token);
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_row      public.member_identities%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_provider = 'telegram' then
    return jsonb_build_object('ok', false, 'error', 'use_bot');
  end if;

  select * into v_row
    from public.member_identities i
   where i.member_id = v_member.id
     and i.provider = v_provider
     and i.status = 'pending'
   limit 1;

  if v_row.identity_id is null then
    return jsonb_build_object('ok', false, 'error', 'not_started');
  end if;
  if v_row.link_expires_at is null or v_row.link_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;
  if upper(btrim(coalesce(p_code, ''))) <> upper(coalesce(v_row.link_code, '')) then
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;

  update public.member_identities
     set status = 'verified', verified_at = now(), link_code = null, link_expires_at = null
   where identity_id = v_row.identity_id;

  perform public.member_log_write(v_member.id, null, 'identity_verified',
    jsonb_build_object('provider', v_provider), null, null);

  return jsonb_build_object('ok', true, 'provider', v_provider, 'status', 'verified');
end;
$$;

revoke all on function public.member_identity_verify(text, text, text) from public;

create or replace function public.member_identity_unlink(p_token text, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member   public.members%rowtype := public.member_from_token(p_token);
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_chat     text;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select external_id into v_chat
    from public.member_identities
   where member_id = v_member.id and provider = v_provider
   limit 1;

  delete from public.member_identities where member_id = v_member.id and provider = v_provider;

  if v_provider = 'telegram' and v_chat is not null and v_chat = v_member.telegram_chat_id then
    update public.members set telegram_chat_id = null where id = v_member.id;
  end if;

  perform public.member_log_write(v_member.id, null, 'identity_unlinked',
    jsonb_build_object('provider', v_provider), null, null);

  return jsonb_build_object('ok', true, 'provider', v_provider);
end;
$$;

revoke all on function public.member_identity_unlink(text, text) from public;

-- ------------------------------------------------------------------
-- 6. what the bot calls
-- ------------------------------------------------------------------
create or replace function public.telegram_identity_link(
  p_code     text,
  p_chat     text,
  p_username text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_row      public.member_identities%rowtype;
  v_chat     text := btrim(coalesce(p_chat, ''));
  v_username text := nullif(btrim(coalesce(p_username, '')), '');
  v_member   public.members%rowtype;
begin
  if v_chat = '' then
    return jsonb_build_object('ok', false, 'error', 'chat');
  end if;

  select * into v_row
    from public.member_identities i
   where i.provider = 'telegram'
     and i.status = 'pending'
     and upper(i.link_code) = upper(btrim(coalesce(p_code, '')))
     and i.link_expires_at > now()
   limit 1;

  if v_row.identity_id is null then
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;

  -- one chat, one member: a chat that was linked elsewhere comes loose
  update public.member_identities
     set status = 'pending', external_id = null, handle = null, verified_at = null
   where provider = 'telegram'
     and external_id = v_chat
     and member_id <> v_row.member_id;

  update public.member_identities
     set status = 'verified',
         external_id = v_chat,
         handle = case when v_username is null then null when left(v_username, 1) = '@' then v_username else '@' || v_username end,
         verified_at = now(),
         link_code = null,
         link_expires_at = null
   where identity_id = v_row.identity_id;

  update public.members set telegram_chat_id = v_chat where id = v_row.member_id
  returning * into v_member;

  perform public.member_log_write(v_row.member_id, null, 'identity_verified',
    jsonb_build_object('provider', 'telegram', 'chat', left(v_chat, 6) || '…'), null, 'telegram bot');

  return jsonb_build_object(
    'ok', true,
    'provider', 'telegram',
    'username', v_member.username,
    'full_name', v_member.full_name
  );
end;
$$;

revoke all on function public.telegram_identity_link(text, text, text) from public;

create or replace function public.telegram_identity_unlink(p_chat text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_chat   text := btrim(coalesce(p_chat, ''));
  v_member uuid;
begin
  if v_chat = '' then
    return jsonb_build_object('ok', false, 'error', 'chat');
  end if;

  select member_id into v_member
    from public.member_identities
   where provider = 'telegram' and external_id = v_chat
   limit 1;

  delete from public.member_identities
   where provider = 'telegram' and external_id = v_chat;

  update public.members set telegram_chat_id = null
   where id = v_member;

  return jsonb_build_object('ok', true, 'unlinked', v_member is not null);
end;
$$;

revoke all on function public.telegram_identity_unlink(text) from public;
