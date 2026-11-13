-- ==================================================================
-- drop-tape-file — the relay is gone, so its gate goes with it
-- ------------------------------------------------------------------
-- `public.video_file_published(text)` existed for one reason: the reader's
-- door `file/stream` on the `studio-upload` edge function, which relayed a
-- published video's own bytes so a Streamtape chapter could become a real
-- second. That door cost the project the film's size on every full view, and
-- it is removed — a Streamtape video now carries no chapter index at all, and
-- a chapter is only drawn where a second can be spent (a file of our own, or
-- YouTube, Vimeo, Facebook).
--
-- Nothing calls this function any more, and a granted `security definer`
-- function with no caller is only an attack surface. Dropped on 2026-10-31.
--
-- The definition it replaces is in this repository's history, should it ever
-- be wanted back.
-- ==================================================================

drop function if exists public.video_file_published(text);
