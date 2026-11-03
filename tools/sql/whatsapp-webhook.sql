-- ==================================================================
-- WhatsApp Cloud API — the webhook (supabase/functions/whatsapp-webhook)
-- ------------------------------------------------------------------
-- Meta calls the edge function for two different reasons:
--
--   GET   hub.mode=subscribe & hub.verify_token=… & hub.challenge=…
--         the console saving the callback URL: the function answers with the
--         challenge, in plain text, and only when the token matches
--   POST  an event: `statuses[]` (sent / delivered / read / failed) or
--         `messages[]` (somebody wrote to the business number)
--
-- The function stores every event here and pushes the status onto the row in
-- `recovery_delivery` that carries the same WhatsApp message id, so "queued"
-- becomes "delivered" — the one thing `pg_net` can never learn by itself.
--
-- The verify token and the app secret live in the **edge secrets**
-- (`WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`), not in this schema.
-- ==================================================================

-- ------------------------------------------------------------------
-- 1. the message id the webhook needs
-- ------------------------------------------------------------------
alter table public.recovery_delivery
  add column if not exists external_id text;

create index if not exists recovery_delivery_external_idx
  on public.recovery_delivery (external_id) where external_id is not null;

-- ------------------------------------------------------------------
-- 2. the events themselves
-- ------------------------------------------------------------------
create table if not exists public.whatsapp_events (
  event_id   bigserial primary key,
  wamid      text,
  kind       text not null check (kind in ('status', 'message', 'other')),
  status     text,
  recipient  text,
  sender     text,
  body       text,
  error_code text,
  error_text text,
  raw        jsonb not null,
  received_at timestamptz not null default now()
);

create index if not exists whatsapp_events_wamid_idx on public.whatsapp_events (wamid);
create index if not exists whatsapp_events_time_idx  on public.whatsapp_events (received_at desc);

alter table public.whatsapp_events enable row level security;
-- no policies: the edge function writes with the service role, nobody else reads

-- ------------------------------------------------------------------
-- 3. a status, applied to the delivery it belongs to
-- ------------------------------------------------------------------
-- Meta sends `sent` → `delivered` → `read`, and any of them can become
-- `failed`. A late `sent` must never undo a `read`, so the statuses are ranked
-- and only a better (or equally late) one is written.
create or replace function public.recovery_whatsapp_status(
  p_wamid  text,
  p_status text,
  p_detail text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v_rank_new int;
  v_rank_old int;
  v_matched  int := 0;
begin
  v_rank_new := case lower(coalesce(p_status, ''))
    when 'queued' then 1 when 'sent' then 2 when 'delivered' then 3
    when 'read' then 4 when 'failed' then 5 else 0 end;
  if v_rank_new = 0 or coalesce(p_wamid, '') = '' then
    return jsonb_build_object('ok', false, 'error', 'status');
  end if;

  with target as (
    select d.delivery_id,
           case d.status
             when 'queued' then 1 when 'sent' then 2 when 'delivered' then 3
             when 'read' then 4 when 'failed' then 5 else 0 end as rank_old
      from public.recovery_delivery d
     where d.external_id = p_wamid
       and d.channel = 'whatsapp'
     order by d.created_at desc
     limit 1
  )
  update public.recovery_delivery d
     set status = lower(p_status),
         detail = left(coalesce(p_detail, d.detail), 300)
    from target t
   where d.delivery_id = t.delivery_id
     and v_rank_new >= t.rank_old
  returning 1 into v_matched;

  v_matched := coalesce(v_matched, 0);
  return jsonb_build_object('ok', true, 'matched', v_matched, 'status', lower(p_status));
end;
$$;

revoke all on function public.recovery_whatsapp_status(text, text, text) from public;

-- ------------------------------------------------------------------
-- 4. what happened lately (for the operator, from the SQL editor)
-- ------------------------------------------------------------------
create or replace function public.whatsapp_events_recent(p_limit int default 20)
returns table (
  received_at timestamptz,
  kind        text,
  status      text,
  sender      text,
  body        text,
  error_text  text,
  wamid       text
)
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  select e.received_at, e.kind, e.status, e.sender, e.body, e.error_text, e.wamid
    from public.whatsapp_events e
   order by e.received_at desc
   limit least(greatest(coalesce(p_limit, 20), 1), 200);
$$;

revoke all on function public.whatsapp_events_recent(int) from public;
