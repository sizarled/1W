-- ==================================================================
-- video-codes — a video's code says what it is, and what shape it is
-- ------------------------------------------------------------------
-- Every post lived on one column default:
--
--   post_code = 'PST-' || lpad(nextval('post_seq'), 6, '0')
--
-- so a video and an article looked alike (`PST-001039`), and a vertical
-- video and a wide one could not be told apart either. A video now carries
-- its own prefix, and the prefix says the shape:
--
--   VID-001039    a video, wide
--   VSR-001039    a video, vertical — a Short, a Reel, a phone recording
--   PST-001039    anything else: an article, a question, a recommendation
--
-- The number is the row's own and never changes. Only the three letters
-- follow the shape, so `PST-001039` did not become something new — it became
-- `VID-001039`, the same video, wearing the name it always should have had.
--
-- A column default cannot look at another column of the row it fills, so the
-- default is gone and a trigger mints the code from `content_type` and
-- `video_meta->>'vertical'`, from the same `post_seq` — the numbers stay dense
-- and in order. The trigger fires on insert, and on an update that touches
-- `video_meta` or `content_type`, so a member who flips the “vertical video”
-- box gets `VSR-` without losing the number.
--
-- Applied on 2026-10-31 as one migration.
--
--   §1 the default goes
--   §2 the trigger that names a row by its type and its shape
--   §3 the rows already out there keep their number, take their prefix
--   §4 an older code still finds its row (`PST-001039`, `Video-001039`)
--
-- Warnings
--   • §3 renames the rows that exist. A link shared with the old code keeps
--     working anyway, because §4 lets `post_resolve` fall back to the number:
--     `videos.html#/h/ID=PST-001039` lands on `ID=VID-001039`. The code the
--     page shows is the row's current one.
--   • The file on Streamtape is named after the code. A file uploaded under
--     an older code is still called `PST-001039.mp4`; opening the video in the
--     editor and saving it renames the file to the code it now has
--     (`meta.host_file.name` is compared with the code on save).
--   • Flipping the shape of a *published* video changes its code. The number
--     stays, so every old link still resolves; the address a search engine
--     holds simply lands on the current code.
-- ==================================================================

begin;

-- ------------------------------------------------------------------
-- 1. the default goes
-- ------------------------------------------------------------------
-- it would fire first, mint a `PST-` and consume a number the trigger wanted
alter table public.posts alter column post_code drop default;

-- ------------------------------------------------------------------
-- 2. the code is minted from the type and the shape
-- ------------------------------------------------------------------
create or replace function public.posts_code_assign()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
declare
  v_prefix text;
begin
  v_prefix := case
    when new.content_type is distinct from 'video' then 'PST-'
    when lower(coalesce(new.video_meta ->> 'vertical', 'false')) in ('true', 't', '1', 'yes') then 'VSR-'
    else 'VID-'
  end;

  /* nothing there yet: a number from the one sequence this table has */
  if new.post_code is null or btrim(new.post_code) = '' then
    new.post_code := v_prefix || lpad((nextval('public.post_seq'))::text, 6, '0');
    return new;
  end if;

  /* a code already there keeps its number; only the three letters follow */
  if new.post_code ~ '^[A-Za-z]+-[0-9]+$' then
    new.post_code := v_prefix || substring(new.post_code from '[0-9]+$');
  end if;

  return new;
end;
$$;

drop trigger if exists posts_code_assign on public.posts;

create trigger posts_code_assign
  before insert or update of video_meta, content_type on public.posts
  for each row
  execute function public.posts_code_assign();

-- ------------------------------------------------------------------
-- 3. the rows already out there
-- ------------------------------------------------------------------
update public.posts p
   set post_code = v.code
  from (
    select x.id,
           case
             when x.content_type is distinct from 'video' then 'PST-'
             when lower(coalesce(x.video_meta ->> 'vertical', 'false')) in ('true', 't', '1', 'yes') then 'VSR-'
             else 'VID-'
           end || substring(x.post_code from '[0-9]+$') as code
      from public.posts x
     where x.post_code ~ '^[A-Za-z]+-[0-9]+$'
  ) v
 where p.id = v.id
   and p.post_code <> v.code;

-- ------------------------------------------------------------------
-- 4. an older code still finds its row
-- ------------------------------------------------------------------
-- the exact code first, then the number: `PST-001039` and `Video-001039`
-- are the same video as `VID-001039`, and a link shared before this
-- migration must not die on the day the letters moved
create or replace function public.post_resolve(p_ref text)
returns uuid
language plpgsql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
declare
  v   uuid;
  ref text := btrim(coalesce(p_ref, ''));
begin
  if ref = '' then
    return null;
  end if;

  begin
    v := ref::uuid;
  exception when others then
    v := null;
  end;

  if v is not null and exists (select 1 from public.posts p where p.id = v) then
    return v;
  end if;

  select p.id into v from public.posts p where p.post_code = ref limit 1;
  if v is not null then
    return v;
  end if;

  if ref ~ '^[A-Za-z]+-[0-9]+$' then
    select p.id into v
      from public.posts p
     where p.post_code ~ '^[A-Za-z]+-[0-9]+$'
       and substring(p.post_code from '[0-9]+$') = substring(ref from '[0-9]+$')
     limit 1;
  end if;

  return v;
end;
$$;

commit;

-- ------------------------------------------------------------------
-- check
-- ------------------------------------------------------------------
--   select post_code, content_type, video_meta ->> 'vertical' as vertical
--     from public.posts
--    where content_type = 'video'
--    order by post_code desc
--    limit 20;
--
--   -- a new wide video takes VID-…, a vertical one VSR-…, an article PST-…
--   select public.video_save(
--     '<token>',
--     jsonb_build_object('title', 'prefix probe', 'embed', 'https://youtu.be/x',
--                        'status', 'draft', 'visibility', 'general')
--   );
--
--   -- an old code lands on the row that carries the number now
--   select public.post_resolve('PST-001039'), public.post_resolve('VID-001039');
