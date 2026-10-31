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
| `members` | points (`points` / `balance`), `level`, `membership`, `avatar`, `username` |
| `notifications` | bell panel (`title`, `subject`, `read_or_unread`, `creation_date`) |
| `features` | feature grid |
| `apps` (or `app_versions`, `versions`) | download links per system |
| `iptvfree` / `iptvpremium` | channel reels |

Column names are read defensively (`feature_title` **or** `title`, `id_member` **or**
`member_id`, …), so small schema differences will not break the page.

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

## Theme

Black is the default; the sidebar has a light (white) switch that is remembered in
`localStorage` and applied before first paint. Both themes share the same monochrome
palette — grey text, white accents, no brand colours except inside platform logos.
