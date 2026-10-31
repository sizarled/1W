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
notification filters) works three ways:

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
tools/build-pages.mjs       regenerates the placeholder pages
tools/smoke.mjs             jsdom smoke test (renders the homepage offline)
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
