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
| **Sidebar** | Left rail that is **pinned or waiting on the screen edge**. Visitor or member card (`Visitor - 482913` / `Member - 000482`), level meter, then the full site map: Search · Watch · Browse · Earn · Pages. The pin is remembered. |
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

## The creator page, drawn as a channel

`creator.html` keeps its console — the rail, the *Managing* picker, the tabs, the tables — and
wears the reference channel's head. The hub being managed now opens on **a cover banner** (its own
`cover_url`, greyscale behind a scrim; a plain gradient when it has none), with the kind and the code
over it, and **a round mark of 58–84px** that sits half on the banner, the studio's name at
`clamp(1.25rem, 2.4vw, 1.75rem)` weight 800 under it, its field and niches on one line, and the numbers
as pills — visibility, subscribers, items, minutes, likes, reports, the figure bold and the word quiet.
The tabs are the reference's toolbar: outlined chips in a bar that scrolls sideways on a phone, the
one you are in filled (`--text` on `--bg`).

**A studio's own page** (`creator.html?studio=IDST100001&creator=ID100019`) is the reference channel
itself: the cover is the head — `clamp(210px, 30vw, 330px)` of the hub's `cover_url` (a plain gradient
when it has none), greyscale under a scrim, with the mark, the name at `clamp(1.5rem, 3.2vw, 2.1rem)`
and the buttons standing on its lower edge; the pills and the description sit under it on the card.
Its shelf cards are the reference's video card: a 16:9 still with the minutes in a dark chip on the
leading edge, the play disc on hover, a two-line title, the studio's name, then views and the date —
the whole card lifting 2px and taking a border when the pointer is on it. The public hub's cards are the reference's video card —
16:9 still, kind line, two-line title, two-line summary, facts row — lifting 3px on hover. A creator's
own page (`creator.html?creator=`) gets the same banner and mark, then its name, handle, where, tags,
bio, actions and totals. Nothing is invented: no `cover_url`, no banner image; no field, "No field yet".

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
| Player | Poster + play button + duration. Play opens the **30-second sponsor gate**: the countdown starts when the sponsor link is opened, runs on a stored deadline (so a background tab, a throttled timer or a redirect inside the sponsor page cannot stop it), resumes after a reload and ends only when the window is closed. When it reaches zero `vidsrc.sh/embed/…` loads and the ledger starts. |
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
| Play was pressed **and the sponsor countdown has finished** (`state.adCleared`) | the gate, the countdown, a reload mid-countdown — the player cannot open, let alone count, before it ends |
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

**The sponsor countdown is a deadline, not a tally of ticks.** `state.adDeadline` holds the
instant the 30 seconds end (`Date.now() + 30 000`), and every beat of the 250 ms timer *reads*
it instead of adding a second — so a tab the browser throttled for a minute finishes the count
the moment it is looked at, instead of starting over. The deadline is written to
`sessionStorage` under `1w.ad.gate` (one ticket per film or episode), which means:

| Event | What happens to the count |
| --- | --- |
| A second tab opens (the sponsor link) | nothing — the ticket is this tab's, the clock keeps running |
| The sponsor page redirects somewhere else | nothing — it has its own document, this one is untouched |
| The tab is backgrounded, throttled or frozen | nothing — the next beat reads the deadline and catches up |
| The page is reloaded | it **resumes** from the ticket, it never goes back to 30 |
| The countdown was already finished here | the next Play opens the player directly |
| The window is closed | the ticket dies with `sessionStorage`, which is the only thing that stops the clock |

`state.adCleared` is set by the countdown alone, and `isCounting()`, `startPlayer()` and
`renderLimitNote()` all read it: the player cannot mount and the ledger cannot tick while the
sponsor gate is up. Before it ends the line under the player reads
`Watch time starts when the sponsor countdown ends · this title counts up to 132 min.`

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

## The login page

`login.html` signs a member in with **one field for the account** — member ID (`ID100042`),
username (`@youssef.amrani` or `youssef.amrani`), member code (`000042`) or email — plus the
password, a **stay signed in** checkbox, the *Forgot password?* / *Create account* links and
the **Log in** button. The whole check happens in the database; the page only renders the
answer.

Under the button there is a second door: **Continue with Google** (and a button per network
once its app is complete) signs a member in through an account they already linked in Account
settings — no password. Only linked accounts are let in; see **Signing in with a linked
account**.

### What happens on submit

1. `member_login(login, password, remember, ip, agent)` resolves the account with one
   case-insensitive lookup over `member_id`, `member_code`, `username` (`@` optional) and
   `email`.
2. It builds a session with the bcrypt hash: `crypt(password, password_hash) = password_hash`.
   A wrong password is checked **before** the account state, so a wrong secret never learns
   whether the account exists, is inactive or is banned.
3. It reads `status` / `account_status` from `members`. An `inactive`, `banned` or `expired`
   account **still signs in** — the state comes back as `restricted: true` and the page shows
   it as a notice instead of a password screen.
4. It writes one row in `sessions` (token hash, method, IP, user agent, remember flag,
   expiry), stamps `members.last_login_at`, and appends `login_success` + `session_created`
   (plus `login_restricted` when the account is not active) to `log`.
5. The browser receives the **plain token once** and stores it in `localStorage` when *stay
   signed in* was ticked (30 days) or in `sessionStorage` otherwise (12 hours). The table
   only ever holds `sha256(token)`.

| Situation | What the member sees |
| --- | --- |
| Correct details, active account | Signed-in card: avatar, username, member ID, session details |
| Wrong password | “That password is not correct.” under the field and in the alert |
| No such account | “No account matches those details.” |
| **Inactive account** | Signed in, status chip `Inactive`, notice “Your account is not activated yet…” with the auto-ban deadline |
| **Banned account** | Signed in, status chip `Banned`, notice “This account is banned… appeal” |
| **Expired account** | Signed in, status chip `Expired`, notice “This account has expired…” |
| Stored session token rejected | The token is dropped and the form is shown again |

**Signed-in card.** Avatar (the member's `avatar_url` or the generated placeholder),
`@username`, the member ID chip, the account status, a detail list (member ID, username,
email, level, membership, sign-in time, when the session ends, stay-signed-in state) and the
three actions the page is for: **Profile** → `profile.html`, **Dashboard** →
`dashboard.html`, **Log out**. When the account is not `active`, a dashed **restriction
notice** sits above the details (with the 30-day ban deadline for inactive accounts); the
card and the three buttons stay exactly the same. When the visitor arrived from another page
(`login.html?next=cast.html?id=287`) a **Continue** button points back there; only same-site
`*.html` targets are accepted. The header, sidebar and wallet update immediately through
`setMember()`.

**Log out.** `member_logout(token)` marks the session `ended` (with `logged_out_at`),
appends `logout` to `log`, the token is deleted from storage and `signOut()` clears
`1w.member`. Signing out is therefore server-side, not cosmetic.

### The three tables

| Table | Role in sign-in |
| --- | --- |
| `members` | identity + `password_hash` (bcrypt) + `status`/`account_status` + `last_login_at` |
| `sessions` | one row per sign-in: `session_id`, `member_id`, `session_token_hash` (sha256, generated from `token_hash`), `login_method`, `ip_address`, `user_agent`, `remember_me`, `session_status` (`active`/`ended`/`revoked`/`expired`), `created_at`, `last_activity_at`, `expires_at`, `logged_out_at` |
| `log` | append-only audit trail: `log_id`, `member_id`, `session_id`, `action`, `action_details` (jsonb), `ip_address`, `user_agent`, `created_at` |

`sessions` keeps its original columns (`user_id`, `token_hash`, `last_seen_at`,
`revoked_at`) for compatibility and adds the spec ones on top; `user_id` and `member_id`
both point at the member row.

**What is written to `log`:** `login_success` (with the account status), `login_failed`
(reason `password` or `not_found`), `login_restricted` (an inactive/banned/expired account
signed in), `session_created`, `session_expired`, `session_revoked`, `logout`,
`account_banned`, `account_updated` (field names only — a trigger on `members`) and anything a
page reports through `member_log(token, action, details)`. Passwords, hashes and tokens are
never written.

**Nobody can edit the trail.** `log` and `sessions` have RLS enabled and **no policies**, so
`anon`/`authenticated` cannot read, insert, update or delete a single row; everything goes
through the security-definer functions. That is also why logins can only be created
server-side.

### Functions

| Function | What it does |
| --- | --- |
| `member_login(login, password, remember, ip, agent)` | Resolves the account, checks the hash, reads the status, creates the session (+ `login_restricted` when the account is not active), writes the log rows |
| `member_session(token)` | Restores a session from its token and touches `last_activity_at`; non-active accounts keep their session and come back with `restricted: true` |
| `member_logout(token)` | Ends the session and logs it |
| `member_log(token, action, details)` | Appends an action for the signed-in session |
| `member_sweep_inactive()` | Bans accounts that stayed inactive for 30 days (called on every login attempt; service role) |
| `member_payload(m)` | The public shape of a member — never the hashes |

**Restriction policy.** Login is *open*: any account that knows its password gets in, and the
state (`inactive` / `banned` / `expired`) is shown rather than used to block the door. The gate
lives in one place — the `if v_row.status is distinct from 'active' then v_restricted := true`
block of `member_login()` — so switching back to a hard block is a single, readable edit (return
`jsonb_build_object('ok', false, 'error', 'inactive')` from that branch).

**30-day rule.** `member_sweep_inactive()` is invoked at the start of every `member_login()`,
so any account still `inactive` 31+ days after `created_at` becomes `banned` (with an
`account_banned` log row) the next time anyone signs in. No cron job required.

**Activating an account** (there is no admin UI yet — this is the SQL the operator runs):

```sql
update public.members set status = 'active' where member_id = 'ID100042';
```

DDL + functions: `tools/sql/login-page.sql` (migrations `login_page`,
`login_handle_lookup`, `login_password_before_status`, `login_digest_search_path`,
`member_ip_lenient`, `members_log_fields_fix`).

`tools/login-smoke.mjs` runs the page four times in jsdom: a fresh visitor (prefill, empty
submit, wrong password, unknown account, then sign-in for an inactive account, a banned
account and an active one — each reaching the signed-in card — plus log out), a returning
visitor whose stored token is restored through `member_session()`, a visitor whose token is
no longer accepted, and a restored session for an inactive account (notice shown).

---

## The recovery page

`rest.html` gets a locked-out member back in. It was asked for in three steps and it stays in
three steps — each **Next** only moves on once the step in front of it has answered:

1. **Email and phone.** Both are typed and both must belong to the same row of `members`;
   the phone is compared on its last nine digits, so `+212 6 12 34 56 78` and
   `0612345678` are the same number. The pair is matched by `recovery_start()`, which also
   **issues the code** and sends it.
2. **The recovery code.** `OW-XXXX-XXXX-XXXX`, typed in any case, with or without the dashes.
   `recovery_verify()` compares its sha256 fingerprint with `members.recovery_code_hash` and,
   on a match, hands back a **ticket** good for twenty minutes. Five wrong codes lock the
   account for thirty minutes; a code that was never requested, or one that has expired,
   is refused with its own message.
3. **The new password.** `recovery_reset(ticket, password)` stores the bcrypt hash, **closes
   every open session**, and — the part the flow insists on — **mints a new recovery code**,
   because the one that was just used is spent. The page shows the account, the fresh code
   and the recovery link again, with **copy** buttons and the **.txt download**, exactly as
   the registration card does.

### The recovery link

`rest.html?recovry=OW-XXXX-XXXX-XXXX` is the same secret in URL shape. The parameter is
spelled `recovry` because that is how it was specified; `recovery=` and `code=` are accepted
too, and so is a whole link pasted into the code field. The link is registered as
`recovery_link()`: it looks the code up across `members` and opens the page **at the password
step**, with the account details already on screen. The code is saved at registration —
`register.html` now prints the code **and** the link, and the `.txt` carries both.

Because a link can outlive the thirty minutes of a mailed code, `recovery_link()` ignores
`recovery_expires_at` and honours only a lock. Every use still rotates the code, so an old
link dies the moment a new one is minted.

### The device path — no code at all

The second way in, for a member who has lost the code: **full name + phone + email + the
device's original viewing code**.

The rule the flow follows is the one the site already obeys: **the code created when a device
was activated belongs to that device for good** — it cannot be unlinked, and it is called the
device's *original* code. The other codes on the account may be linked to other devices, and
unlinked again. So `recovery_device()` accepts the original code of **this** device and
nothing else:

- the device is the shared `1w.device` id (`assets/js/device.js` — one module for the wizard,
  the player, the dashboard and this page, always MAC-shaped `9E:3D:EB:E8:B8:50`);
- the comparison is normalised on both sides (`recovery_device_key`: upper case, letters and
  digits only), so `9e:3d:eb:e8:b8:50`, `9E-3D-EB-E8-B8-50` and `9E3DEBE8B850` are one device;
- the code has to be the one whose `viewing_codes.device_mac` — or its `watch_code_devices`
  row — carries that id;
- the full name is compared as a **set of words** (`recovery_name_key`), so
  `EL MEHDI MOUAOUINE` and `Mouaouine,  El-Mehdi` are the same person;
- the phone is still the last nine digits.

**One device, several accounts.** Two accounts can be activated on the same browser, so the
device id alone never decides whose code it is: **the code decides the account**, and name,
phone and email only confirm it. When the code is this device's own, a mismatch comes back as
`identity` with the `field` that is off and the `username` of the account it belongs to
(`{"error":"identity","field":"email","username":"@ledsizar"}`), and the page puts the error
on that field. When the code is real but belongs to another device, the answer depends on who
is asking: the holder who also fits the account gets `device_not_bound` / `other_device`, and
anyone else gets the same flat `view_code` as for a code that does not exist — a code cannot
be probed for existence with a random six digits.

The panel carries a **Check this device** button. `recovery_device_status(name, phone, email,
device)` answers with the accounts this browser holds original codes for, and for each one a
verdict per field:

```json
{ "device": true, "bound": true, "accounts": 2, "identity": false,
  "matches": [
    { "username": "@jhon007",  "name": false, "phone": false, "email": false },
    { "username": "@ledsizar", "name": true,  "phone": true,  "email": false } ] }
```

No code, no password and no device ever comes back. From that the page can say the useful
sentence instead of a shrug — *"this device holds the original code of @ledsizar, and the email
address is the only field that does not match it"*. The path ends the same way as the others:
new password, new code, details to download.

### Delivery: the Google Apps Script, WhatsApp and the bot

The code leaves the database through `recovery_send()` and `pg_net`, never through the
browser — and **every configured channel carries the same code**, so a dead mailbox does not
close the account:

| Channel | Where it goes | What it needs in `site_secrets` |
| --- | --- | --- |
| Email | the member's email, sent by a Google Apps Script web app | `gs_mail_url`, `gs_mail_token`, optional `gs_mail_cc` |
| WhatsApp | the member's phone, through Meta **WhatsApp Cloud API** — the same web app posts it | `gs_mail_url`, `gs_mail_token`, optional `whatsapp_cc` |
| Telegram | `sendMessage` to the chat the member **linked** (or `members.telegram_chat_id`) | `telegram_bot_token` — see the bot below |

WhatsApp is dialled, not mailed: `whatsapp_number(phone, country, default_cc)` turns whatever
was typed — `0668313718`, `+212 668-313718`, `00212668313718` — into E.164 digits
(`212668313718`). A number that arrives with a `+` or `00` already carries its country code
and is left alone (an Andorran `+376` number must not become Moroccan); a local number takes
the member's own country — English **or** Arabic name, or ISO code — and falls back to
`site_secrets.whatsapp_cc` (then `212`) when the country is not recognised. A number that
cannot be read is logged `skipped` with the reason, and the other channels still go.

**"Queued" is not "delivered".** `pg_net` is asynchronous: by the time the web app answers, the
transaction that issued the code has committed. Two small functions close that gap. Every send
fires a `doGet` heartbeat (`delivery_probe()`) and reads the **previous** answer
(`delivery_probe_read()`) into `delivery_channels`, so the next recovery knows what this
deployment can actually carry — a channel the script has no credentials for is reported `false`
and logged `skipped`, instead of promising a WhatsApp message nobody sent. And
`recovery_delivery_reconcile()` joins the queued rows to `net._http_response` and turns them into
`sent` or `failed` **with the script's own words** (`token`, `whatsapp not configured`,
`chat not found`…); `recovery_send()` runs it before every new code, so the log stays honest
without a cron job.

`site_secrets` has RLS on and **no policies** — only the `security definer` functions read
it, so neither the endpoint nor the bot token can be fetched with the publishable key. Each
send writes a row in `recovery_delivery` (channel, masked target, status, `pg_net` request
id, error) and the whole flow writes to `log` (`recovery_request`, `recovery_verified`,
`recovery_link_used`, `recovery_reset`, `recovery_failed` with its reason).

The script's `SHARED_TOKEN` property and the `gs_mail_token` secret are one pair: change one and
the other stops matching, and the log says so (`failed` with `{"ok":false,"error":"token"}`). Script
properties are read at run time, so changing them needs **no new deployment** — only the code does.

The script lives in the repo: `tools/apps-script/recovery-delivery.gs`. It is one web app
with three channels — `channel: "email" | "whatsapp" | "telegram" | "all"` — and the database
calls it once per channel. Deploy it once (script.google.com → Web app → *Execute as: me*,
*Access: anyone*), fill **Project Settings → Script properties**, then store the URL:

```sql
insert into public.site_secrets (key, value)
values ('gs_mail_url',  'https://script.google.com/macros/s/XXXX/exec'),
       ('gs_mail_token', '<the same SHARED_TOKEN as in the script>')
on conflict (key) do update set value = excluded.value, updated_at = now();
```

| Script property | Meaning |
| --- | --- |
| `SHARED_TOKEN` | **must equal** `gs_mail_token`, or every call answers `{"ok":false,"error":"token"}` |
| `FROM_NAME` | the sender name on the email (`1World`) |
| `CC` | optional copy of every mail, the operator's address while the flow is new |
| `WHATSAPP_TOKEN` | Meta **permanent** access token |
| `WHATSAPP_PHONE_ID` | the *Phone number ID* of the sender (not the phone number) |
| `WHATSAPP_TEMPLATE` | the approved template name; empty → plain text |
| `WHATSAPP_LANG` | the template's language (`en`) |
| `TELEGRAM_BOT_TOKEN` | only if you also want Telegram to leave through the script |

WhatsApp only delivers a **business-initiated** message through an approved template. Submit
one (category *Utility*) with the body

```
1World recovery code: {{1}}. It is valid for 30 minutes and works once.
```

put its name in `WHATSAPP_TEMPLATE`, and the script fills `{{1}}` with the code. While the
template is unapproved (or if the name is wrong) the script retries as plain text — that only
lands inside a 24-hour conversation window — and the answer says `mode: "text (template
failed: …)"` instead of pretending.

Open the `/exec` URL in a browser for a heartbeat: it lists which channels that deployment is
configured for and prints no secret. `testSend()` and `checkSetup()` in the editor do the same
without the web app. When the script changes, **Manage deployments → Edit → Version: New** —
the `/exec` URL then keeps working and serves the new code; a bare *Save* changes nothing for
the database.

A separate WhatsApp gateway (Ultramsg, Green API, CallMeBot…) can be used instead: set
`whatsapp_url` to its endpoint and `whatsapp_token` to its token, and the database will post
the same JSON (`channel`, `to`, `code`, `text`, `name`, `member`) there.

#### The WhatsApp webhook

Meta's console asks for a **callback URL** and a **verify token** before it will tell you
anything about a message it was handed. That endpoint is an edge function in this repo:
`supabase/functions/whatsapp-webhook/index.ts`.

| In the Meta console | Value |
| --- | --- |
| Callback URL | `https://vtbqbhuywdhnvitbcsfy.supabase.co/functions/v1/whatsapp-webhook` |
| Verify token | the edge secret `WHATSAPP_VERIFY_TOKEN` |
| Webhook fields | **messages** (statuses and inbound messages arrive together) |

It answers two different calls:

* **GET** `?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…` — the console saving the
  URL. The challenge goes back as **plain text**, and only when the token matches; anything
  else is `403 forbidden`, so a stranger cannot confirm the endpoint.
* **POST** an event. Every `statuses[]` (`sent` → `delivered` → `read`, or `failed` with a
  code and a title) and every `messages[]` (somebody wrote to the business number) is stored in
  `whatsapp_events`. A status is then pushed onto the `recovery_delivery` row that carries the
  same WhatsApp message id (`external_id`, filled by `recovery_delivery_reconcile()` from the
  script's answer), so the log can finally say **delivered** — something `pg_net` can never
  learn by itself. `recovery_whatsapp_status()` ranks the statuses, so a late `sent` never
  undoes a `read`.

When `WHATSAPP_APP_SECRET` is set, `X-Hub-Signature-256` (HMAC-SHA256 of the raw body) must
match or the request is dropped — set it, it is the only thing that proves the caller is Meta.
`whatsapp_events_recent(20)` shows what arrived. Deleting the events costs nothing; they are
not used by any page.

Deploy it with `verify_jwt: false` — Meta has no Supabase JWT — and redeploy after every change
to the file:

```bash
supabase functions deploy whatsapp-webhook --no-verify-jwt
```

While the Meta app is **unpublished**, the console only sends the test events you trigger from
the dashboard; real member statuses start once the app is live.

#### Going live on WhatsApp

The console hands you a **test number** and a token that expires in 24 hours. That is enough to
prove the integration, not to run it:

| Step | Where | Why |
| --- | --- | --- |
| Add up to **5 recipient numbers** | WhatsApp → API Setup | the test number can only write to numbers verified there |
| Add **your own number** | WhatsApp → API Setup → *Add phone number* | it gets its own **Phone number ID**; the test number must not be used for members |
| Create the **Utility template** | WhatsApp Manager → Message templates | a business-initiated message needs an approved template |
| Substitute the token | Business settings → Users → **System users** | a system user token with `whatsapp_business_messaging` does not expire in 24 hours |
| Subscribe the field | WhatsApp → Configuration → Webhook fields | the URL is verified, but nothing arrives until **messages** is ticked |

`whatsapp_business_messaging` is the permission that sends; `whatsapp_business_management` reads
templates, numbers and webhook subscriptions; `business_management` reaches the assets. The other
three on that page (`email`, `public_profile`, `manage_app_solution`) have nothing to do with this
flow.

Business verification is **not** a prerequisite to start: without it a business can reply to
unlimited user-initiated conversations and open up to **250 new conversations per rolling 24h**
(and register two numbers). It becomes necessary to raise that ceiling, and App Review of
`whatsapp_business_messaging` is what a provider messaging *on behalf of other businesses* needs —
a single business sending to its own members does not.

The Telegram bot is **Cineaura** (`@cineaura2bot`). It is an edge function, not a polling loop,
and it links a chat to an account instead of to the site:

```bash
supabase functions deploy telegram-bot --no-verify-jwt
supabase secrets set TELEGRAM_BOT_TOKEN=<token from @BotFather> \
                     TELEGRAM_WEBHOOK_SECRET=<openssl rand -hex 16>
```

```sql
-- once: point Telegram at the function, and drop whatever was queued while it was offline
select net.http_post(url := 'https://api.telegram.org/bot'
  || public.site_secret('telegram_bot_token') || '/setWebhook',
  body := jsonb_build_object(
    'url', 'https://<project>.supabase.co/functions/v1/telegram-bot',
    'secret_token', '<the same TELEGRAM_WEBHOOK_SECRET>',
    'allowed_updates', jsonb_build_array('message'),
    'drop_pending_updates', true));
select content::text from net._http_response order by id desc limit 1;
```

The member presses **Connect** beside Telegram in **Account settings**, and the panel hands them
`https://t.me/cineaura2bot?start=<code>`. `/start <code>` writes the chat id to
`member_identities` (and to `members.telegram_chat_id`), so the bot answers “Linked” without the
site ever seeing the chat. `/stop` unlinks it again, `/id` prints the chat id for support, and
anything else gets help in Arabic and English. Every request must carry
`X-Telegram-Bot-Api-Secret-Token`, so a stranger who learns the function URL can do nothing.

While a webhook is registered `getUpdates` answers `409 Conflict` — that is why the old polling
recipe is gone. Read the **edge function logs** instead (`supabase functions logs telegram-bot`).
`telegram_chat_id` in `site_secrets` is no longer a fallback: a member's code must never land in
the operator's chat. `telegram_bot_username` is optional (it defaults to `cineaura2bot`).

`gs_mail_cc` is an optional copy — the operator's own address, so a test recovery can be
read while the script is still new. Remove the row when the mailer is trusted:

```sql
delete from public.site_secrets where key = 'gs_mail_cc';
```

Telegram and WhatsApp reach the **member's own** chat: `recovery_send()` reads
`members.telegram_chat_id` / `member_telegram_chat(member)` and
`member_whatsapp_number(member)` (falling back to the sign-up phone), and nothing site-wide.
`members.recovery_last_channel` records which channels actually took the code. If none is
configured the code is still issued and every `channels` flag (`email`, `whatsapp`, `telegram`)
comes back `false`, so the page says so instead of pretending.

### Functions

| Function | What it does |
| --- | --- |
| `recovery_start(email, phone, ip, agent)` | Matches email + phone, refuses unknown, mismatched, closed and locked accounts, applies a 60-second cooldown, issues a code (30 minutes) and sends it to both channels |
| `recovery_verify(email, phone, code, ip, agent)` | Compares the fingerprint, counts the attempts (5 → 30-minute lock) and returns a 20-minute ticket plus the member's public data |
| `recovery_link(code, ip, agent)` | The same, keyed by the code alone — that is what `?recovry=` calls |
| `recovery_reset(ticket, password, ip, agent)` | The final step: new bcrypt password, sessions revoked, **new recovery code**, data + link returned |
| `recovery_device(name, phone, email, view_code, device, password, ip, agent)` | The no-code path: the device's **original** code only, refused with `other_device` / `unknown_device` |
| `recovery_device_status(name, phone, email, device)` | The accounts this browser holds original codes for, with a verdict per field, for the "check this device" button; nothing else leaves the server |
| `recovery_device_key(text)` / `recovery_name_key(text)` | The device and the name in one comparable shape |
| `recovery_send(member, code)` | Builds the email, the WhatsApp message and the Telegram message and posts them with `pg_net`, each to the member's own address / number / chat; answers `{email, whatsapp, telegram}` (internal) |
| `whatsapp_number(phone, country, default_cc)` | The phone as E.164 digits, or `null` when it cannot be read |
| `delivery_probe()` / `delivery_probe_read()` | Ask the web app which channels it holds; store the answer in `delivery_channels` (internal) |
| `delivery_ready(channel)` | Is the web app configured for this channel? Optimistic until the first heartbeat (internal) |
| `recovery_delivery_reconcile()` | Read the `pg_net` answers back into `recovery_delivery`: `queued` → `sent` / `failed` + the reason, and keep the WhatsApp message id (internal) |
| `recovery_whatsapp_status(wamid, status, detail)` | A webhook status on the delivery that carries that message id, ranked so a late `sent` never undoes a `read` (internal) |
| `whatsapp_events_recent(n)` | What the webhook stored lately (internal) |
| `recovery_code_hash(text)` / `recovery_code_key(text)` | One canonical shape — `OW-XXXX-XXXX-XXXX`, upper case, dashes — so old registration hashes keep working |
| `recovery_phone_key(text)` | Last nine digits, so the country code never matters |
| `site_secret(key)` | Reads one secret; executable by nobody |

DDL + functions: `tools/sql/recovery-page.sql`. The old, unused recovery experiment (six-digit
codes in a `recovery_codes` table that never existed, plus a `recovery_delivery(delivery_id)`
short-cut that handed the plain code back to whoever held the id) is dropped at the top of
that file.

`tools/delivery-smoke.mjs` runs `recovery-delivery.gs` itself under Node with `PropertiesService`,
`MailApp`, `UrlFetchApp` and `ContentService` stubbed, so the script is tested before it is
deployed: a wrong token and a malformed address send nothing, the WhatsApp template carries the
code in `{{1}}`, a rejected template falls back to text and says so, `channel: "all"` lets a
broken channel fail alone, and `doGet` is a heartbeat that prints no secret.

`tools/rest-smoke.mjs` runs the page six times in jsdom: step 1 (empty, bad email, short
phone, unknown account, wrong phone, then the pair that matches), the resend cooldown, step 2
(malformed code never reaching the server, wrong code with the attempts left, expired code,
the right code), step 3 (short password, mismatch, strength hint, the change itself with the
new code, the link and the `.txt`), the recovery link (good and spent), the device path
(without a device id, a code of another device, a browser that never held one, a wrong email
and a wrong name landing on their own fields, the verdicts of "check this device" including
the two-accounts-on-one-device case, then the success) and the markup itself.

---

`dashboard.html` is the member's control room. It is drawn from **one** server call —
`member_dashboard(token)` — and it gates itself **before** it draws a single tool, so an
inactive or banned account never receives a menu, a code form or a hidden button it could
unhide.

### The five states

| Account state | What the page shows | Buttons |
| --- | --- | --- |
| `active` | Header rail, sidebar and every section | Everything |
| `inactive` | “Your account is not activated yet”, plus the day the account would be banned automatically | **Activate account** → `activated.html?member=ID_MEMBER`, **Log out** |
| `expired` | “Your membership has expired” | **Renew membership**, **Log out** |
| `banned`, no trial | The ban reason, who wrote it and when, plus “you may ask for a trial” | **Request trial**, **Log out** |
| `banned`, trial requested | “Your request is with the court”, case number | **Check notifications**, **Log out** |
| `banned`, trial scheduled | The date and time of the hearing, the case and the reason, and the warning that missing it makes the ban permanent | **Go to trial** → `court.html?id=ID_COURT`, **Log out** |
| `banned`, ban upheld (`ban_permanent` or `decision = uphold`) | “This account is permanently closed” with the case number and the court note | **Log out** only |
| Ban lifted (`decision = unban`) | Normal dashboard with a “Reopened by court decision” note and the case number | Everything |

The gate is chosen from the payload, and the payload comes from the token: a member cannot
pick a state by editing the URL or a class. `member_court_request()` refuses anything that is
not a non-permanent ban, creates at most one open case and writes a notification plus a
`court_requested` log row. `member_activation_request()` accepts `inactive` accounts only, at
most once an hour.

### Header

A horizontally scrollable rail of the twelve sections — **Movies, Series, Channels, Videos,
Podcasts, Images, Articles, Reviews, Q&A, Documents, Store, Auction** — each with its own SVG
icon. It scrolls with the mouse (click-and-drag through `enableDragScroll`), with a finger,
with the two arrow buttons and with the keyboard, because it is a real overflow container and
not a clipped list. Then the bell, the avatar (→ `profile.html`) and **Log out**.

The **bell** opens a popover with the last notifications in four windows (hour, today,
yesterday, week), a **Settings** button that jumps to the notification settings tab, and
**View all** → `notifications.html`. Unread items carry a dot on the bell and a counter in the
sidebar.

### The navigation rail: pinned, or waiting on the edge

There is one **rail behaviour**, not one menu: every page keeps the menu it needs, and the pin and
the edge reveal are shared through `assets/js/edge.js`.

| Page | The menu | Classes |
| --- | --- | --- |
| `index.html` | the site panel `<aside id="siteSidebar">` (mounted by `shell.js`) | `sb-open` · `sb-pinned` · `sb-rail` |
| `watch.html` | the same site panel — the player has no menu of its own | `sb-open` · `sb-pinned` · `sb-rail` |
| `profile.html` | its **own** menu in `.pf-side` (Reach, Dashboard, Profile, Network, Account, In build) | `pf-side-open` · `pf-side-pinned` · `pf-side-rail` |
| `dashboard.html` | its **own** menu in `.dsh-side` (the dashboard sections) | `data-pin` · `data-side-reveal` |

Every other page mounts the header without the button and leaves the sidebar container empty — no
rail to open and no `sb-open` class to inherit from a stored preference.

**The edge is the edge.** `edgePx = 2` and `edgeDwell = 180` in `createEdgeRail()`: a menu that
appears 30px away covers the thing the pointer was heading for, and a menu that appears the
instant a mouse crosses the border pops open on the way to the scrollbar or a link. So the trigger
is the last couple of pixels *and* a short rest there — cross the edge quickly and it is
cancelled — and "am I still on the menu?" (`nearPanel`) is only asked while the menu is actually
out. Asking it while the panel was closed made the whole left band of the page a trigger, because
a panel that hides off-screen still reports its width.

The rail has two states, and the **pin** in the menu moves between them (bottom of the site panel,
top corner of the profile card, next to the fold button on the dashboard):

| State | What happens | Class |
| --- | --- | --- |
| **Pinned** | the panel stays out and the page keeps room for it | `sb-pinned` · `pf-side-pinned` · `data-pin="on"` |
| **On the edge** | the panel is gone and the page uses the whole width; the pointer has to **touch the last two pixels** of the left screen edge and rest there for 180ms — or be placed on the thin tab on the edge — before the panel slides in **over** the content, and it slides away 320ms after the pointer leaves it | `sb-rail` · `pf-side-rail` · `data-pin="off"` |

The preference is `1w.sidebar.pin` (`"1"` / `"0"`, stamped with `1w.sidebar.pin.v` — a value from an
older build is ignored, and the legacy `1w.sidebar` flag is never read: it was the homepage's
"is the panel open" switch, so honouring it hid every menu at once), so pinning the menu on the profile pins it on
the player too. Without a saved choice the homepage, the profile and the dashboard start **pinned**
(they look exactly as they did before) and the player starts **on the edge** — the video needs the
width, and its menu is the site panel you can also reach from the header button. The header menu button is the keyboard/pointer
shortcut for the same thing: it pins and unpins on a desktop, and opens the drawer with its scrim
below 1024px — where the pin and the edge tab are hidden, because there is no edge to reach with a
finger. `Escape` closes a floating panel and leaves a pinned one alone.

The rail slides in *under* the header (`top: var(--header-h)`, `z-index: 120` against the header's
`130`). Opening it never touches `.site-header` or `.site-header__bar` — no padding, no width, no
translate — so the brand, the section rail and the wallet stay exactly where they are; pinned,
`.site-main` and `.site-footer` step aside by `--sidebar-w`, and floating they do not move at all.
`tools/shell-smoke.mjs` asserts which page carries which menu, `tools/sidebar-smoke.mjs` asserts the
edge (18px away does nothing, the very edge opens it, a quick touch does not), the pin, the Escape
key, the mobile drawer, the profile menu and the dashboard menu, and the stylesheets are checked to
contain no `body.sb-open .site-header__bar` rule.

### Sidebar

Avatar, `@username`, `IDXXXXXX` and the account status chip, then the groups:

| Group | Items |
| --- | --- |
| Account | Overview, Notifications, Codes, IPTV, Favorites, Watch later, Completed, Reports, Court, Points, Level, Payments, Prizes |
| History & analytics | Viewing history, Analytics |
| Creator | Creator management (eStudio, eServer, eBlog, eGallery, eSpace, eLibrary, eCinema) |
| Publisher | Publisher management (eStore, auctions, eBank, community) |
| Advertiser | Advertising campaigns |
| Settings | Website, Profile, Account, Platforms |
| Administration | Panel → `panel.html`, **only** for admins and moderators |

`Administration` is hidden for everybody else, and the panel enforces the same rule
server-side — hiding the link is a courtesy, not the permission. The rule has one source:
`public.site_admin(token)`, which answers true when the member's code is in `public.site_staff`
(the owners seeded there), when their `account_status` is admin / owner / moderator, or when
their level is 8 or above. `panel.html` asks it before it reads a row, and the dashboard asks it
before it reveals the group, so the two never disagree.

The site menu is **hidden by default** on the homepage: the page keeps its whole width and the
sidebar waits on the left edge (`watch.html` and the member-video pages behave the same). The
header's menu button pins it out on a desktop, the pin in the sidebar tools does the same, and a
click on the edge tab or a pointer resting on the very edge brings it in over the content. The
choice is remembered (`1w.sidebar.pin`, version 3 — the older builds pinned the homepage, and that
stored value is deliberately not read).

### Sections in this build

**Live, reading and writing real rows**

- **Overview** — membership and its expiry, days as a member, points available / spent /
  total, total watch minutes, the six-digit codes and the devices linked to them, and the
  account details.
- **Notifications** — the whole list with date filters (hour, today, yesterday, week, month,
  year, custom range, all time) on one tab, and per-section switches on the other. **Messages
  and Court cannot be switched off**: the inputs are disabled and `member_notify_set()` also
  rejects those two sources.
- **Codes** — generate or type six digits, pick 1 / 3 / 6 / 12 months, an age rating
  (none / 13+ / 16+ / 18+), a device MAC or a free code. Each row shows the code, duration,
  age rating, bound device, expiry and status, with **Copy**, **Download**, **Share**,
  **Unlink** and **Delete**. The **Linked devices** tab lists device, MAC, code, linked date
  and status with a remove action. Codes are refused while the account is not active.
- **IPTV** — M3U and Xtream tabs with their package shape (name, playlist URL, EPG URL, free
  or premium, status, download, channels). Members cannot add a package here; packages are
  published by admins and members create theirs from `e-server`.
- **Favorites / Watch later / Completed** — eight tabs (movies, series, channels, podcasts,
  articles, answers, documents, images) with posters, logos or thumbnails according to the
  type, and **Open** / **Share** / **Remove**.
- **Reports** — reports the member filed *and* reports against their own content, with
  reason, decision and dates.
- **Court** — the current case (reason, parties, hearing, decision, absence warning) with
  **Enter court** → `court.html?id=…`, and the verdict archive.
- **Points** — available / spent / total with the 100 points = $1 value, the earn breakdown,
  the serial box and the full ledger.
- **Level** — current and next level, a progress bar with the points still needed, the level
  table with what each level unlocks, and a criteria checklist.
- **Prizes** — the open draws with thumbnail, title, end date and points.
- **Viewing history** — one row per title with type, date and time, minutes watched and
  **Open**, filtered by type and by date; movie and series titles are resolved from TMDB.
- **Website settings** — language, country and theme, written to the same local keys the rest
  of the site reads, plus the skin gallery.
- **Account settings** — the identity card (member id, username and email locked, phone,
  status, plan), a real **Change password** form (current + new + repeat), and the recovery
  accounts — Telegram, WhatsApp, Google, Facebook, X, Pinterest, Reddit and TikTok. See below.
- **Creator management** — the seven creator pages (e-Studio, e-Server, e-Blog, e-Gallery,
  e-Space, e-Library, e-Cinema), created *and* edited from `dashboard.html#creator`. See
  *Your creator pages* below.

**Staged — the layout and copy are in place, the aggregation comes next**

Payments (the wallet, the 100:1 calculator, the payout form and the status chain are drawn,
no transfer row is written yet), Analytics, Publisher, Advertiser and Profile settings.
Each one states what it will do instead of pretending to have data.

### Your creator pages — created and edited from the dashboard

`dashboard.html#creator` is the only place a creator page is *made* and *named*. It draws seven
tabs — one per page — from **one** call, `creator_hubs_list(token)`, which returns the member's
hubs and the limit each kind has at their level:

| Tab | For | Kind | Where the content lives |
| --- | --- | --- | --- |
| e-Studio | Films, series and videos | `channel` | `creator.html?section=studio&tab=videos` |
| e-Server | IPTV playlists and channels | `server` | `creator.html?section=server&tab=channels` |
| e-Blog | Articles and long reads | `blog` | `creator.html?section=blog&tab=articles` |
| e-Gallery | Images and collections | `gallery` | `creator.html?section=gallery&tab=images` |
| e-Space | Community posts | `space` | `creator.html?section=space&tab=questions` |
| e-Library | Documents and books | `library` | `creator.html?section=library&tab=books` |
| e-Cinema | Curated screenings | `cinema` | `creator.html?section=cinema&tab=movies` |

One tab, one page. A tab that holds hubs carries their number beside its name, so what exists is
readable without opening it. The panel under it repeats the page and what it is for, then lists
the hubs: the status (`Live` / `Hidden`), the name, the public code (`IDST100001`-style), the
counts (published, drafts, subscribers) and the visibility, with three doors each — **Edit page**
(`…&tab=settings`), **Content** (the kind's own tab) and **Open** (the public page: a blog opens on
`blog.html?studio=<code>`, every other hub on `creator.html?studio=<code>`). A page that does not
exist yet shows a dashed **Not created** chip instead.

The panel's foot says **Where the content lives** — the `creator.html` section and tab that hold
it — and carries the **Create** / **Add another** button, which walks in with `new=1` so the *New
studio / server / …* form is already open (`openNewHub()` at boot). At the level's limit the
button becomes a `1 of 1` chip instead of a seventh form that would be refused. The tabs are a
real `role="tablist"`: the arrow keys, Home and End walk them.

**Managing a page** is the same card, one tab deeper. *Manage page* opens the page itself:
**Page management** (logo, cover, name, description, field, niches, related links, visibility, the
private password and its window, the excluded list, the exclusive criteria, subscriptions on or
off, the simultaneous-viewer ceiling, staff, VIP, and the delete door), **Categories** (the
three-level tree), **Participants** (the requests, approve or refuse, the publishers and
advertisers inside, and the hub's own ads) and **Subscribers**. It is `assets/js/hub-admin.js` —
one module, mounted by the dashboard, owning the four panes and their calls; the studio no longer
carries any of them. `dashboard.html#creator&manage=<hub>` opens a page straight into its
management, which is the door the public hub page's **Requests** button uses.

The content of those pages is **not** written here: it is written in the studio, which opens the
same seven sections under the same names. A page is the hub — its name, its look, its audience —
and the tab is where its content is written; every table there is a studio table. (A cinema's
first tab is `tab=movies`; links written when it was `tab=films` still land on it.) If the studio
does not answer, the card says so and offers **Try again**; the seven tabs and their doors keep
working, because creating a page only needs the URL.

### Account settings — the password, and where a code can find you

The email on an account **cannot be changed** from the dashboard: it is the address the member
signed up with and the one `recovery_start()` matches on, so a screen that renamed it would only
break the recovery page. It is printed with a `fixed` chip and the card says so. What *can* be
changed is the password, and it needs the current one:

| Field | Rule |
| --- | --- |
| Current password | compared against the stored bcrypt hash — a wrong one answers `current` |
| New password | 8–72 characters, must differ from the old one (`same`) and be typed twice |
| After it | every other session is revoked (`closed_sessions` says how many), this one survives |

The second card is **Recovery accounts**. Linking a network is what makes a recovery code
reachable without the mailbox, which is the point: eight rows, one per network the member asked
for, each showing the state (`Not connected` / `Waiting for the code` / `Linked · @handle`) and a
single button.

| Network | How it links | Delivers a code |
| --- | --- | --- |
| Telegram | a 10-character code inside `https://t.me/cineaura2bot?start=<code>`, verified by the bot | yes — `sendMessage` |
| WhatsApp | a 6-character code sent to the member's own number, typed back into the row | yes, once the Cloud API token is in `site_secrets` |
| Google, Facebook, X, Pinterest, Reddit, TikTok | an **OAuth app** each; the member leaves, the provider sends them back to `oauth-link` | no — they are the second door, not a mailbox |

The last six are honest about it: until their app exists, `member_identity_start()` answers
`error: oauth` and the row's button is disabled with a tooltip saying what is missing, instead of
opening a dead popup. The moment the client id and secret are in `site_secrets` the same button
reads **Connect** and the whole flow runs — see the checklist below. No credential ever reaches
the browser: the page holds a session token, the tokens stay in the row.

A pending link lives 20 minutes. Telegram's panel prints the code and the deep link, and polls
`member_account()` for about a minute so the row turns **Linked** by itself once the member
presses Start; WhatsApp's panel is the code box. **Disconnect** is offered on verified rows only
(`member_identity_unlink`), and the badge on the card counts what is really linked. The note at
the top of the card spells out the consequence: *the recovery code is sent to this account too*.

`member_identities` keeps one row per member and provider (`unique (member_id, provider)`) with
`status`, `handle`, `external_id`, `link_code`, `link_expires_at`, the PKCE `code_verifier`, and
the OAuth `access_token` / `refresh_token` / `token_expires_at` — none of which
`member_account()` returns. RLS is on with no policies: the browser only ever sees the handle.

DDL + functions: `tools/sql/account-settings.sql` (the table, the password, the two chat links)
and `tools/sql/oauth-linking.sql` (the encoder, the six recipes, the callback writes).

### Platforms — the API keys, sealed at rest

**Platforms** is the one panel in the dashboard that stores a credential the member brings with
them: a YouTube API key, a TikTok token, a Telegram bot token. The rule is strict, and it is the
whole design:

| | |
| --- | --- |
| at rest | `pgp_sym_encrypt(key, site_secret('api_key_key'))` — 32 random bytes, one row, sealed once |
| in the page | `••••` + the last four characters (`key_tail`), and nothing else |
| to use it | `api_key_secret(id)` — **service role only**, revoked from `anon` and `authenticated` |

So the table can be listed by its owner and still never shows a key back: an XSS or a stolen
session gets four characters and a label. Replacing a key overwrites the sealed copy and the tail;
removing it deletes the row (`on delete cascade` with the member).

The form is a select of the platforms the **server** accepts (`api_platforms()` — seventeen, from
YouTube to Reddit), a label up to 40 characters, and the key itself. A key must be 8–512
characters and carry no spaces, one platform holds one key per label (`unique (member, platform,
lower(label))`), and a member may keep 40. Every refusal has its own sentence in `API_MESSAGES`, so
"already stored under that label" is never mistaken for "the save failed".

**Replace** pins the platform and asks only for the new secret; **Remove** confirms first, then
deletes. The panel says the count — `3 / 40` — in the card head.

`member_api_keys` has RLS on and no policies: the four functions are the only doors, and each one
starts with `member_from_token()`.

| Function | Purpose |
| --- | --- |
| `member_api_keys(token)` | the accepted platforms, the limit and the masked rows |
| `member_api_key_save(token, id, platform, label, key)` | add (`id` null) or replace; validates platform, length, spaces, the label slot and the ceiling |
| `member_api_key_delete(token, id)` | removes a row the caller owns |
| `api_key_secret(id)` | the decrypted key, for the server alone |
| `api_platforms()` / `api_platform_known(slug)` / `api_platform_label(slug)` | the list the select is built from |

DDL + functions: `tools/sql/member-api-keys.sql` — **applied**, and exercised against a real
session afterwards: store → `tail 9012` in the list, `api_key_secret()` returning the original
string, a duplicate label refused case-insensitively, a 3-character key refused, an unknown
platform refused, then delete leaving zero rows and `site_secret` still closed to `anon`.
`tools/dashboard-smoke.mjs` runs the panel end to end — the four-character cell, the full key
nowhere in the DOM, replace keeping one row, remove, and a refusal that explains itself.

### Creator — the studio: seven hub kinds, one working area

**`creator.html`** is the creator studio. The rail on the left is the member (avatar, name,
username, `ID…` code) over two labelled groups — **Discover** (the public directory of creators, and
the same directory narrowed to publishers) and **Your pages** (the seven things they run) — and the
working area changes with the section. Above it sits the band of the hub being worked on: its
cover, its logo or initials, the section and its code, the field and its niches, the seat, and the
numbers it lives on — visibility, subscribers, items, minutes, likes, reports — as one row of pills.
Every one of the seven is the same object on the server — a **hub** — because their settings are the
same settings; what differs is what hangs underneath:

| Section | Tabs | Items |
| --- | --- | --- |
| **Studio** | Videos · Podcasts · Playlists | `video`, `podcast`, `playlist` |

**A row is a door.** Clicking anywhere on a table row opens the thing in it — a video in
`video-editor.html?id=<code>`, an article or a question in the writing room, everything else in
the item editor — and Enter or Space does the same on the focused row. The action menu, the links
and the copy buttons keep their own clicks.
| **Blog** | Articles · Drafts | `article` (published / draft) |
| **Space** | Questions · Answers | `question`, `answer` (a child row) |
| **Library** | Books · Documents | `book`, `document` |
| **Gallery** | Images | `image` |

**The studio writes content and nothing else.** It makes no page, names no page and changes no
page: the management tabs it used to carry (*Studio management*, *Categories*, *Participants*,
*Subscribers*) are gone from it and live on `dashboard.html#creator`, where the page is made.
The bar's **Add** and the empty state both hand you to the dashboard; `?new=1` and
`?tab=settings` no longer open a form here — the section lands on its first table.

The bar above the tabs is the two dropdowns the brief asks for: **Managing** (every hub of this
kind, with its subscriber count, and `＋ Add a studio` at the end) and **Add content** (the kinds
that belong in the open hub, then `New studio`).

#### The hub — identity, access, staff, VIP

| Field | Rule |
| --- | --- |
| name | 2–80 characters, unique per member per kind |
| logo / cover / links | `http(s)://…`, ten links at most, each with a label |
| field | **one** — a blog cannot specialise in two |
| niches | **five** at most, de-duplicated |
| visibility | `public` · `exclusive` (subscribers) · `private` (password and/or VIP list) |
| password | bcrypt hash (`extensions.crypt`), valid **1 hour to 1 month** (`1..720` hours), then it closes |
| staff | member codes (`ID100015`); the hub then appears in their own studio, in that section's management tab |
| VIP | member codes allowed in even while the hub is private |
| how many | `creator_hub_limit(kind, level)`: studios (kind `channel`) 1→4, blogs **3**→5, space/library/gallery 2→4 as the level rises 1→10 |

`creator_hub_unlock(hub, password)` is the only door that reads the hash, it is callable without a
session (a visitor on the public page), and it answers `expired` once the window has closed.

#### The tables

Every tab is `creator_items(token, hub, kind, status, search)` — one call, the counters included.
The action menu on each row is a small popover: **edit / preview / open**, **copy link**, **publish**
(drafts), **close** (questions), **share**, **delete** (with a confirmation). The numbers a public
surface will later write are already columns: minutes watched, likes, dislikes, comments, shares,
reports, downloads, plus answers / followers / re-asks (questions), replies (answers), and
lines / words / characters (drafts).

#### The item editor

**A hub's table is not the vault, and a video is not typed into a table.** A video's form —
the player, the thumbnail from the host, the audience, the schedule — is `video-editor.html`, so the
studio stopped offering a second, weaker one: there is **no `Video · new` screen any more**. The
`＋ Add content` menu's **Video** entry is a link to the editor (it carries the hub's code, so the
studio is already chosen), and the `Videos` tab — which the studio, a server and a cinema each now
have — carries **Publish a video** in its bar, and the same button in its empty state, where the text
says plainly that a video is written over there. `openEditor("video")` navigates instead of opening a
form, so no path — old markup, a keyboard, a link — can bring the table form back.

The table editor keeps one job, and a video is not it either: **a video is published only from the
editor** — `video-editor.html`, which a member the owner approved as a publisher of the hub may use
too (`video_save`'s guard accepts them), so a publisher's video is written in the editor like
everybody else's, with the studio chosen in its picker. The public
hub page's *Write in this hub* form
used to offer Video among the kinds a publisher could hand in; it does not any more. The list is
podcast and playlist for a studio or a server, article for a blog, and **nothing for a cinema** —
a cinema's films are its owner's, so an approved publisher there gets no button at all rather than
an empty form. The server says the same thing: `creator_submit_item` answers
`{ok:false, error:"video_editor"}` for `video`, and so does `creator_item_save` for a **new** video
row (a row that already exists still opens, so nothing already in a hub is stranded).

**A blog's article is written the same way.** *Article · new* used to be the table's own thin form —
a title, a summary and a textarea — with none of what the real editor has. It now opens the **writing
room**: `article-editor.html`'s editor, embedded in `creator.html` (`<body data-ae-embed="1">`), with
the whole surface — the rich-text toolbar and its dialogs, the cover, the tags, the field with its keywords,
the visibility with its audience, the private list and passwords, the schedule, the reader preview,
the autosaved draft. The studio opens it with `ae:open` `{ hub, hubName, field, id? }`; in that mode
`article_save` takes a `hub` key (a blog's code or uuid), the caller must own it, staff it or be an
approved publisher of it, and its kind must be able to hold an article. The Content/Help choice is
gone there — a blog is not the site's Help — and a publish never navigates: the editor answers
`ae:published`, the studio closes the room and re-reads the table. `creator_items` and
`creator_hub_posts` learned that a hub's post rows are videos **or** articles, with `source` naming
the editor that owns the row (`video-editor` / `article-editor`); a legacy `member_content` article
keeps `source: hub` and still opens in the table, so nothing already written is stranded.

**A space's question is written in the same room.** *Question · new* was the table's own thin form —
a title, a paragraph of details, a visibility, two niche boxes — and it is gone: a question is a
second **kind** of the one engine, not a second editor. `question-editor.html` is
`article-editor.html` with `<body data-ae-kind="question">`, and the studio opens it exactly the way
it opens an article: `ae:open` `{ hub, hubName, id?, kind: "question" }` into the same writing room,
so a question carries the rich-text toolbar, the HTML import, the contents rail, the cover and
thumbnail, the keywords (one head term, five long tails), the door, the private list and passwords,
the schedule, the reader preview and the autosaved draft — nothing is trimmed. The kid paints
itself: `Ready to ask?`, *Ask the question*, a six-word body rule, no Help section and no field
ladder (a question is not sorted onto a shelf), and **Attachments** — up to five files of 10 MB
(pictures, video, PDF, Word/Excel/PowerPoint, text, markdown, CSV, RTF, ZIP, by drag or by picker)
uploaded to `source/users/files/question_*` and kept as `meta.attachments[]`. Saving goes to
`question_save`, the loader is the same `article_get`, the list under *Your questions* is
`question_mine`, and a published question stays on the page instead of navigating to a reader.
`posts.content_type` learned the word, `member_post_save` stores a question's body and
`article_meta` like an article, and `creator_items` / `creator_hub_posts` count it with
`source: question-editor`.

`creator_item_save` takes the hub, the kind, the title, summary, body, media link, thumbnail, tags,
language, age, visibility, category, parent (an answer points at its question), field, niche,
**micro** and **nano** niche. Publishing is guarded on the server: an active membership, a title of
3–200 characters, the media link for the kinds that cannot exist without one, 12 words for an
article and 6 for a question or an answer — and a kind can only live in a hub that takes it (a video
cannot hang under a blog).

#### Functions, all token-scoped

| Function | Purpose |
| --- | --- |
| `creator_hubs_list(token)` | every hub the member owns or staffs, with its counters and the per-kind limits |
| `creator_hub_get / _save / _delete` | one door each; delete is the owner's alone and cascades |
| `creator_hub_staff / _vip(token, hub, add/remove, code)` | the two lists, resolved by member code |
| `creator_hub_unlock(hub, password)` | the private hub's door, with its expiry |
| `creator_subscribe / creator_subscribers` | subscribe, and the list with codes, countries and dates |
| `creator_categories / _save / _delete` | main → second → last, three levels, refused at a fourth |
| `creator_items` | one table per tab |
| `creator_item_get / _save / _status / _delete` | the editor, publish/close, delete |

`creator_hubs`, `creator_subscriptions`, `creator_categories` and the widened `member_content` all
have RLS on with no policies: the functions are the only doors, every one starts with
`member_from_token()` and then `creator_hub_manage()` (owner, or a member whose code is staff).

DDL + functions: `tools/sql/creator-studio.sql` — **applied**, and exercised on a real session:
a studio created, a private blog created with a 48-hour password (`unlocked` for the right one,
`denied` for a wrong one, `expired` after the window moved into the past), a draft video saved and
published (and refused without a media link), an article refused in a studio hub (`kind`),
categories three deep with the fourth refused (`deep`) and a duplicate refused, a third blog created
then a fourth refused (`limit`, level 1), staff added by code and an unknown code refused
(`member`), and the subscriber list reporting a real member with their country.
`tools/creator-smoke.mjs` (372 checks) runs the studio end to end — an empty studio, its tables
(private + password + staff), saves, refuses, and deletes a studio; a studio page holding one of each
hub (tables, columns, action menus, the editor saving a draft then publishing, blog articles vs
drafts, categories, subscribers, library books); and the `?section=&tab=` deep links — including
`&new=1`, the door the dashboard's **Create** uses, which opens the *New server* form by itself.

### Creator — the front door: find a creator, then walk into a hub

`creator.html` with no `section` is the **directory**, and it needs no session. A search box over
name, `@handle` and member code, three filters and a sort:

| Control | Values |
| --- | --- |
| who | **Everyone · Owners · Publishers** — see below |
| search | `name`, `@username`, `ID100015` — partial, case-insensitive |
| kind | every kind, or only creators who run a studio, blog, space, library, gallery, server or cinema |
| country | the countries that actually appear among creators (returned by the server) |
| sort | most subscribers · most items · newest |

#### Two kinds of people in one search

The directory finds both halves of a creator page, and says which one a row is:

| Who | What it means | Where it comes from |
| --- | --- | --- |
| **Owner** (مالك) | the member whose hubs these are — the studio, the blog, the space, the library, the gallery, the server, the cinema | `creator_hubs.owner` |
| **Publisher** (ناشر) | somebody who writes *inside* a hub they do not own, after that owner approved them | their member code in `creator_hubs.publishers` |
| **Owner & publisher** | both at once, which is the normal case for a working creator | the two above |

`?section=publishers` (or `?role=publisher`, or the **Publishers** item in the studio's
discover rail) opens the same search on the second half. A publisher card carries the badge, the
number of places they write in, and a dashed chip per hub — each one links straight to that hub —
and their own page grows a **Writes in** block beside the hubs they run, with the owner's name on
every card. `creators_search(token, role, query, kind, country, sort)` answers all three shapes
(`''` / `all`, `owner`, `publisher`), counts both (`owners`, `publishers`) and never mentions a
private hub: a member who only writes inside one is not listed at all.

Each card is a creator: avatar or initials, name, handle, code, flag and country, the seven kinds
they run with their counts, their fields, and hubs / subscribers / items. One click opens their page:

```
creator.html?creator=ID100015      (or ?creator=@jhon007, or the member uuid)
```

That page is the member — name, handle, code, country, joined date, field chips, bio — the five
totals (hubs, subscribers, items, minutes, likes), and **every hub they run, grouped by kind**:
Studios, Blogs, Spaces, Libraries, Galleries, Servers, Cinemas. Each hub is a card with its logo,
its field, its visibility and its three counters, and each card opens the hub itself:

```
creator.html?studio=IDST100001      (or ?hub=<hub uuid> — both resolve)
```

Every hub carries a public code — `ID` + the kind's two letters + six digits (`IDST` studio,
`IDBL` blog, `IDSP` space, `IDLB` library, `IDGL` gallery, `IDSV` server, `IDCN` cinema). It is
generated on insert, unique, and it is what the studio's Participants tab copies out.

#### One hub as a visitor

The header (cover, logo, kind, name, owner link, field, visibility, subscribers, items, minutes,
likes, niches, description), a **Subscribe** button, and the published items under it. No token is
needed to look.

Access is decided on the server, never by the page:

| The hub | What a visitor gets |
| --- | --- |
| public | the header and every `public` item |
| exclusive | the header and the `public` items; `exclusive` items only for a subscriber (and the owner, staff, VIP list) |
| private, password open | the header and a password form; a right password opens **this visit** only |
| private, window closed / VIP only | the header, "this hub is private", and nothing else — not one item |
| private, and you are the owner / staff / VIP | everything, plus **Manage** back into the studio |

A private hub is in nobody's directory card and nobody's creator page but the owner's, the staff's
and the VIP list's. Banned members are in no directory and on no creator page.

Servers and cinemas are already real hub kinds on the server (`creator_hubs.kind` allows `server`
and `cinema`, and `creator_kind_allowed` gives a server videos / podcasts / playlists and a cinema
videos), so a creator who owns one sees it in its own group on their page and can open it like any
other hub. The studio's five sections are still the five listed above; a management section for
servers and cinemas is not built yet.

#### The four public functions

| Function | Answers |
| --- | --- |
| `creators_search(token, query, kind, country, sort)` | `{ok, rows[], countries[], count}` — 60 at most; a member with no non-private hub never appears |
| `creator_public(token, ref)` | `{ok, is_self, creator{}, totals{}, hubs[]}` — `ref` is a code, an `@handle` or a uuid; a private hub only for the owner, staff and VIP |
| `creator_hub_view(token, hub, password)` | `{ok, locked, hub{}, items[]}` — the locked reply carries only the name, logo, cover and whether a password exists |
| `creator_hub_subscribers(hub)` | the count, used by every total above |

#### Working in somebody else's place — publishers and advertisers

Every hub's page offers two doors to a visitor who is not its owner:

| Door | What it asks | What an approval gives |
| --- | --- | --- |
| **Publisher** (ناشر) | a message (10–600 characters) and an optional portfolio link | the member writes in that hub: `creator_submit_item` lands their content as a **draft** the owner publishes from the tables — a podcast or a playlist, or an article in a blog, never a video |
| **Advertiser** (معلن) | the format — **banner · video · image · paragraph** — a message, a sample, a budget in points | the member runs an ad there: `creator_ad_save`, and it shows on the hub's page |

A request is one row in `creator_requests` (`pending` → `approved` / `rejected` / `withdrawn`), one
open request per member per role per hub. The owner and the staff answer it in the studio's new
**Participants** tab of every section, which shows who is waiting, the publishers, the advertisers
with their ad counts, and the hub's ads with impressions and clicks (and a remove button).

Approving writes the member's code into `creator_hubs.publishers` or `.advertisers` — two arrays the
server checks before it accepts an item (`creator_submit_item`) or an ad (`creator_ad_save`); nothing
is shared until the owner says yes, and a private hub's door still stands in front of all of it.

An ad is a `creator_ads` row: `banner` (a wide picture), `video` (a file with controls), `image` (a
picture) or `paragraph` (40 characters of text and nothing else), an optional link, `live` or
`paused`, with impressions and clicks waiting for the reader. The hub page draws each format its own
way, under "Advertising in this hub"; the public reply only ever carries the `live` ones.

| Function | Answers |
| --- | --- |
| `creator_request_send(token, hub, role, format, message, link, budget)` | one ask; `self`, `exists`, `member`, `format`, `message`, `link` are refused |
| `creator_participants(token, hub)` | the owner's view: every request, the two lists, the counts |
| `creator_request_decide(token, request, approve\|reject)` | the answer, and the list it writes to |
| `creator_request_withdraw(token, request)` | the asker takes it back while it is pending |
| `creator_ad_save / creator_ad_delete / creator_ads` | the ad itself, for an approved advertiser and for the owner |
| `creator_submit_item(token, hub, kind, …)` | a publisher's draft |

### Publisher — the program for creators outside the site

**Publisher is not the same word as the search's.** In the directory a *publisher* is a member
writing inside somebody else's hub. **This page is for the other kind: the creator who works
outside 1World** — a channel, a newsletter, a Telegram group, a blog of their own — and carries the
site's blogs, libraries, studios and films to an audience that never comes here.

`publisher.html` has two rooms, and only these:

| Room | What it holds |
| --- | --- |
| **The program** | what it is, the three steps, the pay table, and the seat: a code `IDPB100042`-style, where you publish, from where, how many people read you |
| **Your links** | one link per hub or one for the whole site, each with its URL, clicks, sign-ups and points — plus the conversions table |

There is **no third room**. The page used to embed the video editor and call itself *the publisher's
desk*; that is not what this page is for. A member an owner lets into a hub writes in `creator.html`
(see *Two publishers, two pages* below), and a `?studio=` link that used to open the desk here is now
handed straight to `creator.html?studio=<code>`.

What a conversion is worth, server-side:

| Conversion | Points | Written by |
| --- | --- | --- |
| a click through the link | — | `publisher_visit(code)` — the page a `?ref=` lands on |
| the visitor makes an account | 50 | `publisher_credit(code, member, 'signup')` |
| the account is activated | 250 | `publisher_credit(code, member, 'activation')` |
| the account takes a membership | 1 000 | `publisher_credit(code, member, 'membership')` |

`publisher_credit` is **granted to `service_role` only** — a browser cannot mint its own points — and
one member counts once per link per kind (a partial unique index). The points are written to the same
`points_ledger` the rest of the site spends from, so a publisher's reward is spendable like any other
point. A link is `register.html?ref=<code>` or `creator.html?studio=<hub code>&ref=<code>`; the app
shell counts the click on arrival (`app.js` → `publisher_visit`) and keeps the code for the session so
the registration page can credit the same publisher. A private or hidden hub cannot be promoted.

DDL + functions: `tools/sql/publisher-program.sql` — `publishers`, `publisher_links`,
`publisher_conversions`, and `publisher_me` / `publisher_join` / `publisher_link_save` /
`publisher_link_delete` / `publisher_visit` / `publisher_credit`. **Applied** and exercised on the
live project: a seat taken, its code issued, a link made for the whole site and one for a hub, a
click counted by `publisher_visit`, and the JSON the page reads.

The dashboard's **Publisher management** section is the same program seen from the member's side: the
code, the clicks, the sign-ups and the points as four numbers, the pay table, the links as a table,
and the two kinds of publisher spelled out so nobody confuses the seat in someone's blog with the
program.

#### Two publishers, two pages

The word covers two different people and they no longer share a room.

**The publisher outside the site** is `publisher.html`: the program, the seat with its public code,
the links they carry into their own channel and the points those links pay. It is two rooms — *the
program* and *your links* — and nothing else. The editor that used to be embedded in it as a third
room, *the publisher's desk*, is gone: the page no longer loads `video-editor.js`, carries none of
its markup, and no longer deep-links a hub (`?studio=`, `?id=`).

**The publisher inside the site** — the member an owner admits into `creator_hubs.publishers` —
writes in **`creator.html`**, which is where the content of a hub is made, and the owner's hub is
listed there beside their own. The page reads the `role` the server puts on every hub
(`owner` · `staff` · `publisher`) and narrows the room for the third one:

| | owner and staff | publisher |
| --- | --- | --- |
| the tables | every tab | the tables only — no management, no seats, no subscribers, no categories |
| the rows | every row | the hub's published rows, plus **their own** drafts (`mine` on each row) |
| a new row | draft or live | a **draft**, always — `creator_item_save` answers `seat` for `p_publish` |
| an article | the writing room publishes it | the same room, opened with `draft: true`: *Send to the owner* |
| the hub itself | settings, staff, VIP, the door | nothing: the settings tab is not drawn and `?tab=settings` falls back to the tables |
| deleting | any row | their own draft (`creator_item_delete`) |

The owner publishes what arrives, from the same tables: a publisher's draft is a `draft` row, and
`creator_item_status` — which still answers only to `creator_hub_manage` — is how it goes out.

DDL: `tools/sql/creator-seats.sql` — five patches, each rewriting the definition it finds (so it keeps
whatever the function grew since) and safe to run twice. **Applied** to the live project and exercised
on a real hub: member `ID100015` was put in `IDBL100003`'s `publishers`, `creator_hubs_list` listed the
blog with `role: "publisher"`, `creator_items` returned its two published rows with `mine: false`,
`creator_item_save` with `p_publish: true` answered `{ok:false, error:"seat"}` and with `false` wrote a
`draft`, `creator_item_get` opened it and `creator_item_delete` removed it — while another member's row
answered `not_found`. The seat and the test session were removed afterwards. `tools/publisher-smoke.mjs`
(52 checks) holds `publisher.html` to the program alone and follows an old `?studio=` link to
`creator.html?studio=<code>`; `tools/creator-smoke.mjs` (372 checks) walks a publisher's seat room by
room and re-checks that the owner's page did not change.

DDL + functions: `tools/sql/creator-requests.sql` — **applied**, and exercised on the real database:
a member asked to advertise (banner, 500 points) and to publish in a hub, the owner read both in
`creator_participants`, approved both (the two arrays filled with their code), the advertiser put a
banner live and it appeared in `creator_hub_view`'s `ads`, the publisher's draft landed as
`status: draft`, a second ask was refused with `member`, and `creator_hub_view('', 'IDST100001', '')`
answered `can:{publish:false,advertise:false}` for a guest. The test rows and sessions were removed
afterwards.

DDL + functions: `tools/sql/creator-public.sql` — **applied**, and exercised on the real database:
the kind constraint widened to seven, `creator_kind_allowed` covering `server` and `cinema`, the
directory answering with a real creator (`fields` free of empty strings), a creator page by
`@handle` with its hubs, and a hub view answering `{role: visitor}` for a guest. `tools/creator-smoke.mjs`
covers it in jsdom — **249 checks** over fourteen passes: the directory with no session, typing that
narrows the list, an empty filter that explains itself, a creator page grouped by kind, a hub as a
visitor, a member subscribing, a guest asked to sign in first, a private hub behind a wrong and then a
right password, `?section=studio` without a session still gated, the Participants tab (a pending ask,
approve, the two lists, the ad table, a removal), a member already let in writing a draft and putting
an ad live, asking to advertise with its four formats, a server (its tabs, its management tab, a
channel with a group and an EPG, a pasted list counted and saved, an Xtream account with its port, and
a seat count above the level refused), a cinema (a film with TMDB, two qualities, subtitles and their
languages and the ads flag; an episode with its season and number; a playlist with two picks and a
backdrop), and the public side of a closed door (the device count, the closed badge, a disabled
Subscribe button, the qualities, the seats and the ads flag on the card).

### Server and cinema — every door, every seat

Two more sections sit in the rail: **Server** and **Cinema**. A server holds `channel`,
`channel_list` and `xtream` items (plus videos, podcasts and playlists); a cinema holds `film`,
`episode` and `playlist`. `creator_kind_allowed` names all seven hub kinds, and
`member_content.kind` carries the five new item kinds.

Every hub and **every item** now answers the same three doors, by the same rule:

| Door | Who walks in |
| --- | --- |
| `public` | everybody except the `excluded` list (member codes, up to 200, on the hub and on each item) |
| `exclusive` | the `audience` criteria: `requires` (`subscribe`/`follow`), `countries`, `languages`, `level_min`, `wealth_min` — every one that is set must pass |
| `private` | the hub's **VIP** list, or the password its publisher set (with its own window) |

The owner, the staff, and anyone the VIP list names always see their own. The doors are computed by
`creator_audience_ok`, `creator_hub_open_to` and `creator_item_open_to`; `creator_hub_access` saves a
hub's `excluded`, `audience`, `auto_accept` and `max_viewers`; `creator_item_meta` saves the same on one
item, together with the `meta` each kind needs and its `seats`.

**Simultaneous viewers** are capped by the owner's level — `creator_viewer_limit`: a server and a
cinema film take **100 × level** (100 at L1, 1000 at L10), a cinema series/episode **1000 × level**
(1000 → 10000), and the top level (11) has **no limit**. The hub may lower its own number
(`max_viewers`), a single film or episode may lower it again (`seats`, refused when above the level's
ceiling), and `creator_hub_view` reports the `cap` that really applies to each item.

**Auto-accept** (`creator_hubs.auto_accept`) is a switch in every management tab: with it off,
`creator_subscribe` answers `closed`, the hub page disables Subscribe, and
`creator_hub_view` carries `can_subscribe: false`.

What each kind keeps in `member_content.meta`:

| Kind | `meta` |
| --- | --- |
| `channel` | `{ group, epg_url }` |
| `channel_list` | `{ list_name, source: paste\|url\|file, content, url, epg_url, count }` |
| `xtream` | `{ host, port, username, password }` |
| `film` | `{ tmdb, quality: [SD…8K], subtitles, subtitle_langs, ads }` |
| `episode` | the same, plus `{ season, episode }` |
| `playlist` | `{ items: [{ id, kind, title }] }` |

DDL + functions: `tools/sql/creator-server-cinema.sql` — **applied**, and exercised on the real
database: a `server` hub came back as `IDSV100004` with `viewer_limit: 100`; `creator_hub_access`
refused 5000 viewers above the level's 100, then saved `excluded: ["ID100015"]`, an exclusive rule of
`{requires: subscribe, countries: [Morocco], level_min: 1}`, `auto_accept: false` and 50 viewers; a
channel published with `seats: 100` (5000 was refused as `seats`), a channel list with a pasted
`#EXTM3U` and its EPG, a guest then saw **only** the public channel (the exclusive list stayed shut),
the excluded member was answered `{locked: true, reason: "excluded"}`, and `creator_subscribe` returned
`closed`. A `cinema` hub (`IDCN100005`) took a film with `{tmdb, quality: [4K, FHD], subtitles, ads}`,
an episode with `seats: 900` (1500 refused, the ceiling being 1000) — the owner saw both and the guest
only the public film. The test hubs, items and sessions were removed afterwards.

### Member videos — the feed, the watch screen and the publish page

Two screens that used to be placeholders are now live, dressed in the site's own tokens rather than
the mock's: **`videos.html`** (the feed and the player, one page, `#/v/<code>` for a single video)
and **`video-editor.html`** (publishing). An owner's publisher publishes a video from that same
editor — `video_save` accepts them — and writes everything else in `creator.html`.

Neither invents a table. A member video is a row of `posts` with `content_type = 'video'` — the same
row likes, comments, reports and reach already live on — plus one column of its own,
`posts.video_meta`, and one small table, `video_keys`, for a door's passwords (bcrypt, via
`extensions.crypt`).

| Call | What it answers |
| --- | --- |
| `video_feed(token, field, sort, search, limit, offset)` | the cards the caller may see, the fields that have videos, the total |
| `video_get(token, ref, key)` | the player, the publisher, `related` (shared keyword) and `more` (same host) — or the locked door |
| `video_mine(token)` | the member's own rows, drafts and scheduled ones included |
| `video_save(token, payload)` | one call for a draft, a publish or a schedule; an edit carries the `code` back |
| `video_card(post, viewer)` | `post_card` plus `video { meta, embed, file, host }` |

`video_save` takes `title`, `description`, `thumbnail`, `embed`, `language`, `visibility`, `status`
(`draft`/`published`/`scheduled`), `scheduled_at`, `tags` (main keywords, twelve at most),
`audience[{kind, value}]`, `profiles[]`, `passwords[]`, `meta { age, download, vertical, source }`
and `hub` — the studio the video is published into, which is [its own section](#the-studio-a-video-goes-into).
A key it is **not** given is a list it leaves alone — so a partial save can never wipe an audience, the
nominated people, the passwords or the tags of the video it edits.

The three doors keep their meaning, on the feed as well as on the door:

| What the editor says | `posts.visibility` | Who gets in |
| --- | --- | --- |
| Public | `general` | everyone |
| Exclusive | `limited` | at least one `post_audience_rules` `include` rule matches — country, language or level |
| Private | `private` | the `post_authorized_profiles` list only |
| Followers only | `followers` | whoever follows the publisher |

Exclusive also accepts a named member (`kind = 'entity'`, the `@username` as the value), and a level
*range* becomes one rule per level — that is the shape `post_visible_to` matches. Private and
exclusive can both carry **join passwords**: the editor never sees them again (only `asks_password`),
it sends a `passwords` list only when the member added one in that visit, and a correct password opens
that one visit for anyone without granting a reaction.

The feed searches titles and descriptions, filters by one field, and sorts four ways (`popular` by
`rank_points`, `new`, `liked`, `discussed`). A card carries the thumbnail, the age badge, the door it
belongs to, the publisher, the time and the counters.

The watch screen is the reference watch layout, in the site's clothes: a reading column of cards and
a sticky column of suggestions beside it, and every block — the actions, the chapters, the publisher,
its links, the comments — on the same card (one border, one radius, one blur, `--surface` at 78%).
Under the player come the action row — like, dislike, comments, reshare, save (on the device),
download when the publisher allowed it, report — then the chapter panel with its fold button, then
the facts line (**minutes · views · date · language · age · visibility**), the title, the clamped
description with *Show more* (three lines, chevron turning), the publisher card (58px mark, name with
its seal, kind and code and member, `subscribers · releases`, **Follow**/Subscribe,
`profile_follow_toggle` or `creator_subscribe`), the studio's own links, the tags as field chips, and
the comments. The side column carries *Related* and *More from …* as thumbnail rows. Commenting
follows the site rule: **like or dislike first**, then the composer appears. A video the viewer may not
see arrives `locked` — with its title and its thumbnail, never its source.

**A comment is a place of its own.** Under every comment sit four doors: **like**, **dislike**
(`post_comment_vote`, the same door the article's *agree / disagree* uses — one vote per member, a
second press of the other takes the first back, and the counts come back from the answer so the row
never guesses), **Reply** (an inline box under that comment; it goes out as `post_comment` with
`p_parent_id`, and a server that does not keep threads yet still gets it as a line naming the member —
never dropped), and **Report** (an inline box with a reason and a note; it is filed through
`post_report` under the video, and the note names the comment and quotes it, so a moderator knows
exactly which line it is about). A row whose `parent_id` points at another comment is drawn under it,
in a bordered thread; a row with no parent is a comment of its own. The header is the site's
own, untouched: only the content under it was rebuilt.

`video.html?id=…` still answers its old address: it forwards to `videos.html#/v/<code>`, so the links
`watch.js` and `cast.js` already write keep working.

**Two stores, one table:** the Creator studio's *Videos* tab reads `member_content` (`kind = 'video'`,
the hub's own library) *and* the `posts` this page publishes into that hub — see
[the studio a video goes into](#the-studio-a-video-goes-into).

DDL + functions: `tools/sql/videos-page.sql` — **applied**, and exercised on the real database: a
published video came back with its code (`PST-001005`), a guest saw it in the feed and its
`impressions` ticked; a private one stayed `locked` for a guest, `asks_password` was true, a wrong
password stayed locked and the right one opened it; an exclusive one dated to Morocco stayed shut for a
guest and for an Andorran member, and opened for the Moroccan one; a draft was absent from the feed but
present in `video_mine`; a like opened the composer and a comment landed; a save **without** the
`passwords` key left the existing password in place. The test rows were removed afterwards (three demo
videos from the Blender open movies remain in the feed).

**One sign-in, every page.** The token lived in `sessionStorage` whenever "stay signed in" was not
ticked, and `sessionStorage` is per tab: a link opened in a new tab, or a page that was already open,
never saw it and asked a signed-in member to sign in again. There is now one store —
`localStorage["1w.session"]` with `1w.session.until` beside it (twelve hours, or thirty days when the
box was ticked) — read by every page and every tab, and dropped the moment it is past. Two other
ways a session ended by accident are gone too: a call that *failed* (a flaky moment) no longer signs
anyone out — only an answer that says the session is dead does (`dashboard.html`, `activated.html`,
`court.html`).

**The studio publishes, not the profile.** A video saved into a studio carries `posts.hub_id`, and
the watch screen shows that studio as the publisher: its mark, its name (opening
`creator.html?studio=<code>&creator=<owner>`), its kind and its code, with the member named under it
as *by @handle*. A video with no studio keeps the member's face and follower count. The one call that
answers it is `video_hub(ref)` in `tools/sql/video-publisher.sql`; `video_get` is untouched, so the
screen asks for the video and its studio side by side.

**The index is written in the editor.** The video form carries a **Chapters** card — a numbered row of
a time and what happens there, added and removed in place, starting a minute after the last row so a
member typing one after another never restarts at `00:00`. Times are accepted as `0:38`, `00:38` or
`1:02:03` and stored as `m:ss`; a row without both halves is dropped on save, never saved
half-written; the list is stored sorted in `meta.chapters` and travels with the video, so the watch
page draws it under the player without reading the description.

**The publisher card carries its own two doors.** Under the studio's name: its counts (subscribers,
releases), its blurb, then **Subscribe** — the hub's own subscription (`creator_subscribe`), not the
member's follow, with the count moving when it lands, and a guest told to sign in before anything is
sent — and **Take action**, the six a viewer acts with: **Follow the creator** (`profile_follow_toggle`),
**Join the studio** (the same door as Subscribe), **Message** (a dialog that sends through
`msg_send` to the studio's owner and closes on success), **Share**, **Copy the link**, **Report**
(the page's own report box) and **Block** — which keeps the member in `1w.videos.blocked` on this
device only, says so on the card, and offers Unblock in the same row. A video with no studio keeps the member's face, handle, followers and Follow.

**Related links come from the studio's own settings.** The studio page's *Page management* pane carries
the label-and-URL rows (`p_links`, ten at most); the watch page draws them **under the publisher's
blurb, inside the publisher's card** — Website, YouTube, Instagram, X — with a **Playlists** door
always beside them, so a studio that wrote no links still has one way into its shelves.

**The details under the video.** The watch screen carries, in the reference's order: *Back to the
studio* (the kind's own word) beside *All videos*; the player; the action row; the **chapter panel** —
read from the description or written in the editor, `Comedy beats: (0:37 - 14:00) …` becomes
`01 · 0:37 · Comedy beats`, clickable, with a fold button and the picked row marked; the facts line
with the minutes; the title; the description; the studio card with its subscribers, its releases and
its blurb, its own links (website, YouTube, Instagram, X) beside a *Playlists* door; the tags; and the
comments. Nothing is invented: no time in the description, no
chapter list; no links on the studio, no row. A source that plays in its own frame cannot be seeked
from here, so a chapter there says the time instead of pretending.

**Under the publisher's shelf, the rest of the site.** The side column lists *Related* (the server's
own neighbours), *More from <publisher>*, and — under both — **Suggested for you**: one read of
`video_feed` (`popular`, 24 rows), minus the video on screen and minus every row already listed beside
it, same shape only, eight at most. It is a call of its own and never holds the page up; a video the
viewer already has on the page is never suggested back to them.

**A chapter is a second in the address.** Picking one seeks the frame *and* writes `…&t=840s` at the
end of the address, the way the reference does, replacing any earlier second rather than stacking one.
Opening a link that carries `&t=90s` (`?t=90` is read the same) starts the file there — a `<video>`
seeks, a YouTube frame reloads at `start=90`, a Vimeo frame at `#t=90s` — and the chapter that second
belongs to is the one marked. The router strips the second before reading the id, so
`ID=CA4728CD&t=90s` is still `CA4728CD` and an old link opens.

**A video saved before that column existed has no studio on its row**, and it still must not fall
back to a bare profile: the page then asks which studio the member publishes into — `creator_studio(ref)`
in the same file, or, when that call is not on the server yet, the `creator_public` call the creator
page already makes (a channel first, then a server or a cinema, never a private hub). No studio at
all, and the member's face is the publisher, which is the honest answer.

Test: `node tools/video-smoke.mjs` — **321/321** (feed, sort, search, watch, reaction→comment, a locked
door and its password, a missing video, the editor signed out and in, the payload of a publish, of an
exclusive rule set and of a private list, the player and the sixteen host cases, the oEmbed stills, the
studio picker, the contents rail, and the forwarding page).

**The live preview is a door.** Once the video has been saved, the preview card in the editor opens
the video's own page in a new tab — `videos.html#/h/ID=<code>`, or `#/v/` when **vertical** was
ticked — so the editor is never lost. A draft has no page yet: the card carries no link and says so
under itself.

**The form carries its own contents too.** A video form is nine sections long — the source, the words,
the extras, the live preview, the studio, the thumbnail, the audience, the moment, the details — so it
opens with the same **Contents** rail: one row per section, in the order the form is read, numbered
`01…`, with the count in its head. A press scrolls to that section, lights it up, and puts the caret in
its first field (a section of switches takes the focus itself, since a radio button is not a place to
land in). The box that lists the sections is not one of them.

Both rails are one module — `assets/js/contents.js` — and one set of styles, so the article editor, the
video editor, the writing room inside `creator.html` and the editor embedded in `publisher.html` all
index themselves the same way.

#### The studio a video goes into

A member video used to belong to the member's own feed and to nothing else, while a studio's *Videos*
tab read a different table entirely — so a creator with a studio could not say *this film belongs to
my studio*. `video-editor.html` can say it now:

| Where | What it looks like |
| --- | --- |
| the editor | a **Where it goes** card under the live preview: a select of the member's studios, servers and cinemas, then `My own feed — no studio`, and one plain sentence about what the choice does |
| the preview card | `in <studio>` on the card itself, so the studio is visible while the video is being written |
| the studio | `creator.html?section=studio` → *Videos*, where the video appears with its counters, its door and a `· video editor` mark on its code. A server and a cinema have that tab too |
| the link between them | the studio's `＋ Add content` → **Video** and the *Videos* tab's **Publish a video** both open `video-editor.html?studio=<code>`, so the studio is already chosen |

`posts.hub_id` (uuid, `on delete set null`) is the whole schema. `video_save` accepts `hub` as a hub
**code** (`IDST100001`) or its uuid; a payload **without** the key leaves the studio where it is, and
`hub: null` sends the video back to the member's own feed. It is checked **before** anything is
written, and refused three ways: `hub` (no such code), `hub_role` (not the owner and not on the staff
list) and `hub_kind` (a blog cannot hold a video — `creator_kind_allowed` decides, so a studio, a server
and a cinema are the three kinds offered). The save itself is still `member_post_save`'s; the wrapper
sets the studio afterwards, so nothing about the video path forked.

`video_card` now carries `video.hub { id, code, kind, name, visibility }`, so the editor reopens with
the studio it was published into, and `creator_items` unions the two stores: a row from `posts` arrives
with `source: 'video-editor'`, its post code (`PST-…`), its counters, and its visibility in the
studio's own words (`general → public`, `limited`/`followers → exclusive`). That row's action menu is
the editor's, not the table's — **Open in the editor** (to `video-editor.html?id=<code>`), copy link,
**Delete** (through `post_delete`, with the confirmation saying *a video*). `creator_hub_json` counts
those rows (`creator_hub_posts`), so the hub's header and its table agree.

DDL + functions: `tools/sql/video-studio.sql` — **applied**, and exercised on the real database: a
video published with `hub: 'IDST100001'` came back carrying that studio in `video.video.hub`, the
studio's *Videos* table listed it as `source: video-editor` with `items`/`published` at 1, an edit
**without** the key kept the studio, `hub: ''` cleared it (the column read null), and the three refusals
answered `hub`, `hub_kind` (a blog) and `hub_role` (a studio owned by another member). The test rows,
the temporary studio and the session were removed afterwards.

### The address book — one grammar for every piece of content

`assets/js/media.js` is the only module that knows how a thing is addressed. A page asks it for a
link; a page hands it a hash; nothing else spells a media URL by hand.

A **studio** (`creator.html?studio=<code>&creator=<id>`, kind `channel`) is read shelf by shelf:
**All · Videos · Vertical · Podcasts · Music · Playlists** — a tab per shelf with its count, the
videos in a grid, the vertical ones in a portrait rail, the podcasts, the music and the playlists as
lists, plus an *Also here* shelf for anything else the studio holds (a book, a document, an image).
Every card is a link: `videos.html#/h|v/ID=…`, `audio.html#/p|m/ID=…`, `playlist.html#/videos|podcasts|songs/ID=…`.
The other six hub kinds keep the plain grid.

| What | Address |
| --- | --- |
| A studio and whose page of it | `creator.html?studio=IDST100001&creator=ID100019` |
| A horizontal video | `videos.html#/h/ID=video001032` |
| A vertical one | `videos.html#/v/ID=video001032` |
| A podcast | `audio.html#/p/ID=podcast001032` |
| A song | `audio.html#/m/ID=song001032` |
| A playlist of videos | `playlist.html#/videos/ID=playlist001032` |
| A playlist of podcasts | `playlist.html#/podcasts/ID=playlist001032` |
| A playlist of songs | `playlist.html#/songs/ID=playlist001032` |

- **`studio` and `creator` are two different ids.** `studio` is the hub (`IDST100001`), `creator`
  is the member whose content it is (`ID100019`). Both are optional and both are carried: the hub
  page opened with both shows a chip naming the creator and scopes the items to them; opened with
  only `studio` it is the whole hub, and opened with only `creator` it is that member's page.
- **`h` and `v` are shapes, `p` and `m` are kinds.** `h` is a 16:9 piece and `v` is a 9:16 one —
  the watch screen narrows to a portrait stage rather than letterboxing a tall video into a wide
  frame. `p` is a podcast, `m` is a song.
- **`ID=` is always there.** The id after it is the item's code — the first eight hex digits of its
  uuid, the same `code` every table shows — so a link survives a rename. `#/v/CA4728CD` (the older
  address of a plain video) still opens, and a bare `#/<code>` opens the video page.
- **The shelf is part of the playlist's address**, so a playlist opens on the right list without
  asking. A row on it opens with the shape it has: a landscape video row goes to `#/h/`, a vertical
  one to `#/v/`, a podcast to `audio.html#/p/`, a song to `audio.html#/m/`.
- **A row in a studio table is a door, and so is a card on a hub page**: the copy-link action writes
  the address above, never a guess.

`audio.html` and `playlist.html` are real pages now — both were "Page in build" shells. The audio
page is a cover, a byline that names the hub, a transport (play/pause, ±15 s, seek, volume), and a
queue of the same kind; a locked item still shows its cover and its name and asks for the door
instead of the file. The playlist page is a hero, three shelves, and numbered rows. Their two calls
are in `tools/sql/media-pages.sql` — `audio_get(token, ref, kind)` and
`playlist_get(token, ref, shelf)` — plus `song` added to the kind check and a `media_item(code)`
lookup. An item is readable exactly when `creator_hub_view` would have shown it: the hub's door and
the item's own visibility both decide, and a closed one returns `locked` with the name and no file.

Test: `node tools/media-smoke.mjs` — **89/89**: the grammar writes the four shapes and reads back the
six addresses (plus the legacy ones), the video page turns portrait for `#/v/`, the audio page asks
for the right kind and draws its queue with both ids on the byline, a locked item shows the gate and
no player, and the playlist page lights the shelf in its address and gives a landscape row `#/h/`
and a vertical one `#/v/`.

### Member articles — the index, the reader and the writing page

The three article mocks became three real pages, in the site's own clothes: **`articles.html`** (the
index), **`article.html?id=<code>`** (one piece) and **`article-editor.html`** (writing and
publishing), with **`question-editor.html?id=<code>`** as the same editor in its question kind. The
mocks' own theme system and palette were not carried over — only their geometry.

An article is a row of `posts` with `content_type = 'article'`, the same row likes, comments, reports
and reach already live on. It needed one column of its own — `posts.article_meta` (`place`, `field`,
`category`, `main_keyword`, `sub_keywords`, `help`) — and nothing else: the door's passwords table was **renamed**
`video_keys → post_keys`, so a video and an article share one kind of door, and `video_save` is now a
thin wrapper around one general save.

| Call | What it answers |
| --- | --- |
| `article_feed(token, field, sort, search, limit, offset)` | the cards, the fields that have articles, one shelf per field (`rails`), the total |
| `article_get(token, ref, key)` | the piece with its body, `related` (shared keyword) and `more` (same host) — or the door, with the audience, the viewer's own attributes and `asks_password` |
| `article_mine(token)` | the member's own rows, drafts, scheduled and pending ones included |
| `article_save(token, payload)` | one call for a draft, a publish, a schedule or a review; the wrapper on `member_post_save` |
| `article_card(post, viewer)` | `post_card` plus `article { meta, field, category, place, words, reading, host }` |
| `question_save(token, payload)` | the article's save for a space's question: same payload, one `hub` key, six words to publish, `meta.attachments[]` |
| `question_mine(token)` | the member's own questions — the *Your questions* panel of the question page |
| `post_comment_vote(token, comment_id, agree)` | agree / disagree under a comment, one vote per member |

`member_post_save(token, payload, type)` is the one save behind both editors: `title`,
`description`, `body` (article) or `embed` (video), `thumbnail`, `language`, `visibility`, `status`
(`draft` / `published` / `scheduled` / `pending`), `scheduled_at`, `tags[]`, `audience[]`,
`profiles[]`, `passwords[]`, `meta{}`. A key it is **not** given is a list it leaves alone, so a
partial save can never wipe an audience, the named people, the passwords or the tags.

The index searches titles, descriptions **and the body**, filters by one field, and sorts five ways
(`popular`, `newest`, `liked`, `discussed`, `longest`). Unfiltered it leads with one piece, draws a
shelf per field, then lists everything; a card carries the cover, the door's badge (*Exclusive*,
*Private*, *Followers*, *Draft*), the field and category, the writer, the reading time, the reads,
the comments and the age.

**A long piece is read in places, so the reader is handed its index first.** Above the text stands
*In this piece*: every `h2`, `h3` and `h4` the allowlist kept, in the order they are read, numbered `01…`,
a sub-heading set in from its parent — the same rail the editors carry (`assets/js/contents.js`). A press
takes the reader to that line, lights it for a moment, and **writes the place into the address bar**
(`#sec-3`), so a paragraph can be sent to someone; opening a link that already carries that hash lands on
it. The headings get their ids as the body is rendered, never from the server. A piece with a single
heading is not indexed, and the rail stays away entirely.

The reader keeps the measure: a 68-character prose column with the site's type scale, a sticky column
with the writer's card (**Follow** through `profile_follow_toggle`) and the suggestions, a bar with
*Useful / Not useful / Save / Share / Report*, and the conversation. Commenting follows the site rule:
**react first, then the composer**. Bodies are displayed through one allowlist (`article-text.js`) —
no scripts, no frames, no inline handlers, no `javascript:` links — so the body the editor wrote is
the only thing the page can render.

The two doors are the mock's idea on the site's rules:

* **Exclusive** (`limited`) — the gate lists the audience as steps (country, language, level range,
  named member) and marks the ones already true for the viewer; any one is enough. The viewer's own
  attributes come from the server, not from the page. *Remind me* is kept on the device.
* **Private** (`private`) — the gate counts the writer's list and asks for one of the passwords; a
  wrong one says so and stays shut, the right one opens the piece **for that visit** (`?key=…`) and is
  taken back out of the address bar.

The writing page carries what the mock carried, in the site's words: a toolbar (bold, italic,
underline, strike, headings and quote, lists, alignment, link, unlink, clear, image, video, undo,
redo), a title and a description with counters, a contenteditable body that counts words the same way
the server does, a cover (upload, link, first image in the piece, remove), a field + category +
language + tags, the four doors, and *Content* or a *Help section* — a Help piece goes to the
reviewers (`pending`) and is forced **public**, because a help page nobody can read helps nobody. An
image picked in the body gets a floating bar (small / medium / full, left / centre / right, delete).
*Reader preview* opens the piece with a simulated reader (country, language, level) and says whether
that reader would see the piece or the door.

**The niche ladder became a keyword rule.** *Niche*, *Micro niche* and *Nano niche* asked a writer to
name a tree; what a piece is found by is the words people type. So the three boxes became two rungs:

| Rung | Rule | Example |
| --- | --- | --- |
| Main keyword | **three words at most**, one per piece | `الربح من الانترنت` |
| Long-tail keywords | **five at most**, each one **five words or more** and each one **carrying the main keyword** | `الربح من الانترنت من خلال بيع الصور` |

A long tail cannot be typed before there is a head to hang it on — the boxes stay shut until the main
keyword is valid, the same "nothing is named before the thing above it exists" rule the ladder had.
Both rungs judge as they are typed: `3 / 3 words` and `1 / 5` in the panel, over three words marked on
the counter, and beside each line either *"7 words, with “الربح من الانترنت” in it."* or the reason it
was refused (*"It has to carry “الربح من الانترنت”."*, *"3 words — five at least."*). The head is read as
a phrase of whole words, so a comma after it does not break the tail, and a head hidden inside a longer
word does not count. What the editor
saves is `meta.main_keyword` and `meta.sub_keywords[]`; the old `niche / micro / nano` keys are no
longer edited, but a piece that already carries them keeps them — the save carries back every meta key
the form does not own, so a new field on this page can never quietly throw an old one away. The rule
lives in `article-editor.js`, so the studio's writing room wears it too.

**The piece carries its own contents.** The side column opens with a **Contents** rail: every `h2`, `h3`
and `h4` in the body, in the order they are read, numbered `01…`, a sub-heading set in from its parent,
and a count in the head (`3 headings`). It is rebuilt as the piece is written — and only rebuilt when the
headings actually change, so a writer typing in the body never loses the row they were standing on.
Press one and the page scrolls to that heading, the heading lights up for a moment, and **the caret
lands inside it** — the writer carries on from that line instead of from the top of a long piece. An
empty piece says so: *No headings yet. Press H2 in the toolbar and the piece's contents appear here.*

**A piece that already exists somewhere else comes in through *Import HTML*.** The button sits in the
piece's head, beside the title counter, and it is put there by `article-editor.js` itself — so the
studio's writing room has it too, on the same code. The dialog takes the page either way: paste it, or
drop an `.html` file (2 MB at most) — the file is read on the device and never uploaded. What lands is
an article, not a wall of tags, because two things happen in that order:

1. `precleanHtml()` takes the outside world apart — doctype, `<head>`, `<script>`, `<style>`,
   comments, frames and forms, inline handlers, `srcdoc`/`srcset`, `javascript:` links, a table's cells
   turned into lines — and keeps the first `<h1>` (or the `<title>`) as a candidate title. An `<h1>`
   becomes an `<h2>`, because an article has no second title.
2. `sanitizeHtml()` — the allowlist the reader already trusts, unchanged — decides what may stay.

The dialog says what will happen before it happens: how many words, headings and pictures land, and
what is being dropped (scripts, styles, comments, handlers). Two boxes refine it: *take the first
heading as the title, when it is still empty* (ticked) and *replace the body instead of adding to it*.
The button stays asleep while there is no readable text, so an empty paste cannot wipe a draft. The
import is not a second renderer: what it inserts is exactly what the reader would have accepted.

`articles.html` and `article.html` were placeholder pages from `tools/build-pages.mjs`; both were
taken off that list so the generator cannot overwrite them.

DDL + functions: `tools/sql/articles-page.sql` — **applied**. Test: `node tools/article-smoke.mjs` —
**254/254** (the index, the empty index, the reader and its sanitizer, reaction→comment→vote, the
exclusive gate with its steps and reminder, the private gate with a wrong and a right password, a
missing piece, the reader's own contents — the index before the text, a press that lights the heading and
puts the place in the address bar, a one-heading piece that is not indexed — the editor signed out and in,
every toolbar function on a real range, the editor's contents rail — a row per heading, a press that
lights the heading and moves the caret into it — the keyword rule —
a head of three words waking the long tails, a tail refused without the head, a head refused past three
words — importing an HTML
page through the paste box and through a chosen file — scripts, styles and handlers gone, the headline
kept as a heading and offered as the title, a replace that clears the body — the draft on the device,
Ctrl+Enter, a draft payload, an audience payload, a private payload with its member and password, Help
going to review, and the shared word-count / reading-time rules).

Eleven pieces from @ledsizar, @jhon007 and @ledsizar7 remain on the index — nine public, one
exclusive (`PST-001020`, open to LV5–LV10) and one private (`PST-001021`, the password is
`1world2026`), so both gates can be seen without publishing anything.

### A blog's reading page — `blog.html?studio=<code>`

The studio writes a blog's articles and `articles.html` lists every article on the platform, but the
**blog itself** — the place a reader lands — did not exist. `blog.html?studio=IDBL100003` is that page,
built in the shape the blog mock asked for and in the site's own clothes: a **cover** carrying the
blog's mark and its name, its words, its sections as chips, one **search** over everything in it, the
numbers under the name (*articles · writers · reads · comments*), a **most read** rail, **one row per
section**, the **sections themselves** to walk into, and a section view with its own sort and *More*.

The sections are the blog's **categories** when its pieces carry them, and the pieces' **fields** when
they do not — a blog that made a category and never used it still reads as a set of shelves rather
than one empty one. The server decides which and says so (`by`), and every link the page builds carries
that back with it.

| Call | What it answers |
| --- | --- |
| `blog_page(token, ref, password)` | the cover, the mark, the name, the words, the sections with their counts, and the numbers — or `locked`, with nothing inside |
| `blog_feed(token, ref, section, by, search, sort, limit, offset)` | the pieces of one section (or the whole blog), searched and sorted, as the same cards `articles.html` draws |

The door is the hub's own door — `blog_page` asks `creator_hub_view`, so owner, staff, VIP list,
password and exclusivity are decided in one place — and every card is filtered by `post_visible_to` on
top of it, so an exclusive piece keeps its audience even inside a public blog. A private blog shows its
name and asks for the password (`?key=…`); a wrong one says so and stays shut.

The page is set like a magazine: the cover is a **poster** — its words stay light in both themes,
whether the blog has a picture or the page's own cloth — one **lead piece** opens the most-read rail
(wide, in the serif), the rails fade at the edge instead of showing a scrollbar, the numbers under the
name are one hairline-divided strip, every row head carries a rule and an accent bar, and a section
card turns into a walk-in with its arrow. Reduced motion is respected; a blog with no cover, no logo
and nothing published still has a page that looks deliberate.

The page has two doors into it: **Open the blog**, beside *Write an article* on the studio's Articles
tab, and **Read the blog** on the hub page a visitor reaches with `creator.html?studio=<code>`.

### The writing surface — one editor, every function

Both writing pages now edit through **`assets/js/rte.js`**, a small rich-text core written on DOM
ranges instead of `document.execCommand` — deprecated, unavailable after a programmatic insert, and
in charge of an undo stack nobody can reason about. It is one code path in every browser, which is
also why it can be tested at all: jsdom has no `execCommand`, so `node tools/rte-smoke.mjs` exercises
the real thing.

What it does, all of it reachable from the toolbar:

| | |
| --- | --- |
| **Inline** | bold · italic · underline · strikethrough — press again to take it off |
| **Blocks** | paragraph · heading 2 · heading 3 · quote, applied to everything the selection touches |
| **Lists** | bulleted · numbered, and pressing the same button again turns them back into paragraphs; **Tab** nests an item, **Shift+Tab** lifts it |
| **Alignment** | left · centre · right |
| **Links** | a link around the words that were selected, or one inserted at the caret; unlink |
| **Insertion** | image (as a figure with a caption) · video (as a captioned link, never a frame) · rule |
| **Clearing** | remove the formatting, keep the words |
| **History** | its own undo and redo, with the caret bookmarked by path, so undo survives an inserted picture |
| **Keys** | Ctrl/Cmd + B · I · U · Shift+X · K (link) · Z / Shift+Z / Y · Enter (publish) |
| **Paste and drop** | pasted text arrives as paragraphs with the markup escaped; a pasted or dropped address becomes a link; a dropped picture is uploaded and inserted |

The bar also **reflects the caret**: stand in a bold run and Bold lights up; move into a heading and
the block select follows. `keepSelection` on the toolbar stops a click from taking the caret with it,
and the engine remembers the range when a dialog opens, so a link or a picture lands where the member
was writing rather than at the end.

The article editor gained the rest of the mock while it was open: the **keyword rule** below, the
**draft on this device** (written 900 ms after the last
keystroke, restored on the next visit, cleared when the piece is published or sent to review, and
dated in the status line), **Ctrl/Cmd+Enter** to publish, and a **follows-you** switch in the reader
preview so the followers-only door can be tried as well.

The video editor gained the mock's uploads and the same safety net: **a picture from the machine** as
the thumbnail, **a video file from the machine** (up to 50 MB, with the percentage on the page, and
the storage address written into the field when it lands), a **draft on the device**, **Ctrl/Cmd+Enter**,
a link **pasted anywhere** on the page, and the mock's five **age ratings** (3+, 6+, 13+, 16+, 18+).

**The player is now in the editor.** As soon as the field holds a link the source is framed under it —
a `<video>` for a real file, the host's own frame for everything else, with the thumbnail as the
poster — so a member sees what they are publishing before they publish it. The live-preview card
carries a play glyph over the still, and when there is no still it names the host rather than showing
a grey rectangle.

**The hosts live in one place**, `assets/js/embed.js`, used by the editor, the watch screen and the
`meta.source` the save records: **YouTube** (watch · youtu.be · shorts · live · embed) · **Vimeo** ·
**Dailymotion** · **TikTok** · **Facebook** (watch · fb.watch · fb.me) · **Google Drive** ·
**Pinterest** (a `/pin/<id>/` link frames the pin; a `pin.it` short link is handed to Pinterest) ·
**Reddit** (`/r/…/comments/<id>/` and `redd.it` frame the thread) · a direct file. Anything else is
framed as it is — some sites refuse to be framed, and the player then says so instead of showing a
blank rectangle.

**Thumbnails, honestly.** YouTube hands a still over with the link, so it arrives by itself and the
member never clicks anything; TikTok, Pinterest, Vimeo, Dailymotion and Reddit are asked through
their **oEmbed** endpoint, once per link, with a five-second leash — if the host answers, the still is
used, and if it refuses (Facebook and Drive want a token) nothing happens and the thumbnail panel says
*"Facebook does not hand us a picture — upload one so the card is not blank."* A picture the member
uploaded or typed is never overwritten by an automatic one, and an automatic picture is dropped when
the source leaves the host that gave it.

**The uploads needed a database change, and did not have one.** The `source` bucket is public to read
but every write passes a policy on `storage.objects`, and the only folders a browser could write to
were `users/messages`, `users/posts` and `users/profile`. `users/articles/…` — where the article
editor was already uploading — was refused. `tools/sql/storage-editors.sql` **opened the two folders
the editors need**, each pinned to a name pattern and a set of extensions (`users/articles/*.jpg|png|webp|gif`,
`users/videos/*.mp4|webm|ogg|mov`); video thumbnails go to `users/posts/`, which was already allowed.

| Gate | Result |
| --- | --- |
| `node tools/rte-smoke.mjs` | **45/45** (every command, links, insertion, history, paste, drop, keys, toolbar state) |
| `node tools/article-smoke.mjs` | **281/281** |
| `node tools/blog-smoke.mjs` | **82/82** (the address, the closed door, the hero, the home, a section, the search, the plain cover) |
| `node tools/video-smoke.mjs` | **321/321** (the two uploads through a stand-in for `XMLHttpRequest`, every host in the list, the player, the oEmbed still and the oEmbed refusal) |
| `node tools/media-smoke.mjs` | **89/89** (the address book, the three pages, the portrait stage, the locked item, the shelves) |

### The six OAuth apps — one checklist each

The dashboard can hold eight networks. Two of them (Telegram, WhatsApp) link with a code we
mint; the other six need an **OAuth app** each — a client id, a client secret and one redirect
URI. Nothing is created on your behalf: the app must belong to the account that will show its
name on the consent screen. What is already built is everything after that.

**One redirect URI, for all six.** Paste this exact string into every console — same casing,
same scheme, no trailing slash:

```
https://vtbqbhuywdhnvitbcsfy.supabase.co/functions/v1/oauth-link/callback
```

It is also the row `oauth_redirect` in `site_secrets`; if the two ever disagree the provider
answers `redirect_uri_mismatch` and nothing else happens. Deploy the function once:

```bash
supabase functions deploy oauth-link --no-verify-jwt
# no secrets to add: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are already in the runtime
curl -s https://vtbqbhuywdhnvitbcsfy.supabase.co/functions/v1/oauth-link/health
# {"ok":true,"service":"oauth-link"}
```

| Network | Console | App you create | What you copy | Scope |
| --- | --- | --- | --- | --- |
| Google | console.cloud.google.com | **OAuth client ID** → *Web application* | Client ID + Client secret | `openid email profile` |
| Facebook | developers.facebook.com | **Consumer** app + *Facebook Login* | App ID + App secret | `public_profile` |
| X | developer.x.com | App with **OAuth 2.0**, type *Web App, Automated App or Bot* | Client ID + Client secret | `users.read tweet.read offline.access` |
| Pinterest | developers.pinterest.com | **OAuth app** (single client) | App ID + App secret | `user_accounts:read` |
| Reddit | reddit.com/prefs/apps | **web app** | client id (under the name) + secret | `identity` |
| TikTok | developers.tiktok.com | App + **Login Kit** | Client key + Client secret | `user.info.basic` |

#### Google — the one that works on day one

1. Create (or pick) a project at **console.cloud.google.com**.
2. **APIs & Services → OAuth consent screen**: *External*, app name `1World`, your support email,
   and the two scopes `.../auth/userinfo.email` and `.../auth/userinfo.profile`. While the app is
   in **Testing**, add your own address under **Test users** (100 max) — nobody else can consent yet,
   which also means nobody else can *sign in* with Google (see **Signing in with a linked account**).
3. **Credentials → Create credentials → OAuth client ID → Web application**. Under *Authorized
   redirect URIs* paste the URI above. No JavaScript origin is needed: the exchange happens on the
   server.
4. Copy the **Client ID** and **Client secret** into `site_secrets` (the block at the end of this
   section). Nothing has to be published or verified: `email` and `profile` are not sensitive
   scopes, so there is no review — only the *Testing* cap on test users, lifted by publishing.

#### Facebook / Meta

1. **developers.facebook.com → My Apps → Create app** → use case *Authenticate and request data
   from users*, type *Consumer*.
2. Add the product **Facebook Login → Settings** and paste the redirect URI into **Valid OAuth
   Redirect URIs**; put your site's host in **App Domains**.
3. **App settings → Basic** gives the **App ID** and **App secret**.
4. While the app is in **Development** mode only admins, developers and testers can sign in (add
   them under *App roles → Testers*). Going public needs App Review of `public_profile` plus
   business verification — that is Meta's queue, not our code.

The app already in use here is **1W**, id `1142180755132298`; that id lives in
`site_secrets.facebook_client_id` and is public by design (it travels in every authorize URL).
Its `facebook_client_secret` is set (rotate it: the value passed through a chat window). One
console step is still missing and the callback says so in Facebook's own words — `191`, *the
domain is not in the app's domains*: put `<ref>.supabase.co` in **App settings → Basic → App
Domains** and the callback URL in **Facebook Login → Settings → Valid OAuth Redirect URIs**. The
older note below explains which value is *not* the secret — and it is **not** the token the
**WhatsApp → API Setup** page offers. That is a *user* access token (type `USER`, scopes
`whatsapp_business_*`, gone in a day) and it can never finish a login: the exchange in
`oauth-link` needs the App Secret. Take it from **App settings → Basic → App secret → Show**
(the account password is asked again), then:

```sql
insert into public.site_secrets (key, value) values ('facebook_client_secret', '<the secret>')
on conflict (key) do update set value = excluded.value;
```

`oauth_ready('facebook')` turns true on its own, so the button appears in `login.html` and in
**Account settings** at the next load — no deploy, no code. To check from the outside without a
human, start a sign-in and open the callback by hand with a made-up code: a `token` answer that
quotes `invalid_client` means the secret is wrong, `invalid_grant` means everything is right.

#### X

1. **developer.x.com → Projects & Apps** → create a project and an app inside it.
2. **User authentication settings → Set up**: *App permissions* at least **Read**; *Type of App*
   **Web App, Automated App or Bot** (a *Native App* will answer `unauthorized_client`); *Callback
   URI* = the redirect URI above; *Website URL* your site.
3. Scopes: `users.read`, `tweet.read`, `offline.access` (the last one is what returns a refresh
   token — without it the row works until the access token expires).
4. **Keys and tokens → OAuth 2.0 Client ID and Client Secret**. The token endpoint wants HTTP
   Basic auth, which `oauth_config()` already sets (`token_basic: true`).

The app configured here answers `invalid_request — Value passed for the authorization code was
invalid` to a made-up code, which is the good answer: the client id, the secret, the PKCE verifier
and the callback are all accepted, only a human is missing. A **401** instead means the secret is
wrong, and `unauthorized_client` means the app type is not *Web App, Automated App or Bot*.

X has no testing mode and no review for these three scopes, so the button works for every member
the moment the two rows are in `site_secrets` — unlike Google and Meta. Opening the authorize URL
by hand returns the **“Authorize app / X”** page; any other page means the callback address in
*User authentication settings* is not the one in `oauth_redirect`.

#### Pinterest

1. **developers.pinterest.com → My apps → Create app**: name, website, privacy policy, the use
   case *Content* or *Analytics*, and the redirect URI above.
2. A new app gets **Trial access**, which is enough to connect accounts you control; *Standard*
   access is a short application.
3. **App ID** and **App secret** go into `site_secrets`. Tokens last 30 days and refresh tokens
   60 — long enough for a link, which never needs the token again until we build sign-in with it.

#### Reddit

1. **reddit.com/prefs/apps → create another app…**, type **web app**, redirect uri = the URI above.
2. The **client id** is the short string under the app's name; the **secret** is beside it.
3. Scope `identity` plus `duration=permanent` is what asks for a refresh token. Reddit refuses
   requests without a distinctive **User-Agent**, so `oauth_config()` sends
   `web:1world:v1.0 (by /u/1world)` — replace the handle with your own moderator account.

#### TikTok

1. **developers.tiktok.com → Manage apps → Connect an app**, then add the product **Login Kit**.
2. **Redirect URI** = the URI above (https is required outside localhost); scope `user.info.basic`
   (display name, avatar, open id).
3. **Client key** and **Client secret** go into `site_secrets` — TikTok says *key*, not *id*, and
   `oauth_config()` sends `client_key` for you.
4. Before review, only accounts you list as **testers** in the app can sign in, and the `open_id`
   is app-scoped: the same person authorises two apps under two different ids. That is why a link
   is stored per provider and never merged across providers.

#### Turning one on

One block, once, replaces the placeholders. `oauth_ready()` looks at exactly these rows:

```sql
insert into public.site_secrets (key, value) values
  ('oauth_redirect', 'https://vtbqbhuywdhnvitbcsfy.supabase.co/functions/v1/oauth-link/callback'),
  ('google_client_id',     '<from Google>'),
  ('google_client_secret', '<from Google>'),
  ('facebook_client_id',     '<from Meta>'),
  ('facebook_client_secret', '<from Meta>'),
  ('x_client_id',     '<from X>'),
  ('x_client_secret', '<from X>'),
  ('pinterest_client_id',     '<from Pinterest>'),
  ('pinterest_client_secret', '<from Pinterest>'),
  ('reddit_client_id',     '<from Reddit>'),
  ('reddit_client_secret', '<from Reddit>'),
  ('tiktok_client_id',     '<from TikTok: the client key>'),
  ('tiktok_client_secret', '<from TikTok>')
on conflict (key) do update set value = excluded.value, updated_at = now();

select public.identity_providers_ready();
-- {"google":true,"facebook":false,"x":false,"telegram":true,"whatsapp":true,
--  "pinterest":false,"reddit":false,"tiktok":false}
```

There is no restart and no redeploy: the button in **Account settings** becomes **Connect** the
next time the card loads (`member_account().providers`). A network whose two halves are missing
keeps the disabled button and the tooltip, which is the honest state.

**How the flow runs.** Connect → `member_identity_start()` stores a 24-character `state` and a
PKCE verifier in the pending row and returns the provider's authorize URL → the dashboard opens a
small window there → the provider sends the browser back to `oauth-link/callback` → the function
spends the state (`oauth_state_take`), exchanges the code for a token, reads the id, and writes the
verified row (`oauth_identity_save`) → the page `postMessage`s the dashboard and closes itself.
The token stays in the database; the browser only ever sees the row's handle.

If the provider answers with an error, the page says it in one sentence — quoting what the
provider itself replied — the dashboard shows the same sentence in a toast, and the pending row
stays until it expires in 20 minutes.

That quote is a diagnostic. Start a link, then open the callback by hand with a made-up code:

```bash
curl -s "https://vtbqbhuywdhnvitbcsfy.supabase.co/functions/v1/oauth-link/callback?code=PROBE&state=<the state from the pending row>"
```

| It answers | It means |
| --- | --- |
| `invalid_grant` | the client id, the client secret **and** the redirect URI are all accepted — only a human is missing |
| `invalid_client` | the secret is wrong (or the app belongs to another project) |
| `redirect_uri_mismatch` | the console does not hold that exact callback URL |
| `taken` | that account is already linked to another member |
| Facebook `191` | the app's **App Domains** does not hold the callback's host (`<ref>.supabase.co`) |

The Google app registered for this deployment lives in project `world-513621`, client
`1064454656570-sau2tuji464dfd64lm0jl6iau4ml6pdk` — public by design, it travels in every
authorize URL. The secret is **only** in `site_secrets.google_client_secret`; if it is ever
pasted anywhere else, rotate it in **Clients → your client → Reset secret** and update that row
with one `insert … on conflict (key) do update`.

#### Going live — the test-user cap, and the message it prints

While an app sits in **Testing** (Google) or **Development** (Meta), only the accounts named in
its console can finish a sign-in. Meta's wording for the others is not helpful:

> **App not active** — This app is not accessible right now and the app developer is aware of the
> issue. You will be able to log in when the app is reactivated.

Nothing is broken: that is the app still being unpublished, or the browser being signed into a
Facebook account that is not on the app's role list. Check it without trusting your memory —

```bash
curl -s "https://graph.facebook.com/v21.0/<app-id>/roles?access_token=<app-id>|<app-secret>"
```

answers every admin, developer and tester. For this deployment that list held one administrator
and no testers, which is exactly the state that prints the sentence above. Two ways out:

| | What to do | Covers |
| --- | --- | --- |
| Now | **App roles → Roles → Add people → Tester**, one row per Facebook account that must sign in today | testers only |
| For the members | **App settings → Basic**: App Domains, a **Privacy Policy URL** (`privacy.html` is a real page now), a category and an icon, then the **App Mode → Live** switch | anybody |

Google is the same story with different words: *Testing* caps at 100 hand-added addresses, and
**Publish app** lifts it — the consent screen then needs a privacy policy link, which `privacy.html`
supplies. Facebook asks for one more thing before it lets an app go public: a **Data Use Checkup**
under *Settings → Basic* when the dashboard shows the reminder.

### Signing in with a linked account

A linked account is also a way *into* the site. `login.html` grows a **Continue with …** row
under the Log in button — one button per network that is fully configured
(`oauth_login_providers()`), each carrying the official mark from `brands.js`. A member can then
sign in with Google and no password, and the same is true for the other networks as their apps
come online.

The rule is one line: **an unlinked account is refused**. Signing in never creates a member and
never links anything — that would let anyone who controls a Google account walk into a fresh
membership. So an unknown provider account gets *“this account is not linked to a member”* and is
told to sign in with the password and link it from Account settings.

**Why a ticket and not the session.** The provider returns the browser to the function, not to
`login.html`, so the session cannot be written there — a URL is the wrong way to carry a token
(it lands in history, in `Referer`, in screenshots). Instead:

1. The button calls `member_oauth_login_start(provider, ip, agent)` — it stores a 20-minute
   pending row (`oauth_logins`) with a 24-character `state` and a PKCE verifier, and hands back
   the authorize URL. The window is opened **on the click**, so it is not blocked.
2. The provider comes back to `oauth-link/callback`. `oauth_attempt_take(state)` says which kind
   of attempt this is — `login` or `link` — from the row alone, never from the browser. A login
   state exchanges the code, reads the id, and calls `oauth_login_complete(login_id, external,
   handle)`, which either answers `unlinked` or mints a **ticket**: 64 hex characters, one use,
   five minutes.
3. The little page `postMessage`s `{type:"1world-oauth-login", ok, provider, ticket}` to the
   window that opened it and closes itself. The login page calls
   `member_oauth_login(ticket, remember, ip, agent)`, gets the same session shape the password
   path returns, stores it with `setSessionToken` and shows the signed-in card — *“Signed in with
   Google.”*

Two windows are therefore not optional. A browser that blocks the pop-up gets
*“Allow pop-ups for this site and try again”* instead of a same-tab trip that would end on the
function's page with nowhere to put the ticket; and a callback opened by hand (no opener) says
*“Signing in finishes in the window that started it”* and points at `login.html` rather than
pretending it is done.

Restricted members (inactive, banned, expired) sign in exactly as they do with a password: the
session exists, the banner says which state the account is in, and the dashboard stays shut.

| Function | Purpose |
| --- | --- |
| `oauth_login_providers()` | the networks a login button may be drawn for |
| `member_oauth_login_start(provider, ip, agent)` | a pending `login` attempt; returns `{url, expires_at}` |
| `oauth_login_complete(login_id, external, handle)` | after the exchange: `unlinked`, or a one-use ticket |
| `member_oauth_login(ticket, remember, ip, agent)` | spends the ticket and returns `{session, member, restricted}` |
| `oauth_login_sweep()` | drops the attempts that expired |

`oauth_attempt_take` and `oauth_login_complete` are **service role only**, so the browser can
neither mint nor read a ticket — it can only spend the one the function gave it. Of the whole
OAuth surface exactly three functions answer the anon key: `oauth_login_providers`,
`member_oauth_login_start` and `member_oauth_login`. The rest — `oauth_config` (which returns a
client secret), `identity_token`, `oauth_identity_save`, `oauth_state_take`, `oauth_attempt_take`,
`oauth_login_complete` — are revoked from `public`, `anon` and `authenticated` and granted to
`service_role`; the block that does it is the last section of `tools/sql/oauth-signin.sql`. Run it
in any project where a blanket `grant execute on all functions in schema public` ever ran: without
it, `POST /rest/v1/rpc/oauth_config` with the anon key hands out the Google client secret.

### Server surface

| Function | Purpose |
| --- | --- |
| `member_dashboard(token)` | the whole page: member, ban, court, overview, codes, devices, notifications, prefs, lists, reports, prizes, ledger, history |
| `member_code_create(token, code, months, age, mac, name)` | six digits, 1/3/6/12 months, an age rating, an optional device; active accounts only |
| `member_code_action(token, code_id, action)` | `unlink`, `delete`, `disable`, `enable` on a code the caller owns |
| `member_device_delete(token, device_id)` | removes a device and frees its code |
| `member_notify_set(token, source, enabled)` | per-section switch; `messages` and `court` return `locked` |
| `member_notify_read(token, id)` | marks one notification read |
| `member_list_remove(token, list_id)` | drops a favorites / later / completed row |
| `member_account(token)` | identity, security flags and the linked identities — the Account settings card |
| `member_api_keys(token)` / `member_api_key_save(token, id, platform, label, key)` / `member_api_key_delete(token, id)` | the Platforms panel: the accepted list and the masked rows, then add/replace and remove. The key itself is never returned |
| `member_change_password(token, current, password)` | the current password is required; every other session is revoked |
| `member_identity_start(token, provider)` | mints the link: Telegram's deep link + code, WhatsApp's 6-character code, `oauth` for the six networks that need an app |
| `member_identity_verify(token, provider, code)` | verifies the WhatsApp code; Telegram is verified by the bot, so it answers `use_bot` |
| `member_identity_unlink(token, provider)` | drops a verified row |
| `telegram_identity_link(code, chat, username)` / `telegram_identity_unlink(chat)` | what the bot calls — the only writers of a chat id |
| `oauth_config(provider)` | the whole recipe for one network (URLs, parameter names, Basic auth, where the id hides, the client secret) — service role only |
| `oauth_ready(provider)` / `identity_providers_ready()` | is the app complete? and which of the eight the dashboard may offer |
| `oauth_authorize_url(provider, state, verifier)` | the authorize URL, PKCE challenge included (internal) |
| `oauth_state_take(state)` | the callback: which member, which verifier, and it spends the state — service role only |
| `oauth_identity_save(member, provider, external, handle, token…)` | the verified row; one external account belongs to one member (`taken`) — service role only |
| `oauth_login_providers()` / `member_oauth_login_start(provider, ip, agent)` | the sign-in buttons, and the pending `login` attempt behind one of them |
| `oauth_login_complete(login_id, external, handle)` / `member_oauth_login(ticket, remember, ip, agent)` | the exchange's verdict (`unlinked`, or a one-use ticket), and the session that ticket buys |
| `identity_token(member, provider)` | the stored token, for the service role alone |
| `member_court_request(token)` | banned, non-permanent accounts ask for a trial |
| `member_court_history(token)` | every case of the caller, for `court.html` |
| `member_activation_state(token)` | what `activated.html` may offer: `mode` (`activate` / `choose` / `blocked`), `first_activation`, `can_reactivate`, `can_upgrade`, `upgrade_targets`, `prices`, `durations`, `ad_url`, profile, 30-day deadline |
| `activation_profile_save(token, name, description, avatar, cover, language, country)` | step 1 — writes `members` (name, bio, avatar/cover URL, language, country) and mirrors the row into `profiles` |
| `activation_viewing_code_save(token, code, months, age, device, device_name)` | step 2 — six digits, unique, age rating, device/MAC bound in `viewing_codes` + `watch_code_devices`; free ⇒ one month |
| `activation_ad_open(token, type, target, duration)` | step 3 — opens a pending ad session, returns the ad URL and the 30-second rule |
| `activation_ad_claim(token, session)` | issues the code **only** when 30 s have really passed on the server (`too_soon, remaining` before that) |
| `activation_ad_cancel(token, session)` | abandons a pending ad session |
| `activation_pay_points(token, type, target, duration)` | premium: deducts the points (`points_ledger`), writes `payment` + `paymentlog` and issues the code in one transaction |
| `activation_redeem(token, code, type, target, duration)` | consumes the code and moves the membership (`free` after the first activation, the same plan on re-activation, the higher tier on an upgrade) |
| `member_activation_request(token, note)` / `member_reactivate_request(token, note)` | the earlier moderator-request pair, kept for old links |
| `member_purge_stale(dry_run)` | service role only — the 30-day policy: never-activated or lapsed accounts are deleted, payments are kept with `member_ref` |
| `admin_ban_member(member, reason, by, permanent)` | service role only |

No table is readable from the browser: `viewing_codes`, `watch_code_devices`,
`notifications`, `notification_prefs`, `member_lists` and `court_cases` all have RLS on with
no policies, and the token is only ever compared inside `member_from_token()`.

### The two pages beside it

`activated.html?member=ID_MEMBER` follows one rule: **first activation happens once, on the
free plan, and only on the first visit** — after that the page offers two doors, **re-activate
the membership** or **upgrade it**. Which doors exist is decided by `member_activation_state()`.

| Situation | Page |
| --- | --- |
| Never activated · inactive · free | The four-step wizard; the 30-day deadline is printed above it |
| Never activated · paid plan | No wizard (activation is a free-plan step): the doors, with a note that the paid plan opens by itself |
| Activated before · inactive / expired | Two doors: re-activation (ad gate on free, Patreon or points on premium) and upgrade |
| Activated before · active | Two doors — renewing early is allowed, the new period starts where the old one ends |
| Diamond | Re-activation only: no tier above it, so the upgrade card is disabled |
| Banned | Neither door: the only path is the trial, with a link to the dashboard and to the court |

**Step 1 — create profile.** Profile name, description, avatar, cover, language and country (the
country comes from the IP lookup and stays editable). Images are previewed locally, uploaded to
Supabase Storage `source/users/profile/` as `avatar_IDMEMBER.ext` / `cover_IDMEMBER.ext`, and the
URLs are saved through `activation_profile_save()`.

**Step 2 — create viewing code.** Six digits, typed or generated, unique across the platform; an
age rating (Unspecified / 13+ / 16+ / 18+); duration fixed to one month on the free plan; the
device identifier is detected in the browser (it is what player apps report as a MAC) and bound
to the code in the same call.

**Step 3 — get activation code.** *Get Activation Code* opens the ad in a new tab and starts a
30-second countdown. The timer is **server-side**: `activation_ad_open()` records `ad_started_at`,
`activation_ad_claim()` refuses with `{error: too_soon, remaining}` until 30 real seconds have
passed, and only then mints a code (`ACT-XXXX-XXXX`, unique, 7-day expiry). Closing the ad page
pauses the countdown (re-opening resumes the same session, it never resets it), the code is
filled into the box automatically, and *Activate Account* appears once a code is present.

**Step 4 — activate account.** *Activate Account* → “Activating Your Account…”, the progress bar,
`activation_redeem('initial')`, then “Account Activated Successfully!” and *Finish* → dashboard.
The RPC refuses a wrong, used, expired or foreign code, a second first activation
(`already_activated`), a paid plan (`plan`) and a duration other than one month.

**Re-activation** extends the plan without ever changing the tier. Free membership renews one
month at a time through the same ad gate; premium plans choose 3, 6, 9, 12, 18 or 24 months and
pay with **Patreon** (redirect, then paste the code you receive) or **points** (the price is
shown first, the points are deducted and the code issued in one transaction). The code must be
valid, unused, of type `reactivation`, for the same plan and for the chosen duration.

**Upgrade** is premium-only and strictly upwards — Free → Silver/Gold/Diamond, Silver →
Gold/Diamond, Gold → Diamond; Diamond has no upgrade. Same payment paths, and the code must be
type `upgrade`, unused, for the target tier and the chosen duration. The membership changes and
the code is consumed in one transaction, then “Membership Upgraded Successfully!”.

**The 30-day policy.** `member_purge_stale(true)` counts and `member_purge_stale(false)` deletes
accounts that were never activated within 30 days, and accounts whose membership expired more
than 30 days ago without a re-activation. Financial records survive: `payment` keeps the row with
`member_ref` (the member id) and `member_id` set to null, and `paymentlog` keeps the trail. The
function is service-role only, so it can be called by a scheduled job (`pg_cron` or the
dashboard's scheduler) without exposing anything to the browser.

**Storage.** The `source` bucket already holds the sounds; `users/profile/` is the only folder
the browser may write to, and only with the fixed names
`avatar_ID123456.jpg` / `cover_ID123456.jpg` (`source_profile_insert`, insert only; a matching
`source_profile_read` covers the API's own read-back). A publishable key must travel in the
`apikey` header **only** — sending `Authorization: Bearer sb_publishable_…` makes the storage API
parse a non-JWT and answer `403 new row violates row-level security policy`, so the page sends
`apikey` first and retries with the Bearer form for deployments that still use the legacy anon
key. A refused upload never traps the member in step 1: the profile is saved without the image,
the reason is printed inline, and the image can be added later from `profile.html`. Replace the
policy with signed uploads when real auth lands.

`court.html?id=ID_COURT` is the case file: case number, date and time, judge / defendant /
plaintiff, reason, status, the absence warning and the verdict with the court note. A case id
that belongs to somebody else shows “Case not found”, because `member_court_history()` only
returns the caller's cases.

### The platform shelf — `panel.html` and section 09

Section 09 on the homepage (`#platform`, *Fourteen places to follow the project*) is no longer a
list in `config.js`. It reads a table:

**`public.platform`** — one row per place.

| Column | What it holds |
| --- | --- |
| `id` / `code` | uuid, and a readable code (`PLT100015`) minted from `public.platform_code_seq` |
| `name` | the platform's name, 1–60 characters |
| `username` | the handle you follow (`@CineauraV2`, `r/Cineaura2`, `c-7972430`) |
| `url` | the link the card opens, `http(s)://` only |
| `logo_url` | an uploaded logo or a pasted picture link; empty falls back to the brand glyph |
| `icon` | the fallback glyph's key, from `brands.js` (youtube, telegram, tumblr …) |
| `status` | `available` — it is on the homepage — or `unavailable` — kept here, invisible there |
| `sort_order` | low numbers first |

The name + handle pair is unique, so the same platform can appear twice with two handles but never
the same one twice. Row level security is on with no policies: the table is reached through two
functions and nothing else.

| Function | Who | What it answers |
| --- | --- | --- |
| `platform_public()` | anyone, no session | the **available** rows in order — the only door a visitor has |
| `platform_admin_list(token)` | staff | every row, available or not, with `{ok, admin, rows}` |
| `platform_save(token, id, name, username, url, logo, icon, status, sort)` | staff | insert (`id` null) or update, with `duplicate` / `url` / `name` refusals |
| `platform_delete(token, id)` | staff | removes one row |

**The page.** `panel.html` is the control panel's first desk. It shows the three honest states
first — no session (sign in), a session that is not staff (the desk is shut), a table that did not
answer (try again) — then the rows: the logo, the name and its code, the handle, the host of the
link, the status as a **switch** (one click writes `platform_save` with the other status) and a
delete that asks once (`Remove?`) before the second click writes. The dialog holds every field,
takes a logo by drop, file or link (the `source` bucket, `users/platform/…`, with its own
`storage.objects` policies in the same SQL file) and validates before it calls the server. The stats strip counts all / available /
unavailable, the search reads name, handle, code and link, and the filter sits beside it.

**The homepage.** `assets/js/platforms.js` is the only reader: `platform_public()` once, cached for
the page, drawn by the homepage rail (`#platform`) and by the footer's social dots — so switching a
platform off takes it off both. The card shows the uploaded logo when there is one and the brand
glyph when there is not. The heading counts what the table gave (`Fourteen places…`, `One place…`),
and a table that is reachable but empty hides the section instead of showing a blank rail. If the
call fails — offline, or a deploy that has not run `tools/sql/platforms-page.sql` — the shelf falls
back to the list the build ships with, so the homepage is never empty. The shipped fourteen rows are
seeded by the SQL file, so nothing changed on the page the day the table arrived.

### The look — one system for every page

Every page reads from three shared sheets — `base.css` (tokens, type, buttons, form, skeleton),
`layout.css` (header, rail, sidebar, footer) and `components.css` (sections, rails, posters, chips) —
so the site is dressed in one place. The pass that made the pages more attractive added light and
depth, never a new shape, a colour or a library: the same monochrome identity, a little more air.

- **Ambient light.** `body` carries two fixed radial washes — one from the top centre, one faint from
  the bottom-right — under the film grain, with a dark twin for `html[data-theme="light"]`. Nothing
  else paints a page background, so the light is continuous from page to page.
- **Fading hairlines** instead of hard rules: `.section--line`, `.site-footer` and the browse-page
  mastheads each draw a 1px rule that fades at both ends, so a divider never looks like a cut.
- **Glass** where something floats over content: the rail arrows (`.rail__btn`) and the sticky filter
  bars (`.abar` on `articles.html`, `.vbar` on `videos.html`) are `color-mix` backgrounds with
  `backdrop-filter: blur() saturate()`, so text scrolling under them stays readable.
- **A beveled primary button.** `.btn--primary` is a three-stop gradient with an inset top highlight
  and a bottom shadow; primary, ghost and icon buttons all lift 1px on hover, and `:focus-visible`
  paints a soft halo outside the outline so the keyboard ring reads on light and dark alike.
- **Posters answer the pointer.** `.pcard__media` takes a diagonal sheen sweep and the hovered card a
  1px inset ring; the hero scrim fades into the page at its foot instead of ending on a line.
- **Editorial type.** The browse pages carry their title in `--font-serif` at a larger optical size
  (`.arts__title`, `.vids__title`), matching the blog's magazine masthead, while the app pages stay
  in the sans for density. Reduced motion turns off the sheen, the lift and the ticker.

Cache stamps on those three sheets travel with the pages, so a change to `components.css` reaches a
browser that already has the old file.

### Tests

```bash
node tools/session-smoke.mjs     # 15 checks: one token in localStorage, seen by the next page, dropped when expired
node tools/dashboard-smoke.mjs   # 272 checks: the five gates, rail, popover, codes, sections, Unlock now, Account settings, the seven creator tabs, the management pane, the Publisher program
node tools/sidebar-smoke.mjs     # 93 checks: the edge, the pin, Escape, the mobile drawer, the dashboard menu
node tools/panel-smoke.mjs       # 90 checks: the desk's three states, the rows, the switch, the dialog, the shelf
node tools/court-smoke.mjs       # 115 checks: the four steps, uploads, both doors, the court room
node tools/creator-smoke.mjs     # 372 checks: the search (owners + publishers), the tables, the editors, a publisher's seat
node tools/media-smoke.mjs       # 89 checks: the address book, videos.html#/h|v/, audio.html#/p|m/, playlist.html#/videos|podcasts|songs/
node tools/publisher-smoke.mjs   # 52 checks: the program, the seat, the links, and the hand-off to the creator page
node tools/iptv-smoke.mjs        # 43 checks: the playlists, the groups, the page, the deep links
node tools/activated-smoke.mjs   # 35 checks: hidden panels, image link, ad pause, code return
node tools/rest-smoke.mjs        # 32 checks: the three steps, the link, the device path, the .txt
node tools/delivery-smoke.mjs    # 35 checks: the Apps Script itself — email, WhatsApp, Telegram
```

`dashboard-smoke.mjs` boots the page in jsdom with a stubbed `member_dashboard` and walks the
five states: inactive (activation link with the member id, no rail, no menu), banned (reason,
request → requested), scheduled (date, `court.html?id=…`, absence warning), upheld (closed,
log out only) and active (12 rail items, drag-enabled rail, sidebar, overview numbers, the
popover's filters and both paths, the two locked switches, the code generator, the devices
tab and every section rendering). Its last passes walk **Account settings**: three password
boxes and no email editor, the eight networks with the six OAuth rows disabled, Telegram's deep
link carrying the code, WhatsApp's code box verified and the row unlinked again, a password
mismatch that never leaves the browser, a wrong current password that says which field, and an
already-linked chat that reads **Linked · @handle** — and, with an OAuth app present, the live
button, the popup, the `postMessage` that turns the row **Linked**, and a refusal that is said out
loud. Its last pass is **Creator management**: the seven surfaces in order, the studio asked once,
a live and a hidden hub with their codes and counts, the three doors (edit page, content, open —
a blog to `blog.html?studio=…`, a studio to `creator.html?studio=…`), the create doors that carry
their own section and `new=1`, a studio already at its level's limit showing `1 of 1` instead of a
button, and a studio that does not answer — the message, the **Try again**, the seven rows still
standing, and the table coming back after the retry. `court-smoke.mjs` covers the activation page as a guest, on a first activation (request sent,
form closed), after activation while active (**Active now**, upgrade link with the member id),
after activation while expired (re-activation request → “Request sent”), a paid plan that was
never activated (no wizard, the doors) and while banned (no doors, trial links), plus the court
room for a guest, the owner and a foreign id. The activation passes walk the whole wizard — step
1 saves the profile, step 2 generates a viewing code, step 3 opens the ad and receives the code
after the (stubbed) 30 s, step 4 activates — and then a premium re-activation with points, a free
re-activation through the ad, a Gold → Diamond upgrade, and the Diamond case where the upgrade
door is closed.

`iptv-smoke.mjs` parses both playlists with `General;News`-style groups and walks the page (chips,
search, the premium lock, `?M3U=` and `?list=`); `activated-smoke.mjs` proves that the first visit
shows the wizard alone, that the second visit shows the two doors with the success card still hidden,
that an image link becomes the preview, and that the ad clock stops when the page is hidden or the ad
tab closes — and returns to the activation page with the code when it finishes.

## Profile, posts and reach — the schema plan

[`docs/profile-schema-plan.md`](docs/profile-schema-plan.md) maps the new profile specification onto
the live database before any DDL is written: what already exists (`profiles`, `profile_follows`,
`content_reaction`, `comment`, `messages`…), the 28 tables of the final model with columns,
relations and constraints, the tables that are deliberately **not** created, and the two scoring
systems (reach per profile, rank per post) with their weights, tie-breakers and budget rules.
Migrations M1–M9 and the pages each one unblocks are listed at the end of that document.

**M1 `profile_core` is live** (2026-11-01, four migrations: `profile_core_tables`,
`profile_core_counters`, `profile_core_rpcs`, `profile_core_blocks_links`). What it adds:

| Piece | What it does |
| --- | --- |
| `profiles` columns | `language`, `birth_date`, `reach_daily_cap`, `posts_count`, `rank_avg`; `reach_count` starts at **0** — there is no seed balance |
| `profile_settings` | six show/hide switches, four auto-accept switches, `allow_keyword_follows`; a row is created with the profile |
| `profile_links` | Facebook, Instagram, TikTok, YouTube, X, Pinterest, Reddit, Threads, Telegram — handle, URL, sync direction; **never a token** |
| `profile_blocks` | seven independent flags (view profile, view posts, message, publish, participate, react, comment); a block removes the follows of both directions |
| `profile_follows` | `status` (`pending`/`active`/`declined`), `requested_at`, `accepted_at`, `source`; a follow stays pending until the target accepts, and the follow counters are recalculated by trigger |
| RPCs | `profile_public`, `profile_settings_get/save`, `profile_follow_toggle/respond/lists`, `profile_block_set/remove/list`, `profile_links_list/save`, `profile_resolve`, `profile_online` — all take `p_token` and return JSON |

The SQL mirror is [`tools/sql/profile-core.sql`](tools/sql/profile-core.sql). Sentiment of the
round, in one line: a profile shows what its settings allow, a follow is a request until accepted,
and a block hides the profile and drops both follows.

## Profile page — owner and visitor views

`profile.html` is the first page built on M1. It renders one profile in two
modes and reads nothing from the tables directly: every field comes from one of
the `profile_*` RPCs.

| URL | What opens |
| --- | --- |
| `profile.html` | the signed-in member's own profile (owner view) |
| `profile.html?u=@ledsara` | a profile found by username |
| `profile.html?id=ID100003` | a profile found by member ID or profile uuid |

**Owner view** — sidebar with avatar, profile name, member ID, followers, following
and reach points, plus the menu (Updates, Activity, Suggestions, Followers,
Following, Blocks, Search, Settings, and the four sections still to come). That
sidebar is its **own** menu, not the site one: it is pinned with its own pin and,
unpinned, it slides back in from the screen edge exactly like the site rail (see
*The navigation rail* below). The
header carries the cover, the avatar, the display name with the level and wealth
badges, the username with the connection-status cylinder, the description, the
language, the country and the join date.

**Visitor view** — the same header without the member ID, without the Activity tab,
with the connection cylinder only while the owner keeps it on, and with
Follow / Message / Publish / Block plus a separate share button.

Wired against the database in this round:

| Panel / action | RPC |
| --- | --- |
| header, stats, relationship, owner settings | `profile_public` |
| Follow / unfollow, a request that stays pending | `profile_follow_toggle` |
| Accept / decline a pending follower | `profile_follow_respond` |
| Followers and Following, actual + pending | `profile_follow_lists` |
| Blocks list, block by username or member ID, unblock | `profile_blocks_list`, `profile_block_set`, `profile_block_remove` |
| Six show/hide switches, four auto-accepts, keyword follows | `profile_settings_get`, `profile_settings_save` |
| Related links (nine platforms, sync direction) | `profile_links_list`, `profile_links_save` |
| People search, ordered by reach points | REST read of `profiles` (public columns only) |

Posts are still an empty state: the tabs, the counters and the member modal land
with **M2 `posts_core`**.

Every icon on the page is inline SVG, never an emoji or a font glyph: the interface
glyphs come from `assets/js/icons.js` through `<i data-icon="…">`, and the nine
platforms in *Related links* use the official brand paths of
`assets/js/brands.js` (simple-icons, CC0). `hydrateIcons()` runs after every
re-render, so switching tabs never leaves an empty `<i>` behind.

```
node tools/profile-smoke.mjs      # 45 checks, owner + visitor + blocked
```

## The tables behind the profile page

M1 gave the page its identity (`profiles`, settings, follows, blocks, links). The functions that
come next — publishing, interactions, reach, statistics, search, messages — now have their tables
too. Twenty-three of them, all with RLS on and **no policy**: the browser still cannot read a table
directly, only the RPCs can.

| Migration | Tables |
| --- | --- |
| `posts_core` | `posts`, `post_audience_rules`, `post_authorized_profiles`, `post_translations` |
| `keywords_core` | `keywords`, `post_keywords`, `keyword_follows`, `post_related_content`, `site_archive` |
| `interactions_core` | `post_reshare`, `post_reports`, plus `comment.edited_at / sentiment / like_count / dislike_count` |
| `reach_rank` | `profile_reach_transactions`, `post_reach_allocation`, `post_reach_delivery`, `post_analytics_events`, `post_analytics_daily` |
| `search_publish_links` | `search_history`, `search_analytics`, `keyword_analytics`, `profile_publish_links` |
| `messaging_core` | `conversations`, `conversation_participants`, `conversation_messages` |

The database now enforces the rules the brief states, so a page cannot break them by accident:
3 main keywords per post and 5 sub-keywords per main, a comment refused until the member reacted
(the comment is written with the member’s reaction as its ±1 `sentiment`, and a later change of reaction never rewrites it), counters recounted from the source rows, `read_minutes_cap`
derived from the word count, one reach point per target per day released after ten minutes, and a
30-day `site_archive` window for anything deleted.

Every table and rule is written down in
[`docs/profile-tables-applied.md`](docs/profile-tables-applied.md); the M2 SQL mirror is
[`tools/sql/posts-core.sql`](tools/sql/posts-core.sql).

### Publishing is live

`profile.html` no longer stops at a placeholder: the **Publish** button opens the composer
(content → visibility → schedule), the composer calls `post_create`, and the Updates, Activity and
Suggestions tabs are filled by `profile_feed`. A post card carries the Like / Dislike / Comment /
Repost / Share / Report bar — a comment is refused until the post is reacted to, and takes that
reaction — with `post_react`, `post_comment`, `post_comments`, `post_reshare`, `post_report`,
`post_reactors` and `post_delete` behind it. Thumbnails upload to `users/posts/…` in the `source`
bucket with the `apikey` header only.

### Levels

A level costs points: `10`, `100`, `1 000` … `100 000 000 000`, and it is **granted only when it is
paid for** — the points have to reach the level's threshold first, then they leave the balance and the
level is stored on the member (`members.level_unlocked`). The membership only sets the ceiling — Free
`LV30`, Silver `LV50`, Gold `LV80`, Diamond open. The badge is `LV` + the level + the tens digit of the
progress, so **`LV85` is level 8 with half of level 9 already earned**, `LV00` is a member who has not
bought a level yet, and `LVMax` is the open level. Everything lives in
[`assets/js/levels.js`](assets/js/levels.js) — the header wallet, the sidebar meter, the login card,
the profile flag and the dashboard level page read from it. Thresholds, quotas and rights are
written down in [`docs/levels.md`](docs/levels.md).

### Messages

`profile.html → Messages` sends a message by **username, member ID or uuid** and keeps the direct
conversations: `msg_send`, `msg_reply`, `msg_list` (`All / Active / Suspended`, online-only),
`msg_thread`, `msg_unread` and `msg_people` all live in the database. A first message lands
suspended until the recipient answers or accepts — or immediately when they follow the sender or
turned `auto_accept_message` on. Attachments go to `users/messages/…` with the `apikey` header only,
and a block with the message flag stops both directions. The panel is described in
[`docs/profile-tables-applied.md`](docs/profile-tables-applied.md).

### Channels — the two playlists

The channel lists come from the two M3U files in the public `source` bucket:

```
IPTV/IPTV-Free.m3u      → free channels   (homepage #iptv tab «Free», iptv.html?list=free)
IPTV/IPTV Premuim.m3u   → premium channels (homepage tab «Premium», iptv.html?list=premium)
```

[`assets/js/playlists.js`](assets/js/playlists.js) reads them (`parseM3U`), and
[`assets/js/iptv.js`](assets/js/iptv.js) draws the page. The one rule that matters: a
`group-title="General;News"` puts the **same channel in both groups** — the semicolon is a separator,
so no `General;News` group ever exists and a channel is never duplicated inside a single group.
The homepage rail shows a fair sample of every group and links to the full page; `iptv.html?M3U=<id>`
opens on one channel. If a playlist cannot be reached, the `iptvfree` / `iptvpremium` tables (then the
demo list) keep the section alive.

### The country field is a picker

`register.html` no longer asks the member to type a country. The field is a searchable list of every
ISO country, each with its **real SVG flag** (`assets/flags/<code>.svg`, bundled from `flag-icons`,
MIT — see `assets/flags/LICENSE`), and the country is guessed from the visitor's IP (`assets/js/geo.js`)
before they touch it. Nothing is fetched from another host, so the flags also work offline.
The list itself lives in [`assets/js/countries.js`](assets/js/countries.js).
After a successful registration the details card's **Log in** button goes straight to
`dashboard.html`.

### Activation images, ads and the second visit

`activated.html` keeps three rules the brief is explicit about:

- **Avatar and cover** take a file, a **direct image link**, or a crop: the cropper draws the chosen
  part on a canvas (512 × 512 avatar, 1200 × 400 cover), so the preview is exactly what is uploaded to
  `users/profile/avatar|cover_IDXXXXXX`.
- **The ad countdown only runs while the member is watching.** Leaving the activation page (the tab
  hidden), closing the ad tab or a blocked pop-up stops the clock on the spot; when the countdown
  finishes the ad tab is closed and the focus returns to the activation page with the code filled in.
  A page blocked by an ad blocker says so instead of hanging. The clock itself is server-side
  (`activation_ad_open` / `activation_ad_claim`).
- **The second visit only.** First activation shows the four steps and nothing else —
  no «Re-activate», no «Upgrade», no success card. Those appear once the account has been activated
  before, and «Account Activated Successfully!» + Plan + Active until + «Finish» come only after the
  last step. All of it is a `hidden` attribute, and `base.css` now carries a global
  `[hidden] { display: none !important }` so the page works without a `.dsh` wrapper.

### Unlock now — buying a level

On `dashboard.html#level` the next rung carries an **Unlock now** button as soon as its points
condition is met — the rung reads **Ready** in the ladder until it is paid. The dialog names the price
(the level's own points threshold) and pays it from the balance; if the balance is short it says how
much is missing and offers to buy the rest instead of paying. Nothing is ever granted by points
alone:

| Level | LV1 | LV2 | LV3 | LV4 | LV5 | LV6 | LV7 | LV8 | LV9 | LV10 | LVMax |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Points | 10 | 100 | 1 000 | 10 000 | 100 000 | 1 000 000 | 10 000 000 | 100 000 000 | 1 000 000 000 | 10 000 000 000 | 100 000 000 000 |

`level_unlock(token, level)` in the database does the work in one transaction: it checks the session,
the active status, the membership ceiling (Free `LV30`, Silver `LV50`, Gold `LV80`, Diamond open) and
one-rung-at-a-time, then writes the `points_ledger` row (`level unlock`, negative) and stores the level
in `members.level_unlocked` — the lifetime total keeps the points, so the badge holds the level.
Errors: `session · inactive · level · cap · already · step · points`.

### The dashboard sidebar

The menu is `<aside class="dsh-side" data-dsh-side>` — the root `.dsh` owns `data-side` (the fold
state), so the page looks the menu up by `data-dsh-side`, never by `[data-side]`, which also matches
the root.

The avatar and the username in the sidebar are a link to the member's own page
(`profile.html?u=@username`, showing the member ID and the status). The menu follows the same pin
as the site rail (`1w.sidebar.pin`):

- **pinned** (`dsh[data-pin="on"]`) it is the first column of the shell and can be folded into a
  narrow icon rail from its own chevron — `dsh[data-side="collapsed"]`, remembered in
  `1w.dsh.side`;
- **unpinned** (`dsh[data-pin="off"]`) it leaves the grid, the main column takes the whole width, and
  the menu floats back in over the content when the pointer reaches the left edge
  (`dsh[data-side-reveal="on"]`), with the same thin tab on the edge.

The header keeps its geometry either way; the header wallet opens `dashboard.html#points`.

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
rest.html                   account recovery (three steps, recovery link, device path)
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
assets/js/edge.js           the pin and the edge reveal shared by both sidebars
assets/js/home.js           homepage sections
assets/js/app.js            entry point, mounts the shell on every page
assets/js/visits.js         visit row + dwell time (IP, country, page)
assets/js/geo.js            visitor address / country lookup (cached 6 h)
assets/js/ui.js             toasts (+points banner, level-up)
assets/js/sound.js          audio pool and mute state
assets/js/icons.js          line icon set + brand glyphs (brands.js)
assets/js/blocks.js         blocked people/media cache used by every list
assets/css/video.css        member videos: the feed, the player, the publish page
assets/js/videos.js         videos.html: feed, watch screen, comments, reactions
assets/js/video-editor.js   video-editor.html: the publish form and video_save (embedable: <body data-ved-embed="1">)
assets/js/publisher.js       publisher.html: the program only — the seat, the links, the conversions
assets/css/publisher.css    that page: the pay table, the seat, the link rows
assets/css/article.css      member articles: the index, the reader, the writing page
assets/js/articles.js       articles.html: the index, the search, the shelves
assets/js/article.js        article.html: one piece, the two doors, the comments
assets/js/article-editor.js article-editor.html: the editor and article_save (embedded by creator.html)
                            question-editor.html: the same engine as a space's question — question_save
assets/js/article-text.js   word count, reading time and the body allowlist, shared by both
assets/js/blog.js           blog.html: one blog as a reader meets it — its cover, its sections, its search
assets/css/blog.css         that page: the cover hero, the rows, the section cards
assets/js/contents.js       the contents rail both editors carry: the piece's headings, the form's sections
assets/js/rte.js            the writing surface: ranges, formatting, history, paste, keys
assets/js/embed.js          the one host list: YouTube · Vimeo · Dailymotion · TikTok · Facebook·
                            Drive · Pinterest · Reddit · a file — for the editor and the watch screen
assets/css/cast.css         cast page (profile, dials, reels, mentions)
assets/js/cast.js           cast page controller (TMDB + person_* RPCs)
assets/css/register.css     registration form + success card (high-contrast, both themes)
assets/js/register.js       registration controller (member_register RPC, .txt export)
assets/css/login.css        sign-in form + signed-in card
assets/js/login.js          sign-in controller (member_login / member_session / member_logout)
assets/css/rest.css         recovery page: stepper, card, panels, code + link blocks
assets/js/rest.js           recovery controller (recovery_start/verify/reset/link/device)
assets/js/device.js         the one device id (MAC), shared by wizard, player and recovery
tools/apps-script/recovery-delivery.gs  the Google Apps Script: email, WhatsApp, Telegram
supabase/functions/whatsapp-webhook/    the edge function Meta calls: verify, statuses, inbound
supabase/functions/telegram-bot/        the bot's webhook: /start <code> links a chat, /stop unlinks
supabase/functions/oauth-link/          the OAuth callback for the six networks (state → code → token → profile)
assets/css/dashboard.css    app shell: header rail, sidebar, gates, section views
assets/js/dashboard.js      dashboard controller (member_dashboard + code/notify/court/account actions)
assets/js/activated.js      activation wizard (profile → viewing code → ad gate → activate), reactivation, upgrade
assets/js/court.js          court room page (member_court_history)
tools/build-pages.mjs       regenerates the placeholder pages
tools/smoke.mjs             jsdom smoke test (renders the homepage offline)
tools/watch-smoke.mjs       jsdom watch page test (player, gates, watch-time)
tools/cast-smoke.mjs        jsdom cast page test (guest + member dials)
tools/register-smoke.mjs    registration test (form, duplicates, member ID, success, .txt)
tools/login-smoke.mjs       sign-in test (states, success card, restore, log out)
tools/rest-smoke.mjs        recovery test (three steps, link, device path, .txt)
tools/delivery-smoke.mjs    the Apps Script under Node: token, email, WhatsApp template, Telegram
tools/dashboard-smoke.mjs   dashboard test (five gates, rail, popover, codes, sections, creator pages)
tools/sidebar-smoke.mjs     sidebar rail test (edge reveal, pin, Escape, mobile drawer, dashboard menu)
tools/video-smoke.mjs       videos + video editor test (feed, player, doors, payload)
tools/article-smoke.mjs     articles test (index, reader, sanitizer, doors, payload)
tools/blog-smoke.mjs        a blog's reading page test (address, door, hero, home, section, search)
tools/rte-smoke.mjs         the editor itself (every command, on real ranges)
tools/sql/storage-editors.sql  the two storage folders the editors may write to
tools/court-smoke.mjs       activation wizard + court room test
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
