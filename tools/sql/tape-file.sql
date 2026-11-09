-- ==================================================================
-- tape-file — may this Streamtape file be played as one of the site's videos?
-- ------------------------------------------------------------------
-- A chapter asks a Streamtape frame for a second, and the frame has none to
-- give: the embed's own page carries no `postMessage` listener and its player
-- script contains no start word at all. The file behind the frame does have a
-- second — but Streamtape hands its address only to a request that holds the
-- account's own ticket, and the endpoint that answers it (`file/dl`) sends no
-- `Access-Control-Allow-Origin`, so no page can read it; an address made on a
-- server is bound to that server's own address and refused everywhere else.
--
-- The way through is the project's own edge function: it mints the ticket, asks
-- for the address, and relays the bytes (Range and all) to the reader's player.
-- That costs the project's bandwidth, so it is done **only when a chapter is
-- pressed** — ordinary watching stays inside the host's own player.
--
-- This is the question that keeps the relay from becoming a door to the whole
-- account: a file may be asked for only when it is one of the site's own
-- published videos.
--
-- Applied on 2026-10-31 as one migration.
-- ==================================================================

/* ------------------------------------------------------------------ */
/* §1 — is this file a published video?                                */
/* ------------------------------------------------------------------ */
/* `security definer` so the answer does not depend on the caller's row-level
   rights, and `stable` so it may be asked inside a larger read. Granted to
   `service_role` alone: the browser never calls it — the edge function does,
   with the service key. */
create or replace function public.video_file_published(p_file text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.posts p
     where p.status = 'published'
       and coalesce(p.video_meta -> 'host_file' ->> 'id', '') = coalesce(p_file, '')
  );
$$;

revoke all on function public.video_file_published(text) from public;
revoke all on function public.video_file_published(text) from anon, authenticated;
grant execute on function public.video_file_published(text) to service_role;

/* ------------------------------------------------------------------ */
/* a look, by hand                                                     */
/* ------------------------------------------------------------------ */
-- select public.video_file_published('789xRL93X9HAarD');   -- true, VID-001039
-- select public.video_file_published('nope');              -- false
