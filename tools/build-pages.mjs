/**
 * Generates the placeholder pages for every route the platform will grow into.
 * Each generated file reuses the shared shell (header / sidebar / footer) and
 * keeps the exact file name the product spec already points at, so navigation
 * from the homepage never dead-ends.
 *
 *   node tools/build-pages.mjs
 *
 * Replace a generated file with the real implementation whenever that page
 * is built — the generator only writes the routes listed below.
 */
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = "20261031e"; // cache-bust for css/js

const PAGES = [
  ["search.html", "Search", "search", "Search across films, series, channels, articles, documents, answers and reviews.", "Reads ?q= from the URL."],
  ["movies.html", "Movies", "film", "The full film catalogue, with filters for genre, year, rating and quality.", ""],
  ["series.html", "Series", "tv", "Every series on 1World, grouped by season count and status.", ""],
  ["iptv.html", "IPTV", "broadcast", "Free and premium channels with EPG, groups and viewer counts.", "Opens a channel with ?M3U=channelId."],
  ["video.html", "Video", "video", "One member video: player, description, publisher and watch minutes.", "Reads ?id= from the URL."],
  ["article.html", "Article", "article", "One member article with reading time, publisher and reactions.", "Reads ?id= from the URL."],
  ["answer.html", "Answer", "help", "One question and its answers from the community.", "Reads ?id= from the URL."],
  ["document.html", "Document", "file", "One shared document with preview, download and publisher.", "Reads ?id= from the URL."],
  ["cast.html", "Cast &amp; crew", "users", "Everything a director or actor worked on, pulled from TMDB.", "Reads ?id=personId."],
  ["playlist.html", "Playlist", "bookmark", "A member playlist: titles, visibility, creator and publisher chain.", "Reads ?id=playlistId&amp;creator=memberId."],
  ["download.html", "Download", "download", "Download options for a film or an episode.", "Reads ?movie=ID or ?tv=ID."],
  ["prize.html", "Prize", "gift", "One prize: rules, points required, stock and expiration.", "Reads ?id=prizeId."],
  ["videos.html", "Videos", "video", "Member uploads — trailers, shorts and full-length pieces.", ""],
  ["podcast.html", "Podcast", "mic", "Audio shows published by the community and the editorial team.", ""],
  ["pictures.html", "Pictures", "image", "Stills, posters and member photography.", ""],
  ["documents.html", "Documents", "file", "Scripts, subtitles, study documents and member essays.", ""],
  ["articles.html", "Articles", "article", "Long-form writing from members and editors.", ""],
  ["answers.html", "Answers", "help", "Questions and answers across the whole catalogue.", ""],
  ["reviews.html", "Reviews", "star", "Member reviews with spoiler-free ratings.", ""],
  ["market.html", "Market", "cart", "Spend points on digital goods, codes and member services.", ""],
  ["auction.html", "Auction", "gavel", "Bid on rare items with your points balance.", ""],
  ["bank.html", "Bank", "bank", "Points ledger, transfers and withdrawal requests.", ""],
  ["prizes.html", "Prizes", "gift", "Monthly draws and member rewards.", ""],
  ["tasks.html", "Tasks", "tasks", "Daily and weekly missions that pay in points.", ""],
  ["about.html", "About", "info", "What 1World is, who runs it and how it is funded.", ""],
  ["privacy.html", "Privacy", "shield", "What we store, why, and how to remove it.", ""],
  ["terms.html", "Terms", "scale", "The rules of the platform, in plain language.", ""],
  ["contact.html", "Contact", "mail", "Reach admins, moderators and the editorial team.", ""],
  ["help.html", "Help", "lifebuoy", "Guides for accounts, playback, publishing and points.", ""],
  ["profile.html", "Profile", "user", "Public member profile: avatar, cover, followers and reach.", ""],
  ["dashboard.html", "Dashboard", "dashboard", "Your account: membership, points, sessions and notification settings.", ""],
  ["notifications.html", "Notifications", "bell", "Every notification, filtered by month, year, exact date or all time.", ""],
  ["login.html", "Log in", "login", "Sign in with your email and password.", ""],
  ["register.html", "Create account", "user", "Register free — membership is granted at sign-up.", "Accepts ?plan= and ?duration= from the pricing cards."],
  ["actevite.html", "Activate membership", "crown", "Upgrade to Silver, Gold or Diamond and activate viewing codes.", ""],
  ["panel.html", "Control panel", "settings", "Admin and moderator console for features, apps, channels and members.", ""],
];

const QUICK_LINKS = [
  ["index.html", "Home", "home"],
  ["search.html", "Search", "search"],
  ["movies.html", "Movies", "film"],
  ["series.html", "Series", "tv"],
  ["iptv.html", "IPTV", "broadcast"],
  ["help.html", "Help", "lifebuoy"],
];

const page = ([file, title, iconName, description, note]) => `<!doctype html>
<html lang="en" data-theme="dark">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${title} — 1World Web</title>
    <meta name="description" content="${description.replace(/"/g, "&quot;")}" />
    <meta name="theme-color" content="#060607" />
    <meta name="robots" content="noindex" />
    <link rel="icon" href="assets/img/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet" />
    <link rel="stylesheet" href="assets/css/base.css?v=${BUILD}" />
    <link rel="stylesheet" href="assets/css/layout.css?v=${BUILD}" />
    <link rel="stylesheet" href="assets/css/components.css?v=${BUILD}" />
    <script>
      /* apply the saved theme (or the OS preference) before first paint */
      (function () {
        try {
          var saved = JSON.parse(localStorage.getItem("1w.theme") || "null");
          var theme =
            saved === "light" || saved === "dark"
              ? saved
              : window.matchMedia && window.matchMedia("(prefers-color-scheme: light)").matches
                ? "light"
                : "dark";
          document.documentElement.dataset.theme = theme;
          var meta = document.querySelector('meta[name="theme-color"]');
          if (meta) meta.setAttribute("content", theme === "light" ? "#f4f4f5" : "#060607");
        } catch (e) {}
      })();
    </script>
    <script type="module" src="assets/js/app.js?v=${BUILD}"></script>
  </head>
  <body data-page="${file.replace(".html", "")}" data-title="${title}">
    <a class="skip-link" href="#main">Skip to content</a>
    <div data-site-header></div>
    <div data-site-sidebar></div>

    <main class="site-main" id="main">
      <section class="soon">
        <div class="soon__inner">
          <span class="soon__icon"><i data-icon="${iconName}"></i></span>
          <p class="eyebrow"><span class="eyebrow__dot"></span>Page in build</p>
          <h1 class="soon__title">${title}</h1>
          <p class="soon__text">${description}${note ? ` ${note}` : ""}</p>

          <div class="soon__meta">
            <span class="badge badge--solid">${file}</span>
            <span class="badge">Next release</span>
            <span class="badge">1World Web</span>
          </div>

          <div class="soon__actions">
            <a class="btn btn--primary" href="index.html"><i data-icon="arrowLeft"></i> Back to homepage</a>
            <a class="btn btn--ghost" href="index.html#membership"><i data-icon="crown"></i> Membership</a>
          </div>

          <div class="soon__links">
            ${QUICK_LINKS.map(
              ([href, label, ico]) => `<a class="soon__link" href="${href}"><i data-icon="${ico}"></i>${label}</a>`
            ).join("\n            ")}
          </div>
        </div>
      </section>
    </main>

    <div data-site-footer></div>
  </body>
</html>
`;

let count = 0;
for (const entry of PAGES) {
  writeFileSync(join(root, entry[0]), page(entry), "utf8");
  count += 1;
}
console.log(`Generated ${count} placeholder pages.`);
