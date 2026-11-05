/**
 * Articles smoke test — the index, the reader and the writing page.
 *
 *   node tools/article-smoke.mjs
 *
 * Pass 1  — the index: cards, the count, the field chips, the leading
 *           piece, the shelves, and a sort / field / search that reach
 *           the server with the arguments article_feed expects.
 * Pass 2  — the empty index and the empty search say something useful.
 * Pass 3  — the reader: the piece, its sanitised body, the writer, the
 *           reactions, the comment rule, a comment and a vote.
 * Pass 4  — the exclusive door: the audience, what the viewer already
 *           has, the reminder, and no body leaking through.
 * Pass 5  — the private door: a wrong password says so, the right one
 *           opens the piece for the visit.
 * Pass 6  — an article that is gone, and one that was never named.
 * Pass 7  — the writing page: signed out it asks for a sign-in; signed
 *           in it counts words, builds the checks and saves a draft with
 *           exactly the payload the server expects.
 * Pass 8  — the editor's hands: every toolbar function on a real range.
 * Pass 9  — publishing: the audience rules, the private list and its
 *           passwords; a Help page goes to review, public and pending.
 * Pass 10 — the rules both pages share: word count, reading time, the
 *           sanitizer; and the stylesheet carries every class worn.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
const strip = (file) => readFileSync(join(root, file), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const css = readFileSync(join(root, "assets/css/article.css"), "utf8");
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const reply = (data, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data, text: async () => JSON.stringify(data) });

/* ------------------------------------------------------------------ */
/* fixtures                                                           */
/* ------------------------------------------------------------------ */
function row(over = {}) {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    code: "PST-001015",
    type: "article",
    title: "The long take is not a flex",
    description: "A four-minute unbroken shot is not automatically four minutes of meaning.",
    thumbnail: "https://example.com/cover.jpg",
    embed: null,
    language: "en",
    visibility: "general",
    status: "published",
    published_at: new Date(Date.now() - 7200_000).toISOString(),
    read_minutes: 3,
    word_count: 476,
    rank_points: 0,
    keywords: [
      { id: "k1", keyword: "Film", role: "main", parent_id: null },
      { id: "k2", keyword: "Camera", role: "main", parent_id: null },
    ],
    counters: { likes: 3, dislikes: 0, comments: 2, impressions: 84, reshares: 0, reports: 0 },
    publisher: { id: "p1", name: "MOUAOUINE EL MEHDI", username: "@ledsizar", avatar: null, online: true },
    author: { id: "p1", name: "MOUAOUINE EL MEHDI", username: "@ledsizar", avatar: null },
    audience: [],
    related: [],
    translations: [],
    mine: { reaction: null, reshared: false, reported: false, can_interact: true, can_manage: false },
    article: {
      meta: { place: "content", field: "Film", category: "Craft" },
      field: "Film",
      category: "Craft",
      place: "content",
      words: 476,
      reading: 3,
      host: { id: "p1", name: "MOUAOUINE EL MEHDI", username: "@ledsizar", avatar: null, followers: 1, posts: 8, country: "Morocco" },
    },
    ...over,
  };
}

const FEED = {
  ok: true,
  rows: [
    row(),
    row({ code: "PST-001016", title: "A 24-hour cinema is an act of scheduling", id: "bbbbbbbb-1111-4111-8111-111111111111", article: { ...row().article, field: "Cinema", category: "Exhibition" } }),
    row({ code: "PST-001017", title: "Serial television forgot how to end a scene", id: "cccccccc-1111-4111-8111-111111111111", visibility: "limited", article: { ...row().article, field: "Series", category: "Writing" } }),
  ],
  fields: [
    { name: "Film", count: 2 },
    { name: "Cinema", count: 2 },
    { name: "Series", count: 1 },
  ],
  rails: [
    { field: "Film", count: 2, rows: [row(), row({ code: "PST-001022", title: "The trailer is a separate art form", id: "dddddddd-1111-4111-8111-111111111111" })] },
    { field: "Cinema", count: 1, rows: [row({ code: "PST-001023", title: "The seat you choose", id: "eeeeeeee-1111-4111-8111-111111111111", article: { ...row().article, field: "Cinema" } })] },
  ],
  total: 3,
  limit: 24,
  offset: 0,
  can_write: true,
};

const BODY = `<p>Every few months a film arrives with a shot that refuses to cut.</p><h2>The camera is always saying something</h2><p>When a shot refuses to cut, the director gives up two tools.</p><blockquote><p>A shot that lasts four minutes because nothing needed cutting is four minutes long.</p></blockquote><p onclick="steal()">And a <a href="javascript:alert(1)">bad link</a>.</p><script>alert(2)</script>`;

const OPEN = {
  ok: true,
  locked: false,
  unlocked: false,
  asks_password: false,
  mine: false,
  authenticated: true,
  article: { ...row(), body: BODY },
  related: [row({ code: "PST-001022", title: "The trailer is a separate art form" })],
  more: [],
};

const COMMENTS = {
  ok: true,
  comments: [
    {
      id: 41,
      code: "cmt000041",
      body: "The kitchen scene is the whole argument.",
      parent_id: null,
      likes: 2,
      dislikes: 0,
      edited: false,
      sentiment: 1,
      created_at: new Date(Date.now() - 300_000).toISOString(),
      author: { id: "m2", name: "Sara", username: "@sara", avatar: null },
      mine: false,
    },
  ],
  count: 1,
  reaction: null,
  can_comment: false,
};

const VIEWER = { signed_in: true, username: "@ledsizar", level: "1", wealth: "0", country: "Morocco", language: "en" };

const LOCKED_EXCLUSIVE = {
  ok: true,
  locked: true,
  asks_password: false,
  audience: [
    { kind: "level", value: "5", mode: "include" },
    { kind: "level", value: "6", mode: "include" },
    { kind: "level", value: "7", mode: "include" },
    { kind: "level", value: "8", mode: "include" },
    { kind: "level", value: "9", mode: "include" },
    { kind: "level", value: "10", mode: "include" },
    { kind: "country", value: "Andorra", mode: "include" },
    { kind: "language", value: "fr", mode: "include" },
  ],
  allowed: 0,
  followers_only: false,
  viewer: VIEWER,
  article: {
    id: "ffffffff-1111-4111-8111-111111111111",
    code: "PST-001020",
    title: "Monochrome is a budget that never runs out",
    description: "Black and white is the cheapest look in cinema and the most expensive decision.",
    thumbnail: "https://example.com/mono.jpg",
    visibility: "limited",
    status: "published",
    language: "en",
    published_at: new Date().toISOString(),
    asks_password: false,
    host: { id: "p2", name: "Jhon Markoni", username: "@ledsizar7", avatar: null },
  },
};

const LOCKED_PRIVATE = {
  ok: true,
  locked: true,
  asks_password: true,
  audience: [],
  allowed: 2,
  followers_only: false,
  viewer: VIEWER,
  article: {
    id: "99999999-1111-4111-8111-111111111111",
    code: "PST-001021",
    title: "Notes from a queue that never moved",
    description: "A private page from a festival week.",
    thumbnail: "https://example.com/queue.jpg",
    visibility: "private",
    status: "published",
    language: "en",
    published_at: new Date().toISOString(),
    asks_password: true,
    host: { id: "p2", name: "Jhon Markoni", username: "@ledsizar7", avatar: null },
  },
};

/* ------------------------------------------------------------------ */
/* the harness                                                        */
/* ------------------------------------------------------------------ */
function boot(file, { url = "", storage = {}, fetchImpl } = {}) {
  const dom = new JSDOM(strip(file), { url: `http://localhost/${url || file}`, pretendToBeVisual: true });
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
  globalThis.DOMParser = window.DOMParser;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({
    matches: false,
    media: q,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  });
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  if (!globalThis.crypto || typeof globalThis.crypto.getRandomValues !== "function") {
    Object.defineProperty(globalThis, "crypto", { value: window.crypto, configurable: true });
  }
  const calls = [];
  globalThis.fetch = (input, opts = {}) => {
    const href = String(input);
    let body = null;
    try {
      body = opts.body ? JSON.parse(opts.body) : null;
    } catch {
      body = opts.body || null;
    }
    calls.push({ href, body, method: opts.method || "GET" });
    if (fetchImpl) return fetchImpl(href, opts, calls);
    return reply([]);
  };
  return { dom, window, document: window.document, calls, errors };
}

const fnName = (href) => String(href).split("/rpc/")[1] || "";
const lastCall = (calls, fn) => [...calls].reverse().find((c) => fnName(c.href) === fn);
const MEMBER = {
  "1w.member": JSON.stringify({ id: "m1", username: "@ledsizar", name: "El Mehdi", level: 1, points: 0 }),
  "1w.session": "tok-article",
};

/* ================================================================== */
/* pass 1 — the index                                                 */
/* ================================================================== */
{
  const { document, calls, errors, window } = boot("articles.html", {
    storage: MEMBER,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "article_feed") return reply(FEED);
      if (fn === "article_mine") return reply({ ok: true, rows: [row({ code: "PST-001030", title: "A draft", status: "draft" })] });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/articles.js")}?p1`);
  await wait(80);

  const cards = document.querySelectorAll("[data-a-grid] .acard");
  const rails = document.querySelectorAll("[data-a-rails] .arail");
  expect("index: the leading piece stands at the top", document.querySelector("[data-a-feature]")?.hidden === false);
  expect("index: the leading piece is the first row", document.querySelector(".afeat__title")?.textContent.includes("The long take"), document.querySelector(".afeat__title")?.textContent);
  expect("index: the grid leaves the leading piece out", cards.length === 2, cards.length);
  expect("index: a card opens the reader", cards[0]?.getAttribute("href") === "article.html?id=PST-001016", cards[0]?.getAttribute("href"));
  expect("index: a card carries the field", cards[0]?.textContent.includes("Cinema"));
  expect("index: a card carries the reading time", cards[0]?.textContent.includes("min"));
  expect("index: the count is spoken", document.querySelector("[data-a-count]")?.textContent === "3 of 3 articles", document.querySelector("[data-a-count]")?.textContent);
  expect("index: one chip per field and an all chip", document.querySelectorAll("[data-a-field]").length === 4, document.querySelectorAll("[data-a-field]").length);
  expect("index: the chips carry their counts", document.querySelector("[data-a-field]")?.textContent.includes("3"));
  expect("index: the shelves are drawn", rails.length === 2, rails.length);
  expect("index: a closed piece wears its badge", document.querySelector(".acard__badge")?.textContent.includes("Exclusive"), document.querySelector(".acard__badge")?.textContent);
  expect("index: the member's own shelf", document.querySelector("[data-a-yours]")?.hidden === false);
  expect("index: the shelf names the draft", document.querySelector("[data-a-shelf]")?.textContent.includes("A draft"));
  expect("index: nothing threw", errors.length === 0, errors.join(" | "));

  /* sort */
  document.querySelector('[data-sort="new"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("index: the sort reaches the server", lastCall(calls, "article_feed")?.body.p_sort === "new", lastCall(calls, "article_feed")?.body.p_sort);
  expect("index: the active sort moves", document.querySelector('[data-sort="new"]').classList.contains("is-active"));

  /* a field */
  document.querySelectorAll("[data-a-field]")[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("index: the field reaches the server", lastCall(calls, "article_feed")?.body.p_field === "Film", lastCall(calls, "article_feed")?.body.p_field);
  expect("index: a field hides the shelves", document.querySelector("[data-a-rails]")?.hidden === true);

  /* search, debounced */
  const search = document.querySelector("[data-a-search]");
  search.value = "monochrome";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(420);
  expect("index: the search reaches the server", lastCall(calls, "article_feed")?.body.p_search === "monochrome", lastCall(calls, "article_feed")?.body.p_search);
}

/* ================================================================== */
/* pass 2 — nothing to show                                           */
/* ================================================================== */
{
  const { document, errors } = boot("articles.html", {
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "article_feed") return reply({ ok: true, rows: [], fields: [], rails: [], total: 0, limit: 24, offset: 0 });
      return reply({ ok: true, rows: [] });
    },
  });
  await import(`file://${join(root, "assets/js/articles.js")}?p2`);
  await wait(60);
  expect("empty: the empty page is drawn", document.querySelector("[data-a-empty]")?.hidden === false);
  expect("empty: it offers a way in", document.querySelector("[data-a-empty]")?.textContent.includes("Write the first article"));
  expect("empty: no shelves without rows", document.querySelector("[data-a-rails]")?.hidden === true);
  expect("empty: the count says nothing", document.querySelector("[data-a-count]")?.textContent === "");
  expect("empty: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 3 — the reader                                                */
/* ================================================================== */
{
  const { document, calls, errors, window } = boot("article.html", {
    url: "article.html?id=PST-001015",
    storage: MEMBER,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "article_get") return reply(OPEN);
      if (fn === "post_comments") return reply(COMMENTS);
      if (fn === "post_react") return reply({ ok: true, likes: 4, dislikes: 0, reaction: 1 });
      if (fn === "post_comment") return reply({ ok: true });
      if (fn === "post_comment_vote") return reply({ ok: true, agree: 3, disagree: 0, mine: "agree" });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/article.js")}?p3`);
  await wait(90);

  expect("reader: the piece is shown", document.querySelector("[data-r-reader]")?.hidden === false);
  expect("reader: the title is set", document.querySelector("[data-r-title]")?.textContent === "The long take is not a flex");
  expect("reader: the document title follows", document.title.startsWith("The long take"));
  expect("reader: the description is kept", document.querySelector("[data-r-desc]")?.textContent.includes("four minutes of meaning"));
  expect("reader: the writer is named", document.querySelector("[data-r-by]")?.textContent.includes("MOUAOUINE EL MEHDI"));
  expect("reader: the reading time is printed", document.querySelector("[data-r-by]")?.textContent.includes("3 min read"));
  expect("reader: the cover is used", document.querySelector("[data-r-cover]")?.hidden === false);
  expect("reader: the body is rendered", document.querySelectorAll("[data-r-body] p").length >= 2, document.querySelectorAll("[data-r-body] p").length);
  expect("reader: headings survive", Boolean(document.querySelector("[data-r-body] h2")));
  expect("reader: quotes survive", Boolean(document.querySelector("[data-r-body] blockquote")));
  expect("reader: no script survived", !document.querySelector("[data-r-body] script"));
  expect("reader: no handler survived", !document.querySelector("[data-r-body] [onclick]"));
  expect("reader: no javascript: link survived", !document.querySelector('[data-r-body] a[href^="javascript"]'));
  expect("reader: the tags are chips", document.querySelectorAll("[data-r-tags] .chip").length === 2, document.querySelectorAll("[data-r-tags] .chip").length);
  expect("reader: the writer card is in the column", document.querySelector(".rauth__name")?.textContent === "MOUAOUINE EL MEHDI");
  expect("reader: the writer card links to the hub", document.querySelector(".rauth a")?.getAttribute("href") === "creator.html?studio=%40ledsizar", document.querySelector(".rauth a")?.getAttribute("href"));
  expect("reader: suggestions are listed", document.querySelector("[data-r-suggest]")?.hidden === false);

  /* the reaction counters */
  expect("reader: the counters arrive", document.querySelector("[data-r-like]")?.textContent === "3", document.querySelector("[data-r-like]")?.textContent);

  /* the comment rule */
  expect("reader: no composer before a reaction", !document.querySelector("[data-r-comment-input]"));
  expect("reader: the rule is explained", document.querySelector(".talk__gate")?.textContent.includes("useful"));

  /* a reaction opens the composer */
  document.querySelector("[data-r-react='1']").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  expect("reader: the reaction is sent", fnName(lastCall(calls, "post_react")?.href) === "post_react");
  expect("reader: the reaction value is +1", lastCall(calls, "post_react")?.body.p_value === 1, lastCall(calls, "post_react")?.body.p_value);
  expect("reader: the counter moves at once", document.querySelector("[data-r-like]")?.textContent === "4", document.querySelector("[data-r-like]")?.textContent);
  expect("reader: the composer opens", Boolean(document.querySelector("[data-r-comment-input]")));

  /* a comment */
  const input = document.querySelector("[data-r-comment-input]");
  input.value = "The kitchen scene is the whole argument.";
  document.querySelector("[data-r-comment-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(80);
  expect("reader: the comment goes out", fnName(lastCall(calls, "post_comment")?.href) === "post_comment");
  expect("reader: with its body", lastCall(calls, "post_comment")?.body.p_body === "The kitchen scene is the whole argument.");
  expect("reader: as a top-level comment", lastCall(calls, "post_comment")?.body.p_parent_id === null);

  /* agreeing with a comment */
  const agree = document.querySelector('[data-r-vote][data-agree="1"]');
  agree.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("reader: the vote is sent", fnName(lastCall(calls, "post_comment_vote")?.href) === "post_comment_vote");
  expect("reader: the vote is an agreement", lastCall(calls, "post_comment_vote")?.body.p_agree === true);
  expect("reader: the count moves", document.querySelector('[data-r-vote][data-agree="1"] b')?.textContent === "3", document.querySelector('[data-r-vote][data-agree="1"] b')?.textContent);
  expect("reader: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 4 — the exclusive door                                        */
/* ================================================================== */
{
  const { document, errors, window } = boot("article.html", {
    url: "article.html?id=PST-001020",
    storage: MEMBER,
    fetchImpl: (href) => (fnName(href) === "article_get" ? reply(LOCKED_EXCLUSIVE) : reply([])),
  });
  await import(`file://${join(root, "assets/js/article.js")}?p4`);
  await wait(80);

  expect("door: the reader is hidden", document.querySelector("[data-r-reader]")?.hidden === true);
  expect("door: the gate is drawn", Boolean(document.querySelector(".agate__card")));
  expect("door: it names the piece", document.querySelector(".agate__title")?.textContent === "Monochrome is a budget that never runs out");
  expect("door: it says exclusive", document.querySelector(".agate__kicker")?.textContent === "Exclusive article");
  expect("door: the level range is one row", document.querySelectorAll(".astep").length === 3, document.querySelectorAll(".astep").length);
  expect("door: the level row reads as a range", document.querySelector(".astep__val")?.textContent === "LV 5 – LV 10", document.querySelector(".astep__val")?.textContent);
  expect("door: nothing matches this viewer", document.querySelectorAll(".astep.is-ok").length === 0);
  expect("door: the country row is there", document.body.textContent.includes("Andorra"));
  expect("door: no body leaks", !document.body.textContent.includes("Every few months a film arrives"));
  expect("door: it offers a reminder", Boolean(document.querySelector("[data-r-remind]")));

  document.querySelector("[data-r-remind]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(40);
  expect("door: the reminder is kept on the device", String(window.localStorage.getItem("1w.articles.remind")).includes("PST-001020"), window.localStorage.getItem("1w.articles.remind"));
  expect("door: the button says so", document.querySelector("[data-r-remind]")?.textContent.includes("Reminder set"));
  expect("door: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 5 — the private door                                          */
/* ================================================================== */
{
  let tries = 0;
  const { document, errors, window } = boot("article.html", {
    url: "article.html?id=PST-001021",
    storage: MEMBER,
    fetchImpl: (href, opts) => {
      const fn = fnName(href);
      if (fn !== "article_get") {
        if (fn === "post_comments") return reply(COMMENTS);
        return reply([]);
      }
      tries += 1;
      const body = JSON.parse(opts.body);
      if (body.p_key === "1world2026") {
        return reply({ ...OPEN, article: { ...row({ code: "PST-001021", title: "Notes from a queue that never moved" }), body: "<p>We stood in the wrong queue for an hour and forty minutes.</p>" }, unlocked: true });
      }
      return reply(LOCKED_PRIVATE);
    },
  });
  await import(`file://${join(root, "assets/js/article.js")}?p5`);
  await wait(80);

  expect("private: the gate asks for a password", Boolean(document.querySelector("[data-r-key-form]")));
  expect("private: it says private", document.querySelector(".agate__kicker")?.textContent === "Private article");
  expect("private: it counts the list", document.body.textContent.includes("2 members are on the writer's list"), document.body.textContent.slice(0, 0));
  expect("private: no steps for a private piece", document.querySelectorAll(".astep").length === 0);

  /* the wrong password */
  const form = document.querySelector("[data-r-key-form]");
  document.querySelector("[data-r-key-input]").value = "letmein";
  form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(120);
  expect("private: a wrong password says so", document.querySelector("[data-r-key-err]")?.hidden === false);
  expect("private: the piece stays shut", document.querySelector("[data-r-reader]")?.hidden === true);
  expect("private: the key is taken out of the address", location.search === "?id=PST-001021", location.search);

  /* the right one */
  const form2 = document.querySelector("[data-r-key-form]");
  document.querySelector("[data-r-key-input]").value = "1world2026";
  form2.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(160);
  expect("private: the right password opens it", document.querySelector("[data-r-reader]")?.hidden === false);
  expect("private: the piece is there", document.querySelector("[data-r-body]")?.textContent.includes("wrong queue"), document.querySelector("[data-r-body]")?.textContent?.slice(0, 60));
  expect("private: it says the password was used", document.querySelector("[data-r-badges]")?.textContent.includes("Opened with a password"));
  expect("private: one call to open, one per attempt", tries === 3, tries);
  expect("private: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 6 — gone, and unnamed                                         */
/* ================================================================== */
{
  const gone = boot("article.html", {
    url: "article.html?id=PST-000000",
    fetchImpl: () => reply({ ok: false, error: "not_found" }),
  });
  await import(`file://${join(root, "assets/js/article.js")}?p6a`);
  await wait(60);
  expect("gone: it says so", gone.document.querySelector("[data-r-state]")?.textContent.includes("gone"));
  expect("gone: the reader stays hidden", gone.document.querySelector("[data-r-reader]")?.hidden === true);
  expect("gone: nothing threw", gone.errors.length === 0, gone.errors.join(" | "));

  const none = boot("article.html", { url: "article.html", fetchImpl: () => reply({}) });
  await import(`file://${join(root, "assets/js/article.js")}?p6b`);
  await wait(40);
  expect("unnamed: it asks for a code", none.document.querySelector("[data-r-state]")?.textContent.includes("No article named"));
  expect("unnamed: it never calls the server", none.calls.length === 0, none.calls.length);
}

/* ================================================================== */
/* pass 7 — the writing page, signed out and signed in                 */
/* ================================================================== */
{
  const out = boot("article-editor.html", { url: "article-editor.html", fetchImpl: () => reply({}) });
  await import(`file://${join(root, "assets/js/article-editor.js")}?p7a`);
  await wait(50);
  expect("editor: signed out shows the door", out.document.querySelector("[data-e-state]")?.hidden === false);
  expect("editor: the form stays hidden", out.document.querySelector("[data-e-shell]")?.hidden === true);
  expect("editor: it links to the sign-in", out.document.querySelector("[data-e-state] a")?.getAttribute("href") === "login.html?next=article-editor.html", out.document.querySelector("[data-e-state] a")?.getAttribute("href"));
  expect("editor: nothing threw", out.errors.length === 0, out.errors.join(" | "));

  const { document, calls, errors } = boot("article-editor.html", {
    url: "article-editor.html",
    storage: MEMBER,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "article_mine") return reply({ ok: true, rows: [row({ code: "PST-001015", title: "The long take is not a flex" })] });
      if (fn === "article_feed") return reply({ ok: true, rows: [], fields: [{ name: "Film", count: 2 }], rails: [], total: 0 });
      if (fn === "article_save") return reply({ ok: true, code: "PST-001040", status: "draft", scheduled_at: null, article: row({ code: "PST-001040", status: "draft" }) });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/article-editor.js")}?p7b`);
  await wait(70);

  expect("editor: the form is shown", document.querySelector("[data-e-shell]")?.hidden === false);
  expect("editor: the language list is filled", document.querySelectorAll("[data-e-lang] option").length === 8, document.querySelectorAll("[data-e-lang] option").length);
  expect("editor: the fields datalist is filled", document.querySelectorAll("[data-e-fields] option").length === 1);
  expect("editor: the member's pieces are listed", document.querySelector("[data-e-mine]")?.textContent.includes("The long take"));

  /* the toolbar exists */
  expect("editor: the toolbar carries every command", document.querySelectorAll("[data-cmd]").length >= 15, document.querySelectorAll("[data-cmd]").length);
  expect("editor: a block select for headings", Boolean(document.querySelector("[data-e-block]")));

  /* typing */
  document.querySelector("[data-e-title]").value = "A piece written in a test";
  document.querySelector("[data-e-title]").dispatchEvent(new Event("input", { bubbles: true }));
  document.querySelector("[data-e-body]").innerHTML = "<p>One two three four five.</p><h2>A heading</h2>";
  document.querySelector("[data-e-body]").dispatchEvent(new Event("input", { bubbles: true }));
  await wait(20);
  expect("editor: the title counter counts", document.querySelector("[data-e-title-count]")?.textContent === "25 / 200", document.querySelector("[data-e-title-count]")?.textContent);
  expect("editor: the words are counted with the tags stripped", document.querySelector("[data-e-words]")?.textContent === "7 words", document.querySelector("[data-e-words]")?.textContent);
  expect("editor: the reading time follows the rule", document.querySelector("[data-e-reading]")?.textContent === "1 min read", document.querySelector("[data-e-reading]")?.textContent);

  /* tags */
  const tagInput = document.querySelector("[data-e-tag-input]");
  tagInput.value = "Film";
  tagInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  await wait(20);
  expect("editor: a tag becomes a chip", document.querySelectorAll("[data-e-chips] .atag").length === 1);
  expect("editor: the tag counter counts", document.querySelector("[data-e-tag-count]")?.textContent === "1 / 12 tags", document.querySelector("[data-e-tag-count]")?.textContent);

  /* the checks */
  const checksText = () => document.querySelector("[data-e-checks]")?.textContent || "";
  expect("editor: a body is ticked", document.querySelectorAll("[data-e-checks] .is-ok").length === 2, document.querySelectorAll("[data-e-checks] .is-ok").length);
  expect("editor: a field is still missing", checksText().includes("A field"));

  /* the field */
  document.querySelector("[data-e-field]").value = "Film";
  document.querySelector("[data-e-field]").dispatchEvent(new Event("change", { bubbles: true }));
  await wait(20);
  expect("editor: the field ticks the check", document.querySelectorAll("[data-e-checks] .is-ok").length === 3, document.querySelectorAll("[data-e-checks] .is-ok").length);

  /* a draft */
  document.querySelector("[data-e-draft]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(80);
  const draft = lastCall(calls, "article_save");
  expect("editor: the draft is sent", Boolean(draft), calls.map((c) => fnName(c.href)).join(","));
  expect("editor: as a draft", draft?.body.p_payload.status === "draft", draft?.body.p_payload.status);
  expect("editor: with the body as written", draft?.body.p_payload.body.includes("<h2>A heading</h2>"), draft?.body.p_payload.body);
  expect("editor: with the field in meta", draft?.body.p_payload.meta.field === "Film", JSON.stringify(draft?.body.p_payload.meta));
  expect("editor: with the tags", JSON.stringify(draft?.body.p_payload.tags) === '["Film"]', JSON.stringify(draft?.body.p_payload.tags));
  expect("editor: with the member's token", draft?.body.p_token === "tok-article");
  expect("editor: the status line follows", document.querySelector("[data-e-status]")?.textContent.includes("draft"), document.querySelector("[data-e-status]")?.textContent);
  expect("editor: the address carries the new code", location.search === "?id=PST-001040", location.search);
  expect("editor: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 8 — the editor's hands: every toolbar function, for real       */
/* ================================================================== */
{
  const { document, window, calls, errors } = boot("article-editor.html", {
    url: "article-editor.html",
    storage: MEMBER,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "article_mine") return reply({ ok: true, rows: [] });
      if (fn === "article_feed") return reply({ ok: true, rows: [], fields: [{ name: "Film", count: 1 }], rails: [], total: 0 });
      if (fn === "article_save") return reply({ ok: true, code: "PST-001042", status: "published", scheduled_at: null, article: row({ code: "PST-001042" }) });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/article-editor.js")}?p8hands`);
  await wait(70);

  const body = document.querySelector("[data-e-body]");
  const pick = (node, start, end) => {
    const range = document.createRange();
    try {
      range.setStart(node, Math.min(start, (node.textContent || "").length));
      range.setEnd(node, end == null ? (node.textContent || "").length : Math.min(end, (node.textContent || "").length));
    } catch (error) {
      console.log("pick failed", node?.nodeName, start, end, node?.textContent, error.message);
      throw error;
    }
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  const click = (selector) => document.querySelector(selector).dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const caretIn = (node, at = 0) => {
    const range = document.createRange();
    const limit = node?.nodeType === 3 ? (node.textContent || "").length : node?.childNodes.length ?? 0;
    try {
      range.setStart(node, Math.min(at, limit));
    } catch (error) {
      console.log("caret failed", node?.nodeName, at, limit, node?.textContent, error.message);
      throw error;
    }
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };

  /* the body starts empty and the toolbar has nothing to grey */
  expect("hands: the body is editable", body.getAttribute("contenteditable") === "true", body.getAttribute("contenteditable"));

  body.innerHTML = "<p>the kitchen scene is the argument</p>";
  pick(body.querySelector("p").firstChild, 4, 11);
  click('[data-cmd="bold"]');
  await wait(20);
  expect("hands: bold bolds the words", body.innerHTML.includes("<strong>kitchen</strong>"), body.innerHTML);
  expect("hands: the count survives formatting", document.querySelector("[data-e-words]")?.textContent === "6 words", document.querySelector("[data-e-words]")?.textContent);

  caretIn(body.querySelector("strong").firstChild, 2);
  body.dispatchEvent(new window.KeyboardEvent("keyup", { key: "ArrowRight", bubbles: true }));
  await wait(20);
  expect("hands: the bold button shows the caret is bold", document.querySelector('[data-cmd="bold"]').classList.contains("is-on"));

  click('[data-cmd="bold"]');
  await wait(20);
  expect("hands: pressing it again takes it off", !body.innerHTML.includes("<strong>"), body.innerHTML);

  pick(body.querySelector("p").firstChild, 0, 3);
  click('[data-cmd="italic"]');
  await wait(20);
  expect("hands: italic works", body.innerHTML.includes("<em>the</em>"), body.innerHTML);

  const block = document.querySelector("[data-e-block]");
  caretIn(body.querySelector("p").firstChild, 2);
  block.value = "h2";
  block.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(20);
  expect("hands: the block select makes a heading", Boolean(body.querySelector("h2")), body.innerHTML);

  click('[data-cmd="insertUnorderedList"]');
  await wait(20);
  expect("hands: the list button makes a list", Boolean(body.querySelector("ul li")), body.innerHTML);
  click('[data-cmd="insertUnorderedList"]');
  await wait(20);
  expect("hands: and puts it back", !body.querySelector("ul"), body.innerHTML);

  body.innerHTML = "<h2>a heading to centre</h2><p>and a line under it</p>";
  body.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(420);
  caretIn(body.querySelector("h2").firstChild, 1);
  click('[data-cmd="justifyCenter"]');
  await wait(20);
  expect("hands: centring sets the block style", body.querySelector("h2").style.textAlign === "center", body.innerHTML);

  click('[data-cmd="undo"]');
  await wait(20);
  expect("hands: undo walks back", body.querySelector("h2").style.textAlign !== "center", body.innerHTML);
  click('[data-cmd="redo"]');
  await wait(20);
  expect("hands: redo walks forward", body.querySelector("h2").style.textAlign === "center", body.innerHTML);

  /* a link through the dialog */
  body.innerHTML = "<p>read the rest of it</p>";
  pick(body.querySelector("p").firstChild, 9, 13);
  click('[data-cmd="insertLink"]');
  await wait(20);
  expect("hands: the link dialog is filled", Boolean(document.querySelector("[data-dlg-url]")), document.querySelector("[data-e-dlg-body]")?.innerHTML.slice(0, 80));
  document.querySelector("[data-dlg-url]").value = "https://example.com/more";
  document.querySelector("[data-dlg-text]").value = "";
  click("[data-e-dlg-ok]");
  await wait(30);
  expect("hands: the link lands in the piece", body.querySelector("a")?.getAttribute("href") === "https://example.com/more", body.innerHTML);
  expect("hands: on the words that were selected", body.querySelector("a")?.textContent === "rest", body.innerHTML);

  /* an image through the dialog */
  const caretAtEndOf = (node) => {
    const range = document.createRange();
    range.selectNodeContents(node);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  };
  caretAtEndOf(body.querySelector("p"));
  click('[data-cmd="insertImage"]');
  await wait(20);
  document.querySelector("[data-dlg-url]").value = "https://example.com/still.jpg";
  document.querySelector("[data-dlg-alt]").value = "a still";
  click("[data-e-dlg-ok]");
  await wait(30);
  expect("hands: the image is inserted as a figure", Boolean(body.querySelector("figure img")), body.innerHTML);
  expect("hands: with its description", body.querySelector("figure img")?.getAttribute("alt") === "a still", body.innerHTML);
  expect("hands: an empty line follows it", Boolean(body.querySelector("p")), body.innerHTML);

  /* a video, as a captioned link */
  click('[data-cmd="insertVideo"]');
  await wait(20);
  document.querySelector("[data-dlg-url]").value = "https://www.youtube.com/watch?v=abc123def45";
  document.querySelector("[data-dlg-caption]").value = "the shot in question";
  click("[data-e-dlg-ok]");
  await wait(30);
  expect("hands: the video becomes a captioned link", body.innerHTML.includes("the shot in question"), body.innerHTML);
  expect("hands: nothing is embedded", !body.innerHTML.includes("<iframe"), body.innerHTML);

  /* clear formatting */
  body.innerHTML = "<p><strong>thick</strong> and <em>slanted</em></p>";
  caretIn(body.querySelector("strong").firstChild, 1);
  click('[data-cmd="removeFormat"]');
  await wait(20);
  expect("hands: clear formatting strips the tags", !body.querySelector("strong") && !body.querySelector("em"), body.innerHTML);
  expect("hands: the words are still there", body.textContent.includes("thick") && body.textContent.includes("slanted"), body.textContent);

  /* the niche ladder */
  const micro = document.querySelector("[data-e-micro]");
  const nano = document.querySelector("[data-e-nano]");
  expect("hands: micro waits for a niche", micro?.disabled === true);
  document.querySelector("[data-e-niche]").value = "Long takes";
  document.querySelector("[data-e-niche]").dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(20);
  expect("hands: a niche unlocks micro", micro?.disabled === false);
  expect("hands: nano still waits", nano?.disabled === true);
  micro.value = "Static camera";
  micro.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(20);
  expect("hands: a micro unlocks nano", nano?.disabled === false);

  /* the draft on the device */
  document.querySelector("[data-e-title]").value = "Hands on the toolbar";
  document.querySelector("[data-e-title]").dispatchEvent(new window.Event("input", { bubbles: true }));
  document.querySelector("[data-e-field]").value = "Film";
  await wait(1100);
  const kept = window.localStorage.getItem("1w.articles.draft");
  expect("hands: the draft is kept on the device", Boolean(kept), kept ? kept.slice(0, 60) : "nothing");
  expect("hands: with the body inside it", kept?.includes("thick") || kept?.includes("slanted"), kept ? kept.slice(0, 120) : "");
  expect("hands: the status line says so", document.querySelector("[data-e-status]")?.textContent.includes("on this device"), document.querySelector("[data-e-status]")?.textContent);

  /* Ctrl+Enter publishes */
  const before = calls.filter((c) => fnName(c.href) === "article_save").length;
  body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  await wait(120);
  const sent = calls.filter((c) => fnName(c.href) === "article_save");
  expect("hands: Ctrl+Enter publishes", sent.length === before + 1, String(sent.length));
  const last = sent[sent.length - 1];
  expect("hands: as a published piece", last?.body.p_payload.status === "published", last?.body.p_payload.status);
  expect("hands: with the niche in meta", last?.body.p_payload.meta.niche === "Long takes", JSON.stringify(last?.body.p_payload.meta));
  expect("hands: with micro and nano too", last?.body.p_payload.meta.micro === "Static camera" && last?.body.p_payload.meta.nano === "", JSON.stringify(last?.body.p_payload.meta));
  expect("hands: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 9 — the audience, the private list, and Help                  */
/* ================================================================== */
{
  const { document, calls, errors } = boot("article-editor.html", {
    url: "article-editor.html",
    storage: MEMBER,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "article_mine") return reply({ ok: true, rows: [] });
      if (fn === "article_feed") return reply({ ok: true, rows: [], fields: [], rails: [], total: 0 });
      if (fn === "article_save") return reply({ ok: true, code: "PST-001041", status: "published", scheduled_at: null, article: row({ code: "PST-001041" }) });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/article-editor.js")}?p8`);
  await wait(60);

  document.querySelector("[data-e-title]").value = "An exclusive piece";
  document.querySelector("[data-e-body]").innerHTML = "<p>A body, so the piece can go out.</p>";
  document.querySelector("[data-e-field]").value = "Cinema";

  /* the audience */
  document.querySelector('[data-vis="limited"]').dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(20);
  expect("audience: the audience panel opens", document.querySelector("[data-e-audience]")?.hidden === false);
  expect("audience: the private panel stays shut", document.querySelector("[data-e-private]")?.hidden === true);
  expect("audience: it is a check until a condition is named", document.querySelector("[data-e-checks]")?.textContent.includes("An audience condition"));

  const country = document.querySelector("[data-e-country-sel]");
  country.value = "Andorra";
  country.dispatchEvent(new Event("change", { bubbles: true }));
  await wait(20);
  expect("audience: the country becomes a chip", document.querySelector("[data-e-countries]")?.textContent.includes("Andorra"));

  document.querySelector("[data-e-lv-min]").value = "3";
  document.querySelector("[data-e-lv-min]").dispatchEvent(new Event("change", { bubbles: true }));
  document.querySelector("[data-e-lv-max]").value = "4";
  document.querySelector("[data-e-lv-max]").dispatchEvent(new Event("change", { bubbles: true }));

  document.querySelector("[data-e-publish]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
  await wait(120);
  const published = lastCall(calls, "article_save");
  const rules = published?.body.p_payload.audience || [];
  expect("audience: the publish is sent", Boolean(published));
  expect("audience: as published", published?.body.p_payload.status === "published", published?.body.p_payload.status);
  expect("audience: the visibility rides along", published?.body.p_payload.visibility === "limited", published?.body.p_payload.visibility);
  expect("audience: the country rule is built", rules.some((r) => r.kind === "country" && r.value === "Andorra"), JSON.stringify(rules));
  expect("audience: the level range is expanded", rules.filter((r) => r.kind === "level").map((r) => r.value).join(",") === "3,4", JSON.stringify(rules));
  expect("audience: every rule includes", rules.every((r) => r.mode === "include"));

  /* private, with a password and a member */
  const priv = boot("article-editor.html", {
    url: "article-editor.html",
    storage: MEMBER,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "article_mine") return reply({ ok: true, rows: [] });
      if (fn === "article_feed") return reply({ ok: true, rows: [], fields: [], rails: [], total: 0 });
      if (fn === "article_save") return reply({ ok: true, code: "PST-001042", status: "published", scheduled_at: null, article: row({ code: "PST-001042" }) });
      return reply([]);
    },
  });
  const D = priv.document;
  await import(`file://${join(root, "assets/js/article-editor.js")}?p8b`);
  await wait(60);

  D.querySelector("[data-e-title]").value = "A private piece";
  D.querySelector("[data-e-body]").innerHTML = "<p>Only the list reads this.</p>";
  D.querySelector("[data-e-field]").value = "Cinema";
  D.querySelector('[data-vis="private"]').dispatchEvent(new priv.window.MouseEvent("click", { bubbles: true }));
  await wait(20);
  expect("private: the panel opens", D.querySelector("[data-e-private]")?.hidden === false);

  const personInput = D.querySelector("[data-e-private] [data-e-person-input]");
  personInput.value = "jhon007";
  D.querySelector("[data-e-private] [data-e-person-add]").dispatchEvent(new priv.window.MouseEvent("click", { bubbles: true }));
  await wait(20);
  expect("private: the named member is listed with a handle", D.querySelector("[data-e-private] [data-e-people]")?.textContent.includes("@jhon007"), D.querySelector("[data-e-private] [data-e-people]")?.textContent);

  D.querySelector("[data-e-pass-gen]").dispatchEvent(new priv.window.MouseEvent("click", { bubbles: true }));
  await wait(20);
  const generated = D.querySelector("[data-e-passes] code")?.textContent || "";
  expect("private: a password is generated", generated.length === 12, generated);
  expect("private: the password is shown once", D.querySelector("[data-e-passes]")?.textContent.includes(generated));

  D.querySelector("[data-e-publish]").dispatchEvent(new priv.window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const sent = lastCall(priv.calls, "article_save");
  const payload = sent?.body.p_payload || {};
  expect("private: the publish is sent", Boolean(sent));
  expect("private: the visibility is private", payload.visibility === "private", payload.visibility);
  expect("private: the member rides in profiles", JSON.stringify(payload.profiles) === '["@jhon007"]', JSON.stringify(payload.profiles));
  expect("private: the password rides in passwords", JSON.stringify(payload.passwords) === JSON.stringify([generated]), JSON.stringify(payload.passwords));
  expect("private: no audience rules for a private piece", (payload.audience || []).length === 0);
  expect("private: nothing threw", priv.errors.length === 0, priv.errors.join(" | "));

  /* Help: always public, always pending */
  const help = boot("article-editor.html", {
    url: "article-editor.html",
    storage: MEMBER,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "article_mine") return reply({ ok: true, rows: [] });
      if (fn === "article_feed") return reply({ ok: true, rows: [], fields: [], rails: [], total: 0 });
      if (fn === "article_save") return reply({ ok: true, code: "PST-001043", status: "pending", scheduled_at: null, article: row({ code: "PST-001043", status: "pending" }) });
      return reply([]);
    },
  });
  const H = help.document;
  await import(`file://${join(root, "assets/js/article-editor.js")}?p8c`);
  await wait(60);

  H.querySelector('[data-vis="private"]').dispatchEvent(new help.window.MouseEvent("click", { bubbles: true }));
  H.querySelector('[data-place="help"]').dispatchEvent(new help.window.MouseEvent("click", { bubbles: true }));
  await wait(20);
  expect("help: the section picker appears", H.querySelector("[data-e-help]")?.hidden === false);
  expect("help: help forces the public door", H.querySelector('[data-vis="general"]')?.classList.contains("is-active"));
  expect("help: the publish button says review", H.querySelector("[data-e-publish]")?.textContent.includes("Send for review"), H.querySelector("[data-e-publish]")?.textContent);
  expect("help: the section list is the tree", H.querySelectorAll("[data-e-help-sel] option").length === 21, H.querySelectorAll("[data-e-help-sel] option").length);

  H.querySelector("[data-e-title]").value = "How a private piece is opened";
  H.querySelector("[data-e-body]").innerHTML = "<p>Two ways: a name on the list, or a password.</p>";
  const section = H.querySelector("[data-e-help-sel]");
  section.value = "Publishing › Who may read it";
  section.dispatchEvent(new help.window.Event("change", { bubbles: true }));

  H.querySelector("[data-e-publish]").dispatchEvent(new help.window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const hp = lastCall(help.calls, "article_save")?.body.p_payload || {};
  expect("help: it is sent", Boolean(hp.title));
  expect("help: it goes to review", hp.status === "pending", hp.status);
  expect("help: it stays public", hp.visibility === "general", hp.visibility);
  expect("help: the section is in meta", hp.meta.help === "Publishing › Who may read it", hp.meta.help);
  expect("help: the place is help", hp.meta.place === "help", hp.meta.place);
  expect("help: nothing threw", help.errors.length === 0, help.errors.join(" | "));
}

/* ================================================================== */
/* pass 9 — the rules the two sides share, and the stylesheet         */
/* ================================================================== */
{
  const text = await import(`file://${join(root, "assets/js/article-text.js")}?p9`);
  expect("rules: words ignore the tags", text.wordsIn("<p>one two</p><h2>three</h2>") === 3, text.wordsIn("<p>one two</p><h2>three</h2>"));
  expect("rules: an empty body is zero words", text.wordsIn("<p></p>") === 0, text.wordsIn("<p></p>"));
  expect("rules: 200 words is one minute", text.readingTime(`<p>${"word ".repeat(200)}</p>`) === 1);
  expect("rules: 201 words is two", text.readingTime(`<p>${"word ".repeat(201)}</p>`) === 2);
  expect("rules: the first image is found", text.firstImage('<p><img src="https://a/b.jpg" /></p>') === "https://a/b.jpg");

  const clean = text.sanitizeHtml(
    '<p onclick="x()">keep<script>bad()</script><a href="javascript:1">no</a><img src="https://a/b.jpg" onerror="y" /><iframe src="z"></iframe></p>'
  );
  expect("rules: the handler is stripped", !clean.includes("onclick"));
  expect("rules: the script is stripped", !clean.includes("script"));
  expect("rules: the javascript: link is stripped", !clean.includes("javascript:"));
  expect("rules: the iframe is stripped", !clean.includes("iframe"));
  expect("rules: the image stays", clean.includes("https://a/b.jpg"));
  expect("rules: the paragraph stays", clean.includes("keep"));

  /* every class the three pages wear is in the stylesheet */
  const js =
    readFileSync(join(root, "assets/js/articles.js"), "utf8") +
    readFileSync(join(root, "assets/js/article.js"), "utf8") +
    readFileSync(join(root, "assets/js/article-editor.js"), "utf8");
  const html =
    readFileSync(join(root, "articles.html"), "utf8") +
    readFileSync(join(root, "article.html"), "utf8") +
    readFileSync(join(root, "article-editor.html"), "utf8");
  const shared =
    readFileSync(join(root, "assets/css/base.css"), "utf8") +
    readFileSync(join(root, "assets/css/components.css"), "utf8") +
    readFileSync(join(root, "assets/css/layout.css"), "utf8");
  const defined = new Set([...`${css}${shared}`.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  const worn = new Set();
  for (const source of [js, html]) {
    for (const match of source.matchAll(/class="([^"$]*)"/g)) {
      match[1].split(/\s+/).filter(Boolean).forEach((cls) => worn.add(cls));
    }
  }
  const missing = [...worn].filter((cls) => !defined.has(cls));
  expect("sheet: every class worn is defined", missing.length === 0, missing.join(" "));

  /* the old addresses still work */
  const links =
    readFileSync(join(root, "assets/js/watch.js"), "utf8") + readFileSync(join(root, "assets/js/cast.js"), "utf8");
  expect("links: the rest of the site still points at article.html?id=", links.includes("article.html?id="));
}

/* ------------------------------------------------------------------ */
/* the report                                                         */
/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
for (const check of checks) {
  console.log(`${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.ok ? "" : `  → ${check.detail}`}`);
}
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) {
  console.log("\nFailed:");
  failed.forEach((c) => console.log(` - ${c.name}: ${c.detail}`));
  process.exit(1);
}
process.exit(0);
