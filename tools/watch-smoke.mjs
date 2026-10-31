import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "watch.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "http://localhost/watch.html?tv=1399&publisher=", pretendToBeVisual: true });
const { window } = dom;

const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.CustomEvent = window.CustomEvent;
globalThis.Event = window.Event;
globalThis.AbortController = window.AbortController || AbortController;
globalThis.localStorage = window.localStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

const TMDB_TV = {
  id: 1399, name: "Game of Thrones", original_name: "Game of Thrones", tagline: "Winter is coming.",
  overview: "Seven noble families fight for control of the mythical land of Westeros.",
  poster_path: "/1XS1oqL89opfnbLl8WnZY1O1uJx.jpg", backdrop_path: "/2OMB0ynKlyIenMJWI2Dy9IWT4c.jpg",
  first_air_date: "2011-04-17", vote_average: 8.4, vote_count: 24000, status: "Ended",
  number_of_seasons: 8, number_of_episodes: 73, episode_run_time: [60], original_language: "en", adult: false,
  genres: [{ id: 18, name: "Drama" }, { id: 10765, name: "Sci-Fi & Fantasy" }],
  production_companies: [{ name: "HBO" }], production_countries: [{ name: "United States of America" }],
  seasons: [{ season_number: 0, episode_count: 12 }, { season_number: 1, episode_count: 10 }, { season_number: 2, episode_count: 10 }],
  credits: {
    cast: Array.from({ length: 10 }, (_, i) => ({ id: 1000 + i, name: `Actor ${i}`, character: `Role ${i}`, profile_path: null })),
    crew: [{ id: 2000, name: "David Benioff", job: "Director", profile_path: null }, { id: 2001, name: "D. B. Weiss", job: "Writer", profile_path: null }],
  },
  "watch/providers": { results: { US: { link: "https://www.themoviedb.org/tv/1399/watch", flatrate: [{ provider_id: 384, provider_name: "HBO Max", logo_path: "/x.jpg" }], buy: [] } } },
  recommendations: { results: [{ id: 1399, name: "self" }, { id: 94997, name: "House of the Dragon", poster_path: null, first_air_date: "2022-08-21", vote_average: 8.2 }] },
  similar: { results: [{ id: 60059, name: "Better Call Saul", poster_path: null, first_air_date: "2015-02-08", vote_average: 8.7 }] },
  content_ratings: { results: [{ iso_3166_1: "US", rating: "TV-MA" }] },
  belongs_to_collection: null,
};

const stats = { likes: 1204, dislikes: 31, comments: 3, minutes: 98600 };
const comments = [
  { id: 2, comment_code: "cmt000002", location: "tv:1399", idmember: "m-1", parent_id: null, content: "Still the best season one.", agree_count: 4, disagree_count: 0, status: "visible", created_at: new Date().toISOString() },
  { id: 1, comment_code: "cmt000001", location: "tv:1399", idmember: "m-1", parent_id: 2, content: "Agreed.", agree_count: 1, disagree_count: 0, status: "visible", created_at: new Date().toISOString() },
];
const members = [{ id: "m-1", username: "@cineaura", avatar_url: null }];

function reply(data) {
  return Promise.resolve({
    ok: true, status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

let calls = [];
globalThis.fetch = (url, opts = {}) => {
  const href = String(url);
  calls.push(href);
  if (href.includes("api.themoviedb.org/3/tv/1399")) return reply(TMDB_TV);
  if (href.includes("api.themoviedb.org/3/trending/")) return reply({ results: [{ id: 999, name: "Trend Show", first_air_date: "2024-01-01", vote_average: 7.1 }] });
  if (href.includes("/rpc/content_stats")) return reply(stats);
  if (href.includes("/rpc/member_watch_minutes")) return reply(1234);
  if (href.includes("/rest/v1/comment")) return reply(comments);
  if (href.includes("/rest/v1/members_public")) return reply(members);
  if (href.includes("/rest/v1/prizeavilable")) return reply([{ id: "p1", idprize: "prize000001", prize_name: "Diamond 3 months", prize_description: "Premium", points_required: 4500 }]);
  if (href.includes("/rest/v1/playlistmovie") || href.includes("/rest/v1/playlisttv")) return reply([]);
  if (href.includes("/rest/v1/playlists")) return reply([]);
  return reply([]);
};

const { initWatch } = await import(`file://${join(root, "assets/js/watch.js")}`);
await initWatch();
await new Promise((r) => setTimeout(r, 250));

const text = (sel) => document.querySelector(sel)?.textContent.trim();
const report = {
  title: text("[data-w-title]"),
  original: text("[data-w-original]"),
  tagline: text("[data-w-tagline]"),
  kindBadge: text("[data-w-kind]"),
  cert: text("[data-w-cert]"),
  metaChips: document.querySelectorAll("[data-w-meta] .w-meta__item").length,
  genres: document.querySelectorAll(".w-genre").length,
  castCards: document.querySelectorAll('[data-w-rail="cast"] .w-person').length,
  providerCards: document.querySelectorAll('[data-w-rail="providers"] .w-provider').length,
  relatedCards: document.querySelectorAll('[data-w-rail="related"] .pcard').length,
  linksCards: document.querySelectorAll('[data-w-rail="links"] .w-link').length,
  commentNodes: document.querySelectorAll("[data-comment]").length,
  nestedReply: document.querySelectorAll(".w-comment--reply").length,
  prizeCards: document.querySelectorAll('[data-w-rail="prizes"] .w-prize').length,
  seasonOptions: document.querySelectorAll("[data-w-season-select] option").length,
  episodeOptions: document.querySelectorAll("[data-w-episode-select] option").length,
  likeCount: text("[data-w-like-count]"),
  viewsCount: text("[data-w-views-count]"),
  duration: text("[data-w-duration]"),
  downloadHref: document.querySelector("[data-w-download]")?.getAttribute("href"),
  factsFetched: calls.length,
  errors,
};

// interaction: play opens the ad gate, the ad link starts the ring
document.querySelector("[data-w-play]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
report.adGateOpen = document.querySelector("[data-w-ad]").hidden === false;
report.adCount = text("[data-w-ad-count]");

const adLink = document.querySelector("[data-w-ad-link]");
adLink.addEventListener("click", (e) => e.preventDefault(), { capture: true });
adLink.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
await new Promise((r) => setTimeout(r, 1200));
report.adCountAfterTick = text("[data-w-ad-count]");
report.ringOffset = document.querySelector("[data-w-ad-progress]").style.strokeDashoffset;

// the code gate itself
document.querySelector("[data-w-lock]").hidden = false;
report.lockVisible = document.querySelector("[data-w-lock]").hidden === false;

console.log(report);
console.log("errors:", errors.length ? errors : "none");
process.exit(errors.length ? 1 : 0);
