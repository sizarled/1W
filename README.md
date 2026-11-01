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

## The login page

`login.html` signs a member in with **one field for the account** — member ID (`ID100042`),
username (`@youssef.amrani` or `youssef.amrani`), member code (`000042`) or email — plus the
password, a **stay signed in** checkbox, the *Forgot password?* / *Create account* links and
the **Log in** button. The whole check happens in the database; the page only renders the
answer.

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

## The dashboard

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

### The navigation rail is a homepage panel

The menu button and the `<aside id="siteSidebar">` exist **on `index.html` only**. Every other
page mounts the header without the button and leaves the sidebar container empty, so there is no
rail to open and no `sb-open` class to inherit from a stored preference.

The rail slides in *under* the header (`top: var(--header-h)`, `z-index: 120` against the header's
`130`). Opening it never touches `.site-header` or `.site-header__bar` — no padding, no width, no
translate — so the brand, the section rail and the wallet stay exactly where they are; only
`.site-main` and `.site-footer` step aside by `--sidebar-w`. `tools/shell-smoke.mjs` asserts both
halves: the homepage opens and closes the rail, an inner page never renders it, and the stylesheet
contains no `body.sb-open .site-header__bar` rule.

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
server-side — hiding the link is a courtesy, not the permission.

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

**Staged — the layout and copy are in place, the aggregation comes next**

Payments (the wallet, the 100:1 calculator, the payout form and the status chain are drawn,
no transfer row is written yet), Analytics, Creator, Publisher, Advertiser, Profile settings,
Account settings and Platforms. Each one states what it will do instead of pretending to have
data.

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

### Tests

```bash
node tools/dashboard-smoke.mjs   # 80 checks: the five gates, rail, popover, codes, sections
node tools/court-smoke.mjs       # 115 checks: the four steps, uploads, both doors, the court room
```

`dashboard-smoke.mjs` boots the page in jsdom with a stubbed `member_dashboard` and walks the
five states: inactive (activation link with the member id, no rail, no menu), banned (reason,
request → requested), scheduled (date, `court.html?id=…`, absence warning), upheld (closed,
log out only) and active (12 rail items, drag-enabled rail, sidebar, overview numbers, the
popover's filters and both paths, the two locked switches, the code generator, the devices
tab and every section rendering). `court-smoke.mjs` covers the activation page as a guest, on a first activation (request sent,
form closed), after activation while active (**Active now**, upgrade link with the member id),
after activation while expired (re-activation request → “Request sent”), a paid plan that was
never activated (no wizard, the doors) and while banned (no doors, trial links), plus the court
room for a guest, the owner and a foreign id. The activation passes walk the whole wizard — step
1 saves the profile, step 2 generates a viewing code, step 3 opens the ad and receives the code
after the (stubbed) 30 s, step 4 activates — and then a premium re-activation with points, a free
re-activation through the ad, a Gold → Diamond upgrade, and the Diamond case where the upgrade
door is closed.

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
Following, Blocks, Search, Settings, and the four sections still to come). The
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

The level is the points: `10`, `100`, `1 000` … `100 000 000 000`, and the membership only sets the
ceiling — Free `LV30`, Silver `LV50`, Gold `LV80`, Diamond open. The badge is `LV` + the level + the
tens digit of the progress, so **`LV85` is level 8 with half of level 9 already earned**, `LV00` is a
member with no points yet, and `LVMax` is the open level. Everything lives in
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
assets/css/login.css        sign-in form + signed-in card
assets/js/login.js          sign-in controller (member_login / member_session / member_logout)
assets/css/dashboard.css    app shell: header rail, sidebar, gates, section views
assets/js/dashboard.js      dashboard controller (member_dashboard + code/notify/court actions)
assets/js/activated.js      activation wizard (profile → viewing code → ad gate → activate), reactivation, upgrade
assets/js/court.js          court room page (member_court_history)
tools/build-pages.mjs       regenerates the placeholder pages
tools/smoke.mjs             jsdom smoke test (renders the homepage offline)
tools/watch-smoke.mjs       jsdom watch page test (player, gates, watch-time)
tools/cast-smoke.mjs        jsdom cast page test (guest + member dials)
tools/register-smoke.mjs    registration test (form, duplicates, member ID, success, .txt)
tools/login-smoke.mjs       sign-in test (states, success card, restore, log out)
tools/dashboard-smoke.mjs   dashboard test (five gates, rail, popover, codes, sections)
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
