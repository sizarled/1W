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
| the comment's **sentiment is the reaction's value at the moment of writing** (±1) and never changes afterwards | same trigger, `comment.sentiment` |
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
like + one comment (sentiment inherited) + one reshare gave the counters `1 / 0 / 1 / 1` and
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

## Correction — the comment keeps the reaction it was written with

The brief says a comment is **refused until the member has liked or disliked the post**, that the
comment is then counted **positive for a like and negative for a dislike**, and that changing the
reaction later **never flips a comment that is already written**. Three things were wrong or
missing, and `comment_sentiment` + `comment_sentiment_rpc` + `comment_sentiment_read` fixed them:

1. The column is now **`comment.sentiment`** (was `polarity`), `smallint` with a
   `check (sentiment is null or sentiment in (-1, 1))`. `polarity` was never written by the
   insert — the trigger relied on `post_comment` leaving it alone, and a probe comment had landed
   with `null`.
2. `comment_requires_reaction` now does both halves explicitly: on `INSERT` it refuses the row
   (`23514`) when no `content_reaction` exists for that location and member, otherwise it stamps
   `new.sentiment := <that value>`; on `UPDATE` it forces `new.sentiment := old.sentiment`, so an
   edit — or a later dislike — cannot rewrite history.
3. `post_counters_sync` counts `comments_pos` / `comments_neg` from `comment.sentiment` **and ends
   with `perform public.post_rank_recompute(v_post)`** — before this, likes, comments, reshares and
   reports moved the counters but the post's `rank_points` never moved at all.

`post_comment` returns `sentiment` alongside the comment, `post_comments` returns each comment's
`sentiment` plus `can_comment` and the caller's current `reaction`, so the page can lock the box
from the server's answer instead of guessing.

### Probe (2026-11-01, throw-away member `@probe.sent` / `ID100011`)

| Step | Result |
| --- | --- |
| `post_comment` with no reaction | `{ ok: false, error: "reaction" }` |
| `post_react(1)` then `post_comment` | `sentiment: 1`, post `comments_pos: 1` |
| `post_react(-1)` afterwards | comment still `sentiment: 1`; post `likes 0 / dislikes 1 / comments_pos 1 / comments_neg 0`, `rank_points: -15` |
| a second comment, now with the dislike | `sentiment: -1`, `comments_neg: 1`, `rank_points: -30` |
| edit of the first comment's text | `sentiment` still `1` |

Every probe row was deleted afterwards (posts 0, post comments 0, probe members 0). The page now
labels the chip **positive** / **negative** from `sentiment`, and the hint under the box reads
“New comments are counted negative (your dislike). Changing your reaction later leaves the
comments you already wrote as they are.” — `tools/profile-smoke.mjs`: **111/111**.

## The messages round — send a message, then the conversations

`messaging_core` had the three tables; this round adds the functions that use them and the panel
inside `profile.html → Messages`.

| Migration | Functions |
| --- | --- |
| `messaging_rpc_send` | `msg_direct(me, other)`, `msg_send(token, ref, subject, body, attachments)` |
| `messaging_rpc_read` | `msg_conv(ref)`, `msg_reply(token, conversation, body, attachments)`, `msg_list(token, filter, online_only, limit, offset)`, `msg_thread(token, conversation, limit)`, `msg_unread(token)` |
| `messaging_pending_state` | widened `conversation_participants_state_check` to `active / pending / suspended / blocked`; filters read “suspended” as “anything not active” |
| `messaging_people_storage` | `msg_people(token, query, limit)` + `users/messages/…` storage policies |

### The rules the database enforces

- **A recipient is a username, a member ID or a uuid** — `profile_resolve()` accepts all three, so
  the send form needs nothing else.
- **One direct conversation per pair.** `msg_direct()` finds a conversation with exactly those two
  participants; sending again appends to it instead of opening a second thread.
- **Suspended until accepted.** The first message creates the thread with the sender `active` and
  the recipient `pending`, unless the recipient has `auto_accept_message` on or a follow exists in
  either direction. A pending thread shows under the **Suspended** tab; one reply from either side
  promotes both participants to `active`.
- **Blocks cascade.** A block with the `message` flag stops the send in both directions, and
  `msg_people()` hides that member from the recipient suggestions.
- **Text or at least one file.** `conversation_messages_body_or_file` refuses an empty message;
  the RPC checks the same thing before inserting and caps the text at 8 000 characters, five
  attachments, a 160-character subject.
- **Attachments** upload to `users/messages/…` in the `source` bucket with the `apikey` header only
  and a filename whitelist (image, PDF, text, Word, ZIP, MP3, MP4, 5 MB each).
- **Reading marks read.** `msg_thread()` moves the caller's `last_read_at` before returning, so the
  unread counts from `msg_list` / `msg_unread` drop on open.

### The panel

`profile.html → Messages` has two blocks. **Send a message**: recipient with a datalist from
`msg_people`, optional subject, body, up to five attachments, Send. **Direct messages**: tabs
`All / Active / Suspended` with their counts, an “online only” switch (filters on
`profiles.last_seen_at` within three minutes and `is_online_visible`), the conversation list
(avatar, online dot, name, preview, unread badge, conversation code) and the thread pane with
bubbles — sent on the right, white-on-black in the dark theme and inverted in the light one — plus
the reply box with its own attachments. The **Message** button on a visitor's profile opens the
same panel with the username already in the To field, and the menu carries the unread count.

### Probe (2026-11-01, two throw-away members)

| Step | Result |
| --- | --- |
| `msg_send('@msg.two', subject, body, 1 attachment)` | `CNV-001003`, sender `active`, recipient `pending` |
| `msg_list` as the sender | 1 conversation, state `active`, unread 0 |
| `msg_list` as the recipient | 1 conversation, state `pending`, unread 1; `suspended` filter → 1, `active` → 0 |
| `msg_unread` as the recipient | `{ unread: 1, suspended: 1 }` |
| `msg_reply('CNV-001003', …)` as the recipient | both participants `active`, message 2 inserted |
| `msg_thread` as the sender | 2 bubbles in order, `mine` true/false, the PDF attachment intact |
| `msg_unread` after the reply | `{ unread: 0, suspended: 0 }` |
| `msg_people('msg.two')` | 1 suggestion (fixed to join `members` on `id`, because `profiles.member_id` is nullable) |

`tools/messages-smoke.mjs` repeats the walk in jsdom with the network stubbed — **36 checks**:
the panel, the counts, the rows, the bubbles, the attachments, the filters, online-only, a reply,
a full send (recipient · subject · body · attachments), and the “Message” button prefilling.
