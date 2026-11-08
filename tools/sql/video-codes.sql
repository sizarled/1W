-- ==================================================================
-- video-codes — a video says "video" in its own code
-- ------------------------------------------------------------------
-- Every post lives in `posts` and took its code from one column default:
--
--   post_code = 'PST-' || lpad(nextval('post_seq'), 6, '0')
--
-- so a video and an article looked alike (`PST-001032`), and a member who
-- meant to hand out a video's code could not tell the two apart. A video now
-- carries its own prefix:
--
--   Video-001032    a video
--   PST-001032      anything else — an article, a question, a recommendation
--
-- The default is replaced by a trigger, because a column default cannot look at
-- another column of the row it is filling. The trigger is the only place a code
-- is minted now: it takes the next number from the same `post_seq`, so the
-- numbers stay dense and in order, and an explicit code is still honoured.
--
-- Applied on 2026-12-04 as one migration.
--
--   §1 the trigger that names a row by its type
--   §2 the videos already published take the new prefix
--
-- Warnings
--   • §2 renames the rows that exist, so an address that carries an old code
--     (`videos.html#/v/PST-001032`) stops finding its video. Every link that
--     was shared with the old code must be updated with it.
--   • The file on Streamtape is named after the code. A file uploaded before
--     this migration is still called `PST-001032.mp4`; opening the video in the
--     editor and saving it renames the file to the code it now has
--     (`meta.host_file.name` is compared with the code on save).
-- ==================================================================

begin;

-- ------------------------------------------------------------------
-- 1. the code is minted from the type
-- ------------------------------------------------------------------
-- the old default would still fire first and consume a number, so it goes
alter table public.posts alter column post_code drop default;

create or replace function public.posts_code_assign()
returns trigger
language plpgsql
as $$
begin
  if new.post_code is null or btrim(new.post_code) = '' then
    new.post_code := case when new.content_type = 'video' then 'Video-' else 'PST-' end
                    || lpad((nextval('public.post_seq'))::text, 6, '0');
  end if;
  return new;
end;
$$;

drop trigger if exists posts_code_assign on public.posts;

create trigger posts_code_assign
  before insert on public.posts
  for each row
  execute function public.posts_code_assign();

-- ------------------------------------------------------------------
-- 2. the videos already out there
-- ------------------------------------------------------------------
-- `substring('PST-001032' from 5)` is `001032`, so the number is kept as it is
update public.posts p
   set post_code = 'Video-' || substring(p.post_code from 5)
 where p.content_type = 'video'
   and p.post_code like 'PST-%'
   and not exists (
     select 1
       from public.posts other
      where other.post_code = 'Video-' || substring(p.post_code from 5)
   );

commit;

-- ------------------------------------------------------------------
-- check
-- ------------------------------------------------------------------
--   select post_code, content_type, title
--     from public.posts
--    where status <> 'deleted'
--    order by post_code desc
--    limit 20;
--
--   -- a new video takes Video-…, a new article still takes PST-…
--   select public.video_save(
--     '<token>',
--     jsonb_build_object('title', 'prefix probe', 'embed', 'https://youtu.be/x', 'status', 'draft', 'visibility', 'general')
--   );
