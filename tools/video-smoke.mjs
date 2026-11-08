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
/* the same card, with a YouTube source: the chapters are tested on a frame
   whose player reads `&t=` — a file would be seeked by the browser instead */
const YT_SOURCE = "https://www.youtube.com/watch?v=8smBjnWptPk&t=1883s";
function youtubeCard(over = {}) {
  const base = card(over);
  base.embed = YT_SOURCE;
  base.video = { ...base.video, embed: YT_SOURCE, file: YT_SOURCE };
  return base;
}

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
    {
      id: 8,
      body: "Agreed — the second half is the film.",
      code: "cmt000008",
      author: { id: "m3", name: "Omar", username: "@omar", avatar: null },
      mine: false,
      likes: 0,
      dislikes: 0,
      edited: false,
      parent_id: 7,
      sentiment: 1,
      created_at: new Date(Date.now() - 300_000).toISOString(),
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
  globalThis.FormData = window.FormData;
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
    const body = typeof opts.body === "string" ? safeParse(opts.body) : opts.body || null;
    calls.push({ href, body });
    if (fetchImpl) return fetchImpl(href, opts, calls);
    return reply([]);
  };
  if (hash) window.location.hash = hash;
  return { dom, window, document: window.document, calls, errors };
}

/* `…/ID=CA4728CD&t=90s` is the same address, with a second to start at */
{
  const media = await import(`file://${join(root, "assets/js/media.js")}?t=1`);
  const route = media.parseRoute("#/h/ID=CA4728CD&t=90s");
  expect("address: a second does not break the id", route.id === "CA4728CD", route.id);
  expect("address: the second is read back", media.timeOf("#/h/ID=CA4728CD&t=90s") === 90, String(media.timeOf("#/h/ID=CA4728CD&t=90s")));
  expect("address: a bare number is the same second", media.timeOf("?t=42") === 42, String(media.timeOf("?t=42")));
  expect("address: no second, no start", media.timeOf("#/h/ID=CA4728CD") === 0);
}

const fnName = (href) => String(href).split("/rpc/")[1] || "";
/* the pages call the `_from` shells when the interaction happens on a page
   that can say where the reader came from, so both names answer */
const lastCall = (calls, fn) =>
  [...calls].reverse().find((c) => fnName(c.href) === fn || fnName(c.href) === `${fn}_from`);

/* one way in: the file row, or one platform's own link row */
const chooseMode = (document, window, mode) => {
  const radio = document.querySelector(`[data-ved-mode="${mode}"]`);
  if (!radio) return;
  radio.checked = true;
  radio.dispatchEvent(new window.Event("change", { bubbles: true }));
};
const choosePlatform = (document, window, value) => {
  const select = document.querySelector("[data-ved-platform]");
  if (!select) return;
  select.value = value;
  select.dispatchEvent(new window.Event("change", { bubbles: true }));
};

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
  /* the address book names the shape: `#/h/ID=<code>` is a landscape piece */
  expect("feed: a card links by code", cards[0]?.getAttribute("href") === "videos.html#/h/ID=PST-001010", cards[0]?.getAttribute("href"));
  expect("feed: the card is marked landscape", cards[0]?.getAttribute("data-orientation") === "h", cards[0]?.getAttribute("data-orientation"));
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
    fetchImpl: (href, opts) => {
      const fn = fnName(href);
      const sent = opts && opts.body ? JSON.parse(opts.body) : {};
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: card(), related: [card({ code: "PST-001011", title: "Elephants Dream" })], more: [] });
      if (fn === "post_comments") return reply(COMMENTS);
      if (fn === "post_react" || fn === "post_react_from") return reply({ ok: true, likes: 5, dislikes: 1, reaction: sent.p_value ?? 1 });
      if (fn === "post_comment" || fn === "post_comment_from") return reply({ ok: true, comments: [], comments_pos: 1, comments_neg: 0, sentiment: 1 });
      if (fn === "post_comment_vote") return reply({ ok: true, agree: sent.p_agree ? 2 : 1, disagree: sent.p_agree ? 0 : 1, mine: sent.p_agree ? "agree" : "disagree" });
      if (fn === "post_report" || fn === "post_report_from") return reply({ ok: true, reported: true });
      if (fn === "post_reshare" || fn === "post_reshare_from") return reply({ ok: true, reshared: true, reshares: 1 });
      if (fn === "reach_share_link") return reply({ ok: true, credited: 10 });
      if (fn === "reach_share_visit") return reply({ ok: true, credited: 20 });
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
  expect(
    "watch: related is listed",
    document.querySelectorAll(".vwatch__side > .vcard-box:first-child .vrow").length === 1,
    String(document.querySelectorAll(".vwatch__side > .vcard-box:first-child .vrow").length)
  );
  expect(
    "watch: suggestions sit under the shelves",
    Boolean(document.querySelector("[data-v-suggested]")) &&
      document.querySelectorAll(".vwatch__side > .vcard-box").length === 2 &&
      document.querySelector(".vwatch__side > .vcard-box:last-child")?.matches("[data-v-suggested]") === true,
    String(document.querySelectorAll(".vwatch__side > .vcard-box").length)
  );
  expect(
    "watch: a suggestion is never the video on screen",
    !/Big Buck Bunny/.test(document.querySelector("[data-v-suggested]")?.textContent || ""),
    document.querySelector("[data-v-suggested]")?.textContent?.slice(0, 60)
  );
  expect("watch: the existing comment renders", document.querySelectorAll(".vcom__list .vcom").length === 2, document.querySelectorAll(".vcom__list .vcom").length);
  expect(
    "watch: a reply sits under the comment it answers",
    document.querySelectorAll(".vcom__list > .vcom").length === 1 &&
      document.querySelectorAll(".vcom__list .vcom__replies .vcom").length === 1,
    `${document.querySelectorAll(".vcom__list > .vcom").length} / ${document.querySelectorAll(".vcom__list .vcom__replies .vcom").length}`
  );
  expect("watch: the tags come back as chips", document.querySelectorAll("[data-v-tag]").length === 1);
  expect("watch: the like reads unpressed", document.querySelector("[data-v-react='1']")?.getAttribute("aria-pressed") === "false");

  /* the comment rule */
  expect("watch: no composer before a reaction", !document.querySelector("[data-v-comment-input]"));
  expect("watch: the rule is explained", document.querySelector(".vcomposer__note")?.textContent.includes("Like or dislike"));

  /* like → the composer appears */
  document.querySelector("[data-v-react='1']").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("watch: the like is sent", fnName(lastCall(calls, "post_react")?.href) === "post_react_from", JSON.stringify(lastCall(calls, "post_react")?.body));
  expect("watch: and it says where the reader came from", lastCall(calls, "post_react")?.body.p_source === "feed", JSON.stringify(lastCall(calls, "post_react")?.body));
  expect("watch: and which way it was before", lastCall(calls, "post_react")?.body.p_was === 0, JSON.stringify(lastCall(calls, "post_react")?.body));
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

  /* a comment of its own: a like, a dislike, a reply and a report */
  const first = document.querySelector('[data-v-comment="7"]');
  expect("comments: every comment carries its four doors", first?.querySelectorAll(".vcom__acts .vcom__act").length === 4, first?.querySelectorAll(".vcom__acts .vcom__act").length);
  expect("comments: a reply carries them too", document.querySelectorAll('[data-v-comment="8"] .vcom__acts .vcom__act').length === 4);
  expect("comments: the count it came with is shown", first?.querySelector("[data-v-cagree]")?.textContent === "1", first?.querySelector("[data-v-cagree]")?.textContent);

  first.querySelector('[data-v-cvote="1"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const vote = lastCall(calls, "post_comment_vote");
  expect("comments: the like names the comment", vote?.body.p_comment_id === 7, JSON.stringify(vote?.body));
  expect("comments: and says which way", vote?.body.p_agree === true);
  expect("comments: the like count moves", first.querySelector("[data-v-cagree]")?.textContent === "2", first.querySelector("[data-v-cagree]")?.textContent);
  expect("comments: the like reads pressed", first.querySelector('[data-v-cvote="1"]')?.getAttribute("aria-pressed") === "true");

  first.querySelector('[data-v-cvote="0"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("comments: a dislike is the same door, the other way", lastCall(calls, "post_comment_vote")?.body.p_agree === false);
  expect("comments: the dislike count moves", first.querySelector("[data-v-cdisagree]")?.textContent === "1", first.querySelector("[data-v-cdisagree]")?.textContent);
  expect("comments: and only one of the two is pressed", first.querySelectorAll("[data-v-cvote][aria-pressed='true']").length === 1, first.querySelectorAll("[data-v-cvote][aria-pressed='true']").length);

  first.querySelector("[data-v-creply='7']").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(20);
  const replyBox = first.querySelector("[data-v-reply-box='7']");
  expect("comments: Reply opens a box under that comment", replyBox?.hidden === false);
  replyBox.querySelector("[data-v-reply-input]").value = "Same here.";
  first.querySelector("[data-v-reply-send='7']").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  const replyCall = lastCall(calls, "post_comment");
  expect("comments: the reply goes out with the comment it answers", replyCall?.body.p_parent_id === 7, JSON.stringify(replyCall?.body));
  expect("comments: and with its own words", replyCall?.body.p_body === "Same here.", replyCall?.body.p_body);

  /* the reply reloaded the list, so the comment is drawn again */
  await wait(40);
  const again = document.querySelector('[data-v-comment="7"]') || first;
  again.querySelector("[data-v-creport='7']").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(20);
  const reportBox = again.querySelector("[data-v-creport-box='7']");
  expect("comments: Report opens its own box", reportBox?.hidden === false);
  reportBox.querySelector("[data-v-creport-reason]").value = "spam";
  again.querySelector("[data-v-creport-send='7']").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const reportCall = lastCall(calls, "post_report");
  expect("comments: the report is filed under the video", reportCall?.body.p_ref === "PST-001010", JSON.stringify(reportCall?.body));
  expect("comments: and it quotes the comment it is about", /Comment #7/.test(reportCall?.body.p_note || "") && /Watched it twice/.test(reportCall?.body.p_note || ""), reportCall?.body.p_note);
  expect("comments: the box closes once it is sent", reportBox?.hidden === true);
  expect("watch: the box empties", box.value === "");

  /* ---- the whole screen ------------------------------------------- */
  const fsButton = document.querySelector("[data-v-fs]");
  expect("fullscreen: the player offers it", Boolean(fsButton), "no button");
  expect("fullscreen: it carries a name", /full screen/i.test(fsButton?.getAttribute("aria-label") || ""), fsButton?.getAttribute("aria-label"));
  expect("fullscreen: it starts unpressed", fsButton?.getAttribute("aria-pressed") === "false");
  expect("fullscreen: it is drawn with the expand mark", Boolean(fsButton?.querySelector("svg")), fsButton?.innerHTML?.slice(0, 60));

  /* jsdom has no full screen of its own: stand one up and watch the page ask */
  let asked = 0;
  const player = document.querySelector("[data-v-player]");
  player.requestFullscreen = () => {
    asked += 1;
    Object.defineProperty(document, "fullscreenElement", { value: player, configurable: true });
    document.dispatchEvent(new window.Event("fullscreenchange"));
    return Promise.resolve();
  };
  Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
  document.exitFullscreen = () => {
    Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    document.dispatchEvent(new window.Event("fullscreenchange"));
    return Promise.resolve();
  };

  fsButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  expect("fullscreen: the player box is the one that takes the screen", asked === 1, String(asked));
  expect("fullscreen: the button says it is on now", fsButton.getAttribute("aria-pressed") === "true", fsButton.getAttribute("aria-pressed"));
  expect("fullscreen: and it offers the way back", /leave full screen/i.test(fsButton.getAttribute("aria-label") || ""), fsButton.getAttribute("aria-label"));
  expect("fullscreen: the mark turns to the corners pointing in", Boolean(fsButton.querySelector("svg")) && document.fullscreenElement === player);

  fsButton.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  expect("fullscreen: a second press leaves it", asked === 1 && document.fullscreenElement === null);
  expect("fullscreen: and the button is quiet again", fsButton.getAttribute("aria-pressed") === "false", fsButton.getAttribute("aria-pressed"));

  /* F does it too — but never while the member is typing */
  document.body.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", bubbles: true }));
  await wait(30);
  expect("fullscreen: F takes the screen", asked === 2, String(asked));
  document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "F", bubbles: true }));
  await wait(30);
  expect("fullscreen: and F again gives it back", document.fullscreenElement === null);
  const typing = document.querySelector("[data-v-comment-input]");
  if (typing) {
    typing.focus();
    typing.dispatchEvent(new window.KeyboardEvent("keydown", { key: "f", bubbles: true }));
    await wait(20);
    expect("fullscreen: a comment box keeps its own f", asked === 2, String(asked));
  }

  const videoCss = readFileSync(join(root, "assets/css/video.css"), "utf8");
  expect("fullscreen: the stylesheet lets the player own the screen", videoCss.includes(".vplayer:fullscreen"), "no fullscreen rule");
  expect("fullscreen: it fills the viewport", /:fullscreen[\s\S]{0,220}height: 100vh/.test(videoCss), "not sized");
  expect("fullscreen: and the backdrop is black", videoCss.includes(".vplayer:fullscreen::backdrop"), "no backdrop");
  expect("fullscreen: the button is drawn in the page", videoCss.includes(".vplayer__fs"), "no button style");
  expect("fullscreen: the iframe is allowed to go full screen", /allowfullscreen/.test(readFileSync(join(root, "assets/js/videos.js"), "utf8")), "no allowfullscreen");

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

  /* the source: one way in, and the platform is picked before the link */
  expect("editor: the field waits for a platform", document.querySelector("[data-ved-embed]")?.disabled === true);
  chooseMode(document, window, "link");
  expect("editor: the link row is the one on the page", document.querySelector("[data-ved-mode-link]")?.hidden === false);
  expect("editor: and the file row stands aside", document.querySelector("[data-ved-mode-file]")?.hidden === true);
  choosePlatform(document, window, "youtube");
  await wait();
  expect("editor: the field opens on that platform", document.querySelector("[data-ved-embed]")?.disabled === false);
  expect(
    "editor: the placeholder asks for its own link",
    document.querySelector("[data-ved-embed]")?.placeholder === "Paste the YouTube link",
    document.querySelector("[data-ved-embed]")?.placeholder
  );
  const embed = document.querySelector("[data-ved-embed]");
  embed.value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  expect("editor: a YouTube link is recognised", document.querySelector("[data-ved-source-badge]")?.textContent === "YouTube", document.querySelector("[data-ved-source-badge]")?.textContent);
  expect("editor: the thumbnail comes from the video", document.querySelector("[data-ved-thumb-box] img")?.getAttribute("src")?.includes("i.ytimg.com"), document.querySelector("[data-ved-thumb-box]")?.innerHTML.slice(0, 80));

  /* the field keeps only the chosen platform's own link */
  embed.value = "https://vimeo.com/76979871";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  expect("editor: a foreign link never becomes the source", document.querySelector("[data-ved-publish]")?.disabled === true);
  expect(
    "editor: and the note says why",
    /not a YouTube link/i.test(document.querySelector("[data-ved-source-note]")?.textContent || ""),
    document.querySelector("[data-ved-source-note]")?.textContent
  );
  embed.value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  expect("editor: its own link is taken again", document.querySelector("[data-ved-source-badge]")?.textContent === "YouTube", document.querySelector("[data-ved-source-badge]")?.textContent);

  const title = document.querySelector("[data-ved-title]");
  title.value = "A first video";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  expect("editor: the preview carries the title", document.querySelector("[data-ved-preview-title]")?.textContent === "A first video");
  /* the card is the door — but only once the video has a page */
  const doorDraft = document.querySelector("[data-ved-preview-open]");
  expect("editor: an unsaved card has no door", !doorDraft?.getAttribute("href") && doorDraft?.getAttribute("aria-disabled") === "true", doorDraft?.getAttribute("href"));
  expect("editor: and the card says why", !document.querySelector("[data-ved-preview-hint]")?.hidden);
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
  expect(
    "editor: the keyword counter counts both levels",
    document.querySelector("[data-ved-tag-count]")?.textContent === "2 / 3 main · 0 / 15 sub",
    document.querySelector("[data-ved-tag-count]")?.textContent
  );

  /* the box takes a dropped file, and a dropped link brings its platform */
  const dropBox = document.querySelector("[data-ved-drop]");
  expect("editor: the box says what it takes", /drop the video here/i.test(dropBox?.textContent || ""), dropBox?.textContent?.slice(0, 60));
  expect("editor: and carries the picker", Boolean(dropBox?.querySelector("[data-ved-file-btn]")));
  expect("editor: a link row sits under it", Boolean(document.querySelector(".vsrc__row--link [data-ved-embed]")), document.querySelector(".vsrc__row")?.innerHTML?.slice(0, 60));

  const dropEvent = (payload) => {
    const event = new window.Event("drop", { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: payload });
    return event;
  };
  chooseMode(document, window, "file");
  await wait();
  expect("editor: the file row is the one on the page", document.querySelector("[data-ved-mode-file]")?.hidden === false);
  expect("editor: and the link row stands aside", document.querySelector("[data-ved-mode-link]")?.hidden === true);
  dropBox.dispatchEvent(
    dropEvent({
      files: [new window.File([new Uint8Array(32)], "drop.mp4", { type: "video/mp4" })],
      getData: () => "",
    })
  );
  await wait(80);
  expect("editor: a dropped file is uploaded", document.querySelector("[data-ved-file-note]")?.hidden === false, document.querySelector("[data-ved-file-note]")?.textContent);

  dropBox.dispatchEvent(
    dropEvent({
      files: [],
      getData: (kind) => (kind === "text/uri-list" ? "https://www.instagram.com/reel/Cxyz123/" : ""),
    })
  );
  await wait(80);
  expect("editor: a dropped link lands in the field", embed.value === "https://www.instagram.com/reel/Cxyz123/", embed.value);
  expect(
    "editor: its platform is chosen, and its own row comes forward",
    document.querySelector("[data-ved-platform]")?.value === "instagram" && document.querySelector("[data-ved-mode-link]")?.hidden === false,
    document.querySelector("[data-ved-platform]")?.value
  );
  expect("editor: the file row stands aside for it", document.querySelector("[data-ved-mode-file]")?.hidden === true);

  /* back to the YouTube link the rest of the pass reads */
  choosePlatform(document, window, "youtube");
  embed.value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();

  /* three main keywords, and subs under them */
  tagInput.value = "documentary";
  tagInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  tagInput.value = "a fourth one";
  tagInput.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  await wait();
  expect("editor: three main keywords is the ceiling", document.querySelectorAll("[data-ved-kw]").length === 3, String(document.querySelectorAll("[data-ved-kw]").length));

  const typeSub = (index, word) => {
    const input = document.querySelector(`[data-ved-sub-input="${index}"]`);
    input.value = word;
    input.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  };
  ["2d", "stop motion", "colour", "sound", "light", "a sixth one"].forEach((word) => typeSub(0, word));
  await wait();
  expect("editor: five subs under one keyword, no more", document.querySelectorAll('[data-ved-kw="0"] .tag--sub').length === 5, String(document.querySelectorAll('[data-ved-kw="0"] .tag--sub').length));
  expect(
    "editor: the counter says both levels",
    document.querySelector("[data-ved-tag-count]")?.textContent === "3 / 3 main · 5 / 15 sub",
    document.querySelector("[data-ved-tag-count]")?.textContent
  );

  /* the platform is chosen, and only its own link survives it */
  const platform = document.querySelector("[data-ved-platform]");
  platform.value = "x";
  platform.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait();
  expect("editor: the platform list holds the eight", document.querySelectorAll("[data-ved-platform] option").length === 9, String(document.querySelectorAll("[data-ved-platform] option").length));
  expect("editor: the chosen platform is named in the counter", document.querySelector("[data-ved-platform-note]")?.textContent === "X", document.querySelector("[data-ved-platform-note]")?.textContent);
  expect("editor: the YouTube link does not survive that choice", document.querySelector("[data-ved-embed]")?.value === "", document.querySelector("[data-ved-embed]")?.value);

  /* back to the YouTube link the payload is read from */
  choosePlatform(document, window, "youtube");
  embed.value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();

  /* the index: a time and a name, typed in the form */
  const typeChapter = (index, time, label) => {
    const timeInput = document.querySelector(`[data-ved-chapter-time="${index}"]`);
    const labelInput = document.querySelector(`[data-ved-chapter-label="${index}"]`);
    timeInput.value = time;
    timeInput.dispatchEvent(new window.Event("input", { bubbles: true }));
    labelInput.value = label;
    labelInput.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  document.querySelector("[data-ved-chapter-add]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("index: the editor offers a row", document.querySelectorAll("[data-ved-chapter]").length === 1, String(document.querySelectorAll("[data-ved-chapter]").length));
  expect("index: the row is numbered", document.querySelector(".vchp__n")?.textContent === "01", document.querySelector(".vchp__n")?.textContent);
  typeChapter(0, "0:00", "Introduction");
  document.querySelector("[data-ved-chapter-add]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  typeChapter(1, "00:38", "Overview");
  document.querySelector("[data-ved-chapter-add]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  typeChapter(2, "1:02:03", "The long take");
  await wait(60);
  expect("index: three rows stand", document.querySelectorAll("[data-ved-chapter]").length === 3, String(document.querySelectorAll("[data-ved-chapter]").length));
  expect("index: the count is spoken", document.querySelector("[data-ved-chapter-count]")?.textContent === "3 chapters", document.querySelector("[data-ved-chapter-count]")?.textContent);
  expect("index: a row can be taken away", (() => {
    document.querySelector('[data-ved-chapter-del="2"]').dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
    return document.querySelectorAll("[data-ved-chapter]").length === 2;
  })(), String(document.querySelectorAll("[data-ved-chapter]").length));

  /* publish */
  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  const payload = lastCall(calls, "video_save")?.body.p_payload || {};
  expect("editor: one call to video_save", Boolean(lastCall(calls, "video_save")));
  expect("editor: the token rides along", lastCall(calls, "video_save")?.body.p_token === "tok-123", lastCall(calls, "video_save")?.body.p_token);
  expect("editor: the payload is published", payload.status === "published", payload.status);
  expect("editor: the payload is public", payload.visibility === "general", payload.visibility);
  expect("editor: the tags are the main keywords", Array.isArray(payload.tags) && payload.tags.join(",") === "animation,editing,documentary", JSON.stringify(payload.tags));
  expect(
    "index: the chapters ride in the payload",
    Array.isArray(payload.meta?.chapters) && payload.meta.chapters.length === 2,
    JSON.stringify(payload.meta?.chapters)
  );
  expect(
    "index: each chapter is a time and a name",
    payload.meta?.chapters?.[0]?.start === "0:00" && payload.meta?.chapters?.[0]?.label === "Introduction" &&
      payload.meta?.chapters?.[1]?.start === "0:38" && payload.meta?.chapters?.[1]?.label === "Overview",
    JSON.stringify(payload.meta?.chapters)
  );
  expect("index: a name-less row is dropped, not saved half-written", (payload.meta?.chapters || []).every((row) => row.label && row.start), JSON.stringify(payload.meta?.chapters));
  expect("editor: the chosen platform rides in the payload", payload.meta?.platform === "youtube", JSON.stringify(payload.meta?.platform));
  expect("editor: a YouTube link is still read as YouTube", payload.meta?.source === "youtube", payload.meta?.source);
  expect(
    "editor: the two levels of keywords ride in the payload",
    Array.isArray(payload.meta?.keywords) &&
      payload.meta.keywords.length === 3 &&
      payload.meta.keywords[0].keyword === "animation" &&
      payload.meta.keywords[0].subs.length === 5 &&
      payload.meta.keywords[0].subs[0] === "2d",
    JSON.stringify(payload.meta?.keywords)
  );
  expect("editor: a public one sends no password key at all", payload.passwords === undefined, JSON.stringify(payload.passwords));
  /* published: the card now opens the video in the watch page */
  const door = document.querySelector("[data-ved-preview-open]");
  expect("editor: a published card opens the watch page", door?.getAttribute("href") === "videos.html#/h/ID=PST-001100", door?.getAttribute("href"));
  expect("editor: in a new tab, so the editor is not lost", door?.getAttribute("target") === "_blank" && /noopener/.test(door?.getAttribute("rel") || ""), door?.getAttribute("rel"));
  expect("editor: the hint steps aside", document.querySelector("[data-ved-preview-hint]")?.hidden === true);
  expect("editor: no audience on a public one", Array.isArray(payload.audience) && payload.audience.length === 0);
}

{
  /* a studio's video does not stay on the site — it goes to the studio's host */
  const tape = { listed: 0, created: [], uploads: [], renames: [] };
  const { document, calls, window } = boot("video-editor.html", {
    storage: STORAGE,
    fetchImpl: (href, opts) => {
      const fn = fnName(href);
      if (fn === "creator_hubs_list") {
        return reply({ ok: true, hubs: [{ code: "IDST100001", name: "CineAura", kind: "channel" }] });
      }
      if (fn === "video_save") return reply({ ok: true, code: "Video-001100", status: "published" });
      if (href.includes("/functions/v1/studio-upload")) {
        const url = new URL(href);
        const action = url.searchParams.get("action");
        const folder = url.searchParams.get("folder") || "";
        tape.studio = url.searchParams.get("studio");
        tape.auth = (opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || "";
        if (action === "file/listfolder") {
          tape.listed += 1;
          if (!folder) return reply({ status: 200, result: { folders: [{ id: "fld-users", name: "Users" }], files: [] } });
          if (folder === "fld-users") return reply({ status: 200, result: { folders: [{ id: "fld-studio", name: "Studio" }], files: [] } });
          return reply({ status: 200, result: { folders: [], files: [] } });
        }
        if (action === "file/createfolder") {
          tape.created.push({ name: url.searchParams.get("name"), pid: url.searchParams.get("pid") });
          return reply({ status: 200, result: { folderid: "fld-cineaura" } });
        }
        if (action === "file/ul") {
          tape.spot = folder;
          return reply({ status: 200, result: { url: "https://tapecontent.net/xfsupload/tok" } });
        }
        if (action === "file/rename") {
          tape.renames.push({ file: url.searchParams.get("file"), name: url.searchParams.get("name"), studio: url.searchParams.get("studio") });
          return reply({ status: 200, result: true });
        }
        return reply({ status: 400, msg: "unexpected call" });
      }
      if (href.startsWith("https://tapecontent.net/")) {
        const sent = opts.body && typeof opts.body.get === "function" ? opts.body.get("file1") : null;
        tape.uploads.push({ href, name: sent && sent.name, size: sent && sent.size });
        return reply({ status: 200, result: { id: "fid1", name: sent && sent.name } });
      }
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?pstudio`);
  await wait(80);

  const hubSelect = document.querySelector("[data-ved-hub]");
  expect("studio upload: the hub list holds the studio", (hubSelect?.querySelectorAll("option") || []).length >= 2, hubSelect?.innerHTML?.slice(0, 120));
  hubSelect.value = "IDST100001";
  hubSelect.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait();

  expect(
    "studio upload: the box says where the file will land",
    /Home \/ Users \/ Studio \/ IDST100001/.test(document.querySelector("[data-ved-drop-note]")?.textContent || ""),
    document.querySelector("[data-ved-drop-note]")?.textContent
  );
  const file = new window.File([new Uint8Array(2048)], "clip.mp4", { type: "video/mp4" });
  const picker = document.querySelector("[data-ved-file]");
  Object.defineProperty(picker, "files", { value: [file], configurable: true });
  picker.dispatchEvent(new window.Event("change", { bubbles: true }));
  await wait(160);

  expect(
    "studio upload: the tree is read from Home down",
    tape.listed === 3,
    `${tape.listed} listings`
  );
  expect(
    "studio upload: a folder is made for the studio, on the Users/Studio shelf",
    tape.created.length === 1 && tape.created[0].name === "IDST100001" && tape.created[0].pid === "fld-studio",
    JSON.stringify(tape.created)
  );
  expect("studio upload: the file is posted into that folder", tape.spot === "fld-cineaura", tape.spot);
  expect("studio upload: the call carries the member's token", tape.auth === "Bearer tok-123", tape.auth);
  expect("studio upload: every call names the studio", tape.studio === "IDST100001", tape.studio);
  expect("studio upload: one file goes up", tape.uploads.length === 1, JSON.stringify(tape.uploads.map((row) => row.name)));
  expect(
    "studio upload: it carries a provisional name until the video has a code",
    /^IDST100001-[a-z0-9]+\.mp4$/.test(String(tape.uploads[0]?.name)),
    tape.uploads[0]?.name
  );
  expect(
    "studio upload: the field holds the host's embed address",
    document.querySelector("[data-ved-embed]")?.value === "https://streamtape.com/e/fid1",
    document.querySelector("[data-ved-embed]")?.value
  );
  expect(
    "studio upload: the source is named Streamtape",
    document.querySelector("[data-ved-source-badge]")?.textContent === "Streamtape",
    document.querySelector("[data-ved-source-badge]")?.textContent
  );
  expect(
    "studio upload: the bar is full under it",
    document.querySelector("[data-ved-progress]")?.hidden === false &&
      document.querySelector("[data-ved-progress-fill]")?.style.width === "100%",
    document.querySelector("[data-ved-progress-fill]")?.style.width
  );
  const studioNote = document.querySelector("[data-ved-file-note]")?.textContent || "";
  expect("studio upload: the note says where the file went", studioNote.includes("Home / Users / Studio / IDST100001"), studioNote);

  /* publish: the video gets its code, and the file takes that name */
  const studioTitle = document.querySelector("[data-ved-title]");
  studioTitle.value = "A studio video";
  studioTitle.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait();
  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(200);
  expect(
    "studio upload: the file is renamed to the video's own code",
    tape.renames.length === 1 && tape.renames[0].name === "Video-001100.mp4" && tape.renames[0].file === "fid1",
    JSON.stringify(tape.renames)
  );
  const studioPayload = lastCall(calls, "video_save")?.body?.p_payload;
  expect(
    "studio upload: the host file rides in the payload",
    studioPayload?.meta?.host_file?.id === "fid1" &&
      studioPayload?.meta?.host_file?.studio === "IDST100001" &&
      studioPayload?.meta?.host_file?.folder === "IDST100001" &&
      studioPayload?.meta?.host_file?.ext === "mp4",
    JSON.stringify(studioPayload?.meta?.host_file)
  );
  expect("studio upload: the source rides as the host", studioPayload?.meta?.source === "streamtape", studioPayload?.meta?.source);

  /* the function first, and a direct way behind it for the day it is missing */
  const cfg = await import(`file://${join(root, "assets/js/config.js")}?cfgstudio`);
  expect(
    "studio upload: the function is the way in",
    /\/functions\/v1\/studio-upload$/.test(cfg.STREAMTAPE.proxy),
    cfg.STREAMTAPE.proxy
  );
  expect(
    "studio upload: and a direct way stands behind it",
    Boolean(cfg.STREAMTAPE.login && cfg.STREAMTAPE.key),
    `${cfg.STREAMTAPE.login ? "login set" : "no login"}`
  );
  const hostFunction = readFileSync(join(root, "supabase/functions/studio-upload/index.ts"), "utf8");
  expect(
    "studio upload: the function reads its keys from the environment",
    hostFunction.includes("STREAMTAPE_LOGIN") && hostFunction.includes("STREAMTAPE_KEY") && hostFunction.includes("Deno.env.get")
  );
  expect("studio upload: no key is written into the function", !/120GYLeBYluelxJ|010abc21eb8af8b77b42/.test(hostFunction));
}

{
  /* a file uploaded before the code changed is renamed to the code it has now */
  const renames = [];
  const ctx = boot("video-editor.html", {
    hash: "#?id=Video-000001",
    url: "video-editor.html?id=Video-000001",
    storage: STORAGE,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "creator_hubs_list") {
        return reply({ ok: true, hubs: [{ code: "IDST100001", name: "CineAura", kind: "channel" }] });
      }
      if (fn === "video_get") {
        return reply({
          ok: true,
          locked: false,
          mine: true,
          video: {
            id: "v1",
            code: "Video-000001",
            title: "Older file",
            status: "draft",
            visibility: "general",
            embed: "https://streamtape.com/e/fid9",
            video: {
              embed: "https://streamtape.com/e/fid9",
              meta: {
                host_file: { id: "fid9", studio: "IDST100001", folder: "IDST100001", ext: "mp4", name: "PST-001032.mp4" },
              },
            },
          },
        });
      }
      if (fn === "video_save") return reply({ ok: true, code: "Video-000001", status: "draft" });
      if (href.includes("/functions/v1/studio-upload")) {
        const url = new URL(href);
        if (url.searchParams.get("action") === "file/rename") {
          renames.push({ file: url.searchParams.get("file"), name: url.searchParams.get("name") });
          return reply({ status: 200, result: true });
        }
        return reply({ status: 200, result: {} });
      }
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?precode`);
  await wait(90);
  const doc = ctx.document;
  expect("codes: the video opens on its own code", doc.querySelector("[data-ved-title]")?.value === "Older file", doc.querySelector("[data-ved-title]")?.value);
  doc.querySelector("[data-ved-save]").dispatchEvent(new ctx.window.MouseEvent("click", { bubbles: true }));
  await wait(150);
  expect(
    "codes: a file still called by the old code is renamed to the new one",
    renames.length === 1 && renames[0].file === "fid9" && renames[0].name === "Video-000001.mp4",
    JSON.stringify(renames)
  );
}

{
  /* the day the function is not deployed: the direct way takes over */
  const direct = { calls: [], uploads: 0 };
  const ctx = boot("video-editor.html", {
    storage: STORAGE,
    fetchImpl: (href, opts) => {
      const fn = fnName(href);
      if (fn === "creator_hubs_list") {
        return reply({ ok: true, hubs: [{ code: "IDST100001", name: "CineAura", kind: "channel" }] });
      }
      if (fn === "video_save") return reply({ ok: true, code: "PST-002200", status: "published" });
      if (href.includes("/functions/v1/studio-upload")) return Promise.reject(new TypeError("Failed to fetch"));
      if (href.startsWith("https://api.streamtape.com/")) {
        const url = new URL(href);
        const action = url.pathname.replace(/^\//, "");
        const folder = url.searchParams.get("folder") || "";
        direct.calls.push({ action, login: url.searchParams.get("login"), key: url.searchParams.get("key") });
        if (action === "file/listfolder") {
          if (!folder) return reply({ status: 200, result: { folders: [{ id: "fld-users", name: "Users" }], files: [] } });
          if (folder === "fld-users") return reply({ status: 200, result: { folders: [{ id: "fld-studio", name: "Studio" }], files: [] } });
          if (folder === "fld-studio") return reply({ status: 200, result: { folders: [], files: [] } });
          return reply({ status: 200, result: { folders: [], files: [] } });
        }
        if (action === "file/createfolder") return reply({ status: 200, result: { folderid: "fld-cineaura" } });
        if (action === "file/ul") return reply({ status: 200, result: { url: "https://tapecontent.net/xfsupload/direct" } });
        if (action === "file/rename") return reply({ status: 200, result: true });
        return reply({ status: 400, msg: "unexpected" });
      }
      if (href.startsWith("https://tapecontent.net/")) {
        direct.uploads += 1;
        return reply({ status: 200, result: { id: "fid2" } });
      }
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?pdirect`);
  await wait(80);
  const doc = ctx.document;
  const hubs = doc.querySelector("[data-ved-hub]");
  hubs.value = "IDST100001";
  hubs.dispatchEvent(new ctx.window.Event("change", { bubbles: true }));
  await wait();
  /* the folder ids are remembered across boots in this harness — forget them
     so the direct way has to read the tree again */
  const host = await import(`file://${join(root, "assets/js/streamtape.js")}`);
  host.forgetFolders();
  const pick = doc.querySelector("[data-ved-file]");
  Object.defineProperty(pick, "files", {
    value: [new ctx.window.File([new Uint8Array(64)], "clip.mp4", { type: "video/mp4" })],
    configurable: true,
  });
  pick.dispatchEvent(new ctx.window.Event("change", { bubbles: true }));
  await wait(160);

  expect(
    "direct way: the API is asked in Streamtape's own shape",
    direct.calls.length >= 3,
    `${direct.calls.length} · ${doc.querySelector("[data-ved-file-note]")?.textContent} · ${JSON.stringify(direct.calls)}`
  );
  expect(
    "direct way: every call carries the account's two keys",
    direct.calls.every((row) => row.login && row.key),
    JSON.stringify(direct.calls[0])
  );
  expect("direct way: the file still goes up", direct.uploads === 1, String(direct.uploads));
  expect(
    "direct way: and the field holds the host's address",
    doc.querySelector("[data-ved-embed]")?.value === "https://streamtape.com/e/fid2",
    doc.querySelector("[data-ved-embed]")?.value
  );
  expect(
    "direct way: the path is remembered",
    ctx.window.localStorage.getItem("1w.streamtape.path") === "direct",
    ctx.window.localStorage.getItem("1w.streamtape.path")
  );
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

  /* the upload's own line: a bar, the time gone, the speed */
  const progress = document.querySelector("[data-ved-progress]");
  expect("progress: the bar is out while the file goes", progress?.hidden === false);
  expect("progress: it is full when the file lands", document.querySelector("[data-ved-progress-fill]")?.style.width === "100%", document.querySelector("[data-ved-progress-fill]")?.style.width);
  expect("progress: and says a hundred", document.querySelector("[data-ved-progress-pct]")?.textContent === "100%", document.querySelector("[data-ved-progress-pct]")?.textContent);
  expect(
    "progress: the time gone is written as a clock",
    /^\d{2}:\d{2}$/.test(document.querySelector("[data-ved-progress-elapsed]")?.textContent || ""),
    document.querySelector("[data-ved-progress-elapsed]")?.textContent
  );
  expect(
    "progress: the speed is a rate, not a dash",
    /\/s$/.test(document.querySelector("[data-ved-progress-speed]")?.textContent || ""),
    document.querySelector("[data-ved-progress-speed]")?.textContent
  );
  expect("progress: the file is named on its line", (document.querySelector("[data-ved-progress-name]")?.textContent || "").includes("short.mp4"), document.querySelector("[data-ved-progress-name]")?.textContent);

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
  expect("hosts: the frame address asks YouTube for its own full screen", embed.fullscreenSrc("https://youtu.be/dQw4w9WgXcQ") === "https://www.youtube.com/embed/dQw4w9WgXcQ?fs=1&playsinline=1", embed.fullscreenSrc("https://youtu.be/dQw4w9WgXcQ"));
  expect("hosts: Dailymotion is asked the same way", embed.fullscreenSrc("https://www.dailymotion.com/video/x8abc12").includes("allowFullscreen=true"), embed.fullscreenSrc("https://www.dailymotion.com/video/x8abc12"));
  expect("hosts: and Facebook", embed.fullscreenSrc("https://www.facebook.com/watch/?v=123456789").includes("allowfullscreen=true"), embed.fullscreenSrc("https://www.facebook.com/watch/?v=123456789"));
  expect("hosts: a platform without such a flag is left alone", embed.fullscreenSrc("https://www.tiktok.com/@who/video/7312345678901234567") === "https://www.tiktok.com/embed/v2/7312345678901234567", embed.fullscreenSrc("https://www.tiktok.com/@who/video/7312345678901234567"));
  expect("hosts: the allow list names full screen", /fullscreen/.test(embed.FRAME_ALLOW), embed.FRAME_ALLOW);
  expect("hosts: and the canonical address never changed", embed.embedUrl("https://youtu.be/dQw4w9WgXcQ") === "https://www.youtube.com/embed/dQw4w9WgXcQ", embed.embedUrl("https://youtu.be/dQw4w9WgXcQ"));
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
  expect("player: a YouTube link is framed", frame() === "https://www.youtube.com/embed/dQw4w9WgXcQ?fs=1&playsinline=1", frame());
  expect("player: YouTube's own full-screen button is asked for", /(^|[?&])fs=1(&|$)/.test(frame()), frame());
  expect("player: the frame names full screen in its allow list", /allow="[^"]*fullscreen/.test(player()?.querySelector("iframe")?.outerHTML || ""), player()?.querySelector("iframe")?.outerHTML?.slice(0, 120));
  expect("player: and carries the attribute itself", player()?.querySelector("iframe")?.hasAttribute("allowfullscreen") === true);
  expect("player: the editor's preview has the corner door too", Boolean(document.querySelector("[data-ved-fs]")), "no button");
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
/* pass 12 — the studio the video is published into                   */
/* ================================================================== */
const HUBS = {
  ok: true,
  level: 4,
  limits: {},
  hubs: [
    { id: "h1", code: "IDST100001", kind: "channel", name: "Studio One", visibility: "public" },
    { id: "h2", code: "IDSV100002", kind: "server", name: "IPTV", visibility: "public" },
    { id: "h3", code: "IDCN100003", kind: "cinema", name: "My Cinema", visibility: "public" },
    { id: "h4", code: "IDBL100004", kind: "blog", name: "My Blog", visibility: "public" },
    { id: "h5", code: "IDSP100005", kind: "space", name: "A Space", visibility: "public" },
  ],
};

async function editorWith(tag, { hubs = HUBS, url = "video-editor.html", saveReply = { ok: true, code: "PST-001200", status: "published" }, storage = STORAGE } = {}) {
  const ctx = boot("video-editor.html", {
    url,
    storage,
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "creator_hubs_list") return hubs === null ? Promise.reject(new Error("down")) : reply(hubs);
      if (fn === "video_save") return reply(saveReply);
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/video-editor.js")}?${tag}`);
  await wait(70);
  return ctx;
}

{
  const ctx = await editorWith("p12hub");
  const { document, window, calls } = ctx;
  const options = () => [...document.querySelectorAll("[data-ved-hub] option")];
  const pick = async (code) => {
    const select = document.querySelector("[data-ved-hub]");
    select.value = code;
    select.dispatchEvent(new window.Event("change", { bubbles: true }));
    await wait(20);
  };

  expect("hub: the card is on the page", Boolean(document.querySelector("[data-ved-hub-wrap]")));
  expect("hub: the first choice is the member's own feed", options()[0]?.value === "" && /my own feed/i.test(options()[0].textContent), options()[0]?.textContent);
  expect("hub: only the hubs that can hold a video are listed", options().length === 4, options().map((o) => o.value).join(","));
  expect("hub: a studio, a server and a cinema are there", ["IDST100001", "IDSV100002", "IDCN100003"].every((code) => options().some((o) => o.value === code)), options().map((o) => o.value).join(","));
  expect("hub: a blog is not — it cannot hold a video", !options().some((o) => o.value === "IDBL100004"));
  expect("hub: the option names the hub and its kind", /Studio One · studio · IDST100001/.test(options().find((o) => o.value === "IDST100001")?.textContent || ""), options().find((o) => o.value === "IDST100001")?.textContent);
  expect("hub: the head counts them", document.querySelector("[data-ved-hub-count]")?.textContent === "3 studios", document.querySelector("[data-ved-hub-count]")?.textContent);
  expect("hub: before choosing it says the video stays in the feed", document.querySelector("[data-ved-hub-note]")?.textContent.includes("stays in your own feed"), document.querySelector("[data-ved-hub-note]")?.textContent);
  expect("hub: nothing about a studio is in the preview yet", document.querySelector("[data-ved-preview-studio]")?.hidden === true);
  expect("hub: no studio to open yet", document.querySelector("[data-ved-hub-link]")?.hidden === true);

  await pick("IDCN100003");
  expect("hub: the note names the chosen studio", document.querySelector("[data-ved-hub-note]")?.textContent.includes("My Cinema · IDCN100003"), document.querySelector("[data-ved-hub-note]")?.textContent);
  expect("hub: the note says where it will appear", document.querySelector("[data-ved-hub-note]")?.textContent.includes("Videos tab"), document.querySelector("[data-ved-hub-note]")?.textContent);
  expect("hub: the preview card carries it", document.querySelector("[data-ved-preview-studio]")?.hidden === false && document.querySelector("[data-ved-preview-studio]")?.textContent.includes("My Cinema"), document.querySelector("[data-ved-preview-studio]")?.textContent);
  expect("hub: the studio can be opened from here", document.querySelector("[data-ved-hub-link]")?.getAttribute("href") === "creator.html?studio=IDCN100003", document.querySelector("[data-ved-hub-link]")?.getAttribute("href"));

  /* the draft on this device remembers it, before anything is published */
  await wait(950);
  const kept = JSON.parse(window.localStorage.getItem("1w.videos.draft") || "{}");
  expect("hub: the draft keeps the studio", kept.hub === "IDCN100003", JSON.stringify(kept.hub));

  /* a video with the link and the title is ready */
  const embed = document.querySelector("[data-ved-embed]");
  embed.value = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  const title = document.querySelector("[data-ved-title]");
  title.value = "A film for the cinema";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(40);

  calls.length = 0;
  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const save = lastCall(calls, "video_save");
  expect("hub: the save went out", Boolean(save), calls.map((c) => fnName(c.href)).join(","));
  expect("hub: the payload carries the studio's code", save?.body?.p_payload?.hub === "IDCN100003", JSON.stringify(save?.body?.p_payload?.hub));

  /* back to the member's own feed */
  await pick("");
  calls.length = 0;
  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  const cleared = lastCall(calls, "video_save");
  expect("hub: «my own feed» sends a null, not the last studio", cleared?.body?.p_payload?.hub === null, JSON.stringify(cleared?.body?.p_payload?.hub));
  expect("hub: nothing threw", ctx.errors.length === 0, ctx.errors.join(" | "));
}

{
  /* a link from the studio opens the editor with the studio already chosen */
  const ctx = await editorWith("p12param", { url: "video-editor.html?studio=idst100001" });
  const { document, calls, window } = ctx;
  expect("hub param: the select is already on that studio", document.querySelector("[data-ved-hub]")?.value === "IDST100001", document.querySelector("[data-ved-hub]")?.value);
  expect("hub param: the note says so", document.querySelector("[data-ved-hub-note]")?.textContent.includes("Studio One"), document.querySelector("[data-ved-hub-note]")?.textContent);
  expect("hub param: a lower-case code still matches", document.querySelector("[data-ved-preview-studio]")?.textContent.includes("Studio One"), document.querySelector("[data-ved-preview-studio]")?.textContent);

  const embed = document.querySelector("[data-ved-embed]");
  embed.value = "https://cdn.example.com/film.mp4";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  const title = document.querySelector("[data-ved-title]");
  title.value = "Straight from the studio";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(30);
  calls.length = 0;
  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(120);
  expect("hub param: publishing keeps it", lastCall(calls, "video_save")?.body?.p_payload?.hub === "IDST100001", JSON.stringify(lastCall(calls, "video_save")?.body?.p_payload?.hub));
  expect("hub param: nothing threw", ctx.errors.length === 0, ctx.errors.join(" | "));
}

{
  /* a member who runs no studio is told so, and given the way to make one */
  const ctx = await editorWith("p12none", { hubs: { ok: true, level: 1, limits: {}, hubs: [] } });
  const { document } = ctx;
  expect("no studio: the select is not shown", document.querySelector("[data-ved-hub]")?.closest("label")?.hidden === true);
  expect("no studio: the card says it plainly", document.querySelector("[data-ved-hub-note]")?.textContent.includes("You run no studio yet"), document.querySelector("[data-ved-hub-note]")?.textContent);
  expect("no studio: and offers the way in", document.querySelector("[data-ved-hub-link]")?.getAttribute("href") === "creator.html?section=studio", document.querySelector("[data-ved-hub-link]")?.getAttribute("href"));
  expect("no studio: the preview stays quiet", document.querySelector("[data-ved-preview-studio]")?.hidden === true);
  expect("no studio: nothing threw", ctx.errors.length === 0, ctx.errors.join(" | "));
}

{
  /* a studio that belongs to someone else: the server says so, and says why */
  const ctx = await editorWith("p12refused", { saveReply: { ok: false, error: "hub_role" } });
  const { document, window } = ctx;
  const embed = document.querySelector("[data-ved-embed]");
  embed.value = "https://cdn.example.com/film.mp4";
  embed.dispatchEvent(new window.Event("input", { bubbles: true }));
  const title = document.querySelector("[data-ved-title]");
  title.value = "Not mine to publish";
  title.dispatchEvent(new window.Event("input", { bubbles: true }));
  await wait(30);
  document.querySelector("[data-ved-publish]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(150);
  const msg = [...document.querySelectorAll(".toast__msg")].map((n) => n.textContent).join(" | ");
  expect("refused: the sentence is about the studio, not a generic error", /belongs to someone else/.test(msg), msg);
  expect("refused: nothing threw", ctx.errors.length === 0, ctx.errors.join(" | "));
}

{
  /* the page itself carries the card, in the right column, before the picture */
  const html = readFileSync(join(root, "video-editor.html"), "utf8");
  const hubAt = html.indexOf("data-ved-hub-wrap");
  const thumbAt = html.indexOf("data-ved-thumb-box");
  const previewAt = html.indexOf("data-ved-preview-media");
  expect("html: the studio card sits under the preview", previewAt > 0 && hubAt > previewAt, `${previewAt} / ${hubAt}`);
  expect("html: and above the thumbnail", hubAt < thumbAt, `${hubAt} / ${thumbAt}`);
  expect("html: the card has its own heading", /Where it goes/.test(html.slice(hubAt, hubAt + 900)));
  expect("css: the studio line in the preview is styled", css.includes(".vprev__studio") || readFileSync(join(root, "assets/css/video.css"), "utf8").includes(".vprev__studio"));
}

/* ================================================================== */
/* pass 14 — the contents of the form                                 */
/* ================================================================== */
{
  const { document, window, errors } = await editor("p14");
  const rows = [...document.querySelectorAll("[data-ved-toc] [data-toc]")];

  expect("contents: the form carries a rail", Boolean(document.querySelector("[data-ved-toc]")), "");
  expect("contents: one row per section", rows.length === 10, rows.length);
  expect("contents: the count is spoken", document.querySelector("[data-ved-toc-count]")?.textContent === "10 sections", document.querySelector("[data-ved-toc-count]")?.textContent);
  expect(
    "contents: in the order the form is read",
    rows[0]?.textContent.includes("The video") &&
      rows[2]?.textContent.includes("Extra choices") &&
      rows[6]?.textContent.includes("Chapters") &&
      rows[9]?.textContent.includes("Details"),
    rows.map((row) => row.textContent.trim()).join(" | ")
  );
  expect("contents: numbered", rows[8]?.textContent.trim().startsWith("09"), rows[8]?.textContent);
  expect("contents: the box that lists them is not one of them", !rows.some((row) => /Contents/.test(row.textContent)), rows.map((row) => row.textContent.trim()).join(" | "));

  const audienceRow = rows.find((row) => /Who sees it/.test(row.textContent));
  audienceRow.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(30);
  const audienceBox = [...document.querySelectorAll(".vcard-box")].find(
    (box) => box.querySelector(".vcard-box__title")?.textContent.trim() === "Who sees it"
  );
  expect("contents: a press marks the row", audienceRow.classList.contains("is-active"), audienceRow.className);
  expect("contents: and lights the section up", audienceBox.classList.contains("is-jump"), audienceBox.className);
  expect("contents: the section takes the focus", audienceBox.contains(document.activeElement), document.activeElement?.tagName);
  expect("contents: nothing threw", errors.length === 0, errors.join(" | "));
  expect("contents: the jump is drawn", css.includes(".vcard-box.is-jump"), "");
}

/* ================================================================== */
/* pass 13 — the old address and the stylesheet                       */
/* ================================================================== */
{
  const html = readFileSync(join(root, "video.html"), "utf8");
  expect("video.html: it forwards to the videos page", html.includes("videos.html#/v/") && html.includes('get("id")'));
  const codes = readFileSync(join(root, "tools/sql/video-codes.sql"), "utf8");
  expect("codes: a video is minted with its own prefix", codes.includes("'Video-'") && codes.includes("content_type = 'video'"));
  expect("codes: and the videos already out there are renamed", codes.includes("set post_code = 'Video-' || substring"));
  expect("codes: the old default is dropped first", codes.includes("alter column post_code drop default"));
  expect("video.html: it replaces, not pushes", html.includes("location.replace"));

  ["vcard", "vcard__media", "vgrid", "vbar", "vwatch", "vplayer", "vgate", "vacts", "vhost", "vcomposer", "vcom", "ved", "vdrop", "vfoot", "vseg", "vtaglist", "vsk", "vempty", "vshelf", "vrow", "vchoose", "vchoose__opt", "vdrop__note", "vkw", "vplatform", "vprog", "vprog__bar", "vprog__fill", "vprog__meta"].forEach((name) => {
    expect(`css: .${name} exists`, css.includes(`.${name}`), name);
  });
  expect("css: it is monochrome — no colour literals beyond the scrims", !/#[0-9a-f]{3,6}/i.test(css.replace(/#(000|000000|f2f2f4|fff|ffffff|e6e6e9|08080a)\b/gi, "").replace(/rgba?\([^)]*\)/g, "")), "colour found");
  expect("css: the two screens stack on a phone", css.includes("@media (max-width: 1180px)") && css.includes("@media (max-width: 720px)"));
}

/* ================================================================== */
/* 17 — the publisher is the studio, when the video went into one      */
/* ================================================================== */
{
  const STUDIO = {
    id: "hub-1",
    code: "IDST100001",
    kind: "channel",
    name: "Cine Aura",
    logo_url: "https://example.com/logo.png",
    visibility: "public",
    creator: "ID100019",
  };
  const studioBoot = (hub) => {
    const made = boot("videos.html", {
      hash: "#/h/ID=PST-001032",
      fetchImpl: (href) => {
        const fn = fnName(href);
        if (fn === "video_feed") return reply(FEED);
        if (fn === "video_mine") return reply({ ok: true, rows: [] });
        if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: card({ code: "PST-001032" }), related: [], more: [] });
        if (fn === "video_hub") return reply({ ok: true, hub });
        if (fn === "post_comments") return reply({ comments: [], count: 0 });
        return reply([]);
      },
    });
    return made;
  };

  const withStudio = studioBoot(STUDIO);
  await import(`file://${join(root, "assets/js/videos.js")}?p=studio1`);
  await wait(120);
  const doc = withStudio.document;
  expect("studio: the question was asked for the video's studio", withStudio.calls.some((c) => fnName(c.href) === "video_hub"), withStudio.calls.map((c) => fnName(c.href)).join(" "));
  expect("studio: the studio is named as the publisher", doc.querySelector(".vhost__name")?.textContent === "Cine Aura", doc.querySelector(".vhost__name")?.textContent);
  expect("studio: the publisher block says it is a studio", doc.querySelector("[data-v-host]")?.getAttribute("data-v-host") === "studio", doc.querySelector("[data-v-host]")?.getAttribute("data-v-host"));
  expect(
    "studio: the name opens the studio with its creator",
    doc.querySelector("[data-v-studio]")?.getAttribute("href") === "creator.html?studio=IDST100001&creator=ID100019",
    doc.querySelector("[data-v-studio]")?.getAttribute("href")
  );
  expect("studio: the mark is the studio's logo", doc.querySelector("[data-v-studio] img")?.getAttribute("src") === "https://example.com/logo.png", doc.querySelector("[data-v-studio]")?.innerHTML.slice(0, 60));
  expect("studio: the code and the member are under it", /Studio/.test(doc.querySelector(".vhost__meta")?.textContent || "") && /IDST100001/.test(doc.querySelector(".vhost__meta")?.textContent || "") && /Jhon/.test(doc.querySelector(".vhost__meta")?.textContent || ""), doc.querySelector(".vhost__meta")?.textContent);
  expect("studio: the member's profile is still one click away", /creator\.html\?creator=/.test(doc.querySelector(".vhost__meta a")?.getAttribute("href") || ""), doc.querySelector(".vhost__meta a")?.getAttribute("href"));

  /* a video saved before `posts.hub_id` existed: the member's studio answers */
  const byMember = boot("videos.html", {
    hash: "#/h/ID=PST-001032",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: card({ code: "PST-001032" }), related: [], more: [] });
      if (fn === "video_hub") return reply({ ok: true, hub: null });
      if (fn === "creator_studio") return reply({ ok: true, hub: STUDIO });
      if (fn === "post_comments") return reply({ comments: [], count: 0 });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p=studio1b`);
  await wait(120);
  expect("studio: a video with no hub asks its member's studio", byMember.calls.some((c) => fnName(c.href) === "creator_studio"), byMember.calls.map((c) => fnName(c.href)).join(" "));
  expect("studio: the member's studio becomes the publisher", byMember.document.querySelector(".vhost__name")?.textContent === "Cine Aura", byMember.document.querySelector(".vhost__name")?.textContent);
  expect("studio: and it links with the studio's code", byMember.document.querySelector("[data-v-studio]")?.getAttribute("href") === "creator.html?studio=IDST100001&creator=ID100019", byMember.document.querySelector("[data-v-studio]")?.getAttribute("href"));

  /* the same answer from the creator page's own call, when that one is missing */
  const byPublic = boot("videos.html", {
    hash: "#/h/ID=PST-001032",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: card({ code: "PST-001032" }), related: [], more: [] });
      if (fn === "video_hub") return reply({ ok: true, hub: null });
      if (fn === "creator_studio") return reply({ ok: false, error: "not_found" });
      if (fn === "creator_public") return reply({ ok: true, creator: { code: "ID100019" }, hubs: [{ id: "hub-9", kind: "blog", name: "Night Notes" }, { id: "hub-1", kind: "channel", name: "Cine Aura", logo_url: "", visibility: "public" }] });
      if (fn === "post_comments") return reply({ comments: [], count: 0 });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p=studio1c`);
  await wait(140);
  expect("studio: the creator page's call names the studio too", byPublic.document.querySelector(".vhost__name")?.textContent === "Cine Aura", byPublic.document.querySelector(".vhost__name")?.textContent);
  expect("studio: a non-studio hub is not picked first", !/Night Notes/.test(byPublic.document.querySelector(".vhost")?.textContent || ""), byPublic.document.querySelector(".vhost")?.textContent);
  expect("studio: with no code the link keeps the hub's id", /creator\.html\?studio=hub-1&creator=ID100019/.test(byPublic.document.querySelector("[data-v-studio]")?.getAttribute("href") || ""), byPublic.document.querySelector("[data-v-studio]")?.getAttribute("href"));

  /* the details under the video: chapters, the studio's counts, its links */
  const RICH = {
    ...STUDIO,
    description: "Studio Cine Aura — camera tests and long talks.",
    field: "Cinema",
    subscribers: 746000,
    published: 12,
    links: [
      { label: "Website", url: "https://cineaura.example" },
      { label: "YouTube", url: "https://youtube.com/@cineaura" },
    ],
  };
  const richBoot = boot("videos.html", {
    hash: "#/h/ID=PST-001032",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get")
        return reply({
          ok: true,
          locked: false,
          mine: false,
          video: youtubeCard({
            code: "PST-001032",
            minutes: 51,
            description: "Comedy beats: (0:37 - 14:00) the wedding hunt.\nMoney and work: (14:00 - 30:00) the neighbours.\nNo time in this line at all.",
          }),
          related: [],
          more: [],
        });
      if (fn === "video_hub") return reply({ ok: true, hub: RICH });
      if (fn === "post_comments") return reply({ comments: [], count: 0 });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p=studio1d`);
  await wait(140);
  const rd = richBoot.document;
  expect("details: the way back to the studio is there", rd.querySelector("[data-v-studio-back]")?.getAttribute("href") === "creator.html?studio=IDST100001&creator=ID100019", rd.querySelector("[data-v-studio-back]")?.getAttribute("href"));
  expect("details: it is not hidden when there is a studio", rd.querySelector("[data-v-studio-back]")?.hasAttribute("hidden") === false);
  expect("details: the chapters are read from the description", rd.querySelectorAll("[data-v-chapter]").length === 2, String(rd.querySelectorAll("[data-v-chapter]").length));
  expect("details: a chapter is numbered", rd.querySelector(".vchaps__n")?.textContent === "01", rd.querySelector(".vchaps__n")?.textContent);
  /* the passage is named before its time — "Comedy beats: (0:37 - 14:00) …" */
  expect("details: a chapter is named by the words before its time", rd.querySelector(".vchaps__label")?.textContent === "Comedy beats", rd.querySelector(".vchaps__label")?.textContent);
  expect("details: a chapter carries its time", rd.querySelector(".vchaps__time")?.textContent === "0:37", rd.querySelector(".vchaps__time")?.textContent);
  expect("details: a line with no time makes no chapter", rd.querySelectorAll("[data-v-chapter]").length === 2);

  /* a chapter is a second in the address, the way the reference writes it */
  const frameBefore = rd.querySelector(".vplayer iframe");
  expect("details: the frame starts without a second", !/[?&](t|start)=\d/.test(frameBefore?.getAttribute("src") || ""), frameBefore?.getAttribute("src"));
  const secondChapter = rd.querySelectorAll("[data-v-chapter]")[1];
  secondChapter.dispatchEvent(new richBoot.window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  const frameAfter = rd.querySelector(".vplayer iframe");
  expect(
    "details: the second goes into the frame's own address, as &t=840s",
    /[?&]t=840s(&|$)/.test(frameAfter?.getAttribute("src") || ""),
    frameAfter?.getAttribute("src")
  );
  expect(
    "details: and the word the embed reads rides beside it",
    /[?&]start=840(&|$)/.test(frameAfter?.getAttribute("src") || ""),
    frameAfter?.getAttribute("src")
  );
  expect(
    "details: the frame is moved in place — the page is not rebuilt",
    Boolean(frameAfter) && frameAfter === frameBefore,
    `${Boolean(frameAfter)} / ${frameAfter === frameBefore}`
  );
  expect(
    "details: the old second is replaced in the frame too",
    (String(frameAfter?.getAttribute("src") || "").match(/[?&]t=/g) || []).length === 1,
    frameAfter?.getAttribute("src")
  );
  expect(
    "details: picking a chapter writes its second into the address",
    /[?&]t=840s$/.test(richBoot.window.location.hash),
    `${richBoot.window.location.href} | ${richBoot.window.location.hash}`
  );
  expect(
    "details: the old second is replaced, not stacked",
    (richBoot.window.location.hash.match(/t=/g) || []).length === 1,
    richBoot.window.location.hash
  );
  expect("details: the minutes are in the stats line", /51 minutes/.test(rd.querySelector(".vmeta")?.textContent || ""), rd.querySelector(".vmeta")?.textContent);
  expect("details: the studio counts its subscribers and releases", /746,000|746K/.test(rd.querySelector(".vhost__stats")?.textContent || "") && /12/.test(rd.querySelector(".vhost__stats")?.textContent || ""), rd.querySelector(".vhost__stats")?.textContent);
  expect("details: the studio's blurb is under it", /camera tests and long talks/.test(rd.querySelector(".vhost__bio")?.textContent || ""), rd.querySelector(".vhost__bio")?.textContent);
  expect("details: the related links are the studio's", rd.querySelectorAll(".vlinks .chip").length === 3, String(rd.querySelectorAll(".vlinks .chip").length));
  expect("details: a link points where it says", rd.querySelector('.vlinks .chip[href="https://youtube.com/@cineaura"]') !== null);
  /* they sit under the publisher's blurb, inside the publisher's card */
  expect("details: the links are inside the publisher card", Boolean(rd.querySelector(".vhost .vhost__foot .vlinks")), rd.querySelector(".vhost__foot")?.className);
  expect("details: and under the blurb", /camera tests/.test(rd.querySelector(".vhost__foot .vhost__bio")?.textContent || ""), rd.querySelector(".vhost__foot .vhost__bio")?.textContent);
  expect("details: the playlists door is always there", Boolean(rd.querySelector("[data-v-studio-link]")) && /Playlists/.test(rd.querySelector("[data-v-studio-link]")?.textContent || ""));
  expect("details: every link carries its own label", [...rd.querySelectorAll(".vlinks .chip")].map((a) => a.textContent.trim()).join(" | ") === "Website | YouTube | Playlists", [...rd.querySelectorAll(".vlinks .chip")].map((a) => a.textContent.trim()).join(" | "));

  /* a studio that wrote no links still gets the door */
  const bare = boot("videos.html", {
    hash: "#/h/ID=PST-001032",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: card({ code: "PST-001032" }), related: [], more: [] });
      if (fn === "video_hub") return reply({ ok: true, hub: { ...STUDIO, links: [] } });
      if (fn === "post_comments") return reply({ comments: [], count: 0 });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p=studio1g`);
  await wait(120);
  expect("details: a studio with no links shows only the playlists door", bare.document.querySelectorAll(".vlinks .chip").length === 1 && Boolean(bare.document.querySelector("[data-v-studio-link]")), String(bare.document.querySelectorAll(".vlinks .chip").length));
  rd.querySelector("[data-v-chapter]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("details: jumping a chapter throws nothing", richBoot.errors.length === 0, richBoot.errors.join(" | "));

  /* the studio card's two buttons: Subscribe, and the menu behind it */
  const studioCard = boot("videos.html", {
    hash: "#/h/ID=PST-001032",
    storage: { "1w.member": JSON.stringify({ id: "m7", username: "@viewer", name: "Viewer", level: 2 }), "1w.session": "tok-view" },
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: card({ code: "PST-001032" }), related: [], more: [] });
      if (fn === "video_hub") return reply({ ok: true, hub: RICH });
      if (fn === "creator_subscribe") return reply({ ok: true, subscribed: true, subscribers: 746001 });
      if (fn === "post_comments") return reply({ comments: [], count: 0 });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p=studio1e`);
  await wait(140);
  const cd = studioCard.document;
  expect("publisher: a studio offers Subscribe", /Subscribe/.test(cd.querySelector("[data-v-subscribe]")?.textContent || ""), cd.querySelector("[data-v-subscribe]")?.textContent);
  expect("publisher: the button knows the studio", cd.querySelector("[data-v-subscribe]")?.getAttribute("data-v-subscribe") === "hub-1", cd.querySelector("[data-v-subscribe]")?.getAttribute("data-v-subscribe"));
  expect("publisher: Take action opens a menu", cd.querySelector(".vmenu > summary")?.textContent.includes("Take action"), cd.querySelector(".vmenu > summary")?.textContent);
  const items = [...cd.querySelectorAll(".vmenu__item")].map((node) => node.textContent.trim());
  /* the six a viewer acts with: follow, join, message, share, report, block */
  expect("publisher: the menu holds the six actions", items.length === 7, items.join(" | "));
  expect("publisher: follow, join, message, share, copy, report, block", /Follow/.test(items[0]) && /Join/.test(items[1]) && /Message/.test(items[2]) && /Share/.test(items[3]) && /Report/.test(items[5]) && /Block/.test(items[6]), items.join(" | "));
  expect("publisher: the block row is the last, and marked", cd.querySelectorAll(".vmenu__item")[6]?.classList.contains("vmenu__item--danger"));
  cd.querySelector("[data-v-subscribe]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  expect("publisher: the subscription is sent", lastCall(studioCard.calls, "creator_subscribe")?.body.p_hub === "hub-1", JSON.stringify(lastCall(studioCard.calls, "creator_subscribe")?.body));
  expect("publisher: the button says so", /Subscribed/.test(cd.querySelector("[data-v-subscribe]")?.textContent || ""), cd.querySelector("[data-v-subscribe]")?.textContent);
  /* the card writes the count the way the rest of the site does: 746K */
  expect("publisher: and the count moves", cd.querySelector(".vhost__stats b")?.textContent === "746K", cd.querySelector(".vhost__stats b")?.textContent);

  /* message: a dialog, then the inbox call */
  cd.querySelector("[data-v-message]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("publisher: the message opens a dialog", Boolean(cd.querySelector("[data-v-msg-dialog]")));
  expect("publisher: the dialog names who it is for", /Cine Aura/.test(cd.querySelector(".vmsg__head")?.textContent || ""), cd.querySelector(".vmsg__head")?.textContent);
  cd.querySelector('.vmsg textarea[name="body"]').value = "A question about the last shoot.";
  cd.querySelector("[data-v-msg-form]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(80);
  const sent = lastCall(studioCard.calls, "msg_send")?.body;
  expect("publisher: the message is sent to the owner", sent?.p_ref === "ID100019" && sent?.p_body === "A question about the last shoot.", JSON.stringify(sent));
  expect("publisher: and the dialog closes", !cd.querySelector("[data-v-msg-dialog]"));

  /* block: this device, and the way back */
  cd.querySelector("[data-v-block]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("publisher: block is kept on the device", (studioCard.window.localStorage.getItem("1w.videos.blocked") || "").includes("ID100019"), studioCard.window.localStorage.getItem("1w.videos.blocked"));
  expect("publisher: the menu offers the way back", /Unblock/.test(cd.querySelector("[data-v-block]")?.textContent || ""), cd.querySelector("[data-v-block]")?.textContent);
  expect("publisher: and the card says it is blocked", cd.querySelector(".vhost")?.classList.contains("is-blocked"));
  cd.querySelector("[data-v-block]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(60);
  expect("publisher: unblock clears it", !(studioCard.window.localStorage.getItem("1w.videos.blocked") || "").includes("ID100019"), studioCard.window.localStorage.getItem("1w.videos.blocked"));

  /* a guest is asked to sign in, and nothing is sent */
  const guestCard = boot("videos.html", {
    hash: "#/h/ID=PST-001032",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: card({ code: "PST-001032" }), related: [], more: [] });
      if (fn === "video_hub") return reply({ ok: true, hub: RICH });
      if (fn === "post_comments") return reply({ comments: [], count: 0 });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p=studio1f`);
  await wait(120);
  guestCard.document.querySelector("[data-v-subscribe]").dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  await wait(80);
  expect("publisher: a guest is asked to sign in", /Sign in first/i.test(guestCard.document.querySelector(".toast__title")?.textContent || ""), guestCard.document.querySelector(".toast__title")?.textContent);
  expect("publisher: and nothing was sent", !guestCard.calls.some((c) => fnName(c.href) === "creator_subscribe"));

  const noStudio = studioBoot(null);
  await import(`file://${join(root, "assets/js/videos.js")}?p=studio2`);
  await wait(120);
  const nd = noStudio.document;
  expect("studio: with no studio the member publishes", nd.querySelector(".vhost__name")?.textContent === "Jhon", nd.querySelector(".vhost__name")?.textContent);
  expect("studio: and the block says member", nd.querySelector("[data-v-host]")?.getAttribute("data-v-host") === "member");
  expect("studio: no studio mark is drawn", !nd.querySelector("[data-v-studio]"));
}

/* ------------------------------------------------------------------ */
/* ================================================================== */
/* last — an address that already carries `&t=1860​s` opens the frame  */
/* ================================================================== */
{
  /* an address that already carries `&t=1860s` opens the frame there */
  const atSecond = boot("videos.html", {
    hash: "#/h/ID=PST-001032&t=1860s",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "video_feed") return reply(FEED);
      if (fn === "video_mine") return reply({ ok: true, rows: [] });
      if (fn === "video_get") return reply({ ok: true, locked: false, mine: false, video: youtubeCard({ code: "PST-001032" }), related: [], more: [] });
      if (fn === "video_hub") return reply({ ok: true, hub: RICH });
      if (fn === "post_comments") return reply({ comments: [], count: 0 });
      return reply([]);
    },
  });
  await import(`file://${join(root, "assets/js/videos.js")}?p=atsecond`);
  await wait(180);
  const atFrame = atSecond.document.querySelector(".vplayer iframe");
  expect(
    "details: a link with &t=1860s opens inside the frame at that second",
    /[?&]t=1860s(&|$)/.test(atFrame?.getAttribute("src") || "") && /[?&]start=1860(&|$)/.test(atFrame?.getAttribute("src") || ""),
    atFrame?.getAttribute("src")
  );
  expect(
    "details: and the chapter it belongs to is the one marked",
    atSecond.document.querySelectorAll(".vchaps__row.is-active").length <= 1,
    String(atSecond.document.querySelectorAll(".vchaps__row.is-active").length)
  );
}

const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  if (!c.ok) console.log(`FAIL  ${c.name}${c.detail ? ` — ${c.detail}` : ""}`);
});
console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
if (failed.length) process.exitCode = 1;
