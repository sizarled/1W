/**
 * Videos smoke test — the feed, the watch screen and the publish page.
 *
 *   node tools/video-smoke.mjs
 *
 * Pass 1  — the feed renders cards, the count, the field chips and the sort
 *           segmented control; a sort click and a search both reach the server
 *           with the right arguments.
 * Pass 2  — the watch screen: the player, the title, the actions and the
 *           comment rule (no comment before a reaction); a like opens the
 *           composer, and a comment goes out with the body.
 * Pass 3  — a locked video: the door, the password form, the key handed to
 *           video_get, and the player once it opens.
 * Pass 4  — a video that is gone says so instead of half-rendering.
 * Pass 5  — the editor signed out: no form, a way in.
 * Pass 6  — the editor signed in: the live preview, the counters, a draft and
 *           a publish with exactly the payload the server expects.
 * Pass 7  — exclusive needs an audience, and the rules it builds are the ones
 *           the server matches; private carries its people and its passwords.
 * Pass 8  — video.html still answers its old address; the stylesheet carries
 *           every class the two pages wear.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
const strip = (file) => readFileSync(join(root, file), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const css = readFileSync(join(root, "assets/css/video.css"), "utf8");
const wait = (ms = 40) => new Promise((r) => setTimeout(r, ms));

const reply = (data, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data, text: async () => JSON.stringify(data) });

/* ------------------------------------------------------------------ */
/* the fixtures                                                       */
/* ------------------------------------------------------------------ */
function card(over = {}) {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    code: "PST-001010",
    type: "video",
    title: "Big Buck Bunny",
    description: "A giant rabbit and three rodents.",
    thumbnail: "https://example.com/thumb.jpg",
    embed: "https://example.com/film.mp4",
    language: "en",
    visibility: "general",
    status: "published",
    published_at: new Date(Date.now() - 3600_000).toISOString(),
    keywords: [{ id: "k1", keyword: "animation", role: "main", parent_id: null }],
    counters: { likes: 4, dislikes: 1, comments: 2, impressions: 120, watch_minutes: 30 },
    publisher: { id: "p1", name: "Jhon", username: "@jhon", avatar: null, online: true },
    author: { id: "p1", name: "Jhon", username: "@jhon", avatar: null },
    audience: [],
    related: [],
    translations: [],
    mine: { reaction: null, reshared: false, reported: false, can_interact: true, can_manage: false },
    video: {
      meta: { age: "none", download: true, vertical: false },
      embed: "https://example.com/film.mp4",
      file: "https://example.com/film.mp4",
      host: { id: "p1", name: "Jhon", username: "@jhon", avatar: null, followers: 12 },
    },
    ...over,
  };
}

const FEED = {
  ok: true,
  rows: [
    card(),
    card({ code: "PST-001011", title: "Elephants Dream", id: "22222222-2222-4222-8222-222222222222" }),
    card({ code: "PST-001012", title: "For Bigger Blazes", id: "33333333-3333-4333-8333-333333333333" }),
  ],
  fields: [
    { name: "animation", count: 3 },
    { name: "trailer", count: 1 },
  ],
  total: 3,
  limit: 24,
  offset: 0,
  can_publish: false,
};

const COMMENTS = {
  ok: true,
  comments: [
    {
      id: 7,
      body: "Watched it twice.",
      code: "cmt000007",
      author: { id: "m2", name: "Sara", username: "@sara", avatar: null },
      mine: false,
      likes: 1,
      dislikes: 0,
      edited: false,
      parent_id: null,
      sentiment: 1,
      created_at: new Date(Date.now() - 600_000).toISOString(),
    },
  ],
  count: 1,
  reaction: null,
  can_comment: false,
};

/* ------------------------------------------------------------------ */
/* booting one page                                                   */
/* ------------------------------------------------------------------ */
function boot(file, { hash = "", url = "", storage = {}, fetchImpl, globals } = {}) {
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
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
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
    calls.push({ href, body: opts.body ? JSON.parse(opts.body) : null });
    if (fetchImpl) return fetchImpl(href, opts, calls);
    return reply([]);
  };
  if (hash) window.location.hash = hash;
  return { dom, window, document: window.document, calls, errors };
}

const fnName = (href) => String(href).split("/rpc/")[1] || "";
const lastCall = (calls, fn) => [...calls].reverse().find((c) => fnName(c.href) === fn);

/* ================================================================== */
/* pass 1 — the feed                                                  */
/* ================================================================== */
{
  const { document, calls, errors, window } = boot("videos.html", {
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p1`);
  await wait();

  const cards = document.querySelectorAll("[data-v-grid] .vcard");
  expect("feed: three cards", cards.length === 3, cards.length);
  expect("feed: the count is spoken", document.querySelector("[data-v-count]")?.textContent === "3 videos", document.querySelector("[data-v-count]")?.textContent);
  expect("feed: field chips + all", document.querySelectorAll("[data-v-field]").length === 3, document.querySelectorAll("[data-v-field]").length);
  expect("feed: the first chip is all fields", document.querySelector("[data-v-field]")?.classList.contains("is-active"));
  expect("feed: a card carries its title", cards[0]?.textContent.includes("Big Buck Bunny"));
  expect("feed: a card links by code", cards[0]?.getAttribute("href") === "#/v/PST-001010", cards[0]?.getAttribute("href"));
  expect("feed: the guests gets the sign-in door", document.querySelector("[data-v-publish]")?.getAttribute("href") === "login.html?next=video-editor.html");
  expect("feed: no shelf without a member", document.querySelector("[data-v-yours]")?.hidden === true);
  expect("feed: nothing threw", errors.length === 0, errors.join(" | "));

  /* sort */
  document.querySelector('[data-sort="new"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait();
  expect("feed: sort reaches the server", lastCall(calls, "video_feed")?.body.p_sort === "new", JSON.stringify(lastCall(calls, "video_feed")?.body));
  expect("feed: the active sort moves", document.querySelector('[data-sort="new"]').classList.contains("is-active"));

  /* a field */
  document.querySelectorAll("[data-v-field]")[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait();
  expect("feed: the field reaches the server", lastCall(calls, "video_feed")?.body.p_field === "animation", lastCall(calls, "video_feed")?.body.p_field);

  /* search, debounced */
  const search = document.querySelector("[data-v-search]");
  search.value = "bunny";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(400);
  expect("feed: the search reaches the server", lastCall(calls, "video_feed")?.body.p_search === "bunny", lastCall(calls, "video_feed")?.body.p_search);
}

/* ================================================================== */
/* pass 2 — the watch screen                                          */
/* ================================================================== */
{
  const { document, calls, errors, window } = boot("videos.html", {
    hash: "#/v/PST-001010",
    storage: { "1w.member": JSON.stringify({ id: "m9", username: "@you", name: "You", level: 2 }), "1w.session": "tok-watch" },
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: card(), related: [card({ code: "PST-001011", title: "Elephants Dream" })], more: [] });
      if (fn === "post_comments") return reply(COMMENTS);
      if (fn === "post_react") return reply({ ok: true, likes: 5, dislikes: 1, reaction: 1 });
      if (fn === "post_comment") return reply({ ok: true, comments: [], comments_pos: 1, comments_neg: 0 });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p2`);
  await wait(80);

  const browse = document.querySelector("[data-v-browse]");
  const watch = document.querySelector("[data-v-watch]");
  expect("watch: the feed gives way", browse?.hidden === true && watch?.hidden === false);
  expect("watch: the file plays in a video tag", Boolean(document.querySelector(".vplayer video")), document.querySelector(".vplayer")?.innerHTML.slice(0, 60));
  expect("watch: the player has the source", document.querySelector(".vplayer video")?.getAttribute("src") === "https://example.com/film.mp4");
  expect("watch: the title is set", document.querySelector(".vtitle")?.textContent === "Big Buck Bunny");
  expect("watch: the document title follows", document.title.startsWith("Big Buck Bunny"));
  expect("watch: the publisher is named", document.querySelector(".vhost__name")?.textContent === "Jhon");
  expect("watch: the counters arrive", document.querySelector("[data-v-like]")?.textContent === "4", document.querySelector("[data-v-like]")?.textContent);
  expect("watch: related is listed", document.querySelectorAll(".vwatch__side .vrow").length === 1, document.querySelectorAll(".vwatch__side .vrow").length);
  expect("watch: the existing comment renders", document.querySelectorAll(".vcom__list .vcom").length === 1);
  expect("watch: the tags come back as chips", document.querySelectorAll("[data-v-tag]").length === 1);
  expect("watch: the like reads unpressed", document.querySelector("[data-v-react='1']")?.getAttribute("aria-pressed") === "false");

  /* the comment rule */
  expect("watch: no composer before a reaction", !document.querySelector("[data-v-comment-input]"));
  expect("watch: the rule is explained", document.querySelector(".vcomposer__note")?.textContent.includes("Like or dislike"));

  /* like → the composer appears */
  document.querySelector("[data-v-react='1']").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("watch: the like is sent", fnName(lastCall(calls, "post_react")?.href) === "post_react", JSON.stringify(lastCall(calls, "post_react")?.body));
  expect("watch: the like value is +1", lastCall(calls, "post_react")?.body.p_value === 1);
  expect("watch: the counter moves at once", document.querySelector("[data-v-like]")?.textContent === "5", document.querySelector("[data-v-like]")?.textContent);
  expect("watch: pressed now", document.querySelector("[data-v-react='1']")?.getAttribute("aria-pressed") === "true");
  expect("watch: the composer is open", Boolean(document.querySelector("[data-v-comment-input]")));

  /* comment */
  const box = document.querySelector("[data-v-comment-input]");
  box.value = "Second watch, still great.";
  document.querySelector("[data-v-comment-send]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("watch: the comment is sent", lastCall(calls, "post_comment")?.body.p_body === "Second watch, still great.", JSON.stringify(lastCall(calls, "post_comment")?.body));
  expect("watch: the box empties", box.value === "");
  expect("watch: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 3 — a locked video                                            */
/* ================================================================== */
{
  let opened = false;
  const { document, calls, window } = boot("videos.html", {
    hash: "#/v/PST-001013",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply({ ...FEED, rows: [], total: 0, fields: [] });
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") {
        if (opened) return reply({ ok: true, locked: false, unlocked: true, asks_password: true, mine: false, video: card({ code: "PST-001013", visibility: "private" }), related: [], more: [] });
        return reply({
          ok: true,
          locked: true,
          asks_password: true,
          video: { id: "x", code: "PST-001013", title: "Behind the door", thumbnail: "https://example.com/t.jpg", visibility: "private", status: "published", asks_password: true, host: { username: "@jhon", name: "Jhon", avatar: null } },
        });
      }
      if (fn === "post_comments") return reply(COMMENTS);
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p3`);
  await wait(80);

  expect("locked: the title still shows", document.querySelector(".vtitle")?.textContent === "Behind the door", document.querySelector(".vtitle")?.textContent);
  expect("locked: there is a door", Boolean(document.querySelector(".vgate")));
  expect("locked: it asks for a password", document.querySelector(".vgate h2")?.textContent.includes("password"), document.querySelector(".vgate h2")?.textContent);
  expect("locked: the source is nowhere on the page", !document.querySelector(".vplayer video") && !document.querySelector(".vplayer iframe"));
  expect("locked: no actions on a closed door", !document.querySelector("[data-v-react]"));

  const input = document.querySelector("[data-v-key-input]");
  input.value = "open-sesame";
  opened = true;
  document.querySelector("[data-v-key-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(120);
  expect("locked: the key is handed to the server", lastCall(calls, "video_get")?.body.p_key === "open-sesame", JSON.stringify(lastCall(calls, "video_get")?.body));
  expect("locked: the door opens", Boolean(document.querySelector(".vplayer video")) && !document.querySelector(".vgate"));
}

/* ================================================================== */
/* pass 4 — a video that is gone                                      */
/* ================================================================== */
{
  const { document } = boot("videos.html", {
    hash: "#/v/PST-000000",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply({ ...FEED, rows: [], total: 0, fields: [] });
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: false, error: "not_found" });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p4`);
  await wait(80);
  expect(
    "gone: it says so",
    document.querySelector("[data-v-watch] .vempty h2")?.textContent === "That video is gone",
    document.querySelector("[data-v-watch] .vempty h2")?.textContent
  );
  expect("gone: there is a way back", Boolean(document.querySelector("[data-v-back]")));
}

/* ================================================================== */
/* pass 5 — the editor, signed out                                    */
/* ================================================================== */
{
  const { document } = boot("video-editor.html");
  await import(`file://${join(root, "assets/js/video-editor.js")}?p5`);
  await wait(60);
  expect("editor: no form without a member", document.querySelector("[data-ved-shell]")?.hidden === true);
  expect("editor: the sticky bar stays away", document.querySelector("[data-ved-foot]")?.hidden === true);
  expect("editor: it offers the way in", document.querySelector("[data-ved-state] a")?.getAttribute("href") === "login.html?next=video-editor.html");
}

/* ================================================================== */
/* pass 6 & 7 — the editor, signed in                                 */
/* ================================================================== */
const MEMBER = JSON.stringify({ id: "m1", username: "@jhon", name: "Jhon", level: 3, points: 500, membership: "free" });
const STORAGE = { "1w.member": MEMBER, "1w.session": "tok-123" };

async function editor(tag) {
  const ctx = boot("video-editor.html", {
    storage: STORAGE,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_save") return reply({ ok: true, code: "PST-001100", status: "published", scheduled_at: null });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?${tag}`);
  await wait(60);
  return ctx;
}

{
  const { document, calls, window } = await editor("p6");

  expect("editor: the form is up", document.querySelector("[data-ved-shell]")?.hidden === false);
  expect("editor: the bar is up", document.querySelector("[data-ved-foot]")?.hidden === false);
  expect("editor: nothing is ready yet", document.querySelector("[data-ved-publish]")?.disabled === true);
  expect("editor: the status says what is missing", document.querySelector("[data-ved-status]")?.textContent.includes("link"), document.querySelector("[data-ved-status]")?.textContent);
  expect("editor: the language list is filled", document.querySelectorAll("[data-ved-lang] option").length >= 8, document.querySelectorAll("[data-ved-lang] option").length);
  expect("editor: the country list is filled", document.querySelectorAll("[data-ved-country-sel] option").length > 200, document.querySelectorAll("[data-ved-country-sel] option").length);

  /* the source */
  const embed = document.querySelector("[data-ved-embed]");
  embed.value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  expect("editor: a YouTube link is recognised", document.querySelector("[data-ved-source-badge]")?.textContent === "YouTube", document.querySelector("[data-ved-source-badge]")?.textContent);
  expect("editor: the thumbnail comes from the video", document.querySelector("[data-ved-thumb-box] img")?.getAttribute("src")?.includes("i.ytimg.com"), document.querySelector("[data-ved-thumb-box]")?.innerHTML.slice(0, 80));

  const title = document.querySelector("[data-ved-title]");
  title.value = "A first video";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  expect("editor: the preview carries the title", document.querySelector("[data-ved-preview-title]")?.textContent === "A first video");
  expect("editor: the counter counts", document.querySelector("[data-ved-title-count]")?.textContent === "13 / 150", document.querySelector("[data-ved-title-count]")?.textContent);
  expect("editor: with both it is ready", document.querySelector("[data-ved-publish]")?.disabled === false);

  const desc = document.querySelector("[data-ved-desc]");
  desc.value = "What happens, and why to watch it.";
  desc.dispatchEvent(new window.Event("input", { bubbles: true }));

  /* tags */
  const tagInput = document.querySelector("[data-ved-tag-input]");
  ["animation", "editing"].forEach((tag) => {
    tagInput.value = tag;
    tagInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  });
  await wait();
  expect("editor: tags become chips", document.querySelectorAll("[data-ved-tags] .tag").length === 2, document.querySelectorAll("[data-ved-tags] .tag").length);
  expect("editor: the tag counter counts", document.querySelector("[data-ved-tag-count]")?.textContent === "2 / 12");

  /* publish */
  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  const payload = lastCall(calls, "video_save")?.body.p_payload || {};
  expect("editor: one call to video_save", Boolean(lastCall(calls, "video_save")));
  expect("editor: the token rides along", lastCall(calls, "video_save")?.body.p_token === "tok-123", lastCall(calls, "video_save")?.body.p_token);
  expect("editor: the payload is published", payload.status === "published", payload.status);
  expect("editor: the payload is public", payload.visibility === "general", payload.visibility);
  expect("editor: the tags are the main keywords", Array.isArray(payload.tags) && payload.tags.join(",") === "animation,editing", JSON.stringify(payload.tags));
  expect("editor: a YouTube source is named", payload.meta?.source === "youtube", JSON.stringify(payload.meta));
  expect("editor: a public one sends no password key at all", payload.passwords === undefined, JSON.stringify(payload.passwords));
  expect("editor: no audience on a public one", Array.isArray(payload.audience) && payload.audience.length === 0);
}

{
  /* draft first, then exclusive, then private — one page, three doors */
  const { document, calls, window } = await editor("p7");

  const embed = document.querySelector("[data-ved-embed]");
  embed.value = "https://example.com/film.mp4";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  const title = document.querySelector("[data-ved-title]");
  title.value = "Behind the door";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  expect("editor: a file source is named", document.querySelector("[data-ved-source-badge]")?.textContent === "File", document.querySelector("[data-ved-source-badge]")?.textContent);

  /* a draft needs only a title */
  document.querySelector("[data-ved-save]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("editor: a draft is one call", lastCall(calls, "video_save")?.body.p_payload.status === "draft", lastCall(calls, "video_save")?.body.p_payload.status);

  /* exclusive */
  document.querySelectorAll("[data-vis]")[1].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait();
  expect("editor: the audience panel opens", document.querySelector("[data-ved-audience]")?.hidden === false);
  expect("editor: exclusive without an audience cannot publish", document.querySelector("[data-ved-publish]")?.disabled === true);
  expect("editor: it says why", document.querySelector("[data-ved-status]")?.textContent.includes("audience"), document.querySelector("[data-ved-status]")?.textContent);

  const country = document.querySelector("[data-ved-country-sel]");
  country.value = "Morocco";
  country.dispatchEvent(new window.Event("change", { bubbles: true }));
  const lvMin = document.querySelector("[data-ved-lv-min]");
  lvMin.value = "2";
  lvMin.dispatchEvent(new window.Event("input", { bubbles: true }));
  const lvMax = document.querySelector("[data-ved-lv-max]");
  lvMax.value = "4";
  lvMax.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  expect("editor: the country is a chip", document.querySelectorAll("[data-ved-countries] .tag").length === 1);
  expect("editor: with an audience it can publish", document.querySelector("[data-ved-publish]")?.disabled === false);

  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  const rules = lastCall(calls, "video_save")?.body.p_payload.audience || [];
  expect("editor: exclusive is limited", lastCall(calls, "video_save")?.body.p_payload.visibility === "limited", lastCall(calls, "video_save")?.body.p_payload.visibility);
  expect("editor: the country rule is sent", rules.some((r) => r.kind === "country" && r.value === "Morocco"), JSON.stringify(rules));
  expect(
    "editor: the level range becomes one rule per level",
    rules.filter((r) => r.kind === "level").map((r) => r.value).sort().join(",") === "2,3,4",
    JSON.stringify(rules.filter((r) => r.kind === "level"))
  );

  /* private */
  document.querySelectorAll("[data-vis]")[2].dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait();
  expect("editor: the private panel opens", document.querySelector("[data-ved-private]")?.hidden === false);
  expect("editor: a private video needs someone", document.querySelector("[data-ved-publish]")?.disabled === true);

  const person = document.querySelector("[data-ved-person-input]");
  person.value = "sara";
  document.querySelector("[data-ved-person-add]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const pass = document.querySelector("[data-ved-pass-input]");
  pass.value = "open-sesame";
  document.querySelector("[data-ved-pass-add]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait();
  expect("editor: the person is a chip, with the @", document.querySelector("[data-ved-people] .tag")?.textContent.startsWith("@sara"), document.querySelector("[data-ved-people]")?.textContent);
  expect("editor: the password is a chip", document.querySelectorAll("[data-ved-passes] .tag").length === 1);
  expect("editor: now it can publish", document.querySelector("[data-ved-publish]")?.disabled === false);

  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  const privatePayload = lastCall(calls, "video_save")?.body.p_payload || {};
  expect("editor: private is private", privatePayload.visibility === "private", privatePayload.visibility);
  expect("editor: the nominated list is sent", (privatePayload.profiles || []).includes("@sara"), JSON.stringify(privatePayload.profiles));
  expect("editor: the password is sent as typed, to be hashed", (privatePayload.passwords || []).includes("open-sesame"), JSON.stringify(privatePayload.passwords));

  /* scheduling */
  document.querySelector('[data-when="1d"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait();
  const when = new Date(lastCall(calls, "video_save")?.body.p_payload.scheduled_at || 0);
  expect("editor: a day out is offered", document.querySelector("[data-ved-when-hint]")?.textContent.includes("invisible"), document.querySelector("[data-ved-when-hint]")?.textContent);
  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  const scheduled = lastCall(calls, "video_save")?.body.p_payload || {};
  expect("editor: scheduling sends a future moment", scheduled.status === "scheduled" && new Date(scheduled.scheduled_at).getTime() > Date.now(), `${scheduled.status} ${scheduled.scheduled_at}`);
  expect("editor: the server call is well formed", typeof when.getTime() === "number");
}

/* ================================================================== */
/* pass 8 — a file from the machine, the draft, and the key           */
/* ================================================================== */
{
  /* a stand-in for XMLHttpRequest: the storage upload, without a network */
  const uploads = [];
  class FakeXhr {
    constructor() {
      this.upload = {};
      this.status = 0;
      this.responseText = "";
    }
    open(method, url) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(key, value) {
      this.headers = { ...(this.headers || {}), [key]: value };
    }
    send(file) {
      uploads.push({ url: this.url, headers: this.headers, name: file && file.name, size: file && file.size });
      this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
      this.status = 200;
      this.responseText = "{}";
      setTimeout(() => this.onload?.(), 5);
    }
  }
  globalThis.XMLHttpRequest = FakeXhr;

  const seen = [];
  const ctx = boot("video-editor.html", {
    storage: STORAGE,
    fetchImpl: (href) => {
      const fn = fnName(href);
      seen.push(fn);
      if (fn === "video_save") return reply({ ok: true, code: "PST-001101", status: "published", scheduled_at: null });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p8hands`);
  await wait(70);
  const { document, window, calls } = ctx;

  expect("files: an upload button for the video", Boolean(document.querySelector("[data-ved-file-btn]")));
  expect("files: a hidden file input for it", document.querySelector("[data-ved-file]")?.type === "file");
  expect("files: an upload button for the picture", Boolean(document.querySelector("[data-ved-thumb-upload]")));
  expect("files: a hidden input for the picture", document.querySelector("[data-ved-thumb-file]")?.type === "file");

  /* a dropped file becomes the source */
  const drop = document.querySelector("[data-ved-drop]");
  const dropEvent = new window.Event("drop", { bubbles: true, cancelable: true });
  dropEvent.dataTransfer = {
    files: [{ name: "short.mp4", type: "video/mp4", size: 1024 * 1024 }],
    getData: () => "",
  };
  drop.dispatchEvent(dropEvent);
  await wait(80);
  expect("files: the upload went to storage", uploads.length === 1, JSON.stringify(uploads.map((u) => u.url)));
  expect("files: under the videos folder", uploads[0]?.url.includes("/storage/v1/object/source/users/videos/"), uploads[0]?.url);
  expect("files: with the publishable key", Boolean(uploads[0]?.headers?.apikey), JSON.stringify(uploads[0]?.headers));
  const embed = document.querySelector("[data-ved-embed]");
  expect("files: the source field holds the new address", embed.value.includes("/storage/v1/object/public/source/users/videos/"), embed.value);
  expect("files: the note says what happened", document.querySelector("[data-ved-file-note]")?.textContent.includes("short.mp4"), document.querySelector("[data-ved-file-note]")?.textContent);
  expect("files: a file is named as one", document.querySelector("[data-ved-source-badge]")?.textContent === "File", document.querySelector("[data-ved-source-badge]")?.textContent);

  /* a picture from the machine */
  const thumbInput = document.querySelector("[data-ved-thumb-file]");
  Object.defineProperty(thumbInput, "files", { value: [{ name: "still.jpg", type: "image/jpeg", size: 2048 }], configurable: true });
  thumbInput.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(60);
  expect("files: the picture was uploaded", uploads.length === 2 && uploads[1].url.includes("/users/posts/"), JSON.stringify(uploads.map((u) => u.url)));
  expect("files: and becomes the thumbnail", document.querySelector("[data-ved-thumb-box] img")?.getAttribute("src")?.includes("/users/posts/"), document.querySelector("[data-ved-thumb-box]")?.innerHTML.slice(0, 90));

  /* the hosts the field understands */
  const badge = () => document.querySelector("[data-ved-source-badge]")?.textContent;
  embed.value = "https://vimeo.com/76979871";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(20);
  expect("hosts: Vimeo is named", badge() === "Vimeo", badge());
  embed.value = "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(20);
  expect("hosts: Drive is named", badge() === "Google Drive", badge());
  embed.value = "https://www.dailymotion.com/video/x8abc12";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(20);
  expect("hosts: Dailymotion is named", badge() === "Dailymotion", badge());

  /* ages */
  document.querySelector('[data-age="3"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(20);
  expect("ages: 3+ can be chosen", document.querySelector('[data-age="3"]').classList.contains("is-on"));

  /* the draft on the device */
  const title = document.querySelector("[data-ved-title]");
  title.value = "A draft kept on the device";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(1150);
  const kept = window.localStorage.getItem("1w.videos.draft");
  expect("draft: it is kept on the device", Boolean(kept), kept ? kept.slice(0, 60) : "nothing");
  expect("draft: with the title in it", kept?.includes("A draft kept on the device"));
  expect("draft: and the source", kept?.includes("dailymotion.com/video"), kept ? kept.slice(0, 200) : "");
  expect("draft: the bar says when", document.querySelector("[data-ved-draft-note]")?.textContent.includes("kept on this device"), document.querySelector("[data-ved-draft-note]")?.textContent);

  /* Ctrl+Enter publishes */
  const before = calls.filter((c) => fnName(c.href) === "video_save").length;
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true, cancelable: true }));
  await wait(120);
  const after = calls.filter((c) => fnName(c.href) === "video_save").length;
  expect("keys: Ctrl+Enter publishes", after === before + 1, `${before} → ${after}`);
  const payload = lastCall(calls, "video_save")?.body.p_payload || {};
  expect("keys: the age rides in meta", payload.meta?.age === "3", JSON.stringify(payload.meta));
  expect("keys: the file is named as a file or a host", ["file", "dailymotion", "vimeo", "drive", "embed"].includes(payload.meta?.source), payload.meta?.source);
  expect("keys: publishing clears the draft", window.localStorage.getItem("1w.videos.draft") === null, String(window.localStorage.getItem("1w.videos.draft")));
  expect("files: nothing threw", ctx.errors.length === 0, ctx.errors.join(" | "));
}

/* ================================================================== */
/* pass 9 — a draft left behind comes back                            */
/* ================================================================== */
{
  const left = JSON.stringify({
    code: "",
    savedAt: new Date().toISOString(),
    embed: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
    title: "Written yesterday",
    desc: "and never published",
    tags: ["animation"],
    vis: "limited",
    countries: ["Morocco"],
    language: "ar",
    age: "16",
  });
  const ctx = boot("video-editor.html", {
    storage: { ...STORAGE, "1w.videos.draft": left },
    fetchImpl: (href) => (fnName(href) === "video_save" ? reply({ ok: true, code: "PST-001102", status: "draft", scheduled_at: null }) : reply([])),
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p9draft`);
  await wait(80);
  const { document } = ctx;
  expect("restore: the title is back", document.querySelector("[data-ved-title]")?.value === "Written yesterday", document.querySelector("[data-ved-title]")?.value);
  expect("restore: the source is back", document.querySelector("[data-ved-embed]")?.value.includes("youtube.com"), document.querySelector("[data-ved-embed]")?.value);
  expect("restore: the door is back", document.querySelector('[data-vis="limited"]')?.getAttribute("aria-pressed") === "true" || document.querySelector('[data-vis="limited"]')?.classList.contains("is-on"));
  expect("restore: the age is back", document.querySelector('[data-age="16"]')?.classList.contains("is-on"));
  expect("restore: the language is back", document.querySelector("[data-ved-lang]")?.value === "ar", document.querySelector("[data-ved-lang]")?.value);
}

/* ================================================================== */
/* pass 10 — the host list, and the player in the editor              */
/* ================================================================== */
{
  const embed = await import(`file://${join(root, "assets/js/embed.js")}`);
  const cases = [
    ["https://www.youtube.com/watch?v=dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube", "YouTube"],
    ["https://youtu.be/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube", "YouTube"],
    ["https://www.youtube.com/shorts/dQw4w9WgXcQ", "https://www.youtube.com/embed/dQw4w9WgXcQ", "youtube", "YouTube"],
    ["https://vimeo.com/76979871", "https://player.vimeo.com/video/76979871", "vimeo", "Vimeo"],
    ["https://www.dailymotion.com/video/x8abc12", "https://www.dailymotion.com/embed/video/x8abc12", "dailymotion", "Dailymotion"],
    ["https://www.tiktok.com/@who/video/7312345678901234567", "https://www.tiktok.com/embed/v2/7312345678901234567", "tiktok", "TikTok"],
    ["https://www.facebook.com/watch/?v=123456789", "https://www.facebook.com/plugins/video.php?href=", "facebook", "Facebook"],
    ["https://fb.watch/abcdEFG/", "https://www.facebook.com/plugins/video.php?href=", "facebook", "Facebook"],
    ["https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/view", "https://drive.google.com/file/d/1AbCdEfGhIjKlMnOp/preview", "drive", "Google Drive"],
    ["https://www.pinterest.com/pin/99360735500167749/", "https://assets.pinterest.com/ext/embed.html?id=99360735500167749", "pinterest", "Pinterest"],
    ["https://pin.it/abc123", "https://assets.pinterest.com/ext/embed.html?url=", "pinterest", "Pinterest"],
    ["https://www.reddit.com/r/filmmaking/comments/1abc2de/the_long_take/", "https://embed.reddit.com/r/filmmaking/comments/1abc2de/?embed=true&theme=dark", "reddit", "Reddit"],
    ["https://redd.it/1abc2de", "https://embed.reddit.com/comments/1abc2de/?embed=true&theme=dark", "reddit", "Reddit"],
    ["https://cdn.example.com/film.mp4", "https://cdn.example.com/film.mp4", "file", "File"],
    ["https://somewhere.example/watch/1", "https://somewhere.example/watch/1", "embed", "Embed"],
  ];
  cases.forEach(([input, expected, kind, label]) => {
    const out = embed.embedUrl(input);
    expect(`hosts: ${kind} — ${input}`, out.startsWith(expected), out);
    expect(`hosts: ${kind} is named`, embed.sourceKind(input) === kind, embed.sourceKind(input));
    expect(`hosts: ${kind} wears its label`, embed.sourceLabel(input) === label, embed.sourceLabel(input));
  });
  expect("hosts: a YouTube still comes free", embed.autoThumb("https://youtu.be/dQw4w9WgXcQ") === "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg", embed.autoThumb("https://youtu.be/dQw4w9WgXcQ"));
  expect("hosts: nothing else pretends to have one", embed.autoThumb("https://www.tiktok.com/@a/video/7312345678901234567") === "");

  /* the player in the editor */
  const ctx = boot("video-editor.html", {
    storage: STORAGE,
    fetchImpl: () => reply([]),
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p10player`);
  await wait(70);
  const { document, window } = ctx;
  const field = document.querySelector("[data-ved-embed]");
  const player = () => document.querySelector("[data-ved-player]");
  const frame = () => player()?.querySelector("iframe")?.getAttribute("src") || "";
  const type = (value) => {
    field.value = value;
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
  };

  expect("player: nothing is framed before a link", player()?.hidden === true, String(player()?.hidden));

  type("https://youtu.be/dQw4w9WgXcQ");
  await wait(30);
  expect("player: a YouTube link is framed", frame() === "https://www.youtube.com/embed/dQw4w9WgXcQ", frame());
  expect("player: the still is shown straight away", document.querySelector("[data-ved-thumb-box] img")?.getAttribute("src")?.includes("i.ytimg.com"));
  await wait(400);
  expect("player: and the still is now the form's", document.querySelector("[data-ved-thumb]")?.value.includes("i.ytimg.com"), document.querySelector("[data-ved-thumb]")?.value);

  type("https://www.pinterest.com/pin/99360735500167749/");
  await wait(30);
  expect("player: a Pinterest pin is framed", frame().startsWith("https://assets.pinterest.com/ext/embed.html?id=99360735500167749"), frame());
  expect("player: Pinterest does not hand over a still", document.querySelector("[data-ved-thumb-box] img") === null, document.querySelector("[data-ved-thumb-box]")?.innerHTML.slice(0, 60));
  expect("player: and says so", document.querySelector("[data-ved-thumb-hint]")?.textContent.includes("does not hand us a picture"), document.querySelector("[data-ved-thumb-hint]")?.textContent);

  type("https://www.reddit.com/r/filmmaking/comments/1abc2de/the_long_take/");
  await wait(30);
  expect("player: a Reddit thread is framed", frame() === "https://embed.reddit.com/r/filmmaking/comments/1abc2de/?embed=true&theme=dark", frame());

  type("https://www.tiktok.com/@who/video/7312345678901234567");
  await wait(30);
  expect("player: a TikTok is framed", frame() === "https://www.tiktok.com/embed/v2/7312345678901234567", frame());

  type("https://www.facebook.com/watch/?v=123456789");
  await wait(30);
  expect("player: a Facebook video is framed", frame().includes("facebook.com/plugins/video.php"), frame());

  type("https://cdn.example.com/film.mp4");
  await wait(30);
  const video = player()?.querySelector("video");
  expect("player: a file plays as a video", video?.getAttribute("src") === "https://cdn.example.com/film.mp4", player()?.innerHTML.slice(0, 80));
  expect("player: the still is its poster", video?.getAttribute("poster") === S_postOf(document), String(video?.getAttribute("poster")));
  expect("player: nothing threw", ctx.errors.length === 0, ctx.errors.join(" | "));

  type("");
  await wait(20);
  expect("player: an emptied field takes the frame away", player()?.hidden === true, String(player()?.hidden));
}

function S_postOf(document) {
  return document.querySelector("[data-ved-thumb]")?.value || null;
}

/* ================================================================== */
/* pass 11 — a still the host will hand over (oEmbed), and a quiet no  */
/* ================================================================== */
{
  const ctx = boot("video-editor.html", {
    storage: STORAGE,
    fetchImpl: (href) => {
      if (href.includes("tiktok.com/oembed")) {
        return reply({ thumbnail_url: "https://p16-sign.tiktokcdn.com/still.jpg" });
      }
      if (href.includes("pinterest.com/oembed")) {
        return Promise.reject(new Error("blocked"));
      }
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?p11oembed`);
  await wait(70);
  const { document, window } = ctx;
  const field = document.querySelector("[data-ved-embed]");
  const type = async (value, ms = 640) => {
    field.value = value;
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
    await wait(ms);
  };

  await type("https://www.tiktok.com/@who/video/7312345678901234567");
  expect("oembed: TikTok hands over a still", document.querySelector("[data-ved-thumb]")?.value === "https://p16-sign.tiktokcdn.com/still.jpg", document.querySelector("[data-ved-thumb]")?.value);
  expect("oembed: the box shows it", document.querySelector("[data-ved-thumb-box] img")?.getAttribute("src")?.includes("tiktokcdn"), document.querySelector("[data-ved-thumb-box]")?.innerHTML.slice(0, 60));

  await type("https://www.pinterest.com/pin/99360735500167749/");
  expect("oembed: a host that refuses changes nothing", document.querySelector("[data-ved-thumb]")?.value === "", document.querySelector("[data-ved-thumb]")?.value);
  expect("oembed: nothing threw when the call failed", ctx.errors.length === 0, ctx.errors.join(" | "));

  /* a picture the member chose is never overwritten by a host */
  const thumbField = document.querySelector("[data-ved-thumb]");
  thumbField.value = "https://example.com/mine.jpg";
  thumbField.dispatchEvent(new window.Event("input", { bubbles: true }));
  await type("https://www.tiktok.com/@who/video/7312345678901234999");
  expect("oembed: a chosen picture stays", document.querySelector("[data-ved-thumb]")?.value === "https://example.com/mine.jpg", document.querySelector("[data-ved-thumb]")?.value);
}

/* ================================================================== */
/* pass 12 — the old address and the stylesheet                       */
/* ================================================================== */
{
  const html = readFileSync(join(root, "video.html"), "utf8");
  expect("video.html: it forwards to the videos page", html.includes("videos.html#/v/") && html.includes('get("id")'));
  expect("video.html: it replaces, not pushes", html.includes("location.replace"));

  ["vcard", "vcard__media", "vgrid", "vbar", "vwatch", "vplayer", "vgate", "vacts", "vhost", "vcomposer", "vcom", "ved", "vdrop", "vfoot", "vseg", "vtaglist", "vsk", "vempty", "vshelf", "vrow"].forEach((name) => {
    expect(`css: .${name} exists`, css.includes(`.${name}`), name);
  });
  expect("css: it is monochrome — no colour literals beyond the scrims", !/#[0-9a-f]{3,6}/i.test(css.replace(/#(000|000000|f2f2f4|fff|ffffff|e6e6e9|08080a)\b/gi, "").replace(/rgba?\([^)]*\)/g, "")), "colour found");
  expect("css: the two screens stack on a phone", css.includes("@media (max-width: 1180px)") && css.includes("@media (max-width: 720px)"));
}

/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  if (!c.ok) console.log(`FAIL  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
});
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
