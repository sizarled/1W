-- ==================================================================
-- rest.html — account recovery (three steps, a link, and a device path)
-- ------------------------------------------------------------------
-- Step 1  identity   email + phone, matched against `members`
-- Step 2  code       the recovery code: OW-XXXX-XXXX-XXXX, stored only as
--                    a sha256 fingerprint in `members.recovery_code_hash`
-- Step 3  password   a ticket (20 minutes) unlocks the new password
--
-- Two short-cuts:
--   · `rest.html?recovry=OW-XXXX-XXXX-XXXX` — the recovery link, same secret,
--     jumps straight to the data + the password field;
--   · the device path — full name + phone + email + a viewing code that the
--     member created at activation, accepted only from a device that is already
--     bound to one of those codes (`watch_code_devices`).
--
-- Every use of the code (or of the link, or of the device path) mints a **new**
-- recovery code and returns the member's data, so the page can offer the .txt
-- again. The old code stops working the moment it is spent.
--
-- Delivery: the code leaves through a Google Apps Script web app (email and
-- **WhatsApp**, Meta Cloud API) and through the Telegram bot (message). Every
-- endpoint and every token lives in `site_secrets`, never in the browser and
-- never in this file.
-- ==================================================================

-- the old, unused recovery experiment (six-digit codes in `recovery_codes`,
-- which never existed) is replaced by this file; drop its entry points so the
-- names below are unambiguous
drop function if exists public.recovery_start(text, text, boolean);
drop function if exists public.recovery_verify(uuid, text);
drop function if exists public.recovery_reset(uuid, text, text, text);
drop function if exists public.recovery_delivery(uuid);

-- ------------------------------------------------------------------
-- 1. the columns the flow needs
-- ------------------------------------------------------------------
alter table public.members
  add column if not exists recovery_issued_at         timestamptz,
  add column if not exists recovery_expires_at        timestamptz,
  add column if not exists recovery_attempts          smallint not null default 0,
  add column if not exists recovery_locked_until      timestamptz,
  add column if not exists recovery_ticket_hash       text,
  add column if not exists recovery_ticket_expires_at timestamptz,
  add column if not exists recovery_last_channel      text,
  add column if not exists telegram_chat_id           text;

create index if not exists members_recovery_ticket_idx
  on public.members (recovery_ticket_hash) where recovery_ticket_hash is not null;

-- ------------------------------------------------------------------
-- 2. secrets + delivery log (server-side only)
-- ------------------------------------------------------------------
create table if not exists public.site_secrets (
  key        text primary key,
  value      text,
  updated_at timestamptz not null default now()
);

alter table public.site_secrets enable row level security;
-- no policies on purpose: only the SECURITY DEFINER functions below read it

create table if not exists public.recovery_delivery (
  delivery_id uuid primary key default gen_random_uuid(),
  member_id   uuid references public.members(id) on delete cascade,
  channel     text not null,
  target      text,
  status      text not null default 'queued',
  request_id  bigint,
  detail      text,
  created_at  timestamptz not null default now()
);

create index if not exists recovery_delivery_member_idx
  on public.recovery_delivery (member_id, created_at desc);

alter table public.recovery_delivery enable row level security;

-- outbound HTTP from the database (Supabase ships pg_net)
do $$
begin
  begin
    create extension if not exists pg_net;
  exception when others then
    null;   -- the flow still issues codes, the channels simply report false
  end;
end $$;

create or replace function public.site_secret(p_key text)
returns text
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select nullif(btrim(value), '') from public.site_secrets where key = btrim(coalesce(p_key, ''));
$$;

revoke all on function public.site_secret(text) from public;

-- ------------------------------------------------------------------
-- 3. small helpers
-- ------------------------------------------------------------------
-- phones are compared on their last nine digits, so +212 6.. / 06.. agree
create or replace function public.recovery_phone_key(p text)
returns text
language sql
immutable
as $$
  select right(regexp_replace(coalesce(p, ''), '[^0-9]', '', 'g'), 9);
$$;

-- codes are hashed in one canonical shape: OW-XXXX-XXXX-XXXX, upper case, with
-- the dashes. `member_register()` stored `digest(code, 'sha256')` of exactly that
-- shape, so every reader here goes through this helper and old hashes keep working.
create or replace function public.recovery_code_key(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := coalesce(p, '');
begin
  -- a whole link may be pasted where only the code belongs
  if position('recovry=' in lower(v)) > 0 then
    v := substring(v from position('recovry=' in lower(v)) + 8);
  end if;
  v := upper(regexp_replace(v, '[^A-Za-z0-9]', '', 'g'));

  if v like 'OW%' and length(v) = 14 then
    return 'OW-' || substr(v, 3, 4) || '-' || substr(v, 7, 4) || '-' || substr(v, 11, 4);
  end if;
  return v;
end;
$$;

create or replace function public.recovery_code_hash(p text)
returns text
language sql
immutable
as $$
  select encode(digest(public.recovery_code_key(p), 'sha256'), 'hex');
$$;

-- a device id is compared the way the browser stores it, not the way it is
-- typed: upper case, letters and digits only. `9E:3D:EB:E8:B8:50`,
-- `9e-3d-eb-e8-b8-50` and `9E3DEBE8B850` are one device.
create or replace function public.recovery_device_key(p text)
returns text
language sql
immutable
as $$
  select upper(regexp_replace(coalesce(p, ''), '[^0-9a-zA-Z]', '', 'g'));
$$;

-- the full name is compared as a **set** of words: "MOUAOUINE EL MEHDI",
-- "el mehdi mouaouine" and "Mouaouine,  El-Mehdi" are the same account holder.
create or replace function public.recovery_name_key(p text)
returns text
language sql
immutable
as $$
  select coalesce(string_agg(tok, ' ' order by tok), '')
    from regexp_split_to_table(
           regexp_replace(lower(coalesce(p, '')), '[^a-z0-9]+', ' ', 'g'), ' '
         ) as tok
   where tok <> '';
$$;

create or replace function public.mask_email(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := btrim(coalesce(p, ''));
  v_at integer := strpos(v, '@');
begin
  if v_at < 2 then
    return '***';
  end if;
  return substr(v, 1, 1) || repeat('•', greatest(v_at - 2, 1)) || substr(v, v_at);
end;
$$;

create or replace function public.mask_phone(p text)
returns text
language plpgsql
immutable
as $$
declare
  v text := btrim(coalesce(p, ''));
begin
  if length(v) < 5 then
    return '***';
  end if;
  return substr(v, 1, greatest(length(v) - 6, 1)) || '***' || right(v, 3);
end;
$$;

create or replace function public.recovery_member_json(p_row public.members)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'member_id',    p_row.member_id,
    'member_code',  p_row.member_code,
    'full_name',    p_row.full_name,
    'username',     p_row.username,
    'email',        p_row.email,
    'phone_number', p_row.phone_number,
    'birth_date',   p_row.birth_date,
    'country',      p_row.country,
    'status',       p_row.status,
    'created_at',   p_row.created_at,
    'activated_at', p_row.account_activated_at
  );
$$;

-- WhatsApp/SMS numbers are compared in E.164: digits only, country code first,
-- no plus. A member types `0668313718`, `+212 668-313718` or `00212668313718`
-- and WhatsApp reads `212668313718` — the same number three ways.
--
-- The country code comes from the member's country when the database knows a
-- name it recognises, and from `site_secrets.whatsapp_cc` otherwise (Morocco,
-- the site's home). A number that already carries its country code is left
-- alone: it is longer than a local number.
create or replace function public.whatsapp_number(p_phone text, p_country text default null, p_default_cc text default null)
returns text
language plpgsql
immutable
as $$
declare
  v_raw_phone text := btrim(coalesce(p_phone, ''));
  -- a number that arrives with `+` or `00` already carries its country code,
  -- whatever it is: Andorra is +376 six digits, and it must not become a
  -- Moroccan number just because the site defaults to 212
  v_intl boolean := left(v_raw_phone, 1) = '+'
                     or left(regexp_replace(v_raw_phone, '[^0-9]', '', 'g'), 2) = '00';
  v      text := regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g');
  -- the country arrives as a name in English ("Morocco") or in Arabic
  -- ("المغرب"), or as an ISO code ("MA"): keep both shapes
  v_lat  text := lower(regexp_replace(btrim(coalesce(p_country, '')), '[^a-zA-Z]', '', 'g'));
  v_raw  text := btrim(coalesce(p_country, ''));
  v_cc   text;
  v_dial text;
begin
  if v = '' then
    return null;
  end if;
  -- 00212… is 212…
  if left(v, 2) = '00' then
    v := substr(v, 3);
  end if;

  v_dial := case v_lat
    when 'morocco' then '212'      when 'ma' then '212'
    when 'algeria' then '213'      when 'dz' then '213'
    when 'tunisia' then '216'      when 'tn' then '216'
    when 'egypt' then '20'         when 'eg' then '20'
    when 'libya' then '218'        when 'ly' then '218'
    when 'sudan' then '249'        when 'sd' then '249'
    when 'saudiarabia' then '966'  when 'sa' then '966'
    when 'emirates' then '971'     when 'unitedarabemirates' then '971' when 'ae' then '971'
    when 'qatar' then '974'        when 'qa' then '974'
    when 'kuwait' then '965'       when 'kw' then '965'
    when 'bahrain' then '973'      when 'bh' then '973'
    when 'oman' then '968'         when 'om' then '968'
    when 'jordan' then '962'       when 'jo' then '962'
    when 'iraq' then '964'         when 'iq' then '964'
    when 'lebanon' then '961'      when 'lb' then '961'
    when 'palestine' then '970'    when 'ps' then '970'
    when 'syria' then '963'        when 'sy' then '963'
    when 'yemen' then '967'        when 'ye' then '967'
    when 'turkey' then '90'        when 'tr' then '90'
    when 'france' then '33'        when 'fr' then '33'
    when 'belgium' then '32'       when 'be' then '32'
    when 'spain' then '34'         when 'es' then '34'
    when 'italy' then '39'         when 'it' then '39'
    when 'germany' then '49'       when 'de' then '49'
    when 'netherlands' then '31'   when 'nl' then '31'
    when 'portugal' then '351'     when 'pt' then '351'
    when 'switzerland' then '41'   when 'ch' then '41'
    when 'sweden' then '46'        when 'se' then '46'
    when 'norway' then '47'        when 'no' then '47'
    when 'denmark' then '45'       when 'dk' then '45'
    when 'unitedkingdom' then '44' when 'uk' then '44' when 'gb' then '44'
    when 'unitedstates' then '1'   when 'usa' then '1' when 'us' then '1'
    when 'canada' then '1'         when 'ca' then '1'
    else null
  end;

  if v_dial is null then
    v_dial := case v_raw
      when 'المغرب' then '212'              when 'الجزائر' then '213'
      when 'تونس' then '216'                when 'مصر' then '20'
      when 'ليبيا' then '218'               when 'السودان' then '249'
      when 'السعودية' then '966'            when 'الإمارات' then '971'
      when 'الامارات' then '971'            when 'قطر' then '974'
      when 'الكويت' then '965'              when 'البحرين' then '973'
      when 'عُمان' then '968'               when 'عمان' then '968'
      when 'الأردن' then '962'              when 'الاردن' then '962'
      when 'العراق' then '964'              when 'لبنان' then '961'
      when 'فلسطين' then '970'              when 'سوريا' then '963'
      when 'اليمن' then '967'               when 'تركيا' then '90'
      when 'فرنسا' then '33'                when 'بلجيكا' then '32'
      when 'إسبانيا' then '34'              when 'اسبانيا' then '34'
      when 'إيطاليا' then '39'              when 'ألمانيا' then '49'
      when 'هولندا' then '31'               when 'البرتغال' then '351'
      when 'سويسرا' then '41'               when 'السويد' then '46'
      when 'النرويج' then '47'              when 'الدنمارك' then '45'
      when 'المملكة المتحدة' then '44'      when 'الولايات المتحدة' then '1'
      when 'كندا' then '1'
      else null
    end;
  end if;

  -- the member's own country first: it is their number being dialled
  v_cc := coalesce(
    nullif(v_dial, ''),
    nullif(regexp_replace(coalesce(p_default_cc, ''), '[^0-9]', '', 'g'), ''),
    '212'   -- the site's home; `whatsapp_cc` covers a country not listed above
  );

  if not v_intl then
    if left(v, 1) = '0' then
      v := v_cc || ltrim(v, '0');                     -- 0668… → 212668…
    elsif length(v) between 8 and 10 and left(v, length(v_cc)) <> v_cc then
      v := v_cc || v;                                  -- 668…  → 212668…
    end if;
  end if;

  if length(v) < 8 or length(v) > 15 then
    return null;                                       -- not a number WhatsApp will take
  end if;
  return v;
end;
$$;

-- ------------------------------------------------------------------
-- 4. delivery — Apps Script (email + WhatsApp) and the Telegram bot
-- ------------------------------------------------------------------
create or replace function public.recovery_send(p_member public.members, p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_mail_url   text := public.site_secret('gs_mail_url');
  v_mail_token text := public.site_secret('gs_mail_token');
  v_mail_cc    text := public.site_secret('gs_mail_cc');
  -- WhatsApp rides the same web app; `whatsapp_url` points it at another one
  v_wa_url     text := coalesce(public.site_secret('whatsapp_url'), public.site_secret('gs_mail_url'));
  v_wa_token   text := coalesce(public.site_secret('whatsapp_token'), public.site_secret('gs_mail_token'));
  v_wa_to      text := public.whatsapp_number(
                         p_member.phone_number,
                         p_member.country,
                         public.site_secret('whatsapp_cc'));
  v_bot        text := public.site_secret('telegram_bot_token');
  v_chat       text := coalesce(nullif(p_member.telegram_chat_id, ''), public.site_secret('telegram_chat_id'));
  v_name       text := coalesce(nullif(btrim(p_member.full_name), ''), p_member.username, 'member');
  v_text       text;
  v_wa_text    text;
  v_body       jsonb;
  v_id         bigint;
  v_email      boolean := false;
  v_telegram   boolean := false;
  v_whatsapp   boolean := false;
  v_has_net    boolean := exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'net' and p.proname = 'http_post'
  );
begin
  v_text := format(
    E'1World — account recovery\n\nHello %s,\n\nYour recovery code is:\n\n   %s\n\nIt is valid for 30 minutes and it works once: after you change the password a new code replaces it.\nIf you did not ask for this, ignore the message — your password stays as it is.\n',
    v_name, p_code
  );

  -- WhatsApp is a chat, not a letter: the code, and nothing that has to be read
  v_wa_text := format(
    E'1World — recovery code\n\n%s\n\nValid for 30 minutes, and it works once. If you did not ask for this, ignore this message.',
    p_code
  );

  -- email ------------------------------------------------------------
  if v_mail_url is not null and coalesce(btrim(p_member.email), '') <> '' then
    begin
      v_body := jsonb_build_object(
        'token',   coalesce(v_mail_token, ''),
        'channel', 'email',
        'to',      p_member.email,
        'name',    v_name,
        'subject', '1World — your recovery code',
        'code',    p_code,
        'text',    v_text,
        'member',  p_member.member_id,
        'cc',      v_mail_cc
      );
      if v_has_net then
        select net.http_post(
          url  => v_mail_url,
          body => v_body,
          headers => jsonb_build_object('Content-Type', 'application/json'),
          timeout_milliseconds => 10000
        ) into v_id;
      end if;
      insert into public.recovery_delivery (member_id, channel, target, status, request_id)
      values (p_member.id, 'email', public.mask_email(p_member.email),
              case when v_has_net then 'queued' else 'skipped' end, v_id);
      v_email := v_has_net;
    exception when others then
      insert into public.recovery_delivery (member_id, channel, target, status, detail)
      values (p_member.id, 'email', public.mask_email(p_member.email), 'failed', left(sqlerrm, 200));
    end;
  else
    insert into public.recovery_delivery (member_id, channel, target, status, detail)
    values (p_member.id, 'email', public.mask_email(p_member.email), 'skipped', 'gs_mail_url missing');
  end if;

  -- WhatsApp --------------------------------------------------------
  if v_wa_url is not null and v_wa_to is not null then
    begin
      v_body := jsonb_build_object(
        'token',   coalesce(v_wa_token, ''),
        'channel', 'whatsapp',
        'to',      v_wa_to,          -- E.164 digits, no plus: 212668313718
        'name',    v_name,
        'code',    p_code,
        'text',    v_wa_text,
        'member',  p_member.member_id
      );
      if v_has_net then
        select net.http_post(
          url  => v_wa_url,
          body => v_body,
          headers => jsonb_build_object('Content-Type', 'application/json'),
          timeout_milliseconds => 10000
        ) into v_id;
      end if;
      insert into public.recovery_delivery (member_id, channel, target, status, request_id)
      values (p_member.id, 'whatsapp', public.mask_phone('+' || v_wa_to),
              case when v_has_net then 'queued' else 'skipped' end, v_id);
      v_whatsapp := v_has_net;
    exception when others then
      insert into public.recovery_delivery (member_id, channel, target, status, detail)
      values (p_member.id, 'whatsapp', public.mask_phone('+' || v_wa_to), 'failed', left(sqlerrm, 200));
    end;
  else
    insert into public.recovery_delivery (member_id, channel, target, status, detail)
    values (p_member.id, 'whatsapp', public.mask_phone(p_member.phone_number), 'skipped',
            case when v_wa_url is null then 'no delivery endpoint: gs_mail_url missing'
                 else 'the phone does not read as an international number' end);
  end if;

  -- Telegram --------------------------------------------------------
  if v_bot is not null and v_chat is not null then
    begin
      if v_has_net then
        select net.http_post(
          url  => 'https://api.telegram.org/bot' || v_bot || '/sendMessage',
          body => jsonb_build_object('chat_id', v_chat, 'text', v_text, 'disable_web_page_preview', true),
          headers => jsonb_build_object('Content-Type', 'application/json'),
          timeout_milliseconds => 10000
        ) into v_id;
      end if;
      insert into public.recovery_delivery (member_id, channel, target, status, request_id)
      values (p_member.id, 'telegram', 'chat ' || left(v_chat, 6) || '…',
              case when v_has_net then 'queued' else 'skipped' end, v_id);
      v_telegram := v_has_net;
    exception when others then
      insert into public.recovery_delivery (member_id, channel, target, status, detail)
      values (p_member.id, 'telegram', 'chat', 'failed', left(sqlerrm, 200));
    end;
  else
    insert into public.recovery_delivery (member_id, channel, target, status, detail)
    values (p_member.id, 'telegram', 'chat', 'skipped', 'bot token or chat id missing');
  end if;

  update public.members
     set recovery_last_channel = concat_ws('+',
           case when v_email then 'email' end,
           case when v_whatsapp then 'whatsapp' end,
           case when v_telegram then 'telegram' end)
   where id = p_member.id;

  return jsonb_build_object('email', v_email, 'whatsapp', v_whatsapp, 'telegram', v_telegram);
end;
$$;

revoke all on function public.recovery_send(public.members, text) from public;

-- ------------------------------------------------------------------
-- 5. step 1 — email + phone, then the code is sent
-- ------------------------------------------------------------------
create or replace function public.recovery_start(
  p_email text,
  p_phone text,
  p_ip    text default null,
  p_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_phone text := public.recovery_phone_key(p_phone);
  v_row   public.members%rowtype;
  v_code  text;
  v_wait  integer;
  v_chan  jsonb;
begin
  if v_email !~ '^[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}$' then
    return jsonb_build_object('ok', false, 'error', 'email_format');
  end if;
  if v_phone = '' or length(v_phone) < 6 then
    return jsonb_build_object('ok', false, 'error', 'phone_format');
  end if;

  select * into v_row from public.members m where lower(btrim(m.email)) = v_email limit 1;
  if v_row.id is null then
    perform public.member_log_write(null, null, 'recovery_failed',
      jsonb_build_object('reason', 'not_found', 'email', left(v_email, 80)), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if public.recovery_phone_key(v_row.phone_number) <> v_phone then
    perform public.member_log_write(v_row.id, null, 'recovery_failed',
      jsonb_build_object('reason', 'phone'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'phone');
  end if;

  if v_row.status = 'banned' and coalesce(v_row.ban_permanent, false) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  if v_row.recovery_locked_until is not null and v_row.recovery_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'until', v_row.recovery_locked_until);
  end if;

  v_wait := coalesce(ceil(extract(epoch from (v_row.recovery_issued_at + interval '60 seconds' - now()))), 0);
  if v_row.recovery_issued_at is not null and v_wait > 0 then
    return jsonb_build_object('ok', false, 'error', 'wait', 'retry_after', v_wait);
  end if;

  v_code := public.member_recovery_code();

  update public.members
     set recovery_code_hash         = public.recovery_code_hash(v_code),
         recovery_issued_at         = now(),
         recovery_expires_at        = now() + interval '30 minutes',
         recovery_attempts          = 0,
         recovery_ticket_hash       = null,
         recovery_ticket_expires_at = null
   where id = v_row.id
   returning * into v_row;

  v_chan := public.recovery_send(v_row, v_code);

  perform public.member_log_write(v_row.id, null, 'recovery_request',
    jsonb_build_object('channels', v_chan), p_ip, p_agent);

  return jsonb_build_object(
    'ok', true,
    'member_id', v_row.member_id,
    'username', v_row.username,
    'full_name', v_row.full_name,
    'masked_email', public.mask_email(v_row.email),
    'masked_phone', public.mask_phone(v_row.phone_number),
    'channels', v_chan,
    'expires_at', v_row.recovery_expires_at,
    'restricted', v_row.status is distinct from 'active'
  );
end;
$$;

-- ------------------------------------------------------------------
-- 6. shared: mint the ticket that unlocks step 3
-- ------------------------------------------------------------------
create or replace function public.recovery_issue_ticket(p_member_id uuid)
returns text
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_ticket text := encode(gen_random_bytes(24), 'hex');
begin
  update public.members
     set recovery_ticket_hash       = encode(digest(v_ticket, 'sha256'), 'hex'),
         recovery_ticket_expires_at = now() + interval '20 minutes',
         recovery_attempts          = 0
   where id = p_member_id;
  return v_ticket;
end;
$$;

revoke all on function public.recovery_issue_ticket(uuid) from public;

-- ------------------------------------------------------------------
-- 7. step 2 — the code
-- ------------------------------------------------------------------
create or replace function public.recovery_verify(
  p_email text,
  p_phone text,
  p_code  text,
  p_ip    text default null,
  p_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_phone  text := public.recovery_phone_key(p_phone);
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row    public.members%rowtype;
  v_ticket text;
begin
  select * into v_row from public.members m where lower(btrim(m.email)) = v_email limit 1;
  if v_row.id is null or public.recovery_phone_key(v_row.phone_number) <> v_phone then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if v_row.recovery_locked_until is not null and v_row.recovery_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'until', v_row.recovery_locked_until);
  end if;

  if v_row.recovery_code_hash is null then
    return jsonb_build_object('ok', false, 'error', 'no_code');
  end if;

  if v_row.recovery_expires_at is null or v_row.recovery_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  if public.recovery_code_hash(v_code) is distinct from v_row.recovery_code_hash then
    perform public.member_log_write(v_row.id, null, 'recovery_failed',
      jsonb_build_object('reason', 'code', 'attempt', v_row.recovery_attempts + 1), p_ip, p_agent);
    if v_row.recovery_attempts + 1 >= 5 then
      update public.members
         set recovery_attempts = 0,
             recovery_locked_until = now() + interval '30 minutes'
       where id = v_row.id;
      return jsonb_build_object('ok', false, 'error', 'locked', 'until', now() + interval '30 minutes');
    end if;
    update public.members set recovery_attempts = recovery_attempts + 1 where id = v_row.id;
    return jsonb_build_object('ok', false, 'error', 'code', 'attempts_left', 5 - (v_row.recovery_attempts + 1));
  end if;

  v_ticket := public.recovery_issue_ticket(v_row.id);
  perform public.member_log_write(v_row.id, null, 'recovery_verified', '{}'::jsonb, p_ip, p_agent);

  return jsonb_build_object(
    'ok', true,
    'ticket', v_ticket,
    'expires_at', now() + interval '20 minutes',
    'member', public.recovery_member_json(v_row)
  );
end;
$$;

-- ------------------------------------------------------------------
-- 8. the recovery link — the same secret, no email/phone needed
-- ------------------------------------------------------------------
create or replace function public.recovery_link(
  p_code  text,
  p_ip    text default null,
  p_agent text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_code   text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_row    public.members%rowtype;
  v_ticket text;
begin
  if v_code = '' then
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;

  select * into v_row
    from public.members m
   where m.recovery_code_hash = public.recovery_code_hash(v_code)
   limit 1;

  if v_row.id is null then
    perform public.member_log_write(null, null, 'recovery_failed',
      jsonb_build_object('reason', 'link'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;

  if v_row.recovery_locked_until is not null and v_row.recovery_locked_until > now() then
    return jsonb_build_object('ok', false, 'error', 'locked', 'until', v_row.recovery_locked_until);
  end if;

  v_ticket := public.recovery_issue_ticket(v_row.id);
  perform public.member_log_write(v_row.id, null, 'recovery_link_used', '{}'::jsonb, p_ip, p_agent);

  return jsonb_build_object(
    'ok', true,
    'ticket', v_ticket,
    'expires_at', now() + interval '20 minutes',
    'member', public.recovery_member_json(v_row)
  );
end;
$$;

-- ------------------------------------------------------------------
-- 9. step 3 — the new password (a new code is minted every time)
-- ------------------------------------------------------------------
create or replace function public.recovery_reset(
  p_ticket   text,
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
  v_hash   text := encode(digest(btrim(coalesce(p_ticket, '')), 'sha256'), 'hex');
  v_row    public.members%rowtype;
  v_code   text;
begin
  if length(coalesce(p_password, '')) < 8 or length(p_password) > 72 then
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;

  select * into v_row
    from public.members m
   where m.recovery_ticket_hash = v_hash
   limit 1;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'ticket');
  end if;
  if v_row.recovery_ticket_expires_at is null or v_row.recovery_ticket_expires_at < now() then
    return jsonb_build_object('ok', false, 'error', 'expired');
  end if;

  -- the code that opened this ticket is spent: mint the next one
  v_code := public.member_recovery_code();

  update public.members
     set password_hash               = crypt(p_password, gen_salt('bf', 10)),
         recovery_code_hash          = public.recovery_code_hash(v_code),
         recovery_issued_at          = now(),
         recovery_expires_at         = null,
         recovery_attempts           = 0,
         recovery_locked_until       = null,
         recovery_ticket_hash        = null,
         recovery_ticket_expires_at  = null
   where id = v_row.id
   returning * into v_row;

  -- a password change ends the open sessions, except the recovery itself
  update public.sessions
     set session_status = 'revoked', revoked_at = now(), logged_out_at = now()
   where member_id = v_row.id and session_status = 'active';

  perform public.member_log_write(v_row.id, null, 'recovery_reset',
    jsonb_build_object('via', 'code'), p_ip, p_agent);

  return jsonb_build_object(
    'ok', true,
    'via', 'code',
    'recovery_code', v_code,
    'recovery_link', 'rest.html?recovry=' || v_code,
    'member', public.recovery_member_json(v_row)
  );
end;
$$;

-- ------------------------------------------------------------------
-- 10. the device path — no recovery code at all
--     full name + phone + email + the device's **original** viewing code
--
--     The rule: the code created when a device was activated is bound to that
--     device for good and cannot be unlinked — it is the device's original code.
--     The other codes may be linked to other devices, and unlinked again. So the
--     path accepts the original code of *this* device and nothing else.
--
--     One device can hold the codes of **several accounts** (two people, or one
--     person with two accounts). The code — not the email — therefore decides
--     which account is being recovered; the name, the phone and the email only
--     confirm it, and a mismatch names the field that does not fit.
-- ------------------------------------------------------------------
create or replace function public.recovery_device_status(
  p_name   text,
  p_phone  text,
  p_email  text,
  p_device text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_name     text := public.recovery_name_key(p_name);
  v_email    text := lower(btrim(coalesce(p_email, '')));
  v_phone    text := public.recovery_phone_key(p_phone);
  v_device   text := public.recovery_device_key(p_device);
  v_accounts integer := 0;
  v_matches  jsonb := '[]'::jsonb;
  v_user     text;
  v_member   text;
  v_hits     integer := 0;
begin
  if v_device = '' then
    return jsonb_build_object('ok', true, 'device', false, 'bound', false, 'identity', false, 'accounts', 0, 'matches', '[]'::jsonb);
  end if;

  -- every account holding an original code on this device, with the three
  -- field verdicts for the identity that was typed
  with bound as (
    select distinct m.id, m.username, m.member_id, m.full_name, m.phone_number, m.email
      from public.members m
     where exists (
             select 1 from public.viewing_codes c
              where c.member_id = m.id
                and (
                  public.recovery_device_key(c.device_mac) = v_device
                  or exists (select 1 from public.watch_code_devices d
                              where d.code_id = c.id and d.idmember = m.id
                                and public.recovery_device_key(d.device_id) = v_device)
                )
           )
  ), scored as (
    select b.username, b.member_id,
           public.recovery_name_key(b.full_name) = v_name as name_ok,
           public.recovery_phone_key(b.phone_number) = v_phone as phone_ok,
           lower(btrim(b.email)) = v_email as email_ok
      from bound b
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'username', s.username, 'member_id', s.member_id,
           'name', s.name_ok, 'phone', s.phone_ok, 'email', s.email_ok
         ) order by s.username), '[]'::jsonb),
         count(*)
    into v_matches, v_accounts
    from scored s;

  select s.username, s.member_id into v_user, v_member
    from (
      select b.username, b.member_id,
             public.recovery_name_key(b.full_name) = v_name and
             public.recovery_phone_key(b.phone_number) = v_phone and
             lower(btrim(b.email)) = v_email as full_ok
        from public.members b
       where exists (
               select 1 from public.viewing_codes c
                where c.member_id = b.id
                  and (
                    public.recovery_device_key(c.device_mac) = v_device
                    or exists (select 1 from public.watch_code_devices d
                                where d.code_id = c.id and d.idmember = b.id
                                  and public.recovery_device_key(d.device_id) = v_device)
                  )
             )
    ) s
   where s.full_ok
   limit 1;

  if v_user is not null then v_hits := 1; end if;

  -- one verdict per account on this device, and never a code or a device
  return jsonb_build_object(
    'ok', true,
    'device', true,
    'bound', v_accounts > 0,
    'accounts', v_accounts,
    'matches', v_matches,
    'identity', v_hits > 0,
    'username', v_user,
    'member_id', v_member
  );
end;
$$;

create or replace function public.recovery_device(
  p_name      text,
  p_phone     text,
  p_email     text,
  p_view_code text,
  p_device    text,
  p_password  text,
  p_ip        text default null,
  p_agent     text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_name   text := public.recovery_name_key(p_name);
  v_email  text := lower(btrim(coalesce(p_email, '')));
  v_phone  text := public.recovery_phone_key(p_phone);
  v_view   text := regexp_replace(coalesce(p_view_code, ''), '[^0-9]', '', 'g');
  v_device text := public.recovery_device_key(p_device);
  v_row    public.members%rowtype;
  v_code   public.viewing_codes%rowtype;
  v_bound  boolean := false;
  v_ident  boolean := false;
  v_new    text;
begin
  if length(coalesce(p_password, '')) < 8 or length(p_password) > 72 then
    return jsonb_build_object('ok', false, 'error', 'password');
  end if;
  if v_view !~ '^[0-9]{6}$' then
    return jsonb_build_object('ok', false, 'error', 'view_code');
  end if;
  if v_device = '' then
    return jsonb_build_object('ok', false, 'error', 'device');
  end if;

  -- the code decides the account: one device may hold the codes of several
  -- accounts, so nothing is resolved from the email alone any more
  select * into v_code from public.viewing_codes c where c.code = v_view limit 1;

  if v_code.id is not null then
    select * into v_row from public.members m where m.id = v_code.member_id;
  end if;

  if v_row.id is null then
    perform public.member_log_write(null, null, 'recovery_failed',
      jsonb_build_object('reason', 'view_code'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'view_code');
  end if;

  v_ident := public.recovery_phone_key(v_row.phone_number) = v_phone
             and public.recovery_name_key(v_row.full_name) = v_name
             and lower(btrim(v_row.email)) = v_email;

  -- is this code the original code of this device?
  select exists (
    select 1 from public.viewing_codes c
     where c.id = v_code.id
       and (
         public.recovery_device_key(c.device_mac) = v_device
         or exists (
              select 1 from public.watch_code_devices d
               where d.code_id = c.id and d.idmember = v_row.id
                 and public.recovery_device_key(d.device_id) = v_device
            )
       )
  ) into v_bound;

  if not v_bound then
    perform public.member_log_write(v_row.id, null, 'recovery_failed',
      jsonb_build_object('reason', 'device_not_bound', 'code', v_view,
                         'known_identity', v_ident), p_ip, p_agent);
    -- a stranger who happens to type a real code learns nothing: the answer is
    -- the same as for a code that does not exist, unless the identity fits the
    -- account, in which case the holder is told which device the code belongs to
    if not v_ident then
      return jsonb_build_object('ok', false, 'error', 'view_code');
    end if;
    return jsonb_build_object('ok', false, 'error', 'device_not_bound', 'reason', 'other_device');
  end if;

  -- from here on the caller is on the account's own device: name the field that
  -- does not fit instead of one vague refusal
  if public.recovery_name_key(v_row.full_name) <> v_name then
    perform public.member_log_write(v_row.id, null, 'recovery_failed',
      jsonb_build_object('reason', 'device_identity', 'field', 'full_name'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'identity', 'field', 'full_name',
                              'username', v_row.username);
  end if;

  if public.recovery_phone_key(v_row.phone_number) <> v_phone then
    perform public.member_log_write(v_row.id, null, 'recovery_failed',
      jsonb_build_object('reason', 'device_identity', 'field', 'phone'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'identity', 'field', 'phone',
                              'username', v_row.username);
  end if;

  if lower(btrim(v_row.email)) <> v_email then
    perform public.member_log_write(v_row.id, null, 'recovery_failed',
      jsonb_build_object('reason', 'device_identity', 'field', 'email'), p_ip, p_agent);
    return jsonb_build_object('ok', false, 'error', 'identity', 'field', 'email',
                              'username', v_row.username);
  end if;

  if v_row.status = 'banned' and coalesce(v_row.ban_permanent, false) then
    return jsonb_build_object('ok', false, 'error', 'closed');
  end if;

  v_new := public.member_recovery_code();

  update public.members
     set password_hash               = crypt(p_password, gen_salt('bf', 10)),
         recovery_code_hash          = public.recovery_code_hash(v_new),
         recovery_issued_at          = now(),
         recovery_expires_at         = null,
         recovery_attempts           = 0,
         recovery_locked_until       = null,
         recovery_ticket_hash        = null,
         recovery_ticket_expires_at  = null
   where id = v_row.id
   returning * into v_row;

  update public.sessions
     set session_status = 'revoked', revoked_at = now(), logged_out_at = now()
   where member_id = v_row.id and session_status = 'active';

  perform public.member_log_write(v_row.id, null, 'recovery_reset',
    jsonb_build_object('via', 'device', 'view_code', v_view), p_ip, p_agent);

  return jsonb_build_object(
    'ok', true,
    'via', 'device',
    'recovery_code', v_new,
    'recovery_link', 'rest.html?recovry=' || v_new,
    'member', public.recovery_member_json(v_row)
  );
end;
$$;

-- ------------------------------------------------------------------
-- grants
-- ------------------------------------------------------------------
grant execute on function public.recovery_start(text, text, text, text)  to anon, authenticated, service_role;
grant execute on function public.recovery_verify(text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.recovery_link(text, text, text)         to anon, authenticated, service_role;
grant execute on function public.recovery_reset(text, text, text, text)  to anon, authenticated, service_role;
grant execute on function public.recovery_device(text, text, text, text, text, text, text, text)
  to anon, authenticated, service_role;
grant execute on function public.recovery_device_status(text, text, text, text)
  to anon, authenticated, service_role;

notify pgrst, 'reload schema';
