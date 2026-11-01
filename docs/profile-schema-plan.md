# Oneworld — profile, posts and reach: schema plan

Status: **plan only, no DDL applied**. This document maps the new profile specification onto the
database that is already live (`vtbqbhuywdhnvitbcsfy`), then fixes the final list of tables:
what exists, what is extended, what is created, and what is deliberately **not** created.

The audit was made by introspecting the production schema (54 tables in `public`, all with RLS on,
every browser read going through a `SECURITY DEFINER` RPC).

---

## 1. What is already there

| Table | Columns (live) | Verdict |
| --- | --- | --- |
| `members` | `id, member_code, username, email, password_hash, status, level, membership, membership_started_at/expires_at, points, viewing_codes_limit, avatar_url, cover_url, last_action_at, full_name, phone_number, birth_date, country, terms_accepted(+at), account_activated_at, recovery_code_hash, last_login_at, account_status, member_id, ban_*, bio, language, profile_updated_at` | **keep** — account + auth + money |
| `profiles` | `id, profile_name, profile_username, description, city, country, followers_count, following_count, reach_count, avatar_url, cover_url, created_at, updated_at, member_id` | **extend** — already 1:1 with `members` (`profiles.id = members.id`) |
| `profile_follows` | `follower_id, following_id, created_at` (+ RLS: public read, own write) | **extend** — needs `status` (pending/active) |
| `content_reaction` | `id, location, idmember, value smallint (-1/1), created_at` | **extend** — polymorphic `location` already fits posts |
| `comment` | `id, comment_code, location, idmember, parent_id, content, agree_count, disagree_count, status, created_at, updated_at` | **extend** — needs sentiment + post link |
| `comment_reaction` | `comment_id, idmember, reaction, created_at` | **keep** |
| `notifications` | `notification_code, id_member, source, title, subject, read_or_unread, created_at, read_at` | **keep** — new `source` values only |
| `messages` | `message_code, sender_id, email, message_type, status, title, content, attachments, dates, reply_id` | **keep** — this is the **site contact form**, not member-to-member mail |
| `member_person_actions` | `member_id, person_id, tmdb_person_id, follow, repost, block` | **keep** — blocks *people/actors*, not profiles |
| `member_visits`, `visitor_visits`, `watch_sessions`, `watchtime` | visits, watch seconds per member/title | **keep** — feeds analytics |
| `watchlink`, `blogarticle`, `channelsvideo`, `postrecommendation` | content rows with `idmember`, `keywords text[]`, `views_minutes` | **keep as sources** — they are imported into `posts`, not dropped |
| `reportlink` | reports on links/tmdb ids | **keep** — posts get their own report table |
| `points_ledger` | member points (100 = $1) | **keep** — unrelated to reach points |
| `court_cases`, `payment`, `paymentlog`, `codeactivation`, `viewing_codes`, `sessions`, `log` | unchanged | **keep** |

Two facts drive the whole plan:

1. `profiles` is already one row per member and already carries `reach_count` — the profile **is**
   the public identity, `members` stays private.
2. Reactions and comments are keyed by a polymorphic `location` string. A post can reuse them with
   `location = 'post:<uuid>'`, so likes, dislikes, comment threads and comment reactions do not
   need new tables at all.

---

## 2. Final table list

Legend: **C** = create, **E** = extend existing, **K** = keep untouched.
Every new table: `id uuid primary key default gen_random_uuid()`, `created_at`, `updated_at`,
RLS on, no browser policies (RPC only), `on delete cascade` from the owning profile/post unless
stated otherwise.

### 2.1 Profiles & settings

| # | Table | Kind | Columns |
| --- | --- | --- | --- |
| 1 | `profiles` | E | *add* `language`, `birth_date` (optional), `is_online_visible bool default false`, `connections jsonb` (reserved), `reach_daily_cap int`, `rank_avg numeric(10,2)`, `posts_count int`, `last_seen_at` |
| 2 | `profile_settings` | C | `profile_id pk → profiles`, `show_country, show_language, show_age, show_level, show_wealth, show_connection` **(bool)**, `auto_accept_follow, auto_accept_message, auto_accept_publish, auto_accept_participate` **(bool)**, `allow_keyword_follows bool` |
| 3 | `profile_links` | C | `profile_id`, `platform` (`facebook/instagram/tiktok/youtube/pinterest/reddit/x`), `handle`, `url`, `connected bool`, `sync_direction` (`in/out/both`), `token_ref text` (reference only — **never** the token, see §9), unique `(profile_id, platform)` |
| 4 | `profile_blocks` | C | `blocker_id → profiles`, `blocked_id → profiles`, `view_profile, view_posts, message, publish, participate, react, comment` **(bool default true)**, `created_at`, unique `(blocker_id, blocked_id)`, check `blocker_id <> blocked_id` |

### 2.2 Posts & publishing

| # | Table | Kind | Columns |
| --- | --- | --- | --- |
| 5 | `posts` | C | `id`, `author_profile_id → profiles`, `host_profile_id → profiles` (whoever's profile it lives on; = author when self-published), `post_code text unique` (`PST-000123`), `content_type` (`article/video/recommendation/link`), `title`, `description`, `body`, `thumbnail_url`, `embed_url`, `related_links jsonb` (`[{label,url}]`), `tmdb_id bigint`, `media_type`, `language`, `translation_status` (`none/auto/manual`), `visibility` (`general/excluded/limited/private/followers/following/others`), `status` (`draft/scheduled/published/hidden/deleted/pending`), `scheduled_at`, `published_at`, `deleted_at`, `source_table` (`blogarticle/channelsvideo/postrecommendation/manual`), `source_id uuid`, `reach_daily_points int default 0`, `rank_points int default 0`, `reach_points int default 0`, counters `likes, dislikes, comments_pos, comments_neg, reshares, external_shares, reports, impressions, clicks, watch_minutes int default 0`, `word_count int default 0`, `read_minutes_cap int default 0` (estimated reading time — watch minutes stop at the cap) |
| 6 | `post_audience_rules` | C | `post_id`, `rule_kind` (`country/language/level/wealth/follows/keyword/entity/account_level`), `values jsonb`, `negate bool` |
| 7 | `post_authorized_profiles` | C | `post_id`, `profile_id`, `key_code text` (the "password" cylinder), unique `(post_id, profile_id)` |
| 8 | `post_translations` | C | `post_id`, `language`, `title`, `description`, `body`, `status` (`draft/ready`), unique `(post_id, language)` |
| 9 | `post_keywords` | C | `post_id`, `keyword_id → keywords`, `weight smallint default 1`, unique `(post_id, keyword_id)` — trigger enforces **≤ 3 main keywords per post** |
| 10 | `post_related_content` | C | `post_id`, `related_post_id` **or** `related_url`, `label` — check exactly one of the two |
| 11 | `post_reshare` | C | `post_id`, `profile_id`, `quote text`, `created_at`, unique `(post_id, profile_id)` — repost (reshares are not in `content_reaction`) |
| 12 | `post_reports` | C | `post_id`, `reporter_id → profiles`, `reason`, `details`, `status` (`open/reviewed/rejected/actioned`), `handled_by`, `handled_at` |
| 13 | `post_reach_allocation` | C | `post_id`, `profile_id`, `daily_points int check (>0)`, `starts_at`, `ends_at`, `status` (`active/paused/ended`) — trigger: `sum(daily_points)` of active rows ≤ `profiles.reach_count` |
| 14 | `post_reach_delivery` | C | `post_id`, `target_profile_id`, `owner_profile_id`, `cycle_date date`, `points int default 1`, `status` (`reserved/delivered/released/expired`)`, `reserved_at`, `delivered_at`, unique `(post_id, target_profile_id, cycle_date)` |
| 15 | `profile_reach_transactions` | C | `profile_id`, `kind` (`earn/spend/adjust/refund`), `delta int`, `balance_before int`, `balance_after int`, `event` (`reshares/external_share/watch_minutes/likes/dislikes/comments_pos/comments_neg/reports/allocation`), `post_id`, `actor_profile_id`, `source` (`feed/recommendation/search/home/profile/direct/admin`) |
| 16 | `post_analytics_events` | C | `post_id`, `profile_id` (nullable = visitor), `kind` (`impression/click/watch_minute/like/dislike/reshare/share_external/comment/report`), `source` (`feed/recommendation/search/home/profile/direct`), `seconds int`, `surface_detail text`, `created_at` |
| 17 | `post_analytics_daily` | C | `post_id`, `day date`, `impressions, clicks, watch_minutes, reshares, external_shares, likes, dislikes, comments_pos, comments_neg, reports int`, `sources jsonb`, `reach_points, rank_points int`, unique `(post_id, day)` |

### 2.3 Keywords & search

| # | Table | Kind | Columns |
| --- | --- | --- | --- |
| 18 | `keywords` | C | `id`, `slug text unique`, `term text`, `language`, `parent_id → keywords` (**null = main keyword**), `status` (`active/merged/banned`), `created_by_profile_id`, `followers_count int`, `visitors_count int`, `search_count int`, `reach_min int`, `reach_max int`, `rank_min int`, `rank_max int`, unique `(lower(term), language)` |
| 19 | `keyword_follows` | C | `profile_id`, `keyword_id`, `status` (`pending/active`), unique `(profile_id, keyword_id)` — trigger: main keyword only, **≤ 5 sub-keywords per main per profile** |
| 20 | `keyword_analytics` | C | `keyword_id`, `day date`, `followers, visitors, searches, clicks int`, `reach_min, reach_max, rank_min, rank_max int`, unique `(keyword_id, day)` |
| 21 | `search_history` | C | `member_id`, `profile_id`, `query text`, `kind` (`all/profiles/posts`), `language`, `country`, `results int`, `session_id`, `created_at` |
| 22 | `search_analytics` | C | `day date`, `query_norm text`, `keyword_id`, `language`, `country`, `searches, results, clicks int`, unique `(day, query_norm, language, country)` |

### 2.4 Relationships, publishing rights, messaging

| # | Table | Kind | Columns |
| --- | --- | --- | --- |
| 23 | `profile_follows` | E | *add* `status` (`pending/active/declined`), `requested_at`, `accepted_at`, `source` (`profile/keyword/feed`)` — PK `(follower_id, following_id)` stays |
| 24 | `profile_publish_links` | C | `host_profile_id` (the profile the post appears on), `guest_profile_id` (the author), `status` (`pending/active/paused/removed`), `invited_by` (`host/guest`), `host_approved bool`, `guest_approved bool`, unique `(host_profile_id, guest_profile_id)` |
| 25 | `conversations` | C | `id`, `kind` (`direct/request`), `created_by`, `subject`, `last_message_at`, `status` |
| 26 | `conversation_members` | C | `conversation_id`, `profile_id`, `role` (`owner/member`), `joined_at`, `last_read_at`, `status` (`active/pending/blocked`), unique `(conversation_id, profile_id)` |
| 27 | `conversation_messages` | C | `conversation_id`, `sender_profile_id`, `body`, `read_at`, `created_at` |
| 28 | `conversation_attachments` | C | `message_id`, `storage_path`, `mime`, `bytes`, `name` |

That is **28 tables, 4 of them extensions of tables that already exist, 1 untouched**.

---

## 3. What is deliberately **not** created

The specification lists ~50 entities. These are represented without a dedicated table:

| Proposed in the brief | Why it is not a table |
| --- | --- |
| `PostLanguages` | `posts.language` + `posts.translation_status` + `post_translations` already answer "original language / which translations exist". |
| `ProfileFeedEvents`, `ProfileActivity` | Both are **queries** over `posts` (followed profiles & keywords) and `posts where author = me`. Caching them would duplicate the source of truth; the viewer's "seen" state comes from `post_analytics_events.source = 'feed'`. |
| `ProfileRecommendations` | = `post_reach_delivery` for the viewer + keyword/interest match on the fly. |
| `PostRankingPoints` | The ranking score is a **derived number** (`post.rank_points` cache + `post_analytics_events` as the log). A separate ledger would be a second copy of the same events. |
| `SearchFilters` | Filters live in the URL (`?from=&to=&lang=&country=`) — saving them per user adds nothing yet. |
| `Reactions`, `PostComments`, `Shares` | `content_reaction` (value ±1, `location='post:<id>'`), `comment` (+`sentiment`), `post_reshare`, `post_analytics_events.kind='share_external'`. |
| `Follows`, `Blocks` | `profile_follows` (extended) and `profile_blocks` (granular). |
| `PostAuthorizedProfiles`, `PostSchedules` | `post_authorized_profiles`, and `posts.scheduled_at` + `status='scheduled'` (a schedule is one timestamp, not a table). |
| `Messages` | The site contact form keeps using `messages`; member-to-member mail is `conversations*`. |

---

## 4. Points: two independent scores

The brief defines two scores that must never be mixed:

| | Reach points (نقاط الوصول) | Ranking points (نقاط الترتيب) |
| --- | --- | --- |
| Belongs to | the **profile** (`profiles.reach_count`) | the **post** (`posts.rank_points`) |
| Analogy | domain authority (DA) | page authority (PA) |
| Counted from | interactions **only** when they come from `source in ('feed','recommendation')` | interactions from **any** source |
| Used for | how many non-followers a post may be suggested to | order of search results |
| Ledger | `profile_reach_transactions` | `post_analytics_events` → `posts.rank_points` |

### 4.1 Weights (identical for both scores)

| Event | Points |
| --- | --- |
| Reshare / repost | **+60** |
| External share (once per profile per post) | **+1** |
| Watch minute | **+1** |
| Like | **+30** |
| Dislike | **−30** |
| Positive comment | **+15** |
| Negative comment | **−15** |
| Report | **−60** |

Rules that follow from the brief:

* reach and rank never go below 0 for reach (balance is a budget) while `rank_points` **may** be
  negative — a buried post is legitimate;
* only one external share per profile per post is counted;
* interactions with someone else's post published on **my** profile credit **my** profile's reach
  (the post's `host_profile_id` owns the budget), while `rank` belongs to the post itself;
* deleting a post freezes its transaction rows (no retro-active recalculation).

### 4.2 Sorting posts — the nine tie-breakers, in one place

One SQL function, `post_rank_key(post)`, is the only place the order is defined:

```sql
order by p.rank_points desc,          -- 1
         p.reach_points desc,         -- 2
         p.reshares desc,             -- 3
         p.external_shares desc,      -- 4
         p.watch_minutes desc,        -- 5
         (p.likes - p.dislikes) desc, -- 6
         (p.comments_pos - p.comments_neg) desc, -- 7
         p.reports asc,               -- 8
         p.published_at asc           -- 9
```

Profiles in search are ordered by `profiles.reach_count desc, followers_count desc, created_at asc`.

---

## 5. Reach budget: three levels, and **when a point is spent**

```
profiles.reach_count            1,000   ← the balance (earned, spent, refunded)
post_reach_allocation            100    ← per-post daily cap, sum(active) ≤ balance
post_reach_delivery               100   ← actual suggestions, one row per profile per day
```

Answer to the open question in the brief: **a reach point is consumed when the suggestion is
actually shown, not when it is allocated.**

* `post_reach_delivery` is written as `reserved` at the moment the feed/recommendation payload is
  built for a profile, with `points = 1`;
* the browser confirms the impression (`post_analytics_events.kind='impression'`), which flips the
  row to `delivered` and appends a `profile_reach_transactions` row (`kind='spend'`, `delta=-1`);
* a `reserved` row untouched for 10 minutes becomes `released` (no points spent) — this is the
  fairness case the brief asks about: a failed render must not cost the author;
* a per-post daily unique constraint `(post_id, target_profile_id, cycle_date)` guarantees the same
  profile never receives the same post twice in one cycle;
* when `profiles.reach_count = 0`, the post stops being suggested to non-followers but **stays** in
  the updates feed of its followers (`status='published'` and visibility rules still apply).

Allocation is only a cap: it never moves points. Lowering a cap or pausing a post simply stops new
reservations.

---

## 6. Visibility matrix

`posts.visibility` + `post_audience_rules` + `post_authorized_profiles`:

| Value | Who sees it | Extra rows |
| --- | --- | --- |
| `general` | everybody except blocked profiles | — |
| `excluded` | everybody **except** the listed profiles | `post_authorized_profiles` with `key_code is null` = excluded list |
| `limited` | general scope **plus** the criteria rows (countries, languages, level, wealth, follows, keywords/entities) | `post_audience_rules` |
| `private` | only the profiles in the authorized list (one or more key codes) | `post_authorized_profiles` |
| `followers` | the author's active followers | — |
| `following` | the profiles the author follows | — |
| `others` | explicit profiles found by username / member id / key code | `post_authorized_profiles` |

A post published on someone else's profile (`host_profile_id <> author_profile_id`) is always
`general` — the brief is explicit — and it appears in the **host's** followers' updates, with the
**host's** reach budget.

Every visibility change is logged; a viewer who loses access loses the post from their feed on the
next query (no client-side filtering).

---

## 7. Comments require a reaction

The rule "no comment without a like or a dislike, and the comment inherits that sign" is enforced
by the comment RPC, not by the page:

1. `content_reaction` row must exist for `(location='post:<id>', idmember)` — otherwise
   `{error: 'react_first'}`;
2. `comment.sentiment` = `positive` when `value = 1`, `negative` when `value = -1`;
3. changing the reaction later does **not** rewrite past comments (they keep the sign they were
   written with) — the counters stay consistent with what the author saw;
4. `posts.comments_pos` / `comments_neg` are maintained by trigger.

---

## 8. Follows, blocks, publishing rights

* **Follow** is created as `pending` when the target has `auto_accept_follow = false`, otherwise
  `active`. The follower sees the profile under "following" immediately; the target sees it under
  "followers → pending" and flips it with one cylinder. Accepting sets `accepted_at` on the row and
  both counters.
* **Block** writes `profile_blocks` with all seven action flags `true`; every RPC that reads or
  writes a post, comment, reaction, message or publish link checks the flags for both directions.
  Blocking removes existing follows and pending publish links.
* **Publishing rights** are one row per pair (`profile_publish_links`) with two independent
  approvals, which produces exactly the four lists in the brief:
  * "publish" → rows where I am `host` (pending rows = participants asking to publish on my profile);
  * "share" → rows where I am `guest` (pending rows = hosts I asked, plus my requests);
  * each direction is only usable when `status='active'`;
  * publishing on someone else requires **follow in either direction** and **level ≥ 1** — checked
    in the RPC and re-checked when the link is activated.

---

## 9. Security notes

* `profile_links.token_ref` never stores a token: it stores the name of a Supabase secret
  (`VAULT:profile_link_<id>`) that an edge function reads server-side. No token, API key or Xtream
  password is ever returned by an RPC or written into `assets/js`.
* Every new table is `enable row level security` with **no** browser policies; the pages call
  `SECURITY DEFINER` functions that take `p_token` and resolve the member through
  `member_from_token(token)`, exactly like `member_dashboard`, `member_code_create` and the
  activation RPCs.
* `post_authorized_profiles.key_code` is stored as a hash (`crypt`), never returned in a payload.
* Reports and blocks are logged in `log` with the actor, the target and the action.

---

## 10. Migration order (each one rollback-safe, each one tested before the next)

| # | Migration | Content | Pages unblocked |
| --- | --- | --- | --- |
| M1 | `profile_core` **applied 2026-11-01** | `profiles` columns, `profile_settings` (+auto row), `profile_links`, `profile_blocks`, `profile_follows.status/requested_at/accepted_at/source` + backfill, follow counters trigger, `profile_public` / `profile_settings_*` / `profile_follow_*` / `profile_block_*` / `profile_links_*` RPCs | profile page shell, settings, follow/block lists |
| M2 | `posts_core` + `keywords_core` **applied 2026-11-01** | `posts`, `post_audience_rules`, `post_authorized_profiles`, `post_translations`, `keywords`, `post_keywords`, `keyword_follows`, `post_related_content`, `site_archive` (+ the ≤3 mains / ≤5 subs guard, the counters, the 30-day window) | composer, tabs (updates/activity/suggestions), keyword page |
| M3 | `interactions_core` **applied 2026-11-01** | `comment.edited_at/polarity/like_count/dislike_count`, `post_reshare`, `post_reports`, the counters trigger, the comment-requires-reaction rule | post card interactions, lists of reactors |
| M4 | `reach_rank` **applied 2026-11-01** | `profile_reach_transactions`, `post_reach_allocation`, `post_reach_delivery`, `post_rank_recompute()`, `reach_release_stale()` | suggestions, manage-posts counters |
| M5 | `search` **applied 2026-11-01** (as `search_publish_links`) | `search_history`, `search_analytics`, `keyword_analytics`, `profile_publish_links` | `search.html`, `keyword.html`, publish / share lists |
| M6 | `publish_links` **applied 2026-11-01** (same migration) | the request/approve rows of publishing at another profile | publish / share lists |
| M7 | `messaging_core` **applied 2026-11-01** | `conversations`, `conversation_participants`, `conversation_messages` (+ `last_message_at` trigger) | messages page |
| M8 | `analytics` **applied 2026-11-01** (with M4) | `post_analytics_events`, `post_analytics_daily` | statistics tab |
| M9 | `rpc_surface` | the ~40 RPCs the pages need, each with `p_token` and a JSON payload | all pages |

Each migration gets: a `tools/sql/<name>.sql` file mirroring what was applied, a smoke test in
`tools/`, and a README section — same pattern as `activation_flow`.

---

## 11. Decisions taken with the owner (2026-11-01)

The first draft listed eight open questions; six are now answered and M2/M4 can be built on them.

| # | Question | Decision | Consequence in the schema |
| --- | --- | --- | --- |
| 1 | Reach seed | **No starting balance.** A new profile starts at `reach_count = 0` and is still searchable. Reach arrives from off-site shares, from the ads page (to be built), or because a publisher profile needs content for its followers. | `profiles.reach_count` defaults to 0, no seed in M1; `post_reach_allocation` never allocates above the balance, and a 0 balance means *followers only*. |
| 2 | Host's reach on a guest post | **The host's reach is spent and the host earns/loses.** A post published on someone else's profile never moves points to the guest author. | `posts.host_profile_id` owns `post_reach_allocation`, `post_reach_delivery` and the reach score; the guest keeps only the post ranking. Negative weights (dislike, report) hit the host. |
| 3 | Translations | **Manual translations only** in this round. | `post_translations.kind = 'manual'`; `posts.translation_status` keeps `auto` for a later automatic draft. |
| 4 | Translated content in the tabs | **Translated posts appear in the Updates and Suggestions tabs**, in the reader's language when a translation exists. | the feed queries join `post_translations` on `language = reader.language`; the post card shows the *translated* chip and the original language. |
| 5 | Comments | **Comments are editable, accept replies and take Like/Dislike.** A comment still requires a prior post reaction and carries that polarity (+15 / −15). Editing never re-writes the polarity stored at insert time. | `comment.edited_at`, `comment.parent_id` (replies), `comment_reaction` with the same ±1 checks as `content_reaction`. |
| 6 | Watch minutes | **Estimated reading time, not a session.** `read_minutes_cap = ceil(word_count / 200)`, computed when the post is saved; counting stops at the cap. | `posts.word_count`, `posts.read_minutes_cap`; `post_analytics_events(kind = 'watch_minute')` refuses events past the cap. |
| 7 | Keyword limits | **3 main keywords per post and 5 sub-keywords per main keyword** — a limit per post, not per profile. | unique `(post_id, keyword_id)` plus a trigger on `post_keywords` that counts mains and subs. |
| 8 | Deleted or banned profiles | **Their posts are deleted within 30 days and moved to a `site_archive` table**; financial and legal rows are untouched. | `site_archive(entity, payload jsonb, member_id, archived_at, purge_after)` written by the purge job that already handles the 30-day account window. |

Two items stay open but do not block M2:

* whether the composer also offers an **automatic** translation draft (row 3) — the column accepts
  `auto`, only the UI is undecided;
* whether a post with `visibility = 'private'` / `others` shows up in the Updates tab of the
  authorized profiles (current assumption: yes, plus a notification).

---

*Prepared from the live schema on 2026-11-01. M1–M8 are applied; the tables and the rules they
enforce are listed in [`profile-tables-applied.md`](profile-tables-applied.md), the M1 mirror is
`tools/sql/profile-core.sql` and the M2 mirror is `tools/sql/posts-core.sql`. Next: M9, the RPC
surface the pages call.*
