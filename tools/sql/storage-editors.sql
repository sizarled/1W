-- storage-editors.sql — where the two editors may put a file
-- ------------------------------------------------------------------
-- The `source` bucket is public to read, but every write goes through a
-- policy on storage.objects. Before this file the only folders a browser
-- could write to were `users/messages`, `users/posts` and `users/profile`
-- (see the profile composer) — so the article editor's image upload and the
-- video editor's file upload were refused by the database, not by the page.
--
-- Two folders are opened here, each pinned to a name pattern and a set of
-- extensions, so nothing else can be written into the bucket from a page:
--
--   users/articles/<name>.(jpg|jpeg|png|webp|gif)   a picture in a piece
--   users/videos/<name>.(mp4|webm|ogg|mov)         a file published as a video
--
-- Video thumbnails deliberately go to `users/posts/`, which is already
-- allowed: a thumbnail is a post image like any other.
--
-- APPLIED on the live project (policies created after the drop-if-exists).

drop policy if exists source_articles_insert on storage.objects;
drop policy if exists source_articles_read on storage.objects;
drop policy if exists source_articles_update on storage.objects;
drop policy if exists source_videos_insert on storage.objects;
drop policy if exists source_videos_read on storage.objects;
drop policy if exists source_videos_update on storage.objects;

create policy source_articles_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'articles'
    and name ~ '^users/articles/[A-Za-z0-9_-]{1,90}\.(jpg|jpeg|png|webp|gif)$'
  );

create policy source_articles_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'articles'
  );

create policy source_articles_update on storage.objects
  for update to anon, authenticated
  using (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'articles'
  )
  with check (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'articles'
  );

create policy source_videos_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'videos'
    and name ~ '^users/videos/[A-Za-z0-9_-]{1,90}\.(mp4|webm|ogg|mov)$'
  );

create policy source_videos_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'videos'
  );

create policy source_videos_update on storage.objects
  for update to anon, authenticated
  using (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'videos'
  )
  with check (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'videos'
  );

select policyname, cmd
  from pg_policies
 where schemaname = 'storage' and tablename = 'objects'
 order by policyname;
