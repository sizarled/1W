-- question-writer.sql — a space's question is written on the article engine
-- ------------------------------------------------------------------
-- The studio used to keep its own small form for a space's questions: a title,
-- a paragraph of details, a visibility, a couple of niches. It was a second,
-- weaker door beside the article engine, so it was removed from creator.html
-- and the writing room now writes questions too:
--
--   article-editor.js  +  data-ae-kind="question"   →   question-editor.html
--   question_save(token, payload)                    →   posts.content_type = 'question'
--
-- A question is stored exactly like an article — body, cover, thumbnail,
-- keywords, audience, doors, passwords, schedule — because it is written with
-- the same fields. Only three things differ here:
--
--   * the constraint on posts.content_type learns the word 'question';
--   * member_post_save accepts it and stores the body and article_meta for it;
--   * a published question needs six words, not one.
--
-- On top of that: article_get (the editor's loader), creator_items (the studio's
-- tables) and creator_hub_posts (a hub's numbers) learn to count it, and the
-- `users/files` folder of the source bucket is opened for attachments.
--
-- APPLIED on the live project.

/* 1. the content type ------------------------------------------------- */
alter table public.posts drop constraint if exists posts_content_type_check;
alter table public.posts add constraint posts_content_type_check
  check (content_type = any (array['article', 'video', 'recommendation', 'link', 'question']));

/* 2. member_post_save — a question stores its body like an article ----- */
do $do$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.member_post_save(text,jsonb,text)'::regprocedure);
  if position('''question''' in v_def) > 0 then
    raise notice 'member_post_save already knows the question';
    return;
  end if;

  v_new := replace(v_def,
    'if v_type not in (''video'', ''article'') then',
    'if v_type not in (''video'', ''article'', ''question'') then');
  if v_new = v_def then
    raise exception 'member_post_save: the kind guard did not match';
  end if;
  v_def := v_new;

  /* body, article_meta and the word count are the article's, not the video's */
  if (length(v_def) - length(replace(v_def, 'v_type = ''article''', ''))) / length('v_type = ''article''') <> 5 then
    raise exception 'member_post_save: expected five article branches';
  end if;
  v_def := replace(v_def, 'v_type = ''article''', 'v_type in (''article'', ''question'')');

  /* a published question needs a question in it, not six letters */
  v_new := replace(v_def,
    'if v_type in (''article'', ''question'') and v_status = ''published'' and v_words < 1 then
    return jsonb_build_object(''ok'', false, ''error'', ''body'');
  end if;',
    'if v_type in (''article'', ''question'') and v_status = ''published'' and v_words < 1 then
    return jsonb_build_object(''ok'', false, ''error'', ''body'');
  end if;
  if v_type = ''question'' and v_status = ''published'' and v_words < 6 then
    return jsonb_build_object(''ok'', false, ''error'', ''body'');
  end if;');
  if v_new = v_def then
    raise exception 'member_post_save: the word guard did not match';
  end if;
  v_def := v_new;

  execute v_def;
end $do$;

/* 3. article_get — the editor loads a question with the same call ----- */
do $do$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.article_get(text,text,text)'::regprocedure);
  if position('content_type in (''article'', ''question'')' in v_def) > 0 then
    raise notice 'article_get already loads a question';
    return;
  end if;
  v_new := replace(v_def,
    'from public.posts where id = v_id and content_type = ''article''',
    'from public.posts where id = v_id and content_type in (''article'', ''question'')');
  if v_new = v_def then
    raise exception 'article_get: the post lookup did not match';
  end if;
  execute v_new;
end $do$;

/* 4. creator_items — the studio's tables list a question -------------- */
do $do$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.creator_items(text,uuid,text,text,text)'::regprocedure);
  if position('''question-editor''' in v_def) > 0 then
    raise notice 'creator_items already lists a question';
    return;
  end if;
  if (length(v_def) - length(replace(v_def, 'p.content_type in (''video'', ''article'')', '')))
     / length('p.content_type in (''video'', ''article'')') <> 2 then
    raise exception 'creator_items: expected two post branches';
  end if;
  v_new := replace(v_def,
    'p.content_type in (''video'', ''article'')',
    'p.content_type in (''video'', ''article'', ''question'')');
  v_new := replace(v_new,
    'case p.content_type when ''article'' then ''article-editor'' else ''video-editor'' end',
    'case p.content_type when ''article'' then ''article-editor''
                     when ''question'' then ''question-editor''
                     else ''video-editor'' end');
  if position('''question-editor''' in v_new) = 0 then
    raise exception 'creator_items: the source label did not match';
  end if;
  execute v_new;
end $do$;

/* 5. creator_hub_posts — a question counts in the space's numbers ----- */
do $do$
declare
  v_def text;
  v_new text;
begin
  v_def := pg_get_functiondef('public.creator_hub_posts(uuid)'::regprocedure);
  if position('''question''' in v_def) > 0 then
    raise notice 'creator_hub_posts already counts a question';
    return;
  end if;
  v_new := replace(v_def,
    'and p.content_type in (''video'', ''article'')',
    'and p.content_type in (''video'', ''article'', ''question'')');
  if v_new = v_def then
    raise exception 'creator_hub_posts: the post filter did not match';
  end if;
  execute v_new;
end $do$;

/* 6. question_save — the article's save, with the space's kind -------- */
create or replace function public.question_save(p_token text, p_payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_me     public.members%rowtype := public.member_from_token(p_token);
  v_data   jsonb := case when jsonb_typeof(coalesce(p_payload, '{}'::jsonb)) = 'object'
                         then coalesce(p_payload, '{}'::jsonb) else '{}'::jsonb end;
  /* the space this question belongs to: a code (IDSP100002) or its uuid */
  v_ref    text := nullif(btrim(coalesce(v_data ->> 'hub', '')), '');
  v_hub    public.creator_hubs%rowtype;
  v_hub_id uuid;
  r        jsonb;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  /* an unknown space, a space the member does not own, staff or publish in,
     or a hub whose kind cannot hold a question is refused before anything is
     written — the question it carries is left untouched */
  if v_data ? 'hub' and v_ref is not null then
    select * into v_hub
      from public.creator_hubs h
     where upper(h.code) = upper(v_ref)
        or h.id::text = lower(v_ref)
     limit 1;
    if v_hub.id is null then
      return jsonb_build_object('ok', false, 'error', 'hub');
    end if;
    if not public.creator_hub_manage(v_hub, v_me)
       and not (coalesce(v_me.member_id, '') = any (coalesce(v_hub.publishers, '{}'))) then
      return jsonb_build_object('ok', false, 'error', 'hub_role');
    end if;
    if not public.creator_kind_allowed(v_hub.kind, 'question') then
      return jsonb_build_object('ok', false, 'error', 'hub_kind');
    end if;
    v_hub_id := v_hub.id;
  end if;

  r := public.member_post_save(p_token, v_data, 'question');
  if not coalesce((r ->> 'ok')::boolean, false) then
    return r;
  end if;

  /* the question is written; now it sits in the space. A payload without the
     key leaves the space it already had, so a partial save never moves it. */
  if v_data ? 'hub' then
    update public.posts p
       set hub_id = v_hub_id
     where p.post_code = (r ->> 'code');
  end if;

  return jsonb_build_object(
    'ok', true,
    'question', r -> 'card',
    'code', r ->> 'code',
    'status', r ->> 'status',
    'scheduled_at', r -> 'scheduled_at',
    'hub', v_hub_id
  );
end $function$;

/* 6b. question_mine — the question page's own list ------------------- */
create or replace function public.question_mine(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $function$
declare
  v_me   public.members%rowtype := public.member_from_token(p_token);
  v_rows jsonb;
begin
  if v_me.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;
  select coalesce(jsonb_agg(public.article_card(p.id, v_me.id) order by
                            coalesce(p.published_at, p.created_at) desc), '[]'::jsonb)
    into v_rows
    from public.posts p
   where p.content_type = 'question'
     and (p.author_profile_id = v_me.id or p.host_profile_id = v_me.id)
     and p.status in ('draft', 'scheduled', 'published', 'pending');
  return jsonb_build_object('ok', true, 'rows', coalesce(v_rows, '[]'::jsonb));
end;
$function$;

/* 7. who may call it ------------------------------------------------- */
do $do$
begin
  execute 'revoke all on function public.question_save(text, jsonb) from public';
  execute 'grant execute on function public.question_save(text, jsonb) to anon, authenticated';
end $do$;

/* 8. storage — the attachments folder --------------------------------- */
drop policy if exists source_files_insert on storage.objects;
drop policy if exists source_files_read on storage.objects;
drop policy if exists source_files_update on storage.objects;

create policy source_files_insert on storage.objects
  for insert to anon, authenticated
  with check (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'files'
    and name ~ '^users/files/question_[0-9]{10,16}_[a-z0-9]{2,10}\.(jpg|jpeg|png|webp|gif|mp4|webm|ogg|mov|pdf|doc|docx|xls|xlsx|ppt|pptx|txt|md|csv|rtf|zip)$'
  );

create policy source_files_read on storage.objects
  for select to anon, authenticated
  using (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'files'
  );

create policy source_files_update on storage.objects
  for update to anon, authenticated
  using (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'files'
  )
  with check (
    bucket_id = 'source'
    and (storage.foldername(name))[1] = 'users'
    and (storage.foldername(name))[2] = 'files'
  );

/* 9. what it looks like afterwards ------------------------------------ */
select 'question_save' as what, proname, pg_get_function_identity_arguments(oid) as args
  from pg_proc
 where pronamespace = 'public'::regnamespace and proname = 'question_save';
select policyname from pg_policies
 where schemaname = 'storage' and tablename = 'objects' and policyname like 'source_files%'
 order by 1;
