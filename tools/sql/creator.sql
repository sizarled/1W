/**
 * 1World — the Creator page: the content a member writes.
 * ------------------------------------------------------------------
 * One table holds every kind of member work (a video, an article, a podcast
 * episode, an image set, a document, a community post); the editor on
 * `creator.html` is the only writer, and it writes through three functions.
 *
 *   draft      free, private, autosaveable
 *   published  needs an active membership and the fields its kind cannot do
 *              without — a video needs a media URL, an article needs a body
 *
 * A row belongs to one member and can never be read by another through these
 * functions: every one of them starts with `member_from_token()` and scopes by
 * `member = v_member.id`. Publishing does not make the row public here (the
 * public feeds read it with their own RPC when the surface pages are built).
 *
 * Reading minutes follow the same rule as watching: `ceil(words / 200)`.
 */

-- ------------------------------------------------------------------
-- 1. the table
-- ------------------------------------------------------------------
create table if not exists public.member_content (
  id           uuid primary key default gen_random_uuid(),
  member       uuid not null references public.members(id) on delete cascade,
  kind         text not null default 'article',
  title        text not null default '',
  summary      text not null default '',
  body         text not null default '',
  media_url    text not null default '',
  cover_url    text not null default '',
  tags         text[] not null default '{}',
  language     text not null default 'en',
  age_rating   text not null default 'none',
  visibility   text not null default 'public',
  status       text not null default 'draft',
  word_count   int not null default 0,
  minutes      int not null default 0,
  views        int not null default 0,
  likes        int not null default 0,
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint member_content_kind check (kind in ('video', 'article', 'podcast', 'image', 'document', 'post')),
  constraint member_content_status check (status in ('draft', 'published', 'hidden')),
  constraint member_content_visibility check (visibility in ('public', 'followers', 'unlisted')),
  constraint member_content_age check (age_rating in ('none', '13', '16', '18')),
  constraint member_content_title check (char_length(title) <= 140)
);

create index if not exists member_content_member
  on public.member_content (member, updated_at desc);

create index if not exists member_content_published
  on public.member_content (status, published_at desc);

alter table public.member_content enable row level security;

-- ------------------------------------------------------------------
-- 2. the words in a body
-- ------------------------------------------------------------------
create or replace function public.content_words(p_text text)
returns int
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    array_length(
      array_remove(
        regexp_split_to_array(btrim(coalesce(p_text, '')), '\s+'),
        ''
      ),
      1
    ),
    0);
$$;

create or replace function public.content_minutes(p_text text)
returns int
language sql
immutable
set search_path to 'public', 'pg_temp'
as $$
  select case when public.content_words(p_text) = 0 then 0
              else ceil(public.content_words(p_text) / 200.0)::int end;
$$;

-- ------------------------------------------------------------------
-- 3. the list — everything the member has, with its state
-- ------------------------------------------------------------------
create or replace function public.member_content_list(p_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_rows   jsonb;
  v_counts jsonb;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'id',           c.id,
           'kind',         c.kind,
           'title',        c.title,
           'summary',      c.summary,
           'status',       c.status,
           'visibility',   c.visibility,
           'language',     c.language,
           'age_rating',   c.age_rating,
           'tags',         c.tags,
           'words',        c.word_count,
           'minutes',      c.minutes,
           'views',        c.views,
           'likes',        c.likes,
           'published_at', c.published_at,
           'created_at',   c.created_at,
           'updated_at',   c.updated_at
         ) order by c.updated_at desc), '[]'::jsonb)
    into v_rows
    from public.member_content c
   where c.member = v_member.id;

  select jsonb_build_object(
           'all',       count(*),
           'draft',     count(*) filter (where status = 'draft'),
           'published', count(*) filter (where status = 'published'),
           'views',     coalesce(sum(views), 0),
           'likes',     coalesce(sum(likes), 0))
    into v_counts
    from public.member_content
   where member = v_member.id;

  return jsonb_build_object('ok', true, 'rows', v_rows, 'counts', v_counts);
end;
$$;

-- ------------------------------------------------------------------
-- 4. open one — the body comes here, not in the list
-- ------------------------------------------------------------------
create or replace function public.member_content_get(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.member_content%rowtype;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  select * into v_row
    from public.member_content
   where id = p_id and member = v_member.id;

  if v_row.id is null then
    return jsonb_build_object('ok', false, 'error', 'not_found');
  end if;

  return jsonb_build_object('ok', true, 'row', to_jsonb(v_row) - 'member');
end;
$$;

-- ------------------------------------------------------------------
-- 5. save — a draft, or the same row published
-- ------------------------------------------------------------------
create or replace function public.member_content_save(
  p_token      text,
  p_id         uuid,
  p_kind       text,
  p_title      text,
  p_summary    text,
  p_body       text,
  p_media_url  text,
  p_cover_url  text,
  p_tags       text[],
  p_language   text,
  p_age        text,
  p_visibility text,
  p_publish    boolean
)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_row    public.member_content%rowtype;
  v_kind   text := lower(btrim(coalesce(p_kind, 'article')));
  v_title  text := btrim(coalesce(p_title, ''));
  v_summary text := left(btrim(coalesce(p_summary, '')), 320);
  v_body   text := coalesce(p_body, '');
  v_media  text := btrim(coalesce(p_media_url, ''));
  v_cover  text := btrim(coalesce(p_cover_url, ''));
  v_tags   text[] := coalesce(p_tags, '{}');
  v_lang   text := lower(left(btrim(coalesce(p_language, 'en')), 8));
  v_age    text := coalesce(nullif(btrim(p_age), ''), 'none');
  v_vis    text := lower(btrim(coalesce(p_visibility, 'public')));
  v_publish boolean := coalesce(p_publish, false);
  v_count  int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  if v_kind not in ('video', 'article', 'podcast', 'image', 'document', 'post') then
    return jsonb_build_object('ok', false, 'error', 'kind');
  end if;
  if v_vis not in ('public', 'followers', 'unlisted') then
    return jsonb_build_object('ok', false, 'error', 'visibility');
  end if;
  if v_age not in ('none', '13', '16', '18') then
    v_age := 'none';
  end if;
  if char_length(v_title) > 140 then
    return jsonb_build_object('ok', false, 'error', 'title');
  end if;
  if v_media <> '' and v_media !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'url');
  end if;
  if v_cover <> '' and v_cover !~* '^https?://' then
    return jsonb_build_object('ok', false, 'error', 'url');
  end if;

  /* the tags are short, trimmed, deduplicated, and never more than eight */
  select coalesce((array_agg(distinct t) filter (where t <> ''))[1:8], '{}')
    into v_tags
    from (select left(btrim(unnest(v_tags)), 24) as t) tag;

  if v_publish then
    if char_length(v_title) < 3 then
      return jsonb_build_object('ok', false, 'error', 'title');
    end if;
    if coalesce(v_member.status, '') <> 'active' then
      return jsonb_build_object('ok', false, 'error', 'inactive');
    end if;
    /* every kind needs the one field it cannot exist without */
    if v_kind in ('video', 'podcast', 'image', 'document') and v_media = '' then
      return jsonb_build_object('ok', false, 'error', 'media');
    end if;
    if v_kind in ('article', 'post') and public.content_words(v_body) < 12 then
      return jsonb_build_object('ok', false, 'error', 'body');
    end if;
  end if;

  if p_id is null then
    select count(*) into v_count
      from public.member_content
     where member = v_member.id;
    if v_count >= 200 then
      return jsonb_build_object('ok', false, 'error', 'limit');
    end if;

    insert into public.member_content (
      member, kind, title, summary, body, media_url, cover_url, tags,
      language, age_rating, visibility, status, word_count, minutes, published_at
    ) values (
      v_member.id, v_kind, v_title, v_summary, v_body, v_media, v_cover, v_tags,
      v_lang, v_age, v_vis,
      case when v_publish then 'published' else 'draft' end,
      public.content_words(v_body), public.content_minutes(v_body),
      case when v_publish then now() else null end
    )
    returning * into v_row;
  else
    update public.member_content c
       set kind         = v_kind,
           title        = v_title,
           summary      = v_summary,
           body         = v_body,
           media_url    = v_media,
           cover_url    = v_cover,
           tags         = v_tags,
           language     = v_lang,
           age_rating   = v_age,
           visibility   = v_vis,
           status       = case
                            when v_publish then 'published'
                            when c.status = 'published' then 'published'
                            else 'draft'
                          end,
           word_count   = public.content_words(v_body),
           minutes      = public.content_minutes(v_body),
           published_at = case
                            when v_publish and c.published_at is null then now()
                            else c.published_at
                          end,
           updated_at   = now()
     where c.id = p_id
       and c.member = v_member.id
    returning * into v_row;

    if v_row.id is null then
      return jsonb_build_object('ok', false, 'error', 'not_found');
    end if;
  end if;

  return jsonb_build_object(
    'ok',  true,
    'row', jsonb_build_object(
      'id',           v_row.id,
      'kind',         v_row.kind,
      'title',        v_row.title,
      'summary',      v_row.summary,
      'status',       v_row.status,
      'visibility',   v_row.visibility,
      'words',        v_row.word_count,
      'minutes',      v_row.minutes,
      'published_at', v_row.published_at,
      'updated_at',   v_row.updated_at
    )
  );
end;
$$;

-- ------------------------------------------------------------------
-- 6. delete one
-- ------------------------------------------------------------------
create or replace function public.member_content_delete(p_token text, p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public', 'extensions', 'pg_temp'
as $$
declare
  v_member public.members%rowtype := public.member_from_token(p_token);
  v_gone   int;
begin
  if v_member.id is null then
    return jsonb_build_object('ok', false, 'error', 'session');
  end if;

  delete from public.member_content c
   where c.id = p_id and c.member = v_member.id;
  get diagnostics v_gone = row_count;

  return jsonb_build_object('ok', true, 'removed', v_gone > 0);
end;
$$;

-- ------------------------------------------------------------------
-- 7. grants — the four doors answer the page, nothing else does
-- ------------------------------------------------------------------
revoke all on function public.member_content_list(text) from public;
revoke all on function public.member_content_get(text, uuid) from public;
revoke all on function public.member_content_save(text, uuid, text, text, text, text, text, text, text[], text, text, text, boolean) from public;
revoke all on function public.member_content_delete(text, uuid) from public;

grant execute on function public.content_words(text) to anon, authenticated, service_role;
grant execute on function public.content_minutes(text) to anon, authenticated, service_role;
grant execute on function public.member_content_list(text) to anon, authenticated, service_role;
grant execute on function public.member_content_get(text, uuid) to anon, authenticated, service_role;
grant execute on function public.member_content_save(text, uuid, text, text, text, text, text, text, text[], text, text, text, boolean) to anon, authenticated, service_role;
grant execute on function public.member_content_delete(text, uuid) to anon, authenticated, service_role;
