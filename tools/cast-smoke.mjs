/**
 * cast.html smoke test (jsdom, no network).
 *
 *   CAST_MODE=guest node tools/cast-smoke.mjs   # visitor: dials ask for a sign-in
 *   CAST_MODE=member node tools/cast-smoke.mjs  # member: follow / repost / block really call the RPCs
 *
 * One module instance per process (cast.js keeps state), so the guest run
 * spawns the member run itself.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODE = process.env.CAST_MODE === "member" ? "member" : "guest";
const MEMBER_ID = "22222222-2222-4222-8222-222222222222";

const html = readFileSync(join(root, "cast.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "http://localhost/cast.html?id=287", pretendToBeVisual: true });
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
globalThis.sessionStorage = window.sessionStorage;
if (typeof globalThis.crypto?.randomUUID !== "function") {
  Object.defineProperty(globalThis, "crypto", { value: window.crypto, configurable: true });
}
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.Audio = window.Audio = class {
  constructor() {
    this.volume = 1;
    this.currentTime = 0;
  }
  play() {
    return Promise.resolve();
  }
  pause() {}
  addEventListener() {}
  removeEventListener() {}
};
globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

if (MODE === "member") {
  window.localStorage.setItem(
    "1w.member",
    JSON.stringify({ id: MEMBER_ID, username: "@cineaura", name: "cineaura", level: 4, points: 900, membership: "gold" })
  );
}

/* ------------------------------------------------------------------ */
/* fixtures                                                           */
/* ------------------------------------------------------------------ */
const BIO =
  "William Bradley Pitt is an American actor and film producer. He has received multiple awards, including two Academy Awards and two Golden Globe Awards.\n\n" +
  "Pitt began his acting career in television in 1987 and broke through with Thelma & Louise. He went on to found Plan B Entertainment, which produced several award-winning films.";

const PERSON = {
  id: 287,
  name: "Brad Pitt",
  also_known_as: ["William Bradley Pitt", "Бред Пітт"],
  biography: BIO,
  profile_path: "/oTB9vGIBacH5aQNS0UpF1RHdrC1.jpg",
  known_for_department: "Acting",
  birthday: "1963-12-18",
  deathday: null,
  place_of_birth: "Shawnee, Oklahoma, USA",
  gender: 2,
  popularity: 9.123,
  imdb_id: "nm0000093",
  homepage: "https://www.planbentertainment.com/",
  external_ids: {
    imdb_id: "nm0000093",
    facebook_id: "BradPitt",
    instagram_id: "bradpittofflcial",
    twitter_id: "BradPitt",
    tiktok_id: null,
    youtube_id: null,
    wikidata_id: "Q35332",
  },
  combined_credits: {
    cast: [
      { id: 550, media_type: "movie", title: "Fight Club", character: "Tyler Durden", poster_path: "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", release_date: "1999-10-15", vote_average: 8.4 },
      { id: 16869, media_type: "movie", title: "Inglourious Basterds", character: "Lt. Aldo Raine", poster_path: "/7sfbEnaARXDDhKm0CZ7D7uc2sbo.jpg", release_date: "2009-08-19", vote_average: 8.2 },
      { id: 1429, media_type: "tv", name: "Game of Thrones", character: "Guest", poster_path: null, first_air_date: "2013-06-01", vote_average: 8.4, episode_count: 1 },
      ...Array.from({ length: 28 }, (_, i) => ({
        id: 5000 + i,
        media_type: "movie",
        title: `Filler Film ${i + 1}`,
        character: `Role ${i + 1}`,
        poster_path: null,
        release_date: `200${i % 10}-0${(i % 9) + 1}-1${i % 9}`,
        vote_average: 6 + (i % 3),
      })),
    ],
    crew: [
      { id: 1399, media_type: "tv", name: "Game of Thrones", job: "Producer", department: "Production", poster_path: null, first_air_date: "2011-04-17", episode_count: 73 },
      { id: 83533, media_type: "movie", title: "The Lost City of Z", job: "Producer", department: "Production", poster_path: null, release_date: "2016-08-15", vote_average: 6.1 },
    ],
  },
};

const MENTIONS = [
  { content_type: "review", content_id: "r-1", title: "Fight Club, twenty-five years on", description: "A review of the film and its two leads.", thumbnail_url: null, rating: 9, published_at: "2026-09-30T10:00:00Z" },
  { content_type: "article", content_id: "a-1", title: "The producer who changed Hollywood", description: "How Plan B shaped a decade of cinema.", thumbnail_url: null, published_at: "2026-10-21T10:00:00Z" },
  { content_type: "video", content_id: "v-1", title: "Career retrospective", description: "A twenty minute video essay.", thumbnail_url: null, published_at: "2026-10-02T10:00:00Z" },
];

const mine = { reaction: null, follow: false, repost: false, block: false };
const statsFor = () => ({
  tmdb_person_id: 287,
  fans: 128,
  haters: 9,
  critics: 14,
  followers: 41,
  reposters: 12,
  blocks: 2,
  mine: { ...mine },
});

/* ------------------------------------------------------------------ */
/* fetch stub                                                         */
/* ------------------------------------------------------------------ */
const reply = (data) =>
  Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

let calls = [];
const rpcCalls = [];
let blockMap = { people: [], media: [] };

globalThis.fetch = (url, opts = {}) => {
  const href = String(url);
  calls.push(href);
  const body = opts.body ? JSON.parse(opts.body) : null;

  if (href.includes("api.themoviedb.org/3/person/287")) return reply(PERSON);
  if (href.includes("/rest/v1/tmdb_people")) return reply([]);

  if (href.includes("/rpc/")) {
    const fn = href.split("/rpc/")[1].split("?")[0];
    rpcCalls.push({ fn, body });

    if (fn === "person_save") return reply({ person_id: "p-1", tmdb_person_id: 287, links: body.p_links.length, credits_added: body.p_credits.length });
    if (fn === "person_stats") return reply(statsFor());
    if (fn === "person_mentions") return reply(MENTIONS);
    if (fn === "person_reaction_set") {
      mine.reaction = body.p_reaction === mine.reaction ? null : body.p_reaction || null;
      return reply(statsFor());
    }
    if (fn === "person_action_set") {
      mine.follow = Boolean(body.p_follow);
      mine.repost = Boolean(body.p_repost);
      mine.block = Boolean(body.p_block);
      if (mine.block) {
        blockMap = { people: [287], media: [{ media_type: "movie", tmdb_media_id: 550 }] };
      } else {
        blockMap = { people: [], media: [] };
      }
      return reply({ follow: mine.follow, repost: mine.repost, block: mine.block, stats: statsFor() });
    }
    if (fn === "person_block_map") return reply(blockMap);
    if (fn === "person_sync_deliveries") return reply({ notifications: 1, reposts: 1 });
    if (fn === "person_mention_add") return reply(true);
    return reply(null);
  }

  return reply([]);
};

/* ------------------------------------------------------------------ */
/* run                                                                */
/* ------------------------------------------------------------------ */
const { initCast } = await import(`file://${join(root, "assets/js/cast.js")}`);
await initCast();
await new Promise((r) => setTimeout(r, 260));

const text = (sel) => document.querySelector(sel)?.textContent.trim() || "";
const all = (sel) => [...document.querySelectorAll(sel)];
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
const tick = (ms = 90) => new Promise((r) => setTimeout(r, ms));

const movieTrack = document.querySelector('[data-c-track="movie"]');
const tvTrack = document.querySelector('[data-c-track="tv"]');

const report = {
  mode: MODE,
  pageTitle: document.title,
  name: text("[data-c-name]"),
  kicker: text("[data-c-kicker]"),
  aka: text("[data-c-aka]"),
  bioParagraphs: all("[data-c-bio] p").length,
  bioWords: text("[data-c-bio]").split(/\s+/).filter(Boolean).length,
  facts: all("[data-c-facts] .c-fact").length,
  factsExtra: all("[data-c-facts-extra] .c-fact").length,
  birthday: text("[data-c-facts] .c-fact:nth-child(1) dd"),
  place: text("[data-c-facts] .c-fact:nth-child(2) dd"),
  fans: text("[data-c-fans]"),
  haters: text("[data-c-haters]"),
  critics: text("[data-c-critics]"),
  links: all("[data-c-links] .c-link").length,
  linkHrefs: all("[data-c-links] .c-link").map((a) => a.getAttribute("href")),
  brandSvgs: all("[data-c-links] .c-link svg").length,
  movieCount: text('[data-c-count="movie"]'),
  tvCount: text('[data-c-count="tv"]'),
  movieCards: movieTrack?.querySelectorAll(".pcard").length || 0,
  moreButton: Boolean(movieTrack?.querySelector("[data-c-more]")),
  tvCards: tvTrack?.querySelectorAll(".pcard").length || 0,
  firstMovieHref: movieTrack?.querySelector(".pcard")?.getAttribute("href"),
  firstMovieTitle: text('[data-c-track="movie"] .pcard__title'),
  firstMovieMeta: text('[data-c-track="movie"] .pcard__meta'),
  firstMovieId: text('[data-c-track="movie"] .c-card-work__id'),
  firstTvHref: tvTrack?.querySelector(".pcard")?.getAttribute("href"),
  posterHook: (movieTrack?.querySelector("img.pcard__img")?.getAttribute("onload") || "").includes("is-loaded"),
  posterHost: all('[data-c-track="movie"] img.pcard__img').some((img) =>
    (img.getAttribute("src") || "").startsWith("https://image.tmdb.org/t/p/")
  ),
  tabCounts: ["review", "article", "video"].map((t) => text(`[data-c-tabcount="${t}"]`)),
  mentionCards: all("[data-c-mention-list] .c-card").length,
  mentionHref: document.querySelector("[data-c-mention-list] .c-card")?.getAttribute("href"),
  savePayloadLinks: null,
  savePayloadCredits: null,
  errors,
};

const save = rpcCalls.find((c) => c.fn === "person_save");
report.savePayloadLinks = save?.body?.p_links?.length ?? null;
report.savePayloadCredits = save?.body?.p_credits?.length ?? null;

// lazy loading: first batch is 24, the button reveals the rest
if (movieTrack?.querySelector("[data-c-more]")) {
  click(movieTrack.querySelector("[data-c-more]"));
  await tick();
}
report.movieCardsAfterMore = document.querySelectorAll('[data-c-track="movie"] .pcard').length;
report.movieHrefs = all('[data-c-track="movie"] .pcard').map((a) => a.getAttribute("href"));
report.tvHrefs = all('[data-c-track="tv"] .pcard').map((a) => a.getAttribute("href"));

// ---- dials ---------------------------------------------------------
const toggle = document.querySelector("[data-c-dials-toggle]");
const dials = document.querySelector("[data-c-dials]");
click(toggle);
await tick();
report.dialsOpen = dials.hidden === false && toggle.getAttribute("aria-expanded") === "true";

const followBtn = document.querySelector('[data-dial-btn="follow"]');
if (MODE === "guest") {
  click(followBtn);
  await tick(200);
  report.guestActionBlocked = !rpcCalls.some((c) => c.fn === "person_action_set");
  report.guestToast = text(".toast__title");
} else {
  click(followBtn);
  await tick();
  report.followOn = followBtn.getAttribute("aria-checked") === "true";
  report.followCall = rpcCalls.filter((c) => c.fn === "person_action_set").at(-1)?.body || null;
  report.actionNote = text("[data-c-action-state]");

  click(document.querySelector('[data-dial-btn="repost"]'));
  await tick();
  report.repostCall = rpcCalls.filter((c) => c.fn === "person_action_set").at(-1)?.body || null;

  click(document.querySelector('[data-dial-btn="block"]'));
  await tick(160);
  const blockCall = rpcCalls.filter((c) => c.fn === "person_action_set").at(-1)?.body || {};
  report.blockCall = blockCall;
  report.blockTurnsDialsOff = blockCall.p_follow === false && blockCall.p_repost === false && blockCall.p_block === true;
  report.blockedBanner = document.querySelector("[data-c-blocked]").hidden === false;
  report.reelsHidden = document.querySelector('[data-c-reel="movie"]').hidden === true;
  report.followDisabled = document.querySelector('[data-dial-btn="follow"]').disabled === true;
  report.blockCache = JSON.parse(window.localStorage.getItem("1w.blocks") || "null");
  report.deliveryCall = rpcCalls.filter((c) => c.fn === "person_sync_deliveries").at(-1)?.body || null;

  click(document.querySelector("[data-c-unblock]"));
  await tick(160);
  const unblockCall = rpcCalls.filter((c) => c.fn === "person_action_set").at(-1)?.body || {};
  report.unblockCall = unblockCall;
  report.unblockStaysOff = unblockCall.p_follow === false && unblockCall.p_repost === false && unblockCall.p_block === false;
  report.unblockBannerGone = document.querySelector("[data-c-blocked]").hidden === true;
  report.unblockReelsBack = document.querySelector('[data-c-reel="movie"]').hidden === false;

  click(document.querySelector('[data-reaction="fan"]'));
  await tick();
  report.reactionCall = rpcCalls.filter((c) => c.fn === "person_reaction_set").at(-1)?.body || null;
  report.fansAfter = text("[data-c-fans]");
}

// ---- tabs ----------------------------------------------------------
const articleTab = document.querySelector('[data-c-tab="article"]');
if (articleTab) {
  click(articleTab);
  await tick();
}
report.articleTabCards = document.querySelectorAll("[data-c-mention-list] .c-card").length;
report.articleTabHref = document.querySelector("[data-c-mention-list] .c-card")?.getAttribute("href");

const css = readFileSync(join(root, "assets/css/cast.css"), "utf8");
report.noGrayscale = !/grayscale\(/.test(css);

const checks =
  MODE === "guest"
    ? {
        name: report.name === "Brad Pitt",
        kicker: report.kicker.includes("TMDB person 287"),
        aka: report.aka.includes("William Bradley Pitt"),
        biography: report.bioParagraphs >= 2,
        facts: report.facts >= 5 && report.birthday.includes("1963") && report.place.includes("Shawnee"),
        counts: report.fans === "128" && report.haters === "9" && report.critics === "14",
        links: report.links === 6 && report.brandSvgs === 6, // facebook, instagram, X, IMDb, Wikidata + the official site
        linksNoInvention: report.linkHrefs.some((h) => h.includes("facebook.com/BradPitt")) && report.linkHrefs.some((h) => h.includes("wikidata.org")),
        worksSplit: report.movieCount === "31" && report.tvCount === "2" && report.tvCards === 2,
        lazyLoading: report.movieCards === 24 && report.moreButton && report.movieCardsAfterMore === 31,
        movieCard:
          report.firstMovieHref === "watch.html?movie=83533" &&
          report.firstMovieMeta.includes("Producer") &&
          report.movieHrefs.includes("watch.html?movie=550") &&
          report.movieHrefs.includes("watch.html?movie=16869"),
        movieIdShown: report.firstMovieId.includes("TMDB movie 83533"),
        tvLink: report.firstTvHref === "watch.html?tv=1429" && report.tvHrefs.includes("watch.html?tv=1399"),
        postersKeepColour: report.posterHook && report.posterHost && report.noGrayscale,
        stored: report.savePayloadLinks === 6 && report.savePayloadCredits === 33,
        mentions: report.tabCounts.join(",") === "1,1,1" && report.mentionCards === 1 && report.mentionHref.startsWith("reviews.html?id="),
        tabs: report.articleTabCards === 1 && report.articleTabHref.startsWith("article.html?id="),
        dialsOpen: report.dialsOpen,
        guestsBlocked: report.guestActionBlocked && report.guestToast.includes("Members only"),
        noErrors: errors.length === 0,
      }
    : {
        name: report.name === "Brad Pitt",
        dialsOpen: report.dialsOpen,
        followCalls: report.followOn && report.followCall?.p_follow === true && report.followCall?.p_tmdb === 287,
        repostCalls: report.repostCall?.p_repost === true && report.repostCall?.p_follow === true,
        actionNote: report.actionNote.includes("Following"),
        blockTurnsOff: report.blockTurnsDialsOff && report.followDisabled,
        blockHides: report.blockedBanner && report.reelsHidden,
        blockCache: report.blockCache?.media?.[0]?.tmdb_media_id === 550,
        deliveries: report.deliveryCall?.p_limit === 3 && report.deliveryCall?.p_member === MEMBER_ID,
        unblockStaysOff: report.unblockStaysOff && report.unblockBannerGone && report.unblockReelsBack,
        reactions: report.reactionCall?.p_reaction === "fan" && report.reactionCall?.p_member === MEMBER_ID,
        countsReadOnly: report.fansAfter === "128", // the tally shows the server count, never the client's guess
        mentions: report.mentionCards >= 1 && report.articleTabHref.startsWith("article.html?id="),
        noErrors: errors.length === 0,
      };

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);

console.log(report);
console.log("checks:", failed.length ? `FAILED ${failed.join(", ")}` : "all pass");
console.log("errors:", errors.length ? errors : "none");

let memberStatus = 0;
if (MODE === "guest") {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, CAST_MODE: "member" },
    encoding: "utf8",
  });
  process.stdout.write(child.stdout || "");
  process.stderr.write(child.stderr || "");
  memberStatus = child.status ?? 1;
}

process.exit(failed.length || memberStatus ? 1 : 0);
