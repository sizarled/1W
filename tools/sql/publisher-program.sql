/* ==================================================================
   publisher.html — the Publisher program
   ------------------------------------------------------------------
   A **publisher** here is not a member writing inside a hub. It is a
   person or a creator *outside* the site — a channel, a newsletter, a
   Telegram group, a blog of their own — who carries 1World's blogs,
   libraries, studios and films to their own audience, and is paid in
   points for the people who actually arrive and stay:

       visit       0 points   the click is counted, nothing is owed
       signup     50 points   the visitor made an account through the link
       activation 250 points  the account was activated
       membership 1,000 points  the account paid for a membership

   One member may hold one publisher seat. A seat carries a public code
   (`IDPB100001`) and any number of **links** — one per hub, or one for
   the whole site. A link is what the promoter pastes outside:

       register.html?ref=<link code>
       creator.html?studio=<hub code>&ref=<link code>

   Every link carries its own counters, and the points land in the same
   `points_ledger` the rest of the site spends from, so a publisher's
   reward is spendable like any other point.

   Functions, all security definer:
     publisher_me(token)                     the seat, its links, its totals
     publisher_join(token, channel, place, audience, note)
     publisher_link_save(token, id, hub, label)
     publisher_link_delete(token, id)
     publisher_visit(code)                   public: one click counted
     publisher_credit(code, member, kind)    the server credits a conversion
                                             (service_role only — never anon)

   Requires creator-studio.sql / creator-requests.sql for the hubs, and
   the members + points_ledger tables the rest of the site already uses.
   ================================================================== */

/* ------------------------------------------------------------------ */
/* 1. the seat                                                        */
/* ------------------------------------------------------------------ */
create sequence if not exists public.publisher_code_seq start with 100001;

create table if not exists public.publishers (
  member     uuid primary key references public.members(id) on delete cascade,
  code       text not null default '',
  status     text not null default 'active',
  channel    text not null default '',
  place      text not null default '',
  audience   int  not null default 0,
  note       text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint publishers_status check (status in ('active', 'paused')),
  constraint publishers_code_length check (char_length(code) <= 24),
  constraint publishers_channel_length check (char_length(channel) <= 120),
  constraint publishers_audience check (audience >= 0)
);

create unique index if not exists publishers_code on public.publishers (lower(code));

alter table public.publishers enable row level security;

/** `IDPB` + six digits — the code a publisher is known by. */
create or replace function public.publisher_new_code()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code text;
begin
  loop
    v_code := 'IDPB' || lpad(nextval('public.publisher_code_seq')::text, 6, '0');
    exit when not exists (select 1 from public.publishers p where lower(p.code) = lower(v_code));
  end loop;
  return v_code;
end;
$$;

create or replace function public.publisher_set_code()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(new.code, '') = '' then
    new.code := public.publisher_new_code();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists publishers_code on public.publishers;
create trigger publishers_code
  before insert or update on public.publishers
  for each row execute function public.publisher_set_code();

/* ------------------------------------------------------------------ */
/* 2. the links                                                       */
/* ------------------------------------------------------------------ */
create table if not exists public.publisher_links (
  id         uuid primary key default gen_random_uuid(),
  publisher  uuid not null references public.publishers(member) on delete cascade,
  hub        uuid references public.creator_hubs(id) on delete cascade,
  label      text not null default '',
  code       text not null default '',
  clicks     int not null default 0,
  signups    int not null default 0,
  points     int not null default 0,
  created_at timestamptz not null default now()
);

create unique index if not exists publisher_links_code on public.publisher_links (lower(code));
create index if not exists publisher_links_owner on public.publisher_links (publisher, created_at desc);

alter table public.publisher_links enable row level security;

/** Eight characters, unique, no vowels that read as other letters. */
create or replace function public.publisher_new_link_code()
returns text
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_alphabet text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_code     text;
  i          int;
begin
  loop
    v_code := '';
    for i in 1..8 loop
      v_code := v_code || substr(v_alphabet, 1 + floor(random() * length(v_alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.publisher_links l where lower(l.code) = lower(v_code));
  end loop;
  return v_code;
end;
$$;

/* ------------------------------------------------------------------ */
/* 3. the conversions                                                 */
/* ------------------------------------------------------------------ */
create table if not exists public.publisher_conversions (
  id         uuid primary key default gen_random_uuid(),
  link       uuid not null references public.publisher_links(id) on delete cascade,
  member     uuid references public.members(id) on delete set null,
  kind       text not null default 'visit',
  points     int not null default 0,
  note       text not null default '',
  created_at timestamptz not null default now(),
  constraint publisher_conversions_kind check (kind in ('visit', 'signup', 'activation', 'membership'))
);

create index if not exists publisher_conversions_link on public.publisher_conversions (link, created_at desc);

/* one signup, one activation and one membership per member per link */
create unique index if not exists publisher_conversions_once
  on public.publisher_conversions (link, member, kind)
  where member is not null and kind <> 'visit';

alter table public.publisher_conversions enable row level security;

/** What each kind of conversion is worth, in points. */
create or replace function public.publisher_point_value(p_kind text)
returns int
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case lower(coalesce(p_kind, ''))
           when 'signup'     then 50
           when 'activation' then 250
           when 'membership' then 1000
           else 0
         end;
$$;

/* ------------------------------------------------------------------ */
/* 4. the shape the page reads                                        */
/* ------------------------------------------------------------------ */
create or replace function public.publisher_json(p_publisher public.publishers)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'code',       p_publisher.code,
    'status',     p_publisher.status,
    'channel',    p_publisher.channel,
    'place',      p_publisher.place,
    'audience',   p_publisher.audience,
    'note',       p_publisher.note,
    'created_at', p_publisher.created_at,
    'links',      (select count(*) from public.publisher_links l where l.publisher = p_publisher.member),
    'clicks',     (select coalesce(sum(l.clicks), 0) from public.publisher_links l where l.publisher = p_publisher.member),
    'signups',    (select coalesce(sum(l.signups), 0) from public.publisher_links l where l.publisher = p_publisher.member),
    'points',     (select coalesce(sum(l.points), 0) from public.publisher_links l where l.publisher = p_publisher.member)
  );
$$;

create or replace function public.publisher_link_json(p_link public.publisher_links)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'id',         l.id,
    'code',       l.code,
    'label',      l.label,
    'hub',        l.hub,
    'hub_code',   h.code,
    'hub_kind',   h.kind,
    'hub_name',   h.name,
    'clicks',     l.clicks,
    'signups',    l.signups,
    'points',     l.points,
    'created_at', l.created_at,
    'url',        case when h.id is null
                       then 'register.html?ref=' || l.code
                       else 'creator.html?studio=' || coalesce(h.code, h.id::text) || '&ref=' || l.code
                  end
  )
  from (select p_link.*) l
  left join public.creator_hubs h on h.id = l.hub;
$$;

/* ------------------------------------------------------------------ */
/* 5. reading the seat                                                */
/* ------------------------------------------------------------------ */
/*
 * publisher_me(token)
 *
 * → { ok, member:{code,name,username,avatar},
 *     publisher: null | { code, status, channel, place, audience,
 *                         created_at, links, clicks, signups, points },
 *     links:[ { id, code, label, hub, hub_code, hub_kind, hub_name,
 *               clicks, signups, points, created_at, url } ],
 *     conversions:[ { kind, points, at, who, link } ],
 *     totals:{ clicks, signups, points, signupsLeftToMembership },
 *     values:{ signup, activation, membership } }
 *
 * A signed-out visitor gets `ok:true` with `publisher:null` — the page
 * explains the program and asks them to sign in. It is a public page.
 */
create or replace function public.publisher_me(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_pub    public.publishers%rowtype;
  v_links  jsonb;
  v_conv   jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object(
      'ok', true,
      'member', null,
      'publisher', null,
      'links', '[]'::jsonb,
      'conversions', '[]'::jsonb,
      'totals', jsonb_build_object('clicks', 0, 'signups', 0, 'points', 0),
      'values', jsonb_build_object(
        'signup', public.publisher_point_value('signup'),
        'activation', public.publisher_point_value('activation'),
        'membership', public.publisher_point_value('membership'))
    );
  end if;

  select * into v_pub from public.publishers p where p.member = v_member.id;

  select coalesce(jsonb_agg(public.publisher_link_json(l) order by l.created_at desc), '[]'::jsonb)
    into v_links
    from public.publisher_links l
   where l.publisher = v_member.id;

  select coalesce(jsonb_agg(jsonb_build_object(
           'kind',   c.kind,
           'points', c.points,
           'at',     c.created_at,
           'who',    coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id, ''),
           'link',   l.label
         ) order by c.created_at desc), '[]'::jsonb)
    into v_conv
    from public.publisher_conversions c
    join public.publisher_links l on l.id = c.link
    left join public.members m on m.id = c.member
   where l.publisher = v_member.id
     and c.kind <> 'visit'
   limit 40;

  return jsonb_build_object(
    'ok', true,
    'member', jsonb_build_object(
      'code',     v_member.member_id,
      'name',     coalesce(nullif(btrim(v_member.full_name), ''), v_member.username, v_member.member_id),
      'username', v_member.username,
      'avatar',   v_member.avatar_url,
      'points',   v_member.points
    ),
    'publisher', case when v_pub.member is null then null else public.publisher_json(v_pub) end,
    'links', v_links,
    'conversions', v_conv,
    'totals', jsonb_build_object(
      'clicks',    coalesce((select sum(l.clicks) from public.publisher_links l where l.publisher = v_member.id), 0),
      'signups',   coalesce((select sum(l.signups) from public.publisher_links l where l.publisher = v_member.id), 0),
      'points',    coalesce((select sum(l.points) from public.publisher_links l where l.publisher = v_member.id), 0),
      'conversions', jsonb_array_length(v_conv)
    ),
    'values', jsonb_build_object(
      'signup', public.publisher_point_value('signup'),
      'activation', public.publisher_point_value('activation'),
      'membership', public.publisher_point_value('membership'))
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 6. joining, and the links                                          */
/* ------------------------------------------------------------------ */
/*
 * publisher_join(token, channel, place, audience, note)
 *   The seat is the member's; joining twice updates the seat it already
 *   had instead of opening a second one.
 */
create or replace function public.publisher_join(
  p_token    text,
  p_channel  text,
  p_place    text,
  p_audience int,
  p_note     text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_pub    public.publishers%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  if v_member.status = 'banned' then
    return jsonb_build_object('ok', false, 'error', 'banned');
  end if;

  if btrim(coalesce(p_channel, '')) = '' then
    return jsonb_build_object('ok', false, 'error', 'channel');
  end if;

  insert into public.publishers (member, channel, place, audience, note)
  values (v_member.id,
          left(btrim(coalesce(p_channel, '')), 120),
          left(btrim(coalesce(p_place, '')), 80),
          greatest(0, coalesce(p_audience, 0)),
          left(btrim(coalesce(p_note, '')), 400))
  on conflict (member) do update
    set channel  = excluded.channel,
        place    = excluded.place,
        audience = excluded.audience,
        note     = excluded.note
  returning * into v_pub;

  return jsonb_build_object('ok', true, 'publisher', public.publisher_json(v_pub));
end;
$$;

/*
 * publisher_link_save(token, id, hub, label)
 *   id null → a new link; id set → that link, renamed or re-pointed.
 *   hub '' → the whole site (register.html?ref=…); a hub is named by its
 *   public code (IDBL100003) or its uuid, and it must be public: a private
 *   or hidden hub is not a place to advertise.
 */
create or replace function public.publisher_link_save(
  p_token text,
  p_id    uuid,
  p_hub   text,
  p_label text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_pub    public.publishers%rowtype;
  v_link   public.publisher_links%rowtype;
  v_hub    public.creator_hubs%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_pub from public.publishers p where p.member = v_member.id;
  if v_pub.member is null then
    return jsonb_build_object('ok', false, 'error', 'not_a_publisher');
  end if;
  if v_pub.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'paused');
  end if;

  if nullif(btrim(coalesce(p_hub, '')), '') is not null then
    select * into v_hub from public.creator_hubs h
     where upper(h.code) = upper(btrim(p_hub))
        or h.id::text = lower(btrim(p_hub))
     limit 1;
    if v_hub.id is null then
      return jsonb_build_object('ok', false, 'error', 'hub');
    end if;
    if v_hub.visibility = 'private' or v_hub.status = 'hidden' then
      return jsonb_build_object('ok', false, 'error', 'hidden_hub');
    end if;
  end if;

  if p_id is null then
    if (select count(*) from public.publisher_links l where l.publisher = v_member.id) >= 40 then
      return jsonb_build_object('ok', false, 'error', 'limit');
    end if;
    insert into public.publisher_links (publisher, hub, label, code)
    values (v_member.id, v_hub.id, left(btrim(coalesce(p_label, '')), 60), public.publisher_new_link_code())
    returning * into v_link;
  else
    update public.publisher_links l
       set hub   = v_hub.id,
           label = left(btrim(coalesce(p_label, '')), 60)
     where l.id = p_id and l.publisher = v_member.id
    returning * into v_link;
    if v_link.id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  return jsonb_build_object('ok', true, 'link', public.publisher_link_json(v_link));
end;
$$;

create or replace function public.publisher_link_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_gone   int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  delete from public.publisher_links l
   where l.id = p_id and l.publisher = v_member.id;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', v_gone > 0);
end;
$$;

/* ------------------------------------------------------------------ */
/* 7. a click, counted                                                */
/* ------------------------------------------------------------------ */
/*
 * publisher_visit(code) — called by the page a ?ref= link lands on.
 *
 * → { ok, publisher:{code,name}, hub:{code,kind,name}|null }
 *
 * No session needed: the click is the whole event. It is idempotent per
 * page load, not per visitor — the page calls it once and stores the
 * code, so a member walking around does not inflate the counter.
 */
create or replace function public.publisher_visit(p_code text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_link   public.publisher_links%rowtype;
  v_pub    public.publishers%rowtype;
  v_hub    public.creator_hubs%rowtype;
begin
  if char_length(v_code) < 4 or char_length(v_code) > 24 then
    return jsonb_build_object('ok', false, 'error', 'code');
  end if;

  select * into v_link from public.publisher_links l where upper(l.code) = v_code;
  if v_link.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_pub from public.publishers p where p.member = v_link.publisher;
  if v_pub.member is null or v_pub.status <> 'active' then
    return jsonb_build_object('ok', false, 'error', 'paused');
  end if;

  update public.publisher_links l set clicks = l.clicks + 1 where l.id = v_link.id;

  if v_link.hub is not null then
    select * into v_hub from public.creator_hubs h where h.id = v_link.hub;
  end if;

  return jsonb_build_object(
    'ok', true,
    'publisher', jsonb_build_object('code', v_pub.code, 'name', v_pub.channel),
    'hub', case when v_hub.id is null then null
                else jsonb_build_object('code', v_hub.code, 'kind', v_hub.kind, 'name', v_hub.name) end
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 8. the conversion, credited by the server                          */
/* ------------------------------------------------------------------ */
/*
 * publisher_credit(code, member, kind) — never called from a browser.
 *
 * It is the half that costs points: it is granted to `service_role` only,
 * so the registration, activation and payment paths (or an edge function)
 * can call it, but no anon key can mint points. One member counts once per
 * link per kind (the unique index), and the points land in points_ledger,
 * which is where the site's balance comes from.
 */
create or replace function public.publisher_credit(p_code text, p_member uuid, p_kind text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_code   text := upper(btrim(coalesce(p_code, '')));
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_link   public.publisher_links%rowtype;
  v_points int;
  v_id     uuid;
begin
  if v_kind not in ('signup', 'activation', 'membership') then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;

  select * into v_link from public.publisher_links l where upper(l.code) = v_code;
  if v_link.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  if p_member is null or not exists (select 1 from public.members m where m.id = p_member) then
    return jsonb_build_object('ok', false, 'error', 'member');
  end if;

  begin
    insert into public.publisher_conversions (link, member, kind, points)
    values (v_link.id, p_member, v_kind, public.publisher_point_value(v_kind))
    returning id into v_id;
  exception when unique_violation then
    return jsonb_build_object('ok', true, 'counted', false);
  end;

  v_points := public.publisher_point_value(v_kind);

  if v_points > 0 then
    insert into public.points_ledger (member_id, delta, balance_after, reason, source)
    values (v_link.publisher, v_points, 0, 'Publisher conversion · ' || v_kind, 'publisher');

    update public.publisher_links l
       set points  = l.points + v_points,
           signups = l.signups + case when v_kind = 'signup' then 1 else 0 end
     where l.id = v_link.id;
  end if;

  return jsonb_build_object('ok', true, 'counted', true, 'points', v_points, 'conversion', v_id);
end;
$$;

/* ------------------------------------------------------------------ */
/* 9. grants                                                          */
/* ------------------------------------------------------------------ */
revoke all on function public.publisher_new_code() from public;
revoke all on function public.publisher_new_link_code() from public;
revoke all on function public.publisher_point_value(text) from public;
revoke all on function public.publisher_json(public.publishers) from public;
revoke all on function public.publisher_link_json(public.publisher_links) from public;
revoke all on function public.publisher_me(text) from public;
revoke all on function public.publisher_join(text, text, text, int, text) from public;
revoke all on function public.publisher_link_save(text, uuid, text, text) from public;
revoke all on function public.publisher_link_delete(text, uuid) from public;
revoke all on function public.publisher_visit(text) from public;
revoke all on function public.publisher_credit(text, uuid, text) from public;

grant execute on function public.publisher_me(text) to anon, authenticated, service_role;
grant execute on function public.publisher_join(text, text, text, int, text) to anon, authenticated, service_role;
grant execute on function public.publisher_link_save(text, uuid, text, text) to anon, authenticated, service_role;
grant execute on function public.publisher_link_delete(text, uuid) to anon, authenticated, service_role;
grant execute on function public.publisher_visit(text) to anon, authenticated, service_role;
/* the half that mints points never leaves the server */
grant execute on function public.publisher_credit(text, uuid, text) to service_role;
