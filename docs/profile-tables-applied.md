# Profile page — the tables that were applied (2026-11-01)

This is the record of what the profile page's functions now stand on. M1 was described in
[`profile-schema-plan.md`](profile-schema-plan.md); this file lists the migrations applied after it,
the tables each one created, and the rules the database itself enforces.

Every table below has **RLS enabled with no policy**, so no browser can read or write it directly —
the pages go through `SECURITY DEFINER` RPCs, the same pattern as `member_*` and `activation_*`.

## Migrations

| Migration | Tables | Purpose on the page |
| --- | --- | --- |
| `posts_core` | `posts`, `post_audience_rules`, `post_authorized_profiles`, `post_translations` | the Updates / Activity / Suggestions tabs, the composer, the post card, the visibility step |
| `keywords_core` | `keywords`, `post_keywords`, `keyword_follows`, `post_related_content`, `site_archive` | the keyword picker (≤3 mains × ≤5 subs), the keyword page, related links, the 30-day archive |
| `interactions_core` | `post_reshare`, `post_reports` (+ `comment`/`content_reaction` extended) | Like / Dislike / Comment / Repost / Share / Report and their counters |
| `reach_rank` | `profile_reach_transactions`, `post_reach_allocation`, `post_reach_delivery`, `post_analytics_events`, `post_analytics_daily` | the reach budget, the ranking points, the statistics tab |
| `search_publish_links` | `search_history`, `search_analytics`, `keyword_analytics`, `profile_publish_links` | the owner search, the keyword page ranges, the publisher / participant lists |
| `messaging_core` | `conversations`, `conversation_participants`, `conversation_messages` | the send-message form and the direct conversations |

## The rules the database enforces by itself

| Rule | Where |
| --- | --- |
| `PST-001000` post codes, `CNV-001000` conversation codes | `post_seq`, `conversation_seq` defaults |
| `read_minutes_cap = ceil(word_count / 200)` and `published_at` / `deleted_at` are set on their status | `posts_touch_meta()` trigger |
| at most **3 main keywords** per post | `post_keywords_guard()` |
| at most **5 sub-keywords** per main keyword | `post_keywords_guard()` |
| a sub-keyword needs a main keyword, and that main must be on the same post | `post_keywords_guard()` |
| `keywords.posts_count` and `keywords.followers_count` follow their rows | `keyword_posts_count_sync()`, `keyword_follows_count_sync()` |
| a comment is refused unless the member liked or disliked the post | `comment_requires_reaction()` |
| the comment's **polarity is the reaction's value** (±1) and never changes afterwards | same trigger, `comment.polarity` |
| `comment.edited_at` is set when the text changes | `comment_touch_edit()` |
| `posts.likes / dislikes / comments_pos / comments_neg / reshares / reports` are recount-ed from their source tables | `post_counters_sync()` |
| `comment.like_count` / `dislike_count` follow `comment_reaction` | `comment_reaction_counts_sync()` |
| one reaction per member per location, one reshares / one report per profile per post | unique indexes `content_reaction_unique`, `post_reshare_unique`, `post_reports_unique` |
| a reach reservation left `reserved` for 10 minutes is released and its point returned | `reach_release_stale()` |
| a point can never be spent twice on the same day and profile | `post_reach_delivery_unique (post_id, target_profile_id, cycle_date)` |
| one allocation per post per day, spent + released never above allocated | `post_reach_allocation_unique`, `..._budget` |
| `rank_points = 60·reshares + shares + watch minutes + 30·likes − 30·dislikes + 15·pos − 15·neg − 60·reports` | `post_rank_recompute(post)` |
| no profile can be its own publisher | `publish_links_self` |
| a message carries text or at least one attachment | `conversation_messages_body_or_file` |
| archiving keeps a row for 30 days | `site_archive.purge_after default now() + 30 days` |

## Two corrections made while applying

1. `comment_reaction.reaction` only accepted `agree` / `disagree`; the constraint now also accepts
   `like` / `dislike`, so the comment bar and the old rows agree with each other.
2. `post_counters_sync()` first read `new.post_id` for every table it is attached to, and `comment`
   has no such column. It now branches on `tg_table_name`: `content_reaction` and `comment` parse
   `location = 'post:<uuid>'`, `post_reshare` and `post_reports` read `post_id`.

## Verified with a throwaway profile (then deleted)

A probe member published a 450-word post → `PST-001000`, `read_minutes_cap = 3`, `published_at`
set; three keywords linked (2 mains + 1 sub) and the 4th main refused, an orphan sub refused; one
like + one comment (polarity inherited) + one reshare gave the counters `1 / 0 / 1 / 1` and
`rank_points = 105`; a comment without a reaction was refused; a stale reservation was released and
the allocation showed `points_released = 1`; a conversation touched `last_message_at`; audience
rules, authorized profiles, search history, keyword analytics and publish links all accepted their
rows. Everything was then removed, and `posts`, `keywords` and `comment` are back to zero.

## Still to write

The RPC surface (`profile_feed`, `post_create`, `post_react`, `post_comment`, `reach_allocate`,
`keyword_page`, `conversation_send`…) plus the composer, the post card and the keyword page. The
tables are in place; the pages call them next.

## The publishing round — RPCs wired to the page

Three migrations went in after the tables, plus one storage policy. Every function is
`security definer`, takes the raw session token as `p_token`, takes a post as a uuid or a
`PST-######` code, and is granted to `anon`, `authenticated` and `service_role` (the anon grant
matters: a visitor reads public posts with an empty token).

| Migration | Functions |
| --- | --- |
| `feed_core` | `viewer_attr(uuid,text)`, `post_visible_to(uuid,uuid)`, `post_card(uuid,uuid)`, `profile_feed(text,text,text,int,int)`, `keyword_search(text,text,int)` |
| `composer_core_v2` | `profile_posts_count_sync()` + the `posts_profile_count` trigger, `post_create(text,jsonb)`, `post_delete(text,text)` |
| `post_interactions` | `post_resolve`, `post_react`, `post_comment`, `post_comments`, `post_reshare`, `post_report`, `post_reactors` |
| `storage_post_images` | policies `source_posts_insert / _update / _read` for `users/posts/<name>.(jpg\|jpeg\|png\|webp\|gif)` |

`post_create` takes one jsonb payload:

```json
{ "title": "…", "description": "…", "body": "…", "content_type": "article",
  "thumbnail_url": "…", "embed_url": "…", "language": "ar", "visibility": "general",
  "scheduled_at": null, "host": "@someone",
  "keywords": [{ "keyword": "Cinema", "role": "main" },
               { "keyword": "Noir", "role": "sub", "parent": "Cinema" }],
  "audience": [{ "kind": "country", "value": "MA", "mode": "exclude" }],
  "profiles": ["@sara"], "related_links": [{ "label": "Source", "url": "…" }],
  "translations": [{ "language": "en", "title": "…", "body": "…" }] }
```

and answers `{ ok, post: <post_card>, status: "published" | "scheduled", scheduled_at }`.
A `scheduled_at` more than a minute ahead stores the row as a draft with that time.

### Two fixes this round

1. **`posts.content_type` is `not null`** and the composer sends nothing when the parameter is
   absent; `post_create` built it with `case when coalesce(…, 'article') in (…) then lower(…)` — the
   `then` branch was `null`. Rather than reload the whole function, a `before insert` trigger
   `posts_fill_defaults` now fills `content_type`, `language`, `visibility` and `status` when the
   insert leaves them empty. The function still validates the enum when the value is present.
2. **Storage** only policed `users/profile/avatar|cover_IDXXXXXX`, so a post thumbnail would have
   been refused. `users/posts/…` now has its own insert / update / read policies, still with a
   filename whitelist, and the page still sends `apikey` — never `Bearer`.

### Probe (supabase, 2026-11-01)

A throw-away member `@probe.post`/`ID100010` walked the whole path and every row was deleted
afterwards (posts 0, keywords 0, comments 0, members 0):

| Step | Result |
| --- | --- |
| register + a session row | `member_register` → `ID100010`, session token `probetoken` |
| `post_create` with a main + sub keyword, a related link, one manual translation, 300 words | `PST-001002`, `read_minutes: 2`, `word_count: 323`, keywords parented, translation `ready` |
| `profile_feed` updates / activity / guest | 1 / 1 / 1 |
| `post_react(1)` | `likes: 1` |
| `post_comment` | `ok` |
| `post_reshare` | `reshares: 1` |
| `post_report` | `reported: true` |
| `post_reactors('likes')` | 1 member |
| `post_delete` | activity 0, one row in `site_archive` |

`tools/profile-smoke.mjs` grew a fourth pass that repeats the same walk in jsdom with the
network stubbed — the card, its two tabs, the reaction-first comment rule, the members modal, the
repost, and a full composer run whose payload is asserted (keywords, audience rule, schedule) —
**106/106 checks**.

### Still open

- `tools/sql/` has no mirror yet for `feed_core`, `composer_core_v2` and `post_interactions`; the
  definitions live only in the Supabase migration history. `pg_get_functiondef` can dump them.
- The composer does not yet show live keyword reach/rank or the “Explore keywords” button, and
  guest publishing (`host`) has no profile picker — `publish-here` passes the profile it is on.
- Reach allocation, messaging, the keyword page and post statistics are still to build.
