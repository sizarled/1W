-- ==================================================================
-- tape-file — may this Streamtape file be played as one of the site's videos?
-- ------------------------------------------------------------------
-- A chapter asks a Streamtape frame for a second, and the frame has no word
-- for it: the embed's own page carries no `postMessage` listener and its player
-- reads no start parameter. The one thing that does move a playhead is the
-- file itself, and Streamtape hands out its address only to the browser that
-- will play it — a link made on the server is refused ("this download link is
-- not for you"), because the address is tied to whoever asked.
--
-- So the browser asks for the address. The first half of that — the download
-- ticket — needs the account's credentials, which live in the `studio-upload`
-- function and nowhere else. This is the door that decides whether the second
-- half is worth opening at all: a file may be asked for **only** when it is one
-- of the site's own published videos, so nobody can turn the function into a
-- ticket machine for the account's whole tree.
--
-- Applied on 2026-10-31 as one migration.
--
--   §1 the question, answered in SQL so the json path is read once
-- ==================================================================

/* ------------------------------------------------------------------ */
/* §1 — is this file a published video?                                */
/* ------------------------------------------------------------------ */
/* `security definer` so the answer does not depend on the caller's row-level
   rights, and `stable` so it may be asked inside a larger read. The function is
   granted to `service_role` alone: the browser never calls it directly — the
   edge function does, with the service key. */
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
