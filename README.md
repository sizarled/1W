# 1World Web

The public homepage for **1world-Web** — an independent streaming catalogue for films,
series and IPTV channels, where members also publish videos, documents, articles,
answers and reviews, and earn points in the market, auction, bank, prizes and tasks.

Everything is built in **black, white and grey**, in English, with hand-tuned SVG
icons and no UI framework.

---

## Run it

It is a static site — no build step, no dependencies.

```bash
python3 -m http.server 8000 --bind 0.0.0.0
# then open http://localhost:8000
```

Any static host works (Netlify, Vercel, Cloudflare Pages, an S3 bucket…). Keep the
folder structure intact because the JS uses native ES modules.

---

## What the homepage contains

| Section | Behaviour |
| --- | --- |
| **Header** | Logo + wordmark, section nav, notification bell with filters, points & level wallet, Log in / Register (swaps to Dashboard / Log out when signed in). |
| **Sidebar** | Collapsible rail pinned left. Visitor or member card (`Visitor - 482913` / `Member - 000482`), level meter, then the full site map: Search · Watch · Browse · Earn · Pages. State is remembered. |
| **Hero** | Slideshow of 5 trending films and 5 trending series (toggle between the two), synopsis, rating, genres, and numbered thumbnails with a progress bar. |
| **Features** | Hairline grid fed by the `features` table (`Feature Title / Description / Icon / Link / Clicks`). |
| **Search** | Full-width search box → `search.html?q=…`. |
| **Films** | 50 trending films in a horizontal reel → `watch.html?movie=<tmdbId>`. |
| **Series** | 50 trending series in a horizontal reel → `watch.html?tv=<tmdbId>`. |
| **IPTV** | Free and Premium tiers from `iptvfree` / `iptvpremium`, horizontally scrollable → `iptv.html?M3U=<id>`. Premium cards lock themselves for non-premium members. |
| **Membership** | Free + Silver / Gold / Diamond, each with a duration switcher, price in USD **and** points (100 pts = $1), level caps LV3 / LV5 / LV7 / LV10. Only a **Register** action — upgrades happen on `actevite.html`. |
| **Apps** | Windows, macOS, Linux, Android, iOS, Android TV, Apple TV with "Coming soon" until a download link is published from `panel.html`. |
| **Support** | Name / email / topic / message form posting to the messages table, plus the site-page directory. |
| **Platform** | The 14 social platforms, horizontally scrollable, each with its brand glyph. |
| **Footer** | Description, social dots, four link columns, legal bar and an outlined wordmark. |

### Scrolling the reels

Every horizontal reel (films, series, IPTV, apps, platforms, membership plans, the
notification filters) **and the twelve-section header list on every page** — `watch.html`
included — work three ways:

- **Mouse drag** — press and hold anywhere on the reel, then pull left or right. The
  cursor turns into a grabbing hand, the card under the pointer is not opened when a drag
  ends on it, and a mostly-vertical pull scrolls the page instead of the reel.
- **Wheel / trackpad** — a vertical wheel over a reel moves it sideways until it hits an
  edge, then the page scrolls again. `Shift` + wheel and a two-finger horizontal swipe
  work everywhere.
- **Arrow buttons** — the `‹ ›` pair at the top right of each section, plus native
  touch swiping on phones and tablets.

---

## The watch page

`watch.html` is a real page, not a placeholder. It reads the title from the URL and builds
everything around it:

```
watch.html?tv=1399                        series, season 1 episode 1
watch.html?movie=550&publisher=<uuid>     film + referral publisher
watch.html?tv=1399&season=2&episode=3     a specific episode
watch.html?movie=550&link=link000004      start on a specific member source
```

| Block | Behaviour |
| --- | --- |
| Title header | Poster, display + original title, tagline, synopsis, certification, status, genres and every TMDB fact (runtime, seasons, rating, director, writers, studios, countries, language). |
| Actions | Like / dislike (one vote per member, changeable), comments toggle, total minutes, watch later, download, share, report. |
| Player | Poster + play button + duration. Play opens the **30-second sponsor gate**: the countdown only starts once the sponsor link is opened, and it stops when the page is closed. Then `vidsrc.sh/embed/…` loads. |
| Viewing code | Five minutes after playback starts — for titles rated **≥ 50 % on TMDB or age-restricted** — the film stops, fullscreen exits and the lock panel asks for a six-digit code. Codes are checked through `verify_watch_code()` against `viewing_codes`; "remember this device" binds the code to a random device id. |
| Seasons | Season + episode pickers for series; changing either restarts the player and the ledger. |
| Watch links | The platform source is always first (logo only, URL hidden). Member links show favicon, site name, quality (SD → 8K), audio, subtitles and ads. Picking one loads it in the same player and prints its details underneath. |
| Cast & crew | Director, writers, producers and cast — every card opens `cast.html?id=<personId>`. |
| Official providers | TMDB watch providers for the visitor's region, logo + name + type. |
| Comments | Public read, member write, nested replies, agree / disagree counters (kept by a trigger), reply and report. |
| Related | Saga parts, recommendations and similar titles. |
| Playlists | Member playlists that contain this title → `playlist.html?id=<idplaylist>&creator=…`. |
| Member content | Videos, articles, answers, documents, reviews and recommendations that mention the title, most-watched first. |
| Prizes / Tasks | Published prizes (`prizeavilable`) and offers from the tasks network — impressions, clicks and completions are logged in `taskimpretion`, `taskclick`, `taskcomplet`, and a verified payout credits `points_ledger` at $1 = 100 points. |
| Exit intent | Leaving the page (or opening another title) while playing asks: finished / continue later / not interested. The choice lands in the member's system playlist + `hestory`. |

**Watch-time ledger.** A second of watch time is counted only while **all** of these hold:

| Condition | What pauses the clock |
| --- | --- |
| Play was pressed (the ad gate and the code gate are done) | nothing is counted on a page that was merely opened |
| The tab is visible | switching tabs, minimising, another app in front |
| The window has focus | clicking a second window (a second desktop window counts as "not watching") |
| The browser is online | offline / connection lost |
| The viewing-code lock is closed | the 5-minute code gate |
| The title has not used its allowance | a film or episode can only count its own TMDB runtime |

The allowance is the **TMDB runtime**: `runtime` for a film, the exact episode `runtime`
for a series (`/tv/{id}/season/{s}/episode/{e}`, falling back to `episode_run_time`), so
leaving the player open overnight cannot farm minutes. Accrued seconds live in
`localStorage` under a per-day key (`1w.watched:<type>:<id>[:s..e]:<date>`), so a reload
does not reset the allowance — the next day starts a fresh one. When the allowance is
spent the player keeps playing, the ledger stops and a toast explains it once.

The line under the player shows the live state — `Counting · 3:20 of 132 min`,
`Paused — this window is not focused · 3:20 of 132 min`, `Limit reached — all 132 min of
this title are counted.`

Seconds flush to `watchtime` every 20 seconds and on hide / blur / unload (`keepalive`).
The server enforces the same ceiling as a backstop: `log_watchtime(..., p_cap)` clamps the
daily total per device + title to the cap the browser sent (60 s floor, 6 h hard maximum)
and returns `null` once it is spent, which stops the client ledger instead of falling back
to a direct insert. Ad blockers get a probe at load: their minutes are stored with
`is_eligible = false`, so nothing is credited — previously earned minutes are never
removed. Reaching **1000 eligible minutes** fires the ad-network hook `_Wi()` exactly once
per member (`claim_milestone`).

**Visits.** `assets/js/visits.js` runs on every page from `app.js`: it writes one
`visitor_visits` row (and one `member_visits` row when a member session exists) through
`log_visit()`, carrying the six-digit visitor id, the referrer, the page, the visit
frequency, the purpose (`watching` / `joining`) and the source, then closes the row with
`finish_visit()` — duration + end date — on hide or unload.

**`visit_id` = one browser session, one row per page.** The visit id is minted the first
time the site is opened and then **never changes** while the browser stays open, however
many pages are opened. Each page adds its own row carrying that same `visit_id`:

| Situation | `visit_id` | row |
| --- | --- | --- |
| opening the site | new | one row (start date, duration) |
| moving to another page | unchanged | new row |
| another page after `?movie=` / `?tv=` / `?season=` | unchanged | new row — the query string is part of the page |
| reloading the page that is already recorded | unchanged | **no new row** |
| a second tab on another page | unchanged | new row |
| every page closed (browser closed) | **new** | new row |

Because the id is shared, the rows are addressed by their own `id` (returned by
`log_visit()` as `row_id` and used by `finish_visit(p_row := …)`), so each page keeps its
own `visitor_start_date`, `visitor_end_date` and `visitor_duration`. `visitor_frequency`
is the repeat rate of that exact page for that visitor (`1` the first time
`/watch.html?movie=1765072` is opened, `2` the second time), and member rows count the same
way per `member_page`.

The browser session is tracked in `localStorage["1w.visit.session"]`, shared by all tabs:
every tab registers itself and beats every 10 s, a beaten tab counts as open for 2.5
minutes (browsers throttle background tabs), and a page that loads within 15 s of the last
one closing is a reload or a navigation rather than a closed browser. Only when no tab is
left does the next page start a new `visit_id` — and since a tab that went silent (crash)
is not trusted, a dropped browser never keeps an old session alive.

**Visitor identity.** The six-digit `visitor_id` belongs to the browser and never
changes: `localStorage["1w.visitor"]` is read first, then the first-party cookie `1w_vid`
(two years, `SameSite=Lax`, `Secure` on https), and only then is a new number minted —
every answer is written back to both stores, and kept in memory when a browser blocks
storage entirely. Reloading, closing the browser, signing out (`signOut()` keeps it) or
clearing one of the two stores never produces a second identity, so
`visitor_frequency` really counts the visits of that one visitor. On the server a valid
six-digit id is stored **exactly as sent**; an unusable value (empty, too short, `000000`)
gets a generated number instead of being zero-padded into somebody else's id.

**Visitor address + country.** `assets/js/geo.js` asks public geo-IP services for the
visitor's address in the browser — `ipwho.is`, then `ipapi.co`, then `api.ipify.org` for
the address alone — with a 3.5 s timeout each, no key and no cookies, and caches the answer
in `sessionStorage["1w.geo"]` for six hours. The row is written with whatever arrived in
the first 2.5 s, so a slow service never delays a page; when the answer lands later,
`annotate_visit()` fills the same row. Nothing is invented when every provider is blocked:
the row is stored with a null address.

| Column | Meaning |
| --- | --- |
| `visitor_address` | the visitor's IP (`inet`, IPv4 or IPv6) |
| `visitor_location` | the country of that IP — e.g. `Morocco` |
| `visitor_country_code` | ISO-2 code of that country — e.g. `MA` |
| `visitor_page` | the page that was opened (this used to live in `visitor_location`) |
| `member_ip` / `member_location` | the same pair on `member_visits` for signed-in members |

```sql
select visitor_country_code, count(*) as visits
  from public.visitor_visits
 group by 1 order by visits desc;

select visitor_address, visitor_location, count(*) as pages
  from public.visitor_visits
 where visitor_address is not null
 group by 1, 2 order by pages desc limit 20;
```

From the console: `OneW.geo.lookup()` prints `{ip, country, code, city, provider}` and
`document.documentElement.dataset.country` shows the code that was stored. The address is
resolved client-side, so treat it as best effort — a VPN or a blocked provider simply
leaves it empty.

> **Why the counters used to stay empty.** Both `visitor_visits` and `watchtime` are
> protected by RLS with insert-only policies. PostgREST adds `RETURNING` when a request
> asks for `Prefer: return=representation` (which our `rest()` helper did by default), and
> a table without a SELECT policy rejects that — so the whole insert was rolled back.
> Writes now go through the security-definer functions `log_visit`, `finish_visit` and
> `log_watchtime`, and every other insert passes `minimal: true`. If an RPC call still
> fails (proxy, outage, stale schema cache) the client inserts the row straight into
> `visitor_visits` / `watchtime` with `Prefer: return=minimal`, so a page view is never
> lost silently. Assets are linked as `...css?v=<build>` / `app.js?v=<build>` so a
> cached copy of the old tracker cannot keep running after a deploy.

**Checking a visit from the browser.** Load any page, then in the console:

```js
document.documentElement.dataset.visit        // "visit000123" (or "direct-row")
JSON.parse(sessionStorage.getItem("1w.visit")) // the stored visit ids
OneW.visits.start()                            // re-run the tracker on this page
```

and in SQL: `select count(*), max(visitor_start_date) from public.visitor_visits;`

**Ads.** The site tag and the Adsterra popunder live in the `<head>` of `watch.html`; the
1000-minute hook is fired from JavaScript only when the milestone is claimed.

---

## The cast page

`cast.html?id=<TMDB_PERSON_ID>` — one actor, director, writer or producer. The watch page
already links every cast member here (`watch.html` → `.w-person` → `cast.html?id=…`).

| Part | Behaviour |
| --- | --- |
| **Profile** | Portrait, name, also-known-as, biography (clamped with *Read more*), and personal data: birthday **with age**, place of birth, death day, known-for department, IMDb id, the TMDB person id (linked) and when 1World last synced the record. |
| **Fans / Haters / Critics** | Three counts beside the name, computed by `person_reactions` — the numbers themselves are never editable. The three buttons underneath let a member pick a side; pressing the same one again removes it. |
| **Take action** | One button that opens the three dials. |
| **Follow** | A notification (and an Updates row) for every new film or series the person acts in or directs. |
| **Repost** | The same work is published on the member's profile, in their name (`postrecommendation`), and in Updates. |
| **Block** | Hidden from lists, search, recommendations, Updates and sharing. Turning it on switches Follow and Repost off; turning it off never switches them back on. |
| **Movies / TV series** | Two separate reels from TMDB `combined_credits` (job + character merged per title): poster, title, release / first-air date, role, TMDB id, click → `watch.html?movie=ID` or `watch.html?tv=ID`. Loaded 24 at a time (*Show 24 more*), mouse-draggable, touch-swipeable, with arrow buttons. |
| **Reviews / Articles / Videos** | Three tabs fed by `content_person_mentions`, joined to `reviewwatch`, `blogarticle` and `channelsvideo`. A name search over those tables records any new match through `person_mention_add`, so the second visitor gets it from the join. |
| **Official links** | Facebook, Instagram, X, TikTok, YouTube, IMDb, Wikidata and the official site — **only** when TMDB's external ids (or `homepage`) actually contain them. Nothing is guessed; with no ids the panel says so. |

**No TMDB call on every visit.** The first view fetches
`/person/{id}?append_to_response=external_ids,combined_credits` once, renders it and stores
it with `person_save` (`tmdb_people`, `tmdb_person_external_links`, `tmdb_person_credits`,
`last_synced_at`). A later view paints the stored copy first and refreshes it in the
background; if TMDB is unavailable the stored copy stays on screen with a *Showing the
saved copy* toast.

Guests can read everything. Follow / repost / block / reactions need a member — the dials
send them to `login.html?next=cast.html?id=…`.

**Block is not a page switch.** `assets/js/blocks.js` caches `person_block_map(member)` in
`localStorage["1w.blocks"]` and every surface filters through it: the homepage movie and
series reels, the watch page (a blocked title shows a *This title is hidden* panel instead
of the player, and Related & similar drops the person's other works), and the cast page
itself (reels and mentions collapse into the blocked banner). Following or reposting
delivers work in batches of three per visit (`p_limit`) so the first follow of a prolific
actor does not flood the notification feed; `person_work_deliveries` guarantees the same
work is delivered once as a notification and once as a repost.

### Cast tables

| Table | What it holds |
| --- | --- |
| `tmdb_people` | The cached person: `tmdb_person_id` (unique), name, `also_known_as[]`, biography, `profile_path`, department, birthday / deathday, place of birth, gender, popularity, `imdb_id`, `homepage`, `last_synced_at` |
| `tmdb_person_external_links` | Official links only (`network`, `url`, `handle`), one row per network, replaced on every sync |
| `tmdb_person_credits` | One row per person + title + job/character, `media_type` = `movie` / `tv` (no split tables), release date, poster, rating, episode count. Viewing links stay in `movie_links` / `tv_episode_links` |
| `member_person_actions` | The dials: `follow`, `repost`, `block` — one row per member + person |
| `person_reactions` | `fan` / `hater` / `critic`, one row per member + person |
| `content_person_mentions` | Which review / article / video mentions the person (`content_type`, `content_id`), unique per person + item |
| `person_work_deliveries` | Delivery ledger: unique per member + person + work + `delivery_type`, so a notification and a repost for the same work are two rows and can never repeat |

### Cast functions

| Function | What it does |
| --- | --- |
| `person_stats(p_tmdb, p_member)` | Fans / haters / critics plus followers, reposters, blocks and the member's own dials |
| `person_get(p_tmdb)` | The stored person + links + credits (the offline copy) |
| `person_save(p_person, p_links, p_credits)` | Upserts the person, replaces the links, merges the credits, returns how many titles were new |
| `person_action_set(p_member, p_tmdb, p_follow, p_repost, p_block)` | One upsert for the three dials; block forces follow and repost off |
| `person_reaction_set(p_member, p_tmdb, p_reaction)` | Sets, changes or clears a reaction and returns the new counts |
| `person_sync_deliveries(p_member, p_tmdb, p_limit)` | Writes the notifications and the profile reposts, guarded by `person_work_deliveries` |
| `person_mentions(p_tmdb)` | The mentions already joined to the content tables |
| `person_mention_add(p_tmdb, p_type, p_content, p_title)` | Records a match found by the name search |
| `person_block_map(p_member)` | `{people, media}` — the one call every list, search and recommendation uses to filter |

DDL + functions: `tools/sql/cast-page.sql` (migrations `cast_page`, `cast_page_delivery_limit`).

---

## The registration page

`register.html` creates the account and writes **only** to `members` — no separate
registration table, no separate recovery-code table. The form is English, monochrome and
follows the same field/panel language as the rest of the site.

| Field | Rule |
| --- | --- |
| Full name | Required, at least 3 characters and at least one letter |
| Username | Required, unique **case-insensitively**, 3–24 characters (`a–z`, `0–9`, `.`, `_`, `-`), stored as `@handle`, **locked after creation**. The field itself stays free — the `@` is added by the server and echoed under the field (`Your handle: @…`), nothing is drawn on top of the text you type |
| Email | Required, unique after lowercasing and trimming, one account per address |
| Phone number | Required, international format (`+212 612 345 678`), stored as typed |
| Password + confirmation | Required, 8–72 characters, the two must match; sent once to the server and stored as a **bcrypt hash** |
| Date of birth | Required, at least 13 years old, no future dates |
| Country | Required, with a country datalist |
| Terms | Required; the acceptance timestamp is stored automatically |

**What happens on submit.** `member_register()` (SECURITY DEFINER) validates everything
again, checks both uniqueness rules, generates the member code, hashes the password
(`crypt`), creates the recovery code, stores only its sha256 fingerprint and inserts the
row with `status = 'inactive'`. It returns the plain recovery code **once** with the public
account data. A duplicate username or email never reaches the insert — and a race is still
caught by the unique indexes (`unique_violation` is mapped back to the right field).

**Success card.** “Registration complete”, the public **member ID** (`ID100000`) in its own
copyable block, the account details (member ID, full name, username, email, phone, date of
birth, country, status, registration date), the recovery code in a copyable card marked
*shown once*, a **Download details (.txt)** button that builds `ONEWORLD-<username>.txt` in
the browser (there is no server copy of that file), and a **Log in** button. The password never appears on the success card, in the file or in
storage; the form's password inputs are cleared as soon as the account exists.

**Log in after registration.** The button asks `member_status()` for the account:
- inactive → an inline notice says the account is waiting for activation (no navigation);
- active → `login.html?username=…` (plus `?plan=` when the visitor came from a pricing card).

**Recovery code.** `OW-XXXX-XXXX-XXXX`, generated from 12 random bytes with an alphabet
that avoids `I`, `O`, `0` and `1`. Only `recovery_code_hash` (sha256 hex) is stored, and
the code is never written to `localStorage`/`sessionStorage`. Leaving the success card
while it is unsaved triggers the browser's “leave page?” warning.

### Columns added to `members`

| Column | Type | Note |
| --- | --- | --- |
| `member_id` | text | the public site ID, `ID` + at least 6 digits (`ID100000`); generated by the `members_member_id_seq` default, unique and immutable (the guard rejects edits) |
| `full_name` | text | shown on the success card and in the .txt |
| `phone_number` | text | as typed, with the country code |
| `birth_date` | date | 13+ check enforced server-side |
| `country` | text | free text with a datalist |
| `terms_accepted` | boolean | default false |
| `terms_accepted_at` | timestamptz | stamped by the trigger |
| `account_status` | text | generated mirror of `status` for readers that expect this name |
| `account_activated_at` | timestamptz | stamped the moment `status` becomes `active` |
| `recovery_code_hash` | text | sha256 of the code, never the code |
| `last_login_at` | timestamptz | reserved for the Auth-backed sign-in |

`password_hash` already existed and now receives the bcrypt hash. `username` is protected by
a `members_guard` trigger that rejects any change (`42501`), so the “username cannot be
changed” rule holds even for a direct SQL update. Unique indexes
`members_username_lower_key` and `members_email_lower_key` back the two uniqueness rules.

### Functions

| Function | What it does |
| --- | --- |
| `member_register(full_name, username, email, phone, password, birth_date, country, terms)` | Validates, checks uniqueness, creates the inactive row, returns `{ok, recovery_code, member}` |
| `member_check(username, email)` | Live availability for the form (case-insensitive) |
| `member_status(login)` | Username **or** email → `{found, member_id, status, username}` only |
| `member_recovery_code()` | `OW-XXXX-XXXX-XXXX` generator (service role) |

DDL + functions: `tools/sql/register-page.sql` (migration `registration_page`) and
`tools/sql/member-public-id.sql` (migration `member_public_id`, the public member ID). The
table itself stays closed to `anon` — RLS still only allows a signed-in member to read/update
their own row, so registration cannot be bypassed with a direct REST insert.

**The member ID.** `member_register()` never invents it in JavaScript: the column default
calls `members_member_id_seq`, so the ID exists the instant the row is inserted, is unique by
constraint and matches `^ID[0-9]{6,}$`. It is returned with the account, shown on the success
card (with a copy button) and written into the .txt as `Member ID: ID100000`. The sequence
starts at 100000 so every ID is at least six digits, and `members_guard` refuses any change
to it (`42501`) exactly like the username.

**Password storage.** The publishable key cannot create Supabase Auth users, so the password
is hashed server-side into `members.password_hash` (bcrypt, cost 10) and `auth_user_id`
stays free for the Auth-backed sign-in. No plaintext password is stored anywhere, and the
RPC never returns it.

`tools/register-smoke.mjs` covers the page end to end in jsdom: empty submit, password
mismatch, terms, live availability, a rejected duplicate, a successful registration, the
success card, the .txt export (content, filename, mime type) and both login branches.

---

## Sounds

Played from the public `source` bucket of the Supabase project:

```
https://vtbqbhuywdhnvitbcsfy.supabase.co/storage/v1/object/public/source/sound/<file>.mp3
```

| File | When it plays |
| --- | --- |
| `add-point.mp3` | points are added → banner at the top of the page |
| `success.mp3` | a form or an action succeeds |
| `erorr.mp3` | an error or a rejection |
| `uplevel.mp3` | the member reaches a new level |
| `purchase.mp3` | points are spent |
| `notefcation.mp3` | a new notification arrives |

Browsers block audio until the first interaction, so the pool is unlocked on the first
click/keypress. Members can mute the interface from the sidebar.

---

## Data sources

**Supabase** — `https://vtbqbhuywdhnvitbcsfy.supabase.co` with the publishable key, called
through the REST endpoint only (no SDK, no build step). Tables used on this page:

| Table | Purpose on the homepage |
| --- | --- |
| `members` | points, `level`, `membership`, `avatar_url`, `username` (never public — see RLS) |
| `members_public` (view) | safe, non-sensitive member columns for public profiles |
| `notifications` | bell panel (`title`, `subject`, `read_or_unread`, `created_at`) |
| `features` | feature grid, ordered by `display_order` |
| `apps` (or `app_versions`, `versions`) | download links per system |
| `iptvfree` / `iptvpremium` | channel reels, most-watched first (`channel_views_per_minute`) |
| `messages` | the support / contact form writes here as an anonymous visitor |

Column names are read defensively (`feature_title` **or** `title`, `id_member` **or**
`member_id`, …), so small schema differences will not break the page.

### The live schema

The project already contains the full schema (migrations `core_schema`,
`rls_policies_and_public_api`, `seed_catalogue`, `alias_iptvpremuim_view`):

| Table | What it holds |
| --- | --- |
| `members` | account row: `member_code` (6 digits), `username` (`@handle`), `email`, `status`, `level` 1‑10, `membership` free/silver/gold/diamond, `points`, `viewing_codes_limit`, avatar/cover |
| `profiles` | public profile (same `id` as the member, created by a trigger) |
| `profile_follows` | follower graph, counts kept in sync by trigger |
| `notifications` | per-member inbox (`id_member`, `source`, `title`, `subject`, `read_or_unread`) |
| `points_ledger` | every credit/debit with `delta` and `balance_after` |
| `viewing_codes` | 6‑digit codes, capped per member by `members.viewing_codes_limit` |
| `sessions` | token hashes, 30‑day expiry, revocation |
| `visitor_visits` / `member_visits` | traffic and dwell time |
| `messages` | support/contact messages (anonymous insert allowed) |
| `features` | homepage feature cards |
| `apps` | one row per OS version, with download counters |
| `channels` | master channel registry |
| `iptvfree` / `iptvpremium` | the two channel reels shown on the homepage |

### Watch-page tables

| Table | What it holds |
| --- | --- |
| `watchlink` | Player sources: `idtmdb`, `media_type`, season/episode, site name + logo, URL, quality (SD…8K), audio, subtitles, ads flag, `is_hidden` (hide the URL), `publisher_id` (null = platform), clicks |
| `watchtime` | Seconds watched, per member, publisher, title and source; `is_eligible` is false when an ad blocker was detected |
| `hestory` | Resume / history points per member and episode |
| `comment` + `comment_reaction` | Threads keyed by `location` (`movie:1399`, `tv:1399:season:1:episode:1`), agree / disagree counters kept by trigger |
| `content_reaction` / `watch_later` | Like-dislike per title and the watch-later list |
| `playlists` + `playlistmovie` / `playlisttv` | Playlist identity (name, visibility, owner, `system_kind` for completed/later/not-interested) and its items |
| `reportlink` | Reports: broken, misleading, harmful, other |
| `prizeavilable` | Published prizes with points cost and expiry |
| `channelsvideo`, `blogarticle`, `spaceanswer`, `libraryducment`, `reviewwatch`, `postrecommendation` | Member content matched by title / keywords, sorted by watched minutes |
| `taskimpretion`, `taskclick`, `taskcomplet` | Offers-network events; a completion stores payout + points once |
| `watch_code_devices`, `watch_sessions`, `member_milestones` | Device binding for viewing codes, playback sessions, and the 1000-minute milestone |

SQL for all of it lives in `tools/sql/watch-page.sql`.

Functions: `content_stats(location)`, `content_minutes(idtmdb, type)`,
`member_watch_minutes(member)`, `verify_watch_code(code, device, member)`,
`claim_milestone(member, milestone)`, plus the write path `log_visit(...)`,
`finish_visit(...)` and `log_watchtime(...)`.

Traffic lands in `visitor_visits` / `member_visits` (`visit_id`, visitor id, referrer,
page, frequency, purpose, source, duration, start/end).

`iptvpremium` is the real table name; a read-only view called **`iptvpremuim`** keeps the
original spelling working.

**Row Level Security is on for every table.** Anonymous visitors (the publishable key) can
read published `features`, `apps`, `channels`, `iptvfree`, `iptvpremium`, public
`profiles` and `members_public`, and can *insert* a `messages` row. Everything member
specific (`members`, `notifications`, `points_ledger`, `sessions`, `viewing_codes`,
`member_visits`) is readable only by that member's authenticated session. The helper RPC
`member_notifications(member_id, limit)` returns an inbox without exposing the table.

Points are never written by hand: inserting into `points_ledger` updates
`members.points` and stamps `balance_after` in the same transaction.

**TMDB** — trending films/series with the provided API key. If TMDB is unreachable, the
page falls back to a curated local catalogue and generates monochrome typographic
posters with inline SVG, so the layout is never empty.

If a Supabase table is missing or RLS blocks anonymous reads, that section quietly falls
back to local editorial content — nothing errors in the console.

---

## Wiring the account pages

`assets/js/session.js` is the only place that owns the session. When `login.html` /
`register.html` authenticate, hand the member over:

```js
import { setMember } from "./session.js";
setMember({ id, username, level, points, membership, avatar });
```

The header, sidebar, wallet and IPTV locks update immediately. `signOut()` clears it.

Points can be credited from any page with:

```js
OneW.awardPoints(120, "Review published"); // banner + add-point.mp3
```

The wallet also polls the `members` row every 45 s while a member is signed in, so points
added server-side show up with the banner and the sound automatically.

**Preview helper:** open the console and run `OneW.demoSignIn()` to see the signed-in
state locally (no server call). `OneW.signOut()` returns to the guest view.

---

## Structure

```
index.html                  homepage
*.html                      one placeholder page per planned route (nav never 404s)
assets/css/base.css         tokens, themes, typography, buttons, forms
assets/css/layout.css       header, notifications, sidebar, footer
assets/css/components.css   hero, rails, cards, pricing, IPTV, apps, toasts
assets/js/config.js         Supabase, TMDB, plans, navigation, platforms
assets/js/data.js           REST + TMDB clients, schema mapping, fallbacks
assets/js/session.js        visitor id, member session, change detection
assets/js/wallet.js         points + level rendering, polling, awardPoints
assets/js/notifications.js  bell panel with Now/Hour/Today/Yesterday/Week filters
assets/js/shell.js          header + sidebar + footer templates and behaviour
assets/js/home.js           homepage sections
assets/js/app.js            entry point, mounts the shell on every page
assets/js/visits.js         visit row + dwell time (IP, country, page)
assets/js/geo.js            visitor address / country lookup (cached 6 h)
assets/js/ui.js             toasts (+points banner, level-up)
assets/js/sound.js          audio pool and mute state
assets/js/icons.js          line icon set + brand glyphs (brands.js)
assets/js/blocks.js         blocked people/media cache used by every list
assets/css/cast.css         cast page (profile, dials, reels, mentions)
assets/js/cast.js           cast page controller (TMDB + person_* RPCs)
assets/css/register.css     registration form + success card (high-contrast, both themes)
assets/js/register.js       registration controller (member_register RPC, .txt export)
tools/build-pages.mjs       regenerates the placeholder pages
tools/smoke.mjs             jsdom smoke test (renders the homepage offline)
tools/watch-smoke.mjs       jsdom watch page test (player, gates, watch-time)
tools/cast-smoke.mjs        jsdom cast page test (guest + member dials)
tools/register-smoke.mjs    registration test (form, duplicates, member ID, success, .txt)
tools/visit-smoke.mjs       visit tracker test (5 modes)
```

Regenerate the placeholder pages after editing the list in `tools/build-pages.mjs`:

```bash
node tools/build-pages.mjs
```

---

## Light & dark mode

Both modes are complete — every surface, card, form, toast, hero overlay and media
treatment is themed, not just the background.

- **First visit** follows the operating system (`prefers-color-scheme`), and keeps
  following it live until the visitor chooses a side.
- **Switching** is available in two places: the sun/moon button in the header and the
  Dark/Light control at the bottom of the sidebar (always reachable from the menu on
  phones). The choice is stored in `localStorage` under `1w.theme`.
- The decision is applied by an inline script **before first paint** (no flash), and the
  browser chrome follows via `theme-color` and `color-scheme`.
- Artwork keeps its **real colours** in both modes — posters, backdrops, cast photos and
  channel logos are only lightly graded (`--art-filter`, `--hero-art-filter`), so a light
  theme never washes them out and a dark theme never drains them.
- Poster cards fade in once the bitmap is ready (`.pcard__img` → `.is-loaded`), which is
  why every generated image carries an `onload` hook.
- The switch triggers a short 300 ms colour transition so the change reads as deliberate.

Logic lives in `assets/js/theme.js` (`initTheme`, `setTheme`, `toggleTheme`,
`resetTheme`, `systemTheme`). Call `OneW.theme.reset()` from the console to fall back to
the operating system preference.
