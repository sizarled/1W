-- ==================================================================
-- Account linking — the six networks that sign in with OAuth
-- ------------------------------------------------------------------
-- Telegram and WhatsApp link with a code we mint. Google, Facebook, X,
-- Pinterest, Reddit and TikTok link the other way round: the member leaves
-- for the provider, the provider sends them back with a one-time `code`,
-- and the edge function `oauth-link` swaps it for a token.
--
-- What lives where:
--
--   site_secrets   <provider>_client_id / <provider>_client_secret
--                  oauth_redirect — the one redirect URI, registered in
--                  every console:
--                  https://<project>.supabase.co/functions/v1/oauth-link/callback
--
--   these functions
--                  url_encode(text)            one honest percent-encoder
--                  oauth_random(bytes)         state + PKCE verifier
--                  oauth_config(p)             the whole provider recipe, service role only
--                  oauth_ready(p)              are both halves of the app present?
--                  identity_providers_ready()  what the dashboard may enable
--                  oauth_authorize_url(…)      the URL the member leaves through
--                  member_identity_start()     now answers a real URL for a ready app
--                  oauth_state_take(state)     the callback: which member, which verifier
--                  oauth_identity_save(…)      the callback: the verified row
--
-- No client secret ever reaches the browser: `oauth_config` and
-- `oauth_state_take` are executable by `service_role` alone.
--
-- Honest note: a linked Google account is proof of identity, and one day a
-- sign-in. It cannot *carry* a recovery code — none of these six sends
-- messages for us. Codes travel by email, Telegram and WhatsApp; these rows
-- are the second door into the account, not a mailbox.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. the columns the flow needs
-- ------------------------------------------------------------------
alter table public.member_identities
  add column if not exists code_verifier   text,
  add column if not exists access_token    text,
  add column if not exists refresh_token   text,
  add column if not exists token_expires_at timestamptz;

-- a verified external account belongs to exactly one member (the chat index
-- above already says so; this one keeps the OAuth ids honest too)
create unique index if not exists member_identities_external_idx
  on public.member_identities (provider, external_id)
  where status = 'verified' and external_id is not null;

-- ------------------------------------------------------------------
-- 2. helpers
-- ------------------------------------------------------------------
/** chat or oauth — the two kinds of link, and null for a name we do not know. */
create or replace function public.identity_provider_kind(p_provider text)
returns text
language sql
immutable
as $$
  select case lower(btrim(coalesce(p_provider, '')))
           when 'telegram' then 'chat'
           when 'whatsapp' then 'chat'
           when 'google' then 'oauth'
           when 'facebook' then 'oauth'
           when 'x' then 'oauth'
           when 'pinterest' then 'oauth'
           when 'reddit' then 'oauth'
           when 'tiktok' then 'oauth'
         end;
$$;

/** Percent-encoding, byte by byte, because nothing in the catalog does it. */
create or replace function public.url_encode(p_text text)
returns text
language plpgsql
immutable
as $$
declare
  i   int;
  ch  text;
  out_text text := '';
begin
  if p_text is null then
    return null;
  end if;
  for i in 1..length(p_text) loop
    ch := substr(p_text, i, 1);
    if ch ~ '[A-Za-z0-9._~-]' then
      out_text := out_text || ch;
    elsif ch = ' ' then
      out_text := out_text || '%20';
    else
      out_text := out_text || '%' || upper(encode(convert_to(ch, 'UTF8'), 'hex'));
    end if;
  end loop;
  return out_text;
end;
$$;

/** 32 random bytes, base64url, no padding — a state, or a PKCE verifier. */
create or replace function public.oauth_random(p_bytes int default 32)
returns text
language sql
volatile
as $$
  select translate(
           encode(extensions.gen_random_bytes(greatest(least(coalesce(p_bytes, 32), 96), 16)), 'base64'),
           '+/=', '-_');
$$;

/** PKCE S256: base64url(sha256(verifier)), no padding. */
create or replace function public.oauth_challenge(p_verifier text)
returns text
language sql
immutable
as $$
  select translate(rtrim(encode(extensions.digest(coalesce(p_verifier, ''), 'sha256'), 'base64'), '='), '+/', '-_');
$$;

/** Build ?a=b&c=d from a jsonb object, keys in a stable order. */
create or replace function public.oauth_query(p_params jsonb)
returns text
language sql
immutable
as $$
  select string_agg(
           public.url_encode(kv.key) || '=' || public.url_encode(kv.value),
           '&' order by kv.key)
    from jsonb_each_text(coalesce(p_params, '{}'::jsonb)) as kv;
$$;

-- ------------------------------------------------------------------
-- 3. the six recipes, in one place
-- ------------------------------------------------------------------
-- A client secret is only ever read here, and only the edge function may
-- call this. Everything the callback needs to know about a provider's
-- quirks is in the jsonb below: which URL, which parameter names, whether
-- the token endpoint wants Basic auth, and where the id hides in the
-- answer.
create or replace function public.oauth_config(p_provider text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_id       text := public.site_secret(v_provider || '_client_id');
  v_secret   text := public.site_secret(v_provider || '_client_secret');
  v_redirect text := public.site_secret('oauth_redirect');
  v_base     jsonb;
  v_cfg      jsonb;
begin
  if public.identity_provider_kind(v_provider) is distinct from 'oauth' then
    return jsonb_build_object('ok', false, 'error', 'provider');
  end if;
  if v_id is null or v_secret is null or v_redirect is null then
    return jsonb_build_object('ok', false, 'error', 'oauth',
                             'hint', 'The OAuth app for this network is not configured yet.');
  end if;

  v_base := jsonb_build_object(
    'redirect_uri', v_redirect,
    'response_type', 'code',
    'client_id', v_id
  );

  case v_provider
    when 'google' then
      v_cfg := jsonb_build_object(
        'ok', true, 'provider', v_provider,
        'authorize_url', 'https://accounts.google.com/o/oauth2/v2/auth',
        'authorize_params', v_base || jsonb_build_object(
          'scope', 'openid email profile',
          'access_type', 'offline', 'prompt', 'consent', 'include_granted_scopes', 'true'),
        'pkce', true,
        'token_url', 'https://oauth2.googleapis.com/token',
        'token_basic', false,
        'token_params', jsonb_build_object(
          'client_id', v_id, 'client_secret', v_secret, 'redirect_uri', v_redirect),
        'userinfo_url', 'https://openidconnect.googleapis.com/v1/userinfo',
        'userinfo_headers', jsonb_build_object('Accept', 'application/json'),
        'id_path', 'sub',
        'handle_path', 'email'
      );

    when 'facebook' then
      -- public_profile is granted to every app; email would need App Review.
      v_cfg := jsonb_build_object(
        'ok', true, 'provider', v_provider,
        'authorize_url', 'https://www.facebook.com/v21.0/dialog/oauth',
        'authorize_params', v_base || jsonb_build_object('scope', 'public_profile'),
        'pkce', false,
        'token_url', 'https://graph.facebook.com/v21.0/oauth/access_token',
        'token_basic', false,
        'token_params', jsonb_build_object(
          'client_id', v_id, 'client_secret', v_secret, 'redirect_uri', v_redirect),
        'userinfo_url', 'https://graph.facebook.com/v21.0/me?fields=id,name',
        'userinfo_headers', jsonb_build_object('Accept', 'application/json'),
        'id_path', 'id',
        'handle_path', 'name'
      );

    when 'x' then
      -- confidential client: Basic auth on the token endpoint, plus PKCE.
      v_cfg := jsonb_build_object(
        'ok', true, 'provider', v_provider,
        'authorize_url', 'https://x.com/i/oauth2/authorize',
        'authorize_params', v_base || jsonb_build_object(
          'scope', 'users.read tweet.read offline.access'),
        'pkce', true,
        'token_url', 'https://api.x.com/2/oauth2/token',
        'token_basic', true,
        'token_params', jsonb_build_object('client_id', v_id, 'redirect_uri', v_redirect),
        'userinfo_url', 'https://api.x.com/2/users/me?user.fields=username',
        'userinfo_headers', jsonb_build_object('Accept', 'application/json'),
        'id_path', 'data.id',
        'handle_path', 'data.username'
      );

    when 'pinterest' then
      v_cfg := jsonb_build_object(
        'ok', true, 'provider', v_provider,
        'authorize_url', 'https://www.pinterest.com/oauth/',
        'authorize_params', v_base || jsonb_build_object('scope', 'user_accounts:read'),
        'pkce', false,
        'token_url', 'https://api.pinterest.com/v5/oauth/token',
        'token_basic', true,
        'token_params', jsonb_build_object('redirect_uri', v_redirect),
        'userinfo_url', 'https://api.pinterest.com/v5/user_account',
        'userinfo_headers', jsonb_build_object('Accept', 'application/json'),
        'id_path', 'username',
        'handle_path', 'username'
      );

    when 'reddit' then
      -- duration=permanent is what asks for a refresh token.
      v_cfg := jsonb_build_object(
        'ok', true, 'provider', v_provider,
        'authorize_url', 'https://www.reddit.com/api/v1/authorize',
        'authorize_params', v_base || jsonb_build_object(
          'scope', 'identity', 'duration', 'permanent'),
        'pkce', false,
        'token_url', 'https://www.reddit.com/api/v1/access_token',
        'token_basic', true,
        'token_params', jsonb_build_object('redirect_uri', v_redirect),
        'userinfo_url', 'https://oauth.reddit.com/api/v1/me',
        'userinfo_headers', jsonb_build_object(
          'Accept', 'application/json', 'User-Agent', 'web:1world:v1.0 (by /u/1world)'),
        'id_path', 'id',
        'handle_path', 'name'
      );

    when 'tiktok' then
      -- TikTok says client_key, not client_id, everywhere.
      v_cfg := jsonb_build_object(
        'ok', true, 'provider', v_provider,
        'authorize_url', 'https://www.tiktok.com/v2/auth/authorize/',
        'authorize_params', jsonb_build_object(
          'client_key', v_id,
          'redirect_uri', v_redirect,
          'response_type', 'code',
          'scope', 'user.info.basic'),
        'pkce', true,
        'token_url', 'https://open.tiktokapis.com/v2/oauth/token/',
        'token_basic', false,
        'token_params', jsonb_build_object(
          'client_key', v_id, 'client_secret', v_secret, 'redirect_uri', v_redirect),
        'userinfo_url', 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,union_id,username,display_name',
        'userinfo_headers', jsonb_build_object('Accept', 'application/json'),
        'id_path', 'data.user.open_id',
        'handle_path', 'data.user.username'
      );
  end case;

  if v_cfg is null then
    return jsonb_build_object('ok', false, 'error', 'provider');
  end if;

  -- the two halves of the app, for the token endpoint's Basic auth
  return v_cfg || jsonb_build_object('client_id', v_id, 'client_secret', v_secret);
end;
$$;

revoke all on function public.oauth_config(text) from public;

/** Is the app for this network complete? The dashboard asks before it offers it. */
create or replace function public.oauth_ready(p_provider text)
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce((public.oauth_config(p_provider) ->> 'ok')::boolean, false);
$$;

/** Which of the eight the dashboard may actually offer today. */
create or replace function public.identity_providers_ready()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_object_agg(p, case when public.identity_provider_kind(p) = 'chat'
                                  then true            -- Telegram + WhatsApp link without a client id;
                                                       -- WhatsApp still needs the Cloud API to send.
                                  else public.oauth_ready(p) end)
    from unnest(public.identity_providers()) as p;
$$;

/** The URL the member leaves through: authorize endpoint + our state + PKCE. */
create or replace function public.oauth_authorize_url(p_provider text, p_state text, p_verifier text)
returns text
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_config jsonb := public.oauth_config(p_provider);
  v_params jsonb;
begin
  if coalesce((v_config ->> 'ok')::boolean, false) is not true then
    return null;
  end if;

  v_params := coalesce(v_config -> 'authorize_params', '{}'::jsonb)
              || jsonb_build_object('state', p_state);

  if coalesce((v_config ->> 'pkce')::boolean, false) then
    v_params := v_params || jsonb_build_object(
      'code_challenge', public.oauth_challenge(p_verifier),
      'code_challenge_method', 'S256');
  end if;

  return (v_config ->> 'authorize_url') || '?' || public.oauth_query(v_params);
end;
$$;

-- ------------------------------------------------------------------
-- 4. the callback writes
-- ------------------------------------------------------------------
/** Which member, which provider — and the PKCE verifier. Consumes the state. */
create or replace function public.oauth_state_take(p_state text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_row public.member_identities%rowtype;
begin
  if coalesce(btrim(p_state), '') = '' then
    return jsonb_build_object('ok', false, 'error', 'state');
  end if;

  select * into v_row
    from public.member_identities
   where link_code = btrim(p_state)
     and status = 'pending'
   for update;

  if v_row.identity_id is null then
    return jsonb_build_object('ok', false, 'error', 'state');
  end if;

  if coalesce(v_row.link_expires_at, '-infinity'::timestamptz) < now() then
    update public.member_identities set link_code = null where identity_id = v_row.identity_id;
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  update public.member_identities
     set link_code = null, link_expires_at = null
   where identity_id = v_row.identity_id;

  return jsonb_build_object(
    'ok', true,
    'identity_id', v_row.identity_id,
    'member_id', v_row.member_id,
    'provider', v_row.provider,
    'code_verifier', v_row.code_verifier
  );
end;
$$;

revoke all on function public.oauth_state_take(text) from public;

/** The account came back verified: store it, and say so in the member's log. */
create or replace function public.oauth_identity_save(
  p_member   uuid,
  p_provider text,
  p_external text,
  p_handle   text,
  p_access   text,
  p_refresh  text default null,
  p_expires  timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_external text := nullif(btrim(coalesce(p_external, '')), '');
begin
  if p_member is null or public.identity_provider_kind(v_provider) is distinct from 'oauth' then
    return jsonb_build_object('ok', false, 'error', 'provider');
  end if;
  if v_external is null then
    return jsonb_build_object('ok', false, 'error', 'external');
  end if;

  -- one Google account, one member
  if exists (select 1 from public.member_identities
              where provider = v_provider and external_id = v_external
                and status = 'verified' and member_id <> p_member) then
    return jsonb_build_object('ok', false, 'error', 'taken');
  end if;

  insert into public.member_identities
    (member_id, provider, status, handle, external_id, verified_at,
     access_token, refresh_token, token_expires_at, link_code, link_expires_at, code_verifier)
  values
    (p_member, v_provider, 'verified', nullif(btrim(coalesce(p_handle, '')), ''), v_external, now(),
     p_access, p_refresh, p_expires, null, null, null)
  on conflict (member_id, provider) do update
    set status          = 'verified',
        handle          = excluded.handle,
        external_id     = excluded.external_id,
        verified_at      = now(),
        access_token    = excluded.access_token,
        refresh_token   = coalesce(excluded.refresh_token, member_identities.refresh_token),
        token_expires_at = excluded.token_expires_at,
        link_code       = null,
        link_expires_at = null,
        code_verifier   = null;

  perform public.member_log_write(p_member, null, 'identity_link',
    jsonb_build_object('provider', v_provider), null, 'oauth');

  return jsonb_build_object(
    'ok', true, 'provider', v_provider,
    'handle', (select handle from public.member_identities
                where member_id = p_member and provider = v_provider)
  );
end;
$$;

revoke all on function public.oauth_identity_save(uuid, text, text, text, text, text, timestamptz) from public;

/** The browser never reads a token; the service role may, to refresh a name. */
create or replace function public.identity_token(p_member uuid, p_provider text)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
           'access_token', access_token,
           'refresh_token', refresh_token,
           'expires_at', token_expires_at,
           'external_id', external_id)
    from public.member_identities
   where member_id = p_member and provider = lower(btrim(coalesce(p_provider, '')))
     and status = 'verified';
$$;

revoke all on function public.identity_token(uuid, text) from public;

-- ------------------------------------------------------------------
-- 5. unlink forgets the tokens too
-- ------------------------------------------------------------------
-- `member_identity_unlink` (account-settings.sql) deletes the row, which is
-- already enough. This keeps a re-link honest: a row that is pending when the
-- member changes their mind leaves nothing behind, verifier included.
create or replace function public.member_identity_unlink(p_token text, p_provider text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member   public.members%rowtype := public.member_from_token(p_token);
  v_provider text := lower(btrim(coalesce(p_provider, '')));
  v_gone     int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if public.identity_provider_kind(v_provider) is null then
    return jsonb_build_object('ok', false, 'error', 'provider');
  end if;

  delete from public.member_identities i
   where i.member_id = v_member.id and i.provider = v_provider;
  get diagnostics v_gone = row_count;

  if v_provider = 'telegram' and coalesce(v_member.telegram_chat_id, '') <> '' then
    update public.members set telegram_chat_id = null where id = v_member.id;
  end if;

  perform public.member_log_write(v_member.id, null, 'identity_unlink',
    jsonb_build_object('provider', v_provider), null, 'dashboard');

  return jsonb_build_object('ok', true, 'provider', v_provider, 'unlinked', v_gone > 0);
end;
$$;

revoke all on function public.member_identity_unlink(text, text) from public;
