/* ==================================================================
   creator.html — joining a hub: publishers and advertisers
   ------------------------------------------------------------------
   Everybody can ask to work inside somebody else's place, in one of
   two roles:

     publisher  (ناشر)     writes content in that hub — videos, articles,
                          books, questions, images, whatever the hub
                          takes; what they submit arrives as a draft the
                          owner publishes from the studio
     advertiser (معلن)     runs an ad in that hub, in one of four
                          formats: banner · video · image · paragraph

   A request is one row. The owner (or a staff member) approves it or
   refuses it; approving a publisher appends their member code to
   `creator_hubs.publishers`, approving an advertiser appends it to
   `creator_hubs.advertisers`. Nothing is shared until that happens.

   Every hub also carries a public **code** (`IDST100001`, `IDBL100002`,
   …) so a place can be linked to by name instead of by uuid:

       creator.html?studio=IDST100001

   Functions, all security definer:
     creator_request_send(token, hub, role, format, message, link, budget)
     creator_request_withdraw(token, request)
     creator_request_decide(token, request, approve|reject)
     creator_participants(token, hub)     the requests + the two lists
     creator_ad_save / creator_ad_delete  the advertiser's ad
     creator_ads(token, hub)              the hub's ads (manager) or mine
     creator_submit_item(token, hub, …)   a publisher's draft

   Requires creator-studio.sql and creator-public.sql.
   ================================================================== */

/* ------------------------------------------------------------------ */
/* 1. the hub's code, and the two lists                               */
/* ------------------------------------------------------------------ */
create sequence if not exists public.creator_hub_code_seq start with 100001;

create or replace function public.creator_hub_prefix(p_kind text)
returns text
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case lower(coalesce(p_kind, ''))
           when 'channel' then 'ST'
           when 'blog'    then 'BL'
           when 'space'   then 'SP'
           when 'library' then 'LB'
           when 'gallery' then 'GL'
           when 'server'  then 'SV'
           when 'cinema'  then 'CN'
           else 'HB'
         end;
$$;

/** `ID` + the kind's two letters + six digits — IDST100001. */
create or replace function public.creator_hub_new_code(p_kind text)
returns text
language sql
volatile
security definer
set search_path to 'public', 'pg_temp'
as $$
  select 'ID' || public.creator_hub_prefix(p_kind)
         || lpad(nextval('public.creator_hub_code_seq')::text, 6, '0');
$$;

alter table public.creator_hubs
  add column if not exists code         text,
  add column if not exists publishers   text[] not null default '{}',
  add column if not exists advertisers  text[] not null default '{}';

update public.creator_hubs
   set code = public.creator_hub_new_code(kind)
 where coalesce(code, '') = '';

alter table public.creator_hubs alter column code set not null;

create unique index if not exists creator_hubs_code on public.creator_hubs (lower(code));

/** A hub is looked up by its uuid or by its code — nothing else. */
create or replace function public.creator_hub_ref(p_ref text)
returns public.creator_hubs
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select h.*
    from public.creator_hubs h
   where h.id::text = lower(btrim(coalesce(p_ref, '')))
      or lower(h.code) = lower(btrim(coalesce(p_ref, '')))
   limit 1;
$$;

create or replace function public.creator_hubs_set_code()
returns trigger
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
begin
  if coalesce(btrim(new.code), '') = '' then
    new.code := public.creator_hub_new_code(new.kind);
  end if;
  return new;
end;
$$;

drop trigger if exists creator_hubs_code on public.creator_hubs;
create trigger creator_hubs_code
  before insert on public.creator_hubs
  for each row execute function public.creator_hubs_set_code();

/* the shared hub shape now carries the code and the two lists */
create or replace function public.creator_hub_json(p_hub public.creator_hubs)
returns jsonb
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select jsonb_build_object(
    'id',            h.id,
    'code',          h.code,
    'kind',          h.kind,
    'name',          h.name,
    'description',   h.description,
    'logo_url',      h.logo_url,
    'cover_url',     h.cover_url,
    'links',         h.links,
    'field',         h.field,
    'niches',        h.niches,
    'visibility',    h.visibility,
    'password_until', h.password_until,
    'locked',        coalesce(h.password_hash, '') <> '',
    'staff',         h.staff,
    'vip',           h.vip,
    'publishers',    h.publishers,
    'advertisers',   h.advertisers,
    'status',        h.status,
    'subscribers',   (select count(*) from public.creator_subscriptions s where s.hub = h.id),
    'items',         (select count(*) from public.member_content c where c.hub = h.id),
    'published',     (select count(*) from public.member_content c where c.hub = h.id and c.status = 'published'),
    'drafts',        (select count(*) from public.member_content c where c.hub = h.id and c.status = 'draft'),
    'minutes',       (select coalesce(sum(c.view_minutes), 0) from public.member_content c where c.hub = h.id),
    'likes',         (select coalesce(sum(c.likes), 0) from public.member_content c where c.hub = h.id),
    'dislikes',      (select coalesce(sum(c.dislikes), 0) from public.member_content c where c.hub = h.id),
    'comments',      (select coalesce(sum(c.comments_count), 0) from public.member_content c where c.hub = h.id),
    'shares',        (select coalesce(sum(c.shares), 0) from public.member_content c where c.hub = h.id),
    'reports',       (select coalesce(sum(c.reports), 0) from public.member_content c where c.hub = h.id),
    'categories',    (select count(*) from public.creator_categories g where g.hub = h.id),
    'created_at',    h.created_at,
    'updated_at',    h.updated_at
  )
  from public.creator_hubs h
  where h.id = p_hub.id;
$$;

/* ------------------------------------------------------------------ */
/* 2. the request                                                     */
/* ------------------------------------------------------------------ */
create table if not exists public.creator_requests (
  id          uuid primary key default gen_random_uuid(),
  hub         uuid not null references public.creator_hubs(id) on delete cascade,
  member      uuid not null references public.members(id) on delete cascade,
  role        text not null,
  format      text,
  message     text not null default '',
  link        text not null default '',
  budget      int  not null default 0,
  status      text not null default 'pending',
  decided_by  uuid references public.members(id) on delete set null,
  decided_at  timestamptz,
  created_at  timestamptz not null default now(),
  constraint creator_requests_role check (role in ('publisher', 'advertiser')),
  constraint creator_requests_format check (format is null or format in ('banner', 'video', 'image', 'paragraph')),
  constraint creator_requests_status check (status in ('pending', 'approved', 'rejected', 'withdrawn')),
  constraint creator_requests_message check (char_length(message) <= 600)
);

create index if not exists creator_requests_hub on public.creator_requests (hub, status, created_at desc);
create index if not exists creator_requests_member on public.creator_requests (member, created_at desc);

/* one open request per member per role per hub */
create unique index if not exists creator_requests_one_pending
  on public.creator_requests (hub, member, role)
  where status = 'pending';

alter table public.creator_requests enable row level security;

/* ------------------------------------------------------------------ */
/* 3. the ad                                                          */
/* ------------------------------------------------------------------ */
create table if not exists public.creator_ads (
  id          uuid primary key default gen_random_uuid(),
  hub         uuid not null references public.creator_hubs(id) on delete cascade,
  member      uuid not null references public.members(id) on delete cascade,
  format      text not null,
  title       text not null default '',
  body        text not null default '',
  media_url   text not null default '',
  link_url    text not null default '',
  status      text not null default 'live',
  impressions int not null default 0,
  clicks      int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint creator_ads_format check (format in ('banner', 'video', 'image', 'paragraph')),
  constraint creator_ads_status check (status in ('live', 'paused', 'ended')),
  constraint creator_ads_title check (char_length(title) <= 80)
);

create index if not exists creator_ads_hub on public.creator_ads (hub, status, created_at desc);

alter table public.creator_ads enable row level security;

/* ------------------------------------------------------------------ */
/* 4. asking to join                                                  */
/* ------------------------------------------------------------------ */
/*
 * creator_request_send(token, hub, role, format, message, link, budget)
 *
 *   hub      a hub uuid or a hub code
 *   role     publisher | advertiser
 *   format   banner | video | image | paragraph — advertisers only
 *   message  10..600 characters, why you and what you would bring
 *   link     a portfolio or a sample, http(s), may be empty
 *   budget   an advertiser's points, 0..1 000 000
 *
 * → { ok, request:{ id, role, format, status, created_at } }
 * errors: session | hub | self | role | format | message | link | budget | member | exists
 */
create or replace function public.creator_request_send(
  p_token   text,
  p_hub     text,
  p_role    text,
  p_format  text,
  p_message text,
  p_link    text,
  p_budget  int
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype := public.creator_hub_ref(p_hub);
  v_role   text := lower(btrim(coalesce(p_role, '')));
  v_format text := nullif(lower(btrim(coalesce(p_format, ''))), '');
  v_msg    text := btrim(coalesce(p_message, ''));
  v_link   text := btrim(coalesce(p_link, ''));
  v_budget int  := greatest(0, coalesce(p_budget, 0));
  v_row    public.creator_requests%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;
  if v_hub.owner = v_member.id then
    return jsonb_build_object('ok', false, 'error', 'self');
  end if;
  if v_role not in ('publisher', 'advertiser') then
    return jsonb_build_object('ok', false, 'error', 'role');
  end if;
  if v_role = 'advertiser' then
    if v_format is null or v_format not in ('banner', 'video', 'image', 'paragraph') then
      return jsonb_build_object('ok', false, 'error', 'format');
    end if;
    if v_budget > 1000000 then
      return jsonb_build_object('ok', false, 'error', 'budget');
    end if;
  else
    v_format := null;
    v_budget := 0;
  end if;
  if char_length(v_msg) < 10 then
    return jsonb_build_object('ok', false, 'error', 'message');
  end if;
  if v_link <> '' and v_link !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'link');
  end if;
  if v_member.member_id = any(v_hub.publishers) or v_member.member_id = any(v_hub.advertisers)
     or v_member.member_id = any(v_hub.staff) then
    return jsonb_build_object('ok', false, 'error', 'member');
  end if;
  if exists (select 1 from public.creator_requests r
              where r.hub = v_hub.id and r.member = v_member.id
                and r.role = v_role and r.status = 'pending') then
    return jsonb_build_object('ok', false, 'error', 'exists');
  end if;

  insert into public.creator_requests (hub, member, role, format, message, link, budget)
  values (v_hub.id, v_member.id, v_role, v_format, left(v_msg, 600), v_link, v_budget)
  returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'request', jsonb_build_object(
      'id', v_row.id, 'role', v_row.role, 'format', v_row.format,
      'status', v_row.status, 'created_at', v_row.created_at
    )
  );
end;
$$;

/*
 * creator_participants(token, hub) — what the owner and the staff read
 * → { ok,
 *     rows:[ { id, member:{code,name,username,avatar,country,level},
 *              role, format, message, link, budget, status,
 *              created_at, decided_at } ],
 *     publishers:[ { code, name, username, avatar, since } ],
 *     advertisers:[ { code, name, username, avatar, since } ],
 *     counts:{ pending, approved, rejected } }
 */
create or replace function public.creator_participants(p_token text, p_hub text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype := public.creator_hub_ref(p_hub);
  v_rows   jsonb;
  v_pubs   jsonb;
  v_ads    jsonb;
  v_counts jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select coalesce(jsonb_agg(row_json order by pending desc, created_at desc), '[]'::jsonb)
    into v_rows
    from (
      select r.created_at,
             (r.status = 'pending') as pending,
             jsonb_build_object(
               'id',          r.id,
               'role',        r.role,
               'format',      r.format,
               'message',     r.message,
               'link',        r.link,
               'budget',      r.budget,
               'status',      r.status,
               'created_at',  r.created_at,
               'decided_at',  r.decided_at,
               'member', jsonb_build_object(
                 'code',     m.member_id,
                 'name',     coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id),
                 'username', m.username,
                 'avatar',   m.avatar_url,
                 'country',  m.country,
                 'level',    m.level
               )
             ) as row_json
        from public.creator_requests r
        join public.members m on m.id = r.member
       where r.hub = v_hub.id
    ) s;

  select coalesce(jsonb_agg(jsonb_build_object(
           'code',     m.member_id,
           'name',     coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id),
           'username', m.username,
           'avatar',   m.avatar_url,
           'country',  m.country
         ) order by m.member_id), '[]'::jsonb)
    into v_pubs
    from public.members m
   where m.member_id = any(v_hub.publishers);

  select coalesce(jsonb_agg(jsonb_build_object(
           'code',     m.member_id,
           'name',     coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id),
           'username', m.username,
           'avatar',   m.avatar_url,
           'country',  m.country,
           'ads',      (select count(*) from public.creator_ads a
                         where a.hub = v_hub.id and a.member = m.id)
         ) order by m.member_id), '[]'::jsonb)
    into v_ads
    from public.members m
   where m.member_id = any(v_hub.advertisers);

  select jsonb_build_object(
           'pending',  (select count(*) from public.creator_requests r where r.hub = v_hub.id and r.status = 'pending'),
           'approved', (select count(*) from public.creator_requests r where r.hub = v_hub.id and r.status = 'approved'),
           'rejected', (select count(*) from public.creator_requests r where r.hub = v_hub.id and r.status = 'rejected'))
    into v_counts;

  return jsonb_build_object(
    'ok', true,
    'hub', jsonb_build_object('id', v_hub.id, 'code', v_hub.code, 'kind', v_hub.kind, 'name', v_hub.name),
    'rows', v_rows,
    'publishers', v_pubs,
    'advertisers', v_ads,
    'counts', v_counts
  );
end;
$$;

/*
 * creator_request_decide(token, request, approve|reject)
 * → { ok, status, hub:{ id, code } }
 * errors: session | decision | not_found | decided
 */
create or replace function public.creator_request_decide(p_token text, p_id uuid, p_decision text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member   public.members%rowtype := public.member_from_token(p_token);
  v_decision text := lower(btrim(coalesce(p_decision, '')));
  v_row      public.creator_requests%rowtype;
  v_hub      public.creator_hubs%rowtype;
  v_code     text;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_decision not in ('approve', 'reject') then
    return jsonb_build_object('ok', false, 'error', 'decision');
  end if;

  select * into v_row from public.creator_requests where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  select * into v_hub from public.creator_hubs where id = v_row.hub;
  if v_hub.id is null or not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'decided');
  end if;

  select m.member_id into v_code from public.members m where m.id = v_row.member;

  if v_decision = 'approve' and coalesce(v_code, '') <> '' then
    if v_row.role = 'publisher' then
      update public.creator_hubs
         set publishers = (select array_agg(distinct x) from unnest(publishers || v_code) x),
             updated_at = now()
       where id = v_hub.id;
    else
      update public.creator_hubs
         set advertisers = (select array_agg(distinct x) from unnest(advertisers || v_code) x),
             updated_at = now()
       where id = v_hub.id;
    end if;
  end if;

  update public.creator_requests
     set status = case when v_decision = 'approve' then 'approved' else 'rejected' end,
         decided_by = v_member.id,
         decided_at = now()
   where id = v_row.id
   returning * into v_row;

  return jsonb_build_object(
    'ok', true,
    'status', v_row.status,
    'hub', jsonb_build_object('id', v_hub.id, 'code', v_hub.code)
  );
end;
$$;

/* the asker may take the ask back while it is still pending */
create or replace function public.creator_request_withdraw(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.creator_requests%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_row from public.creator_requests where id = p_id and member = v_member.id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  if v_row.status <> 'pending' then
    return jsonb_build_object('ok', false, 'error', 'decided');
  end if;

  update public.creator_requests set status = 'withdrawn' where id = v_row.id;
  return jsonb_build_object('ok', true, 'status', 'withdrawn');
end;
$$;

/* ------------------------------------------------------------------ */
/* 5. the advertiser's ad                                             */
/* ------------------------------------------------------------------ */
/*
 * creator_ad_save(token, hub, id, format, title, body, media, link, status)
 *
 *   format  banner | video | image | paragraph
 *   media   the banner image, the video file, the picture — http(s).
 *           A paragraph carries no media, only its body.
 *   status  live | paused
 *
 * → { ok, ad }
 * errors: session | hub | role | format | title | media | link | body | not_found
 */
create or replace function public.creator_ad_save(
  p_token     text,
  p_hub       text,
  p_id        uuid,
  p_format    text,
  p_title     text,
  p_body      text,
  p_media_url text,
  p_link_url  text,
  p_status    text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype := public.creator_hub_ref(p_hub);
  v_format text := lower(btrim(coalesce(p_format, '')));
  v_title  text := btrim(coalesce(p_title, ''));
  v_body   text := btrim(coalesce(p_body, ''));
  v_media  text := btrim(coalesce(p_media_url, ''));
  v_link   text := btrim(coalesce(p_link_url, ''));
  v_status text := lower(btrim(coalesce(p_status, 'live')));
  v_row    public.creator_ads%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;
  if not public.creator_hub_manage(v_hub, v_member)
     and coalesce(v_member.member_id, '') <> all (v_hub.advertisers) then
    return jsonb_build_object('ok', false, 'error', 'role');
  end if;
  if v_format not in ('banner', 'video', 'image', 'paragraph') then
    return jsonb_build_object('ok', false, 'error', 'format');
  end if;
  if char_length(v_title) < 3 then
    return jsonb_build_object('ok', false, 'error', 'title');
  end if;
  if v_format = 'paragraph' then
    if char_length(v_body) < 40 then
      return jsonb_build_object('ok', false, 'error', 'body');
    end if;
  elsif v_media !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'media');
  end if;
  if v_link <> '' and v_link !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'link');
  end if;
  if v_status not in ('live', 'paused') then
    v_status := 'live';
  end if;

  if p_id is null then
    insert into public.creator_ads (hub, member, format, title, body, media_url, link_url, status)
    values (v_hub.id, v_member.id, v_format, left(v_title, 80), left(v_body, 2000), v_media, v_link, v_status)
    returning * into v_row;
  else
    select * into v_row from public.creator_ads where id = p_id and hub = v_hub.id;
    if v_row.id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
    if v_row.member <> v_member.id and not public.creator_hub_manage(v_hub, v_member) then
      return jsonb_build_object('ok', false, 'error', 'role');
    end if;
    update public.creator_ads
       set format = v_format, title = left(v_title, 80), body = left(v_body, 2000),
           media_url = v_media, link_url = v_link, status = v_status, updated_at = now()
     where id = v_row.id
     returning * into v_row;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ad', jsonb_build_object(
      'id', v_row.id, 'format', v_row.format, 'title', v_row.title, 'body', v_row.body,
      'media_url', v_row.media_url, 'link_url', v_row.link_url, 'status', v_row.status,
      'impressions', v_row.impressions, 'clicks', v_row.clicks, 'created_at', v_row.created_at
    )
  );
end;
$$;

create or replace function public.creator_ad_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.creator_ads%rowtype;
  v_hub    public.creator_hubs%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_row from public.creator_ads where id = p_id;
  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;
  select * into v_hub from public.creator_hubs where id = v_row.hub;
  if v_row.member <> v_member.id and not public.creator_hub_manage(v_hub, v_member) then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  delete from public.creator_ads where id = v_row.id;
  return jsonb_build_object('ok', true, 'removed', true);
end;
$$;

/*
 * creator_ads(token, hub) — the manager sees the hub's ads, an
 * advertiser sees their own, anybody else is refused.
 * → { ok, rows, counts:{live,paused}, can:{advertise} }
 */
create or replace function public.creator_ads(p_token text, p_hub text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype := public.creator_hub_ref(p_hub);
  v_manage boolean := false;
  v_ads    boolean := false;
  v_rows   jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;

  v_manage := public.creator_hub_manage(v_hub, v_member);
  v_ads := coalesce(v_member.member_id, '') = any(v_hub.advertisers);
  if not v_manage and not v_ads then
    return jsonb_build_object('ok', false, 'error', 'role');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          a.id,
           'format',      a.format,
           'title',       a.title,
           'body',        a.body,
           'media_url',   a.media_url,
           'link_url',    a.link_url,
           'status',      a.status,
           'impressions', a.impressions,
           'clicks',      a.clicks,
           'created_at',  a.created_at,
           'member', jsonb_build_object(
             'code', m.member_id,
             'name', coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id)
           ),
           'mine',       a.member = v_member.id
         ) order by a.created_at desc), '[]'::jsonb)
    into v_rows
    from public.creator_ads a
    join public.members m on m.id = a.member
   where a.hub = v_hub.id
     and (v_manage or a.member = v_member.id);

  return jsonb_build_object(
    'ok', true,
    'hub', jsonb_build_object('id', v_hub.id, 'code', v_hub.code, 'name', v_hub.name),
    'rows', v_rows,
    'counts', jsonb_build_object(
      'live',   (select count(*) from public.creator_ads a where a.hub = v_hub.id and a.status = 'live'),
      'paused', (select count(*) from public.creator_ads a where a.hub = v_hub.id and a.status = 'paused')
    ),
    'can', jsonb_build_object('manage', v_manage, 'advertise', v_ads or v_manage)
  );
end;
$$;

/* ------------------------------------------------------------------ */
/* 6. a publisher's draft                                             */
/* ------------------------------------------------------------------ */
/*
 * creator_submit_item(token, hub, kind, title, summary, body, media, visibility)
 * → { ok, id, status:'draft' }
 *
 * The publisher writes; the owner still decides what goes out, so the
 * row always lands as a draft in the studio's Drafts / table. The two
 * media rules are the hub's: the kind must belong there, and the kinds
 * that cannot exist without a link must have one.
 */
create or replace function public.creator_submit_item(
  p_token    text,
  p_hub      text,
  p_kind     text,
  p_title    text,
  p_summary  text,
  p_body     text,
  p_media    text,
  p_visibility text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype := public.creator_hub_ref(p_hub);
  v_kind   text := lower(btrim(coalesce(p_kind, '')));
  v_title  text := btrim(coalesce(p_title, ''));
  v_body   text := btrim(coalesce(p_body, ''));
  v_media  text := btrim(coalesce(p_media, ''));
  v_vis    text := lower(btrim(coalesce(p_visibility, 'public')));
  v_row    public.member_content%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'hub');
  end if;
  if not public.creator_hub_manage(v_hub, v_member)
     and coalesce(v_member.member_id, '') <> all (v_hub.publishers) then
    return jsonb_build_object('ok', false, 'error', 'role');
  end if;
  if not public.creator_kind_allowed(v_hub.kind, v_kind) then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;
  if char_length(v_title) < 3 then
    return jsonb_build_object('ok', false, 'error', 'title');
  end if;
  if v_kind in ('video', 'podcast', 'playlist', 'book', 'document', 'image')
     and v_media !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'media');
  end if;
  if v_vis not in ('public', 'exclusive') then
    v_vis := 'public';
  end if;

  insert into public.member_content (
    member, hub, kind, title, summary, body, media_url,
    visibility, status, word_count, minutes
  ) values (
    v_member.id, v_hub.id, v_kind, left(v_title, 140),
    left(btrim(coalesce(p_summary, '')), 320), v_body, v_media,
    v_vis, 'draft', public.content_words(v_body), public.content_minutes(v_body)
  )
  returning * into v_row;

  return jsonb_build_object('ok', true, 'id', v_row.id, 'status', v_row.status, 'kind', v_row.kind);
end;
$$;

/* ------------------------------------------------------------------ */
/* 7. the hub as a visitor — the code, the ads, my own standing       */
/* ------------------------------------------------------------------ */
/*
 * creator_hub_view(token, hub, password)  — hub is a uuid *or* a code,
 * which is what `creator.html?studio=IDST100001` sends.
 *
 * The reply keeps its shape and gains:
 *   hub.code, hub.publishers, hub.advertisers (from creator_hub_json),
 *   hub.can:{publish,advertise}, hub.request:{id,role,format,status}|null,
 *   hub.ads:[ {id,format,title,body,media_url,link_url,member} ]
 */
create or replace function public.creator_hub_view(p_token text, p_hub text, p_password text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_hub    public.creator_hubs%rowtype := public.creator_hub_ref(p_hub);
  v_manage boolean := false;
  v_vip    boolean := false;
  v_sub    boolean := false;
  v_pw     boolean := false;
  v_rows   jsonb;
  v_ads    jsonb;
  v_req    jsonb;
  v_pub    boolean := false;
  v_adv    boolean := false;
begin
  if v_hub.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  v_manage := public.creator_hub_manage(v_hub, v_member);
  v_vip    := coalesce(v_member.member_id, '') = any(v_hub.vip);
  v_pub    := coalesce(v_member.member_id, '') = any(v_hub.publishers);
  v_adv    := coalesce(v_member.member_id, '') = any(v_hub.advertisers);
  v_sub    := v_member.id is not null
              and exists (select 1 from public.creator_subscriptions s
                           where s.hub = v_hub.id and s.member = v_member.id);

  if v_hub.visibility = 'private' and not v_manage and not v_vip then
    if coalesce(p_password, '') <> '' and coalesce(v_hub.password_hash, '') <> ''
       and (v_hub.password_until is null or v_hub.password_until >= now())
       and extensions.crypt(p_password, v_hub.password_hash) = v_hub.password_hash then
      v_pw := true;
    end if;
    if not v_pw then
      return jsonb_build_object(
        'ok', true,
        'locked', true,
        'hub', jsonb_build_object(
          'id', v_hub.id, 'code', v_hub.code, 'kind', v_hub.kind, 'name', v_hub.name,
          'description', v_hub.description, 'logo_url', v_hub.logo_url, 'cover_url', v_hub.cover_url,
          'visibility', v_hub.visibility, 'locked', true,
          'has_password', coalesce(v_hub.password_hash, '') <> '',
          'password_until', v_hub.password_until,
          'staff', v_hub.staff, 'vip', v_hub.vip,
          'publishers', v_hub.publishers, 'advertisers', v_hub.advertisers,
          'owner', (select m.member_id from public.members m where m.id = v_hub.owner),
          'subscribers', public.creator_hub_subscribers(v_hub.id)
        )
      );
    end if;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',          c.id,
           'code',        upper(left(replace(c.id::text, '-', ''), 8)),
           'kind',        c.kind,
           'title',       c.title,
           'summary',     c.summary,
           'thumbnail',   c.thumbnail_url,
           'media_url',   c.media_url,
           'visibility',  c.visibility,
           'minutes',     coalesce(nullif(c.view_minutes, 0), c.minutes),
           'likes',       c.likes,
           'comments',    c.comments_count,
           'published_at', c.published_at
         ) order by c.published_at desc nulls last), '[]'::jsonb)
    into v_rows
    from public.member_content c
   where c.hub = v_hub.id
     and c.status = 'published'
     and (v_manage or v_vip or v_pw
          or c.visibility = 'public'
          or (c.visibility = 'exclusive' and v_sub));

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',        a.id,
           'format',    a.format,
           'title',     a.title,
           'body',      a.body,
           'media_url', a.media_url,
           'link_url',  a.link_url,
           'member',    coalesce(nullif(btrim(m.full_name), ''), m.username, m.member_id)
         ) order by a.created_at desc), '[]'::jsonb)
    into v_ads
    from public.creator_ads a
    join public.members m on m.id = a.member
   where a.hub = v_hub.id and a.status = 'live';

  if v_member.id is not null then
    select jsonb_build_object('id', r.id, 'role', r.role, 'format', r.format,
                              'status', r.status, 'created_at', r.created_at)
      into v_req
      from public.creator_requests r
     where r.hub = v_hub.id and r.member = v_member.id
     order by r.created_at desc
     limit 1;
  end if;

  return jsonb_build_object(
    'ok', true,
    'locked', false,
    'hub', public.creator_hub_json(v_hub) || jsonb_build_object(
      'owner', (select m.member_id from public.members m where m.id = v_hub.owner),
      'role', case when v_hub.owner = v_member.id then 'owner'
                   when v_manage then 'staff' else 'visitor' end,
      'subscribed', v_sub,
      'unlocked', v_pw,
      'can', jsonb_build_object('publish', v_pub or v_manage, 'advertise', v_adv or v_manage),
      'request', v_req,
      'ads', v_ads
    ),
    'items', v_rows
  );
end;
$$;

/* the uuid signature is gone — every caller sends the ref as text */
drop function if exists public.creator_hub_view(text, uuid, text);

/* ------------------------------------------------------------------ */
/* 8. grants                                                          */
/* ------------------------------------------------------------------ */
revoke all on function public.creator_request_send(text, text, text, text, text, text, int) from public;
revoke all on function public.creator_request_decide(text, uuid, text) from public;
revoke all on function public.creator_request_withdraw(text, uuid) from public;
revoke all on function public.creator_participants(text, text) from public;
revoke all on function public.creator_ad_save(text, text, uuid, text, text, text, text, text, text) from public;
revoke all on function public.creator_ad_delete(text, uuid) from public;
revoke all on function public.creator_ads(text, text) from public;
revoke all on function public.creator_submit_item(text, text, text, text, text, text, text, text) from public;
revoke all on function public.creator_hub_view(text, text, text) from public;

grant execute on function public.creator_request_send(text, text, text, text, text, text, int) to anon, authenticated, service_role;
grant execute on function public.creator_request_decide(text, uuid, text) to anon, authenticated, service_role;
grant execute on function public.creator_request_withdraw(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_participants(text, text) to anon, authenticated, service_role;
grant execute on function public.creator_ad_save(text, text, uuid, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.creator_ad_delete(text, uuid) to anon, authenticated, service_role;
grant execute on function public.creator_ads(text, text) to anon, authenticated, service_role;
grant execute on function public.creator_submit_item(text, text, text, text, text, text, text, text) to anon, authenticated, service_role;
grant execute on function public.creator_hub_view(text, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
