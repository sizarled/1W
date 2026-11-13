/**
 * 1World — the API keys a member stores for the platforms they publish to.
 * ------------------------------------------------------------------
 * A member connects a platform by pasting the key that platform issued them
 * (a YouTube API key, a TikTok token, a Telegram bot token…). The dashboard
 * shows the row back with only the last four characters; **the key itself is
 * never returned to any browser**, not even to its owner. That is the point of
 * this table: an XSS or a stolen session can list the keys, and still cannot
 * read one.
 *
 *   at rest   pgp_sym_encrypt(key, site_secret('api_key_key'))
 *   in a page '••••' || right(key, 4)                    (key_tail)
 *   for a call api_key_secret(id)  → service role only
 *
 * The table has RLS on and no policies, so the only doors are the four
 * functions below, and every one of them starts with `member_from_token()`.
 */

-- ------------------------------------------------------------------
-- 1. the table
-- ------------------------------------------------------------------
create table if not exists public.member_api_keys (
  id           uuid primary key default gen_random_uuid(),
  member       uuid not null references public.members(id) on delete cascade,
  platform     text not null,
  label        text not null default '',
  key_cipher   bytea not null,
  key_tail     text not null default '',
  status       text not null default 'active',
  last_used_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint member_api_keys_status check (status in ('active', 'revoked')),
  constraint member_api_keys_label check (char_length(label) <= 40),
  constraint member_api_keys_tail check (char_length(key_tail) <= 8)
);

/* one key per platform per label, so "Main channel" cannot be added twice */
create unique index if not exists member_api_keys_slot
  on public.member_api_keys (member, platform, lower(label));

create index if not exists member_api_keys_member
  on public.member_api_keys (member, created_at desc);

alter table public.member_api_keys enable row level security;

-- ------------------------------------------------------------------
-- 2. which platforms a key may belong to
-- ------------------------------------------------------------------
create or replace function public.api_platforms()
returns jsonb
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_agg(jsonb_build_object('slug', slug, 'label', label) order by ord)
  from (values
    ( 1, 'youtube',     'YouTube'),
    ( 2, 'vimeo',       'Vimeo'),
    ( 3, 'dailymotion', 'Dailymotion'),
    ( 4, 'facebook',    'Facebook'),
    ( 5, 'instagram',   'Instagram'),
    ( 6, 'tiktok',      'TikTok'),
    ( 7, 'twitch',      'Twitch'),
    ( 8, 'x',           'X'),
    ( 9, 'spotify',     'Spotify'),
    (10, 'soundcloud',  'SoundCloud'),
    (11, 'podbean',     'Podbean'),
    (12, 'medium',      'Medium'),
    (13, 'substack',    'Substack'),
    (14, 'wordpress',   'WordPress'),
    (15, 'telegram',    'Telegram'),
    (16, 'pinterest',   'Pinterest'),
    (17, 'reddit',      'Reddit')
  ) as t(ord, slug, label);
$$;

create or replace function public.api_platform_known(p_slug text)
returns boolean
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select exists (
    select 1
    from jsonb_array_elements(public.api_platforms()) p
    where p ->> 'slug' = lower(btrim(coalesce(p_slug, '')))
  );
$$;

create or replace function public.api_platform_label(p_slug text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select p ->> 'label'
       from jsonb_array_elements(public.api_platforms()) p
      where p ->> 'slug' = lower(btrim(coalesce(p_slug, '')))),
    '');
$$;

-- ------------------------------------------------------------------
-- 3. the list — the dashboard's table
-- ------------------------------------------------------------------
/**
 * Answers the platforms it accepts and the keys the caller already stored.
 * `tail` is four characters; there is no field that could carry the key.
 */
create or replace function public.member_api_keys(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_rows   jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           k.id,
           'platform',     k.platform,
           'label',        k.label,
           'tail',         k.key_tail,
           'status',       k.status,
           'created_at',   k.created_at,
           'updated_at',   k.updated_at,
           'last_used_at', k.last_used_at
         ) order by k.created_at desc), '[]'::jsonb)
    into v_rows
    from public.member_api_keys k
   where k.member = v_member.id;

  return jsonb_build_object(
    'ok',        true,
    'platforms', public.api_platforms(),
    'keys',      v_rows,
    'limit',     40
  );
end;
$$;

-- ------------------------------------------------------------------
-- 4. add, or replace, one key
-- ------------------------------------------------------------------
create or replace function public.member_api_key_save(
  p_token    text,
  p_id       uuid,
  p_platform text,
  p_label    text,
  p_key      text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_slug   text := lower(btrim(coalesce(p_platform, '')));
  v_label  text := left(btrim(coalesce(p_label, '')), 40);
  v_key    text := btrim(coalesce(p_key, ''));
  v_seal   text := public.site_secret('api_key_key');
  v_row    public.member_api_keys%rowtype;
  v_count  int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if not public.api_platform_known(v_slug) then
    return jsonb_build_object('ok', false, 'error', 'platform');
  end if;
  if char_length(v_key) < 8 then
    return jsonb_build_object('ok', false, 'error', 'short');
  end if;
  if char_length(v_key) > 512 then
    return jsonb_build_object('ok', false, 'error', 'long');
  end if;
  if v_key ~ '\s' then
    return jsonb_build_object('ok', false, 'error', 'space');
  end if;
  if v_seal is null or v_seal = '' then
    return jsonb_build_object('ok', false, 'error', 'config');
  end if;

  if p_id is null then
    select count(*) into v_count
      from public.member_api_keys
     where member = v_member.id;
    if v_count >= 40 then
      return jsonb_build_object('ok', false, 'error', 'limit');
    end if;

    begin
      insert into public.member_api_keys (member, platform, label, key_cipher, key_tail)
      values (v_member.id, v_slug, v_label,
              extensions.pgp_sym_encrypt(v_key, v_seal),
              right(v_key, 4))
      returning * into v_row;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'label');
    end;
  else
    begin
      update public.member_api_keys k
         set platform   = v_slug,
             label      = v_label,
             key_cipher = extensions.pgp_sym_encrypt(v_key, v_seal),
             key_tail   = right(v_key, 4),
             status     = 'active',
             updated_at = now()
       where k.id = p_id
         and k.member = v_member.id
      returning * into v_row;
    exception when unique_violation then
      return jsonb_build_object('ok', false, 'error', 'label');
    end;

    if v_row.id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  return jsonb_build_object(
    'ok',  true,
    'key', jsonb_build_object(
      'id',           v_row.id,
      'platform',     v_row.platform,
      'label',        v_row.label,
      'tail',         v_row.key_tail,
      'status',       v_row.status,
      'created_at',   v_row.created_at,
      'updated_at',   v_row.updated_at,
      'last_used_at', v_row.last_used_at
    )
  );
end;
$$;

-- ------------------------------------------------------------------
-- 5. remove one
-- ------------------------------------------------------------------
create or replace function public.member_api_key_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_gone   int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  delete from public.member_api_keys k
   where k.id = p_id
     and k.member = v_member.id;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'removed', v_gone > 0);
end;
$$;

-- ------------------------------------------------------------------
-- 6. the key itself — the service role, and nothing else
-- ------------------------------------------------------------------
/**
 * The only function that decrypts. A page cannot reach it: it is revoked from
 * public, anon and authenticated below, so a member can list their keys and
 * still never read one.
 */
create or replace function public.api_key_secret(p_id uuid)
returns text
language sql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select extensions.pgp_sym_decrypt(k.key_cipher, public.site_secret('api_key_key'))
    from public.member_api_keys k
   where k.id = p_id;
$$;

/* the row that seals every key — 32 random bytes, hex, once */
insert into public.site_secrets (key, value)
select 'api_key_key', encode(extensions.gen_random_bytes(32), 'hex')
 where not exists (select 1 from public.site_secrets where key = 'api_key_key');

-- ------------------------------------------------------------------
-- 7. grants
-- ------------------------------------------------------------------
revoke all on function public.member_api_keys(text) from public;
revoke all on function public.member_api_key_save(text, uuid, text, text, text) from public;
revoke all on function public.member_api_key_delete(text, uuid) from public;
revoke all on function public.api_key_secret(uuid) from public;

grant execute on function public.api_platforms() to anon, authenticated, service_role;
grant execute on function public.api_platform_known(text) to anon, authenticated, service_role;
grant execute on function public.api_platform_label(text) to anon, authenticated, service_role;
grant execute on function public.member_api_keys(text) to anon, authenticated, service_role;
grant execute on function public.member_api_key_save(text, uuid, text, text, text) to anon, authenticated, service_role;
grant execute on function public.member_api_key_delete(text, uuid) to anon, authenticated, service_role;

revoke execute on function public.api_key_secret(uuid) from anon, authenticated;
grant execute on function public.api_key_secret(uuid) to service_role;

/* `site_secret` stays closed to the browser — every reader is SECURITY DEFINER */
revoke execute on function public.site_secret(text) from public, anon, authenticated;
grant execute on function public.site_secret(text) to service_role;
