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
