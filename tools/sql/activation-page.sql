-- ==================================================================
-- activated.html — first activation, then re-activation or upgrade
-- ==================================================================
-- Migration `activation_page`.
--
-- Rule from the brief
--   first visit  → activation only, and only for the free membership
--   after that   → two options: re-activate, or upgrade the membership
--
-- `members.account_activated_at` is stamped by `members_guard()` the first
-- time the status becomes `active` and is never cleared, so it is what tells
-- “never activated” apart from “activated before”.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. the member payload carries the activation date
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
    'account_activated_at', m.account_activated_at,
    'ban_reason', m.ban_reason,
    'ban_permanent', m.ban_permanent,
    'created_at', m.created_at,
    'last_login_at', m.last_login_at
  );
$$;

-- ------------------------------------------------------------------
-- 2. what the page should offer this member
-- ------------------------------------------------------------------
create or replace function public.member_activation_state(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member    public.members%rowtype;
  v_status    text;
  v_member_sh text;
  v_first     boolean;
  v_requested timestamptz;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  v_status    := lower(coalesce(v_member.status, 'inactive'));
  v_member_sh := lower(coalesce(v_member.membership, 'free'));

  select max(n.created_at) into v_requested
    from public.notifications n
   where n.id_member = v_member.id and n.source = 'activation';

  -- activation is offered once: never activated, still inactive, free plan
  v_first := v_member.account_activated_at is null
             and v_status = 'inactive'
             and v_member_sh = 'free';

  return jsonb_build_object(
    'ok', true,
    'member', public.member_payload(v_member),
    'status', v_status,
    'membership', v_member_sh,
    'activated_at', v_member.account_activated_at,
    'requested_at', v_requested,
    'pending', v_status = 'inactive' and v_requested is not null and v_requested > now() - interval '7 days',
    'deadline', case when v_status = 'inactive' then v_member.created_at + interval '30 days' end,
    'first_activation', coalesce(v_first, false),
    'can_activate', coalesce(v_first, false),
    'can_reactivate', v_member.account_activated_at is not null and v_status in ('inactive', 'expired'),
    'already_active', v_status = 'active',
    'can_upgrade', v_status <> 'banned' and not coalesce(v_member.ban_permanent, false),
    'mode', case
              when v_status = 'banned' then 'blocked'
              when coalesce(v_first, false) then 'activate'
              else 'choose'
            end
  );
end;
$function$;

-- ------------------------------------------------------------------
-- 3. first activation request (free plan, never activated)
-- ------------------------------------------------------------------
create or replace function public.member_activation_request(p_token text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
  v_recent integer;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if lower(coalesce(v_member.status, '')) <> 'inactive' then
    return jsonb_build_object('ok', false, 'error', 'status');
  end if;
  if v_member.account_activated_at is not null then
    return jsonb_build_object('ok', false, 'error', 'already_activated');
  end if;
  if lower(coalesce(v_member.membership, 'free')) <> 'free' then
    return jsonb_build_object('ok', false, 'error', 'plan');
  end if;

  select count(*) into v_recent from public.notifications n
   where n.id_member = v_member.id and n.source = 'activation'
     and n.created_at > now() - interval '1 hour';
  if v_recent > 0 then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into public.notifications (id_member, source, title, subject, read_or_unread)
  values (v_member.id, 'activation', 'Activation requested',
          coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                   'Your activation request was received. A moderator reviews new accounts within 24 hours.'),
          'unread');

  perform public.member_log_write(v_member.id, null, 'activation_requested',
    jsonb_build_object('note', left(coalesce(p_note, ''), 280)), null, null);

  return jsonb_build_object('ok', true, 'already', false);
end;
$function$;

-- ------------------------------------------------------------------
-- 4. re-activation request (the account was activated before)
-- ------------------------------------------------------------------
create or replace function public.member_reactivate_request(p_token text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_member public.members%rowtype;
  v_status text;
  v_recent integer;
begin
  v_member := public.member_from_token(p_token);
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  v_status := lower(coalesce(v_member.status, 'inactive'));
  if v_status = 'banned' then
    return jsonb_build_object('ok', false, 'error', 'banned');
  end if;
  if v_status = 'active' then
    return jsonb_build_object('ok', false, 'error', 'already_active');
  end if;
  if v_member.account_activated_at is null then
    return jsonb_build_object('ok', false, 'error', 'not_activated_yet');
  end if;

  select count(*) into v_recent from public.notifications n
   where n.id_member = v_member.id and n.source = 'activation'
     and n.title = 'Re-activation requested'
     and n.created_at > now() - interval '1 hour';
  if v_recent > 0 then
    return jsonb_build_object('ok', true, 'already', true);
  end if;

  insert into public.notifications (id_member, source, title, subject, read_or_unread)
  values (v_member.id, 'activation', 'Re-activation requested',
          coalesce(nullif(btrim(coalesce(p_note, '')), ''),
                   'Your re-activation request was received. A moderator reopens the account within 24 hours.'),
          'unread');

  perform public.member_log_write(v_member.id, null, 'reactivation_requested',
    jsonb_build_object('note', left(coalesce(p_note, ''), 280), 'status', v_status), null, null);

  return jsonb_build_object('ok', true, 'already', false);
end;
$function$;

grant execute on function public.member_activation_state(text) to anon, authenticated, service_role;
grant execute on function public.member_reactivate_request(text, text) to anon, authenticated, service_role;
