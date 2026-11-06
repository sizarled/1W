/**
 * 1World — the Platform table, and the homepage shelf that reads it.
 * ------------------------------------------------------------------
 * Section 09 on the homepage used to be a hard-coded list in
 * `assets/js/config.js` (fourteen places to follow the project). It is now a
 * table, so the list is content, not code:
 *
 *   public.platform     one row per place: logo, name, username, link and a
 *                       status — `available` (it is drawn on the homepage) or
 *                       `unavailable` (it is kept, but the homepage never sees
 *                       it).
 *
 * The homepage reads it through `platform_public()`, which is callable without
 * a session and returns the available rows in their order. The control panel
 * (`panel.html`) reads every row — available or not — through
 * `platform_admin_list()`, and writes with `platform_save()` /
 * `platform_delete()`.
 *
 * Who may write
 * -------------
 * `site_staff` holds the member codes that run the site. A member is an
 * administrator when their code is in that table, or their `account_status`
 * is admin / owner / moderator, or their level is 8 or above — the same rule
 * `dashboard.js` already used to reveal the Administration group. Every write
 * asks `site_admin()` first and answers `{ok:false, error:'staff'}` otherwise,
 * so the table is never writable from a token alone.
 *
 * Row level security is on with no policies: the table is RPC-only, exactly
 * like the rest of the schema.
 */

-- ------------------------------------------------------------------
-- 1. who runs the site
-- ------------------------------------------------------------------
create table if not exists public.site_staff (
  member_id  text primary key,
  role       text not null default 'admin',
  added_by   text not null default 'system',
  created_at timestamptz not null default now(),
  constraint site_staff_role check (role in ('owner', 'admin', 'editor'))
);

alter table public.site_staff enable row level security;

insert into public.site_staff (member_id, role, added_by)
values ('ID100019', 'owner', 'system'),
       ('ID100003', 'owner', 'system')
on conflict (member_id) do nothing;

-- ------------------------------------------------------------------
-- 2. the platforms
-- ------------------------------------------------------------------
create sequence if not exists public.platform_code_seq start 100001;

create table if not exists public.platform (
  id          uuid primary key default gen_random_uuid(),
  code        text not null default '',
  name        text not null,
  username    text not null default '',
  url         text not null default '',
  logo_url    text not null default '',
  icon        text not null default '',
  status      text not null default 'available',
  sort_order  integer not null default 100,
  created_by  text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint platform_status check (status in ('available', 'unavailable')),
  constraint platform_name check (char_length(btrim(name)) between 1 and 60),
  constraint platform_username check (char_length(username) <= 80),
  constraint platform_url check (char_length(url) <= 400),
  constraint platform_logo check (char_length(logo_url) <= 600),
  constraint platform_icon check (char_length(icon) <= 40)
);

create unique index if not exists platform_code on public.platform (code);
create unique index if not exists platform_name_handle on public.platform (lower(btrim(name)), lower(btrim(username)));
create index if not exists platform_order on public.platform (status, sort_order, name);

alter table public.platform enable row level security;

-- ------------------------------------------------------------------
-- 3. am I staff?
-- ------------------------------------------------------------------
create or replace function public.site_admin(p_token text)
returns boolean
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
begin
  if v_member.id is null then
    return false;
  end if;
  if exists (select 1 from public.site_staff s where s.member_id = v_member.member_id) then
    return true;
  end if;
  if lower(coalesce(v_member.account_status, '')) in ('admin', 'owner', 'moderator') then
    return true;
  end if;
  return coalesce(v_member.level, 1) >= 8;
end;
$$;

-- ------------------------------------------------------------------
-- 4. one row as the pages read it
-- ------------------------------------------------------------------
create or replace function public.platform_json(p public.platform)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select jsonb_build_object(
    'id',         p.id,
    'code',       p.code,
    'name',       p.name,
    'username',   p.username,
    'url',        p.url,
    'logo_url',   p.logo_url,
    'icon',       p.icon,
    'status',     p.status,
    'sort_order', p.sort_order,
    'created_at', p.created_at,
    'updated_at', p.updated_at
  );
$$;

-- ------------------------------------------------------------------
-- 5. the public door — available rows only, no session needed
-- ------------------------------------------------------------------
create or replace function public.platform_public()
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
  select jsonb_build_object(
    'ok',   true,
    'rows', coalesce(
      jsonb_agg(public.platform_json(p) order by p.sort_order, lower(p.name)),
      '[]'::jsonb
    )
  )
  from public.platform p
  where p.status = 'available';
$$;

-- ------------------------------------------------------------------
-- 6. the panel — every row, staff only
-- ------------------------------------------------------------------
create or replace function public.platform_admin_list(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_admin boolean := public.site_admin(p_token);
begin
  if not v_admin then
    return jsonb_build_object('ok', false, 'error', 'staff', 'admin', false, 'rows', '[]'::jsonb);
  end if;

  return jsonb_build_object(
    'ok',    true,
    'admin', true,
    'rows',  coalesce((
      select jsonb_agg(public.platform_json(p) order by p.sort_order, lower(p.name))
        from public.platform p
    ), '[]'::jsonb)
  );
end;
$$;

-- ------------------------------------------------------------------
-- 7. write
-- ------------------------------------------------------------------
create or replace function public.platform_save(
  p_token    text,
  p_id       uuid,
  p_name     text,
  p_username text,
  p_url      text,
  p_logo_url text,
  p_icon     text,
  p_status   text,
  p_sort     integer
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_name   text := btrim(coalesce(p_name, ''));
  v_user   text := btrim(coalesce(p_username, ''));
  v_url    text := btrim(coalesce(p_url, ''));
  v_logo   text := btrim(coalesce(p_logo_url, ''));
  v_icon   text := lower(btrim(coalesce(p_icon, '')));
  v_status text := lower(btrim(coalesce(p_status, 'available')));
  v_row    public.platform%rowtype;
  v_code   text;
begin
  if not public.site_admin(p_token) then
    return jsonb_build_object('ok', false, 'error', 'staff');
  end if;

  if char_length(v_name) < 1 then
    return jsonb_build_object('ok', false, 'error', 'name');
  end if;
  if v_url <> '' and v_url !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'url');
  end if;
  if v_logo <> '' and v_logo !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'logo');
  end if;
  if v_status not in ('available', 'unavailable') then
    v_status := 'available';
  end if;

  if p_id is null then
    v_code := 'PLT' || lpad(nextval('public.platform_code_seq')::text, 6, '0');
    insert into public.platform (code, name, username, url, logo_url, icon, status, sort_order, created_by)
    values (v_code, left(v_name, 60), left(v_user, 80), v_url, v_logo, left(v_icon, 40),
            v_status, coalesce(p_sort, 100), coalesce(v_member.member_id, ''))
    on conflict (lower(btrim(name)), lower(btrim(username))) do nothing
    returning * into v_row;

    if v_row.id is null then
      return jsonb_build_object('ok', false, 'error', 'duplicate');
    end if;
  else
    update public.platform p
       set name       = left(v_name, 60),
           username   = left(v_user, 80),
           url        = v_url,
           logo_url   = v_logo,
           icon       = left(v_icon, 40),
           status     = v_status,
           sort_order = coalesce(p_sort, p.sort_order),
           updated_at = now()
     where p.id = p_id
     returning * into v_row;

    if v_row.id is null then
      return jsonb_build_object('ok', false, 'error', 'missing');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'row', public.platform_json(v_row));
exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

create or replace function public.platform_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
begin
  if not public.site_admin(p_token) then
    return jsonb_build_object('ok', false, 'error', 'staff');
  end if;

  delete from public.platform p where p.id = p_id;
  if not found then
    return jsonb_build_object('ok', false, 'error', 'missing');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- ------------------------------------------------------------------
-- 8. the shelf the homepage already has, as data
-- ------------------------------------------------------------------
insert into public.platform (code, name, username, url, icon, status, sort_order, created_by)
values
  ('PLT100001', 'YouTube',   '@CineauraV2',        'https://www.youtube.com/@CineauraV2',                        'youtube',   'available', 10,  'seed'),
  ('PLT100002', 'Facebook',  'CineauraV2',         'https://www.facebook.com/CineauraV2',                        'facebook',  'available', 20,  'seed'),
  ('PLT100003', 'FB Group',  'Cineaura Community', 'https://web.facebook.com/groups/2011674376679254',           'facebook',  'available', 30,  'seed'),
  ('PLT100004', 'Instagram', '@cineaurav2',        'https://www.instagram.com/cineaurav2/',                      'instagram', 'available', 40,  'seed'),
  ('PLT100005', 'Reddit',    'r/Cineaura2',        'https://www.reddit.com/r/Cineaura2',                         'reddit',    'available', 50,  'seed'),
  ('PLT100006', 'Pinterest', 'CineauraV2',         'https://www.pinterest.com/CineauraV2',                       'pinterest', 'available', 60,  'seed'),
  ('PLT100007', 'Quora',     'Cineaura Arabic',    'https://msaht-cineaurav2arabic.quora.com',                   'quora',     'available', 70,  'seed'),
  ('PLT100008', 'Tumblr',    'cineaura-officiel',  'https://www.tumblr.com/cineaura-officiel-v2',                'tumblr',    'available', 80,  'seed'),
  ('PLT100009', 'Rumble',    'c-7972430',          'https://rumble.com/c/c-7972430',                             'rumble',    'available', 90,  'seed'),
  ('PLT100010', 'Odysee',    '@CineauraV2',        'https://odysee.com/@CineauraV2:c10d9b2863',                  'odysee',    'available', 100, 'seed'),
  ('PLT100011', 'Vimeo',     'Channel 1972980',    'https://vimeo.com/channels/1972980',                         'vimeo',     'available', 110, 'seed'),
  ('PLT100012', 'TikTok',    '@cineauraV2',        'https://www.tiktok.com/@cineauraV2',                         'tiktok',    'available', 120, 'seed'),
  ('PLT100013', 'Bilibili',  'Cineaura',           'https://www.bilibili.tv/en/space/1861102337',                'bilibili',  'available', 130, 'seed'),
  ('PLT100014', 'Telegram',  '@CineauraV2',        'https://t.me/CineauraV2',                                    'telegram',  'available', 140, 'seed')
on conflict do nothing;

-- ------------------------------------------------------------------
-- 9. grants — the shelf is public, the rest checks the token
-- ------------------------------------------------------------------
revoke all on public.platform from public, anon, authenticated;
revoke all on public.site_staff from public, anon, authenticated;

revoke all on function public.site_admin(text) from public;
revoke all on function public.platform_json(public.platform) from public;
revoke all on function public.platform_public() from public;
revoke all on function public.platform_admin_list(text) from public;
revoke all on function public.platform_save(text, uuid, text, text, text, text, text, text, integer) from public;
revoke all on function public.platform_delete(text, uuid) from public;

grant execute on function public.site_admin(text) to anon, authenticated, service_role;
grant execute on function public.platform_json(public.platform) to anon, authenticated, service_role;
grant execute on function public.platform_public() to anon, authenticated, service_role;
grant execute on function public.platform_admin_list(text) to anon, authenticated, service_role;
grant execute on function public.platform_save(text, uuid, text, text, text, text, text, text, integer) to anon, authenticated, service_role;
grant execute on function public.platform_delete(text, uuid) to anon, authenticated, service_role;
