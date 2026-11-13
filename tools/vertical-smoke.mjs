/**
 * Vertical videos smoke test — the 9:16 shelf and its viewer.
 *
 *   node tools/vertical-smoke.mjs
 *
 * Pass 1  — the shelf: nine-by-sixteen cards, the vertical badge, duration,
 *           publisher and views; the count, a sort and a search reaching
 *           `video_vertical_feed` with the right arguments, and "more" only
 *           when there is more.
 * Pass 2  — one video: the player, the info block, the seven actions, the
 *           publisher card, the neighbours, the position, and the comment rule
 *           (no composer before a reaction).
 * Pass 3  — moving on: next and previous rewrite the address, ask for the new
 *           code, update the title and the neighbours — and leave one player,
 *           never two.
 * Pass 4  — the reaction, the comment, the saved list, the share, the follow
 *           and the report all go out through the site's own calls.
 * Pass 5  — the keyboard walks the shelf, and refuses past the ends.
 * Pass 6  — a video that is gone, a locked one, and a new one behind the gate:
 *           all three say so instead of half-rendering a player.
 * Pass 7  — the page and its stylesheet carry what the design promises: the
 *           original header, the 9:16 box, the blurred neighbours, both themes.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
const strip = (file) => readFileSync(join(root, file), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const css = readFileSync(join(root, "assets/css/vertical.css"), "utf8");
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const safeParse = (text) => {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};
const reply = (data, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data, text: async () => JSON.stringify(data) });

/* ------------------------------------------------------------------ */
/* the fixtures                                                       */
/* ------------------------------------------------------------------ */
/* A vertical card is a `video_card` row whose publisher ticked vertical: the
   flag lives in `video.meta.vertical`, and the code carries `VSR-`. */
function vcard(over = {}) {
  const base = {
    id: "a1111111-1111-4111-8111-111111111111",
    code: "VSR-000001",
    type: "video",
    title: "Three minutes in the medina",
    description:
      "A walk through the old town at six in the morning, before the shutters go up. The camera never leaves the hand.",
    thumbnail: "https://example.com/v1.jpg",
    embed: "https://example.com/v1.mp4",
    language: "ar",
    visibility: "general",
    status: "published",
    published_at: new Date(Date.now() - 7200_000).toISOString(),
    keywords: [{ id: "k1", keyword: "travel", role: "main", parent_id: null }],
    counters: { likes: 12, dislikes: 1, comments: 3, impressions: 940, watch_minutes: 44 },
    publisher: { id: "p1", name: "Samir", username: "@samir", avatar: null, followers: 130, posts: 9 },
    author: { id: "p1", name: "Samir", username: "@samir", avatar: null },
    mine: { reaction: null, reshared: false, reported: false, can_interact: true, can_manage: false },
    video: {
      meta: { age: "none", download: true, vertical: true, duration: 80 },
      embed: "https://example.com/v1.mp4",
      file: "https://example.com/v1.mp4",
      host: { id: "p1", name: "Samir", username: "@samir", avatar: null, followers: 130, posts: 9 },
    },
    related: [],
  };
  return { ...base, ...over };
}

const FEED = {
  ok: true,
  rows: [
    vcard(),
    vcard({
      id: "b2222222-2222-4222-8222-222222222222",
      code: "VSR-000002",
      title: "A rooftop and one cat",
      thumbnail: "https://example.com/v2.jpg",
      publish: true,
      video: {
        meta: { vertical: true, duration: 32 },
        embed: "https://example.com/v2.mp4",
        file: "https://example.com/v2.mp4",
        host: { id: "p2", name: "Nour", username: "@nour", avatar: null, followers: 40, posts: 2 },
      },
      counters: { likes: 4, dislikes: 0, comments: 0, impressions: 210 },
    }),
    vcard({
      id: "c3333333-3333-4333-8333-333333333333",
      code: "VSR-000000",
      title: "The last tram",
      thumbnail: "https://example.com/v3.jpg",
      video: {
        meta: { vertical: true, minutes: 2 },
        embed: "https://example.com/v3.mp4",
        file: "https://example.com/v3.mp4",
        host: { id: "p1", name: "Samir", username: "@samir", avatar: null, followers: 130, posts: 9 },
      },
      counters: { likes: 1, dislikes: 0, comments: 0, impressions: 30 },
    }),
  ],
  total: 3,
  limit: 24,
  offset: 0,
};

const HUB = {
  ok: true,
  hub: {
    code: "IDST100001",
    name: "Hello",
    creator: "@samir",
    logo_url: null,
    links: [
      { label: "The studio", url: "https://example.com/studio" },
      { label: "Instagram", url: "https://example.com/insta" },
    ],
    subscribers: 130,
    published: 9,
  },
};

const COMMENTS = {
  ok: true,
  comments: [
    {
      id: 71,
      body: "The light at the start is the whole film.",
      author: { id: "m2", name: "Sara", username: "@sara", avatar: null },
      likes: 2,
      dislikes: 0,
      edited: false,
      parent_id: null,
      created_at: new Date(Date.now() - 900_000).toISOString(),
    },
    {
      id: 72,
      body: "Agreed.",
      author: { id: "m3", name: "Omar", username: "@omar", avatar: null },
      likes: 0,
      dislikes: 0,
      edited: false,
      parent_id: 71,
      created_at: new Date(Date.now() - 300_000).toISOString(),
    },
  ],
  count: 2,
  reaction: null,
  can_comment: false,
};

/* ------------------------------------------------------------------ */
/* booting one page                                                   */
/* ------------------------------------------------------------------ */
const booted = [];

function boot(file, { hash = "", storage = {}, fetchImpl } = {}) {
  const dom = new JSDOM(strip(file), { url: `http://localhost/${file}`, pretendToBeVisual: true });
  const { window } = dom;
  window.scrollTo = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));
  Object.keys(storage).forEach((key) => window.localStorage.setItem(key, storage[key]));

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.location = window.location;
  globalThis.history = window.history;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.Event = window.Event;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.MouseEvent = window.MouseEvent;
  globalThis.KeyboardEvent = window.KeyboardEvent;
  globalThis.FormData = window.FormData;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

  const calls = [];
  globalThis.fetch = (input, opts = {}) => {
    const href = String(input);
    const body = typeof opts.body === "string" ? safeParse(opts.body) : opts.body || null;
    calls.push({ href, body });
    if (fetchImpl) return fetchImpl(href, opts, calls);
    return reply([]);
  };
  if (hash) window.location.hash = hash;
  booted.push(window);
  return { dom, window, document: window.document, calls, errors };
}

const fnName = (href) => String(href).split("/rpc/")[1] || "";
const lastCall = (calls, fn) =>
  [...calls].reverse().find((c) => fnName(c.href) === fn || fnName(c.href) === `${fn}_from`);

const MEMBER = JSON.stringify({ id: "m1", username: "@you", name: "You", level: 2, points: 40 });
const SIGNED = { "1w.member": MEMBER, "1w.session": "tok-vertical", "1w.gate.seen": JSON.stringify({ videos: ["VSR-000001", "VSR-000002", "VSR-000000"] }) };

/* the whole server, as this page meets it */
const server =
  ({ getVideo, feed = FEED, comments = COMMENTS } = {}) =>
  (href, opts) => {
    const fn = fnName(href);
    const body = typeof opts?.body === "string" ? safeParse(opts.body) : null;
    if (fn === "video_vertical_feed") return reply(feed);
    if (fn === "video_get") {
      if (getVideo) return reply(getVideo(body));
      const ref = body?.p_ref;
      const row = (feed.rows || []).find((r) => r.code === ref) || feed.rows[0] || vcard();
      return reply({ ok: true, video: row });
    }
    if (fn === "video_hub") return reply(HUB);
    if (fn === "post_comments") return reply(comments);
    if (fn === "post_react_from") return reply({ ok: true, reaction: 1, likes: 13, dislikes: 1, can_comment: true });
    if (fn === "post_comment_from") return reply({ ok: true, comment: { id: 99 } });
    if (fn === "post_comment_vote") return reply({ ok: true, agree: 3, disagree: 0, mine: "agree" });
    if (fn === "post_reshare_from") return reply({ ok: true, reshared: true });
    if (fn === "post_report_from") return reply({ ok: true });
    if (fn === "profile_follow_toggle") return reply({ ok: true, following: true, status: "active" });
    if (fn === "msg_send") return reply({ ok: true });
    return reply([]);
  };

/* ================================================================== */
/* pass 1 — the shelf                                                 */
/* ================================================================== */
{
  const { document, calls, errors, window } = boot("videos.html", {
    hash: "#/vertical",
    storage: { ...SIGNED },
    fetchImpl: server({ getVideo: () => ({ ok: true, video: vcard() }) }),
  });
  await import(`file://${join(root, "assets/js/vertical.js")}?s1`);
  await wait(120);

  const cards = document.querySelectorAll("[data-vert-grid] .v9card");
  expect("shelf: the vertical block is on the page", document.querySelector("[data-vert-page]")?.hidden === false);
  expect("shelf: the shelf is the part on show", document.querySelector("[data-vert-browse]")?.hidden === false);
  expect("shelf: three cards", cards.length === 3, cards.length);
  expect("shelf: a card links by its code", cards[0]?.getAttribute("href") === "videos.html#/v/ID=VSR-000001", cards[0]?.getAttribute("href"));
  expect("shelf: the card says vertical", /Vertical/.test(cards[0]?.querySelector(".v9card__badge")?.textContent || ""), cards[0]?.querySelector(".v9card__badge")?.textContent);
  expect("shelf: the length is on the card", cards[0]?.querySelector(".v9card__dur")?.textContent === "1:20", cards[0]?.querySelector(".v9card__dur")?.textContent);
  expect("shelf: minutes become a length too", cards[2]?.querySelector(".v9card__dur")?.textContent === "2:00", cards[2]?.querySelector(".v9card__dur")?.textContent);
  expect("shelf: the publisher is named", /Samir/.test(cards[0]?.textContent || ""), cards[0]?.textContent?.slice(0, 80));
  expect("shelf: the views are the counters", /940/.test(cards[0]?.querySelector(".v9card__meta")?.textContent || ""), cards[0]?.querySelector(".v9card__meta")?.textContent);
  expect("shelf: the count line is spoken", document.querySelector("[data-vert-count]")?.textContent === "3 of 3", document.querySelector("[data-vert-count]")?.textContent);
  expect("shelf: no more button when it all fit", !document.querySelector("[data-v9-more]"), "found a more button");
  expect("shelf: the empty state stays quiet", document.querySelector("[data-vert-empty]")?.hidden === true);
  expect("shelf: it asked for the vertical feed", fnName(lastCall(calls, "video_vertical_feed")?.href) === "video_vertical_feed");
  expect(
    "shelf: the first ask is the newest page",
    lastCall(calls, "video_vertical_feed")?.body.p_sort === "new" && lastCall(calls, "video_vertical_feed")?.body.p_offset === 0,
    JSON.stringify(lastCall(calls, "video_vertical_feed")?.body)
  );
  expect("shelf: nothing threw", errors.length === 0, errors.join(" | "));

  /* sort */
  document.querySelector('[data-vert-sort] [data-sort="popular"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  expect("shelf: a sort reaches the server", lastCall(calls, "video_vertical_feed")?.body.p_sort === "popular", JSON.stringify(lastCall(calls, "video_vertical_feed")?.body));
  expect("shelf: the active sort moves", document.querySelector('[data-vert-sort] [data-sort="popular"]').classList.contains("is-active"));

  /* search, debounced */
  const search = document.querySelector("[data-vert-search]");
  search.value = "medina";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(420);
  expect("shelf: a search reaches the server", lastCall(calls, "video_vertical_feed")?.body.p_search === "medina", JSON.stringify(lastCall(calls, "video_vertical_feed")?.body));
  expect("shelf: the search keeps the sort", lastCall(calls, "video_vertical_feed")?.body.p_sort === "popular");
}

/* a shelf with more behind it offers the way to it */
{
  const many = { ...FEED, total: 40 };
  const { document, window, calls } = boot("videos.html", {
    hash: "#/vertical",
    storage: { ...SIGNED },
    fetchImpl: (href) => {
      if (fnName(href) === "video_vertical_feed") {
        const body = safeParse(href) || {};
        return reply(many);
      }
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/vertical.js")}?s2`);
  await wait(120);
  const more = document.querySelector("[data-v9-more]");
  expect("shelf: a longer shelf offers more", Boolean(more), "no more button");
  more?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const calls2 = calls.filter((c) => fnName(c.href) === "video_vertical_feed");
  expect("shelf: more asks for the next page", calls2.length >= 2, calls2.length);
}

/* an empty shelf explains itself, and offers the way to publish */
{
  const { document } = boot("videos.html", {
    hash: "#/vertical",
    storage: { ...SIGNED },
    fetchImpl: (href) => (fnName(href) === "video_vertical_feed" ? reply({ ok: true, rows: [], total: 0 }) : reply([])),
  });
  await import(`file://${join(root, "assets/js/vertical.js")}?s3`);
  await wait(120);
  const empty = document.querySelector("[data-vert-empty]");
  expect("shelf: an empty shelf speaks", empty?.hidden === false);
  expect("shelf: it names why", /Nothing visible|Nothing vertical yet/.test(empty?.textContent || ""), empty?.textContent?.slice(0, 80));
  expect("shelf: it offers the editor", /video-editor\.html/.test(empty?.innerHTML || ""));
}

/* ================================================================== */
/* pass 2 — one video                                                 */
/* ================================================================== */
let viewer;
{
  const { document, calls, errors, window } = boot("videos.html", {
    hash: "#/v/ID=VSR-000001",
    storage: { ...SIGNED },
    fetchImpl: server(),
  });
  viewer = { document, calls, window, errors };
  await import(`file://${join(root, "assets/js/vertical.js")}?w1`);
  await wait(160);

  const player = document.querySelector("[data-v9-player]");
  expect("viewer: the shelf steps back", document.querySelector("[data-vert-browse]")?.hidden === true);
  expect("viewer: the player mounts the file", Boolean(player?.querySelector("video")), player?.innerHTML?.slice(0, 120));
  expect("viewer: one player, not two", document.querySelectorAll("[data-v9-player] video").length === 1);
  expect("viewer: the title is the row's", document.querySelector(".v9info__title")?.textContent === "Three minutes in the medina", document.querySelector(".v9info__title")?.textContent);
  expect("viewer: the badge says vertical", /Vertical video/.test(document.querySelector(".v9badge")?.textContent || ""));
  expect("viewer: the category is the main keyword", /travel/.test(document.querySelector(".v9info__badges")?.textContent || ""));
  expect("viewer: views and length are in the info block", /940/.test(document.querySelector(".v9info__meta")?.textContent || "") && /1:20/.test(document.querySelector(".v9info__meta")?.textContent || ""), document.querySelector(".v9info__meta")?.textContent);
  expect("viewer: the document title follows", /Three minutes in the medina/.test(document.title), document.title);
  expect("viewer: the position is spoken", document.querySelector("[data-v9-pos]")?.textContent === "1 of 3", document.querySelector("[data-v9-pos]")?.textContent);

  /* the suggestions: beside the player there is only the one before and the one
     after, so the rest of the shelf rides above it and scrolls sideways */
  const rail = document.querySelector("[data-v9-rail]");
  const railCards = [...(rail?.querySelectorAll(".vrail__card") || [])];
  expect("rail: the other vertical videos are on the page", Boolean(rail), "no rail");
  expect(
    "rail: it sits above the player",
    rail?.nextElementSibling?.matches("[data-v9-stage]") === true,
    rail?.nextElementSibling?.className
  );
  expect(
    "rail: one poster for each of the others",
    railCards.length === 2,
    JSON.stringify(railCards.map((a) => a.getAttribute("href")))
  );
  expect(
    "rail: never the video being watched",
    !railCards.some((a) => /VSR-000001/.test(a.getAttribute("href") || "")),
    JSON.stringify(railCards.map((a) => a.getAttribute("href")))
  );
  expect(
    "rail: the next one in the shelf leads",
    /#\/v\/ID=VSR-000002/.test(railCards[0]?.getAttribute("href") || ""),
    railCards[0]?.getAttribute("href")
  );
  expect(
    "rail: every card is a poster of the shape it opens",
    railCards.every((a) => a.getAttribute("data-orientation") === "v" && Boolean(a.querySelector(".vrail__media img"))),
    railCards[0]?.innerHTML?.slice(0, 80)
  );
  expect("rail: it is named", /More vertical videos/.test(rail?.querySelector(".vrail__title")?.textContent || ""), rail?.querySelector(".vrail__title")?.textContent);

  const acts = document.querySelectorAll("[data-v9-actions] .v9act");
  expect("viewer: seven actions", acts.length === 7, acts.length);
  expect("viewer: like carries its count", document.querySelector("[data-v9-like]")?.textContent === "12", document.querySelector("[data-v9-like]")?.textContent);
  expect("viewer: comments carry their count", document.querySelector("[data-v9-comment-count]")?.textContent === "3", document.querySelector("[data-v9-comment-count]")?.textContent);
  expect("viewer: watch later starts off", document.querySelector("[data-v9-save]")?.getAttribute("aria-pressed") === "false");

  expect("viewer: the publisher card names them", /@samir/.test(document.querySelector("[data-v9-host]")?.textContent || ""), document.querySelector("[data-v9-host]")?.textContent?.replace(/\s+/g, " "));
  expect("viewer: the studio is called Hello", /Hello/.test(document.querySelector("[data-v9-host]")?.textContent || ""));
  expect("viewer: follow waits to be pressed", Boolean(document.querySelector("[data-v9-follow]")));
  expect("viewer: the menu offers the four rows", document.querySelectorAll(".v9menu__item").length === 4, document.querySelectorAll(".v9menu__item").length);

  expect("viewer: the description is folded until asked", document.querySelector("[data-v9-desc-box]")?.hidden === true);
  expect("viewer: the studio's links are real links", document.querySelectorAll("[data-v9-links] a").length === 2, document.querySelectorAll("[data-v9-links] a").length);

  expect("viewer: the comment rule is said", /Like or dislike the video first/.test(document.querySelector("[data-v9-comments]")?.textContent || ""));
  expect("viewer: two comments render", document.querySelectorAll("[data-v9-comment]").length === 2, document.querySelectorAll("[data-v9-comment]").length);
  expect("viewer: the reply sits under its parent", Boolean(document.querySelector(".v9com__replies [data-v9-comment=\"72\"]")));

  const nextSide = document.querySelector('[data-v9-side="next"]');
  expect("viewer: the next video stands beside it", /A rooftop and one cat/.test(nextSide?.getAttribute("aria-label") || ""), nextSide?.getAttribute("aria-label"));
  expect("viewer: the next side links by code", nextSide?.getAttribute("href") === "videos.html#/v/ID=VSR-000002", nextSide?.getAttribute("href"));
  expect("viewer: there is no previous at the first", document.querySelector("[data-v9-prev]")?.disabled === true);
  expect("viewer: the next button is live", document.querySelector("[data-v9-next]")?.disabled === false);
  expect("viewer: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 3 — moving on                                                 */
/* ================================================================== */
{
  const { document, calls, window, errors } = viewer;
  document.querySelector("[data-v9-next]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(200);

  expect("next: the address follows", window.location.hash === "#/v/ID=VSR-000002", window.location.hash);
  expect("next: the player was asked for the new code", lastCall(calls, "video_get")?.body.p_ref === "VSR-000002", JSON.stringify(lastCall(calls, "video_get")?.body));
  expect("next: only one player is left", document.querySelectorAll("[data-v9-player] video, [data-v9-player] iframe").length === 1, document.querySelectorAll("[data-v9-player] video, [data-v9-player] iframe").length);
  expect("next: the previous side now points back", document.querySelector('[data-v9-side="prev"]')?.getAttribute("href") === "videos.html#/v/ID=VSR-000001", document.querySelector('[data-v9-side="prev"]')?.getAttribute("href"));
  expect("next: the position moved", document.querySelector("[data-v9-pos]")?.textContent === "2 of 3", document.querySelector("[data-v9-pos]")?.textContent);
  expect("next: the previous button is live now", document.querySelector("[data-v9-prev]")?.disabled === false);
  expect("next: nothing threw on the way", errors.length === 0, errors.join(" | "));

  /* the side card is a link, so it carries the address itself */
  const side = document.querySelector('[data-v9-side="next"]');
  expect("next: the neighbour is a real address", side?.getAttribute("href") === "videos.html#/v/ID=VSR-000000", side?.getAttribute("href"));

  /* and back */
  document.querySelector("[data-v9-prev]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(200);
  expect("previous: the address goes back", window.location.hash === "#/v/ID=VSR-000001", window.location.hash);
  expect("previous: the title is the first video again", document.querySelector(".v9info__title")?.textContent === "Three minutes in the medina", document.querySelector(".v9info__title")?.textContent);
}

/* ================================================================== */
/* pass 4 — the actions are the site's own calls                      */
/* ================================================================== */
{
  const { document, calls, window } = viewer;

  /* the description opens */
  document.querySelector("[data-v9-desc]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  expect("actions: description opens", document.querySelector("[data-v9-desc-box]")?.hidden === false);

  /* like */
  document.querySelector('[data-v9-react="1"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const react = lastCall(calls, "post_react_from");
  expect("actions: like goes out", Boolean(react), "no reaction call");
  expect("actions: it is a like", react?.body.p_value === 1, JSON.stringify(react?.body));
  expect("actions: it names the video", react?.body.p_ref === "VSR-000001", react?.body.p_ref);
  expect("actions: the button fills", document.querySelector('[data-v9-react="1"]')?.getAttribute("aria-pressed") === "true");
  expect("actions: the count follows the server", document.querySelector("[data-v9-like]")?.textContent === "13", document.querySelector("[data-v9-like]")?.textContent);
  expect("actions: a reaction opens the composer", Boolean(document.querySelector("[data-v9-comment-input]")));

  /* a comment */
  const input = document.querySelector("[data-v9-comment-input]");
  input.value = "The first shot is the whole film.";
  document.querySelector("[data-v9-comment-send]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const comment = lastCall(calls, "post_comment_from");
  expect("actions: the comment goes out", comment?.body.p_body === "The first shot is the whole film.", JSON.stringify(comment?.body));
  expect("actions: with its video", comment?.body.p_ref === "VSR-000001");
  expect("actions: the box empties", input.value === "");

  /* watch later */
  document.querySelector("[data-v9-save]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  const saved = safeParse(window.localStorage.getItem("1w.videos.saved") || "[]");
  expect("actions: watch later is the site's saved list", Array.isArray(saved) && saved.includes("VSR-000001"), JSON.stringify(saved));
  expect("actions: the button remembers", document.querySelector("[data-v9-save]")?.getAttribute("aria-pressed") === "true");

  /* share — the clipboard is not there in jsdom, the reshare is what is measured */
  document.querySelector("[data-v9-share]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  const reshare = lastCall(calls, "post_reshare_from");
  expect("actions: share reshares", Boolean(reshare), "no reshare");
  expect("actions: reshare names the video", reshare?.body.p_ref === "VSR-000001", reshare?.body.p_ref);

  /* follow */
  document.querySelector("[data-v9-follow]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(100);
  const follow = lastCall(calls, "profile_follow_toggle");
  expect("actions: follow reaches the member graph", Boolean(follow), "no follow call");
  expect("actions: it follows the publisher", follow?.body.p_ref === "p1", JSON.stringify(follow?.body));

  /* report */
  document.querySelector("[data-v9-actions] [data-v9-report]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  expect("actions: the report box opens", document.querySelector("[data-v9-report-box]")?.hidden === false);
  document.querySelector("[data-v9-report-reason]").value = "spam";
  document.querySelector("[data-v9-report-note]").value = "It is an advert.";
  document.querySelector("[data-v9-report-send]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(100);
  const report = lastCall(calls, "post_report_from");
  expect("actions: the report goes out", report?.body.p_reason === "spam" && report?.body.p_note === "It is an advert.", JSON.stringify(report?.body));
  expect("actions: the box closes", document.querySelector("[data-v9-report-box]")?.hidden === true);

  /* a comment vote */
  document.querySelector("[data-v9-vote]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(100);
  expect("actions: a comment can be voted on", Boolean(lastCall(calls, "post_comment_vote")), "no vote call");
}

/* ================================================================== */
/* pass 5 — the keyboard                                              */
/* ================================================================== */
{
  const { document, window } = viewer;
  window.location.hash = "#/v/ID=VSR-000001";
  await wait(200);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await wait(200);
  expect("keys: down walks forward", window.location.hash === "#/v/ID=VSR-000002", window.location.hash);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await wait(200);
  expect("keys: down again reaches the last", window.location.hash === "#/v/ID=VSR-000000", window.location.hash);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await wait(150);
  expect("keys: the shelf refuses past its end", window.location.hash === "#/v/ID=VSR-000000", window.location.hash);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
  await wait(200);
  expect("keys: up walks back", window.location.hash === "#/v/ID=VSR-000002", window.location.hash);
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await wait(150);
  expect("keys: escape gives the address back", window.location.hash === "", window.location.hash);
  expect("keys: the vertical block steps away", document.querySelector("[data-vert-page]")?.hidden === true);
  expect("keys: the player is gone", document.querySelectorAll("[data-v9-player] video, [data-v9-player] iframe").length === 0);
}

/* a mouse dragged across the picture moves along the shelf too */
{
  const { document, window } = viewer;
  window.location.hash = "#/v/ID=VSR-000001";
  await wait(220);
  const stage = document.querySelector("[data-v9-stage]");
  stage.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 400, clientY: 300, button: 0 }));
  stage.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, clientX: 240, clientY: 305 }));
  await wait(220);
  expect("drag: a leftward drag is the next one", window.location.hash === "#/v/ID=VSR-000002", window.location.hash);
  const stage2 = document.querySelector("[data-v9-stage]");
  stage2.dispatchEvent(new window.MouseEvent("pointerdown", { bubbles: true, clientX: 200, clientY: 300, button: 0 }));
  stage2.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true, clientX: 360, clientY: 296 }));
  await wait(220);
  expect("drag: a rightward drag is the one before", window.location.hash === "#/v/ID=VSR-000001", window.location.hash);
}

/* typing in the comment box never walks the shelf */
{
  const { document, window } = viewer;
  window.location.hash = "#/v/ID=VSR-000001";
  await wait(200);
  /* the composer is behind the reaction rule: react, then type */
  document.querySelector('[data-v9-react="1"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(150);
  const input = document.querySelector("[data-v9-comment-input]");
  input.focus();
  input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  await wait(120);
  expect("keys: an arrow inside the box is the box's", window.location.hash === "#/v/ID=VSR-000001", window.location.hash);
}

/* ================================================================== */
/* pass 6 — gone, locked, and behind the gate                         */
/* ================================================================== */
{
  const { document } = boot("videos.html", {
    hash: "#/v/ID=VSR-404404",
    storage: { ...SIGNED },
    fetchImpl: (href) => (fnName(href) === "video_get" ? reply({ ok: false, error: "not_found" }) : reply({ ok: true, rows: [], total: 0 })),
  });
  await import(`file://${join(root, "assets/js/vertical.js")}?g1`);
  await wait(160);
  expect("gone: the page says so", /That video is gone/.test(document.body.textContent || ""), document.body.textContent?.slice(0, 90));
  expect("gone: no half a player is left", !document.querySelector("[data-v9-actions]"));
}

{
  const locked = vcard({ code: "VSR-000777", title: "A door with a word" });
  const { document } = boot("videos.html", {
    hash: "#/v/ID=VSR-000777",
    storage: { ...SIGNED },
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_get") return reply({ ok: true, video: locked, locked: true });
      if (fn === "video_hub") return reply(HUB);
      return reply({ ok: true, rows: [], total: 0 });
    },
  });
  await import(`file://${join(root, "assets/js/vertical.js")}?g2`);
  await wait(160);
  expect("locked: the door is named", /not for everyone/.test(document.body.textContent || ""));
  expect("locked: no player is mounted", !document.querySelector("[data-v9-player] video, [data-v9-player] iframe"));
  expect("locked: no actions are offered", !document.querySelector("[data-v9-actions]"));
}

/* a new vertical video, for a guest: the count comes first — never a task */
{
  const { document } = boot("videos.html", {
    hash: "#/v/ID=VSR-000900",
    storage: {},
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_get") return reply({ ok: true, video: vcard({ code: "VSR-000900", title: "New to you" }) });
      if (fn === "video_hub") return reply(HUB);
      return reply({ ok: true, rows: [], total: 0 });
    },
  });
  await import(`file://${join(root, "assets/js/vertical.js")}?g3`);
  await wait(160);
  const gate = document.querySelector("[data-v9-gate] .vad");
  expect("gate: a new video asks first", Boolean(gate), "no gate");
  expect("gate: nothing plays behind the door", !document.querySelector("[data-v9-player] video, [data-v9-player] iframe"));
  expect("gate: a guest is asked for the count, not a task", !document.querySelector(".vad--task"));
  expect("gate: it is the videos rule", /20/.test(gate?.textContent || ""), gate?.textContent?.slice(0, 120));
}

/* a landscape row has no place on this shelf: it is handed to the videos page */
{
  const wide = vcard({ code: "VID-001039", title: "A wide shot", orientation: "h" });
  wide.video = { ...wide.video, meta: { ...wide.video.meta, vertical: false } };
  const { document } = boot("videos.html", {
    hash: "#/v/ID=VID-001039",
    storage: { ...SIGNED },
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_get") return reply({ ok: true, video: wide, related: [], more: [], locked: false });
      if (fn === "video_hub") return reply(HUB);
      return reply({ ok: true, rows: [], total: 0 });
    },
  });
  await import(`file://${join(root, "assets/js/vertical.js")}?g4`);
  await wait(200);
  expect(
    "shelf: a landscape video is handed back to the videos format",
    document.documentElement.dataset.vertMoved === "#/h/ID=VID-001039",
    document.documentElement.dataset.vertMoved
  );
  expect("shelf: and nothing of it is drawn here", !document.querySelector(".v9info__title") && !document.querySelector("[data-v9-player] video"));
}

/* ================================================================== */
/* pass 7 — the page and its stylesheet                               */
/* ================================================================== */
{
  const html = readFileSync(join(root, "videos.html"), "utf8");
  expect("page: the format lives on the videos page", /data-page="videos"/.test(html));
  expect("page: the header is the site's", /data-site-header/.test(html));
  expect("page: the sidebar is the site's", /data-site-sidebar/.test(html));
  expect("page: the footer is the site's", /data-site-footer/.test(html));
  expect("page: it carries the vertical stylesheet", /assets\/css\/vertical\.css/.test(html));
  expect(
    "page: the vertical script loads only for the address that asks for it",
    /import\(\s*["'][^"']*vertical\.js/.test(readFileSync(join(root, "assets/js/videos.js"), "utf8")) &&
      !/assets\/js\/vertical\.js/.test(html)
  );
  expect("page: both formats have their containers", /data-v-browse/.test(html) && /data-v-watch/.test(html) && /data-vert-browse/.test(html) && /data-vert-watch/.test(html));
  expect("page: the vertical block starts out of the way", /<div data-vert-page hidden>/.test(html));
  expect("page: the shelf is reached from the page itself", /href="#\/vertical"/.test(html));

  /* `vertical.html` is only a door now: it forwards the hash it was given,
     and an empty hash lands on the shelf */
  const stub = readFileSync(join(root, "vertical.html"), "utf8");
  expect("door: vertical.html forwards to the videos page", /location\.replace\("videos\.html"/.test(stub), "no forward");
  expect("door: an empty address lands on the shelf", /#\/vertical/.test(stub));
  expect("door: it keeps the hash it was given", /location\.hash/.test(stub));

  expect("css: the stage has three columns", /\.v9stage\s*\{[^}]*grid-template-columns:\s*minmax\(0,\s*1fr\)\s*auto\s*minmax\(0,\s*1fr\)/s.test(css));
  expect("css: the strip above it is not a grid child", /\.v9rail\s*\{[^}]*grid-column:\s*auto/s.test(css), "no .v9rail rule");
  const videoCss = readFileSync(join(root, "assets/css/video.css"), "utf8");
  expect("css: and its track scrolls sideways", /\.vrail__track\s*\{[^}]*overflow-x:\s*auto/s.test(videoCss), "no sideways track");
  expect("css: the player is nine by sixteen", /\.v9player__box\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/s.test(css));
  expect("css: the card is nine by sixteen", /\.v9card__media\s*\{[^}]*aspect-ratio:\s*9\s*\/\s*16/s.test(css));
  expect("css: the neighbours are blurred", /\.v9side\s*\{[^}]*filter:\s*blur/s.test(css));
  expect("css: and quieter than the player", /\.v9side\s*\{[^}]*opacity:\s*0?\.\d+/s.test(css));
  expect("css: the round actions are round", /\.v9act\s*\{[^}]*border-radius:\s*999px/s.test(css));
  expect("css: a phone drops the neighbours", /@media \(max-width: 1180px\)[\s\S]*?\.v9side\s*\{\s*display:\s*none/s.test(css));
  expect("css: a phone keeps the safe area", /env\(safe-area-inset-bottom\)/.test(css) && /env\(safe-area-inset-top\)/.test(css));
  expect("css: light has its own wall", /\[data-theme="light"\]\s+\.vert::before/.test(css));
  expect("css: less motion is respected", /prefers-reduced-motion/.test(css));
  expect("css: the gate sits over the picture", /\.v9gate\s*\{[^}]*position:\s*absolute/s.test(css));
}

/* ------------------------------------------------------------------ */
/* the report                                                         */
/* ------------------------------------------------------------------ */
booted.forEach((window) => {
  try {
    window.close();
  } catch {
    /* a window already closed is closed */
  }
});

const failed = checks.filter((c) => !c.ok);
const width = Math.max(...checks.map((c) => c.name.length)) + 2;
checks.forEach((c) => console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.name.padEnd(width)} ${c.detail && !c.ok ? `→ ${c.detail}` : ""}`));
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
if (failed.length) process.exitCode = 1;
