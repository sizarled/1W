/**
 * creator.html smoke test (jsdom, no network).
 *
 *   node tools/creator-smoke.mjs
 *
 * Pass 1 — no session: the page asks for a sign-in and never calls the server.
 * Pass 2 — an empty account: every kind is offered, an article saves itself as
 *          a draft while the member types, publishing says what it is missing,
 *          publishing lands when the body is long enough, switching to a video
 *          asks for a media link, and the item deletes.
 * Pass 3 — an account with work in it: the newest item opens, the list switches
 *          the editor, an inactive membership blocks publishing and says so,
 *          and the search narrows the list.
 * Pass 4 — deep links: `?kind=` opens the right form, `?id=` on a missing item
 *          says so without breaking the page, and a filtered list explains an
 *          empty result.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "creator.html"), "utf8").replace(
  /<script[^>]*src="[^"]*"[^>]*><\/script>/g,
  ""
);

const TOKEN = "c".repeat(64);
const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  status: "active",
};

const MEDIA_KINDS = ["video", "podcast", "image", "document"];
const TEXT_KINDS = ["article", "post"];
const KINDS = ["video", "article", "podcast", "image", "document", "post"];

const NOW = Date.now();
const LONG_BODY =
  "Marrakesh wakes early. The souks open one by one, the light moves across the ochre walls, and by noon the whole square is gold.";

const calls = [];
let scenario = {};

const words = (text = "") =>
  String(text || "")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
const minutesOf = (text) => (words(text) ? Math.ceil(words(text) / 200) : 0);

function reply(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

function listRow(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    status: row.status,
    visibility: row.visibility,
    language: row.language,
    age_rating: row.age_rating,
    tags: row.tags,
    words: row.word_count,
    minutes: row.minutes,
    views: row.views,
    likes: row.likes,
    published_at: row.published_at,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

function saved(row) {
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    summary: row.summary,
    status: row.status,
    visibility: row.visibility,
    words: row.word_count,
    minutes: row.minutes,
    published_at: row.published_at,
    updated_at: row.updated_at,
  };
}

function stubFetch(url, opts = {}) {
  const href = String(url);
  calls.push(href);
  const body = opts.body ? JSON.parse(opts.body) : {};
  const rows = scenario.rows || [];

  if (href.includes("/rpc/member_content_list")) {
    const mine = rows.filter((row) => row.member !== "other");
    return reply({
      ok: true,
      rows: mine.map(listRow),
      counts: {
        all: mine.length,
        draft: mine.filter((row) => row.status === "draft").length,
        published: mine.filter((row) => row.status === "published").length,
        views: mine.reduce((sum, row) => sum + (row.views || 0), 0),
        likes: mine.reduce((sum, row) => sum + (row.likes || 0), 0),
      },
    });
  }

  if (href.includes("/rpc/member_content_get")) {
    const row = rows.find((entry) => entry.id === body.p_id);
    if (!row) return reply({ ok: false, error: "not_found" });
    const { member, ...rest } = row;
    return reply({ ok: true, row: rest });
  }

  if (href.includes("/rpc/member_content_save")) {
    if (scenario.saveError) return reply({ ok: false, error: scenario.saveError });
    const kind = String(body.p_kind || "");
    const title = String(body.p_title || "").trim();
    const publish = Boolean(body.p_publish);
    if (!KINDS.includes(kind)) return reply({ ok: false, error: "kind" });
    if (title.length > 140) return reply({ ok: false, error: "title" });
    if (publish) {
      if (title.length < 3) return reply({ ok: false, error: "title" });
      if (scenario.status && scenario.status !== "active") return reply({ ok: false, error: "inactive" });
      if (MEDIA_KINDS.includes(kind) && !String(body.p_media_url || "").trim())
        return reply({ ok: false, error: "media" });
      if (TEXT_KINDS.includes(kind) && words(body.p_body) < 12) return reply({ ok: false, error: "body" });
    }
    const id = body.p_id || `item-${rows.length + 1}-${Math.random().toString(16).slice(2, 6)}`;
    const existing = rows.find((entry) => entry.id === id);
    const row = {
      id,
      member: MEMBER.id,
      kind,
      title,
      summary: String(body.p_summary || ""),
      body: String(body.p_body || ""),
      media_url: String(body.p_media_url || ""),
      cover_url: String(body.p_cover_url || ""),
      tags: body.p_tags || [],
      language: body.p_language || "en",
      age_rating: body.p_age || "none",
      visibility: body.p_visibility || "public",
      status: publish ? "published" : existing ? existing.status : "draft",
      word_count: words(body.p_body),
      minutes: minutesOf(body.p_body),
      views: existing ? existing.views : 0,
      likes: existing ? existing.likes : 0,
      created_at: existing ? existing.created_at : new Date(NOW).toISOString(),
      updated_at: new Date(NOW + calls.length).toISOString(),
      published_at: publish ? new Date(NOW + calls.length).toISOString() : existing ? existing.published_at : null,
    };
    if (existing) scenario.rows = rows.map((entry) => (entry.id === id ? row : entry));
    else scenario.rows = [row, ...rows];
    return reply({ ok: true, row: saved(row) });
  }

  if (href.includes("/rpc/member_content_delete")) {
    const before = (scenario.rows || []).length;
    scenario.rows = (scenario.rows || []).filter((entry) => entry.id !== body.p_id);
    return reply({ ok: true, removed: scenario.rows.length < before });
  }

  if (href.includes("/rpc/member_logout")) return reply({ ok: true });
  return reply([]);
}

/* creator.js autosaves on a timer. A page that is closed keeps its timer,
   so every boot clears what the previous page left behind. */
const liveTimers = new Set();
const nativeSetTimeout = globalThis.setTimeout;
const nativeClearTimeout = globalThis.clearTimeout;
const nativeSetInterval = globalThis.setInterval;
const nativeClearInterval = globalThis.clearInterval;
globalThis.setTimeout = (fn, ms, ...args) => {
  const id = nativeSetTimeout(
    (...rest) => {
      liveTimers.delete(id);
      fn(...rest);
    },
    ms,
    ...args
  );
  liveTimers.add(id);
  return id;
};
globalThis.clearTimeout = (id) => {
  liveTimers.delete(id);
  nativeClearTimeout(id);
};
globalThis.setInterval = (fn, ms, ...args) => {
  const id = nativeSetInterval(fn, ms, ...args);
  liveTimers.add(id);
  return id;
};
globalThis.clearInterval = (id) => {
  liveTimers.delete(id);
  nativeClearInterval(id);
};
const wait = (ms = 120) => new Promise((r) => nativeSetTimeout(r, ms));

async function boot(pass, { search = "", token = true } = {}) {
  liveTimers.forEach((id) => {
    nativeClearTimeout(id);
    nativeClearInterval(id);
  });
  liveTimers.clear();

  const url = `http://localhost/creator.html${search}`;
  const dom = new JSDOM(html, { url, pretendToBeVisual: true });
  const { window } = dom;
  const errors = [];
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.history = window.history;
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.FormData = window.FormData;
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
  window.matchMedia = globalThis.matchMedia;
  globalThis.Audio = window.Audio = class {
    constructor() {
      this.volume = 1;
    }
    play() {
      return Promise.resolve();
    }
    pause() {}
    addEventListener() {}
  };
  Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });
  globalThis.location = {
    search,
    hash: "",
    href: url,
    protocol: "http:",
    pathname: "/creator.html",
    reload() {},
    replace() {},
  };
  globalThis.fetch = stubFetch;
  window.scrollTo = () => {};
  window.open = () => null;
  window.confirm = () => true;

  window.localStorage.clear();
  if (token) window.localStorage.setItem("1w.session", TOKEN);
  window.localStorage.setItem(
    "1w.member",
    JSON.stringify({ ...MEMBER, status: scenario.status || "active", account_status: scenario.status || "active" })
  );

  await import(`file://${join(root, "assets/js/creator.js")}?pass=${pass}`);
  await wait(200);

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (node) => node && node.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const type = (node, value) => {
    node.value = value;
    node.dispatchEvent(new window.Event("input", { bubbles: true }));
  };
  const change = (node, value) => {
    node.value = value;
    node.dispatchEvent(new window.Event("change", { bubbles: true }));
  };
  const hidden = (sel) => {
    const node = qs(sel);
    return !node || node.hidden === true || node.style.display === "none";
  };
  return { window, document: window.document, qs, qsa, text, click, type, change, hidden, wait, errors };
}

/* ------------------------------------------------------------------ */
/* checks                                                              */
/* ------------------------------------------------------------------ */
const checks = [];
function expect(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
}

async function main() {
  /* ---------------------------------------------------------------- */
  /* pass 1 — no session                                              */
  /* ---------------------------------------------------------------- */
  scenario = { status: "active", rows: [] };
  calls.length = 0;
  const anon = await boot(1, { token: false });
  expect("no session: the page asks for a sign-in", /Sign in to write/i.test(anon.text("[data-cr-state]")));
  expect("no session: the sign-in link is there", Boolean(anon.qs('[data-cr-state] a[href="login.html"]')));
  expect("no session: the editor stays hidden", anon.hidden("[data-cr-root]"));
  expect("no session: the server is never called", !calls.some((c) => c.includes("member_content_")), calls.join(" "));
  expect("no session: no errors", anon.errors.length === 0, anon.errors.join(" | "));
  anon.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 2 — an empty account writes, publishes and deletes          */
  /* ---------------------------------------------------------------- */
  scenario = { status: "active", rows: [] };
  calls.length = 0;
  const p = await boot(2);
  expect("empty: the editor is shown", !p.hidden("[data-cr-root]"));
  expect("empty: every kind is offered", p.qsa("[data-cr-start-kind]").length === 6, String(p.qsa("[data-cr-start-kind]").length));
  expect("empty: the list says it is empty", /Nothing written yet/i.test(p.text("[data-cr-list]")));
  expect("empty: the numbers start at zero", p.text('[data-cr-count="all"]') === "0");
  expect("empty: the limit is stated", /of 200 items/.test(p.text("[data-cr-limits]")));

  p.click(p.qs('[data-cr-start-kind="article"]'));
  await p.wait(60);
  expect("new article: the title field exists", Boolean(p.qs("[data-cr-title]")));
  expect("new article: no media field for an article", !p.qs("[data-cr-media]"));
  expect("new article: the body field exists", Boolean(p.qs("[data-cr-body]")));
  expect("new article: six kind switches", p.qsa("[data-cr-kind]").length === 6);

  p.type(p.qs("[data-cr-title]"), "A morning in Marrakesh");
  p.type(p.qs("[data-cr-body]"), "the souks open early");
  expect("typing: the state says unsaved", /Unsaved changes/i.test(p.text("[data-cr-save-text]")));
  expect("typing: the counter follows", /4 words/.test(p.text("[data-cr-words]")), p.text("[data-cr-words]"));
  expect("typing: the gate says what is missing", /more words/i.test(p.text("[data-cr-gate-text]")));

  await p.wait(1700);
  const autosaves = calls.filter((c) => c.includes("member_content_save"));
  expect("autosave: the draft is sent", autosaves.length === 1, String(autosaves.length));
  expect("autosave: saved, not published", /Saved/i.test(p.text("[data-cr-save-text]")), p.text("[data-cr-save-text]"));
  expect("autosave: the item lands in the list", p.qsa("[data-cr-select]").length === 1);
  expect("autosave: the list marks it a draft", /Draft/i.test(p.text("[data-cr-list]")));
  expect("autosave: items counts one", p.text('[data-cr-count="all"]') === "1");
  expect("autosave: drafts counts one", p.text('[data-cr-count="draft"]') === "1");
  expect("autosave: no errors", p.errors.length === 0, p.errors.join(" | "));

  // publishing too early is refused with words the member can act on
  calls.length = 0;
  p.click(p.qs("[data-cr-publish]"));
  await p.wait(220);
  expect("publish early: the call is made", calls.some((c) => c.includes("member_content_save")));
  expect(
    "publish early: the refusal is explained",
    /at least 12 words/i.test(p.text("[data-cr-save-text]")),
    p.text("[data-cr-save-text]")
  );
  expect("publish early: it stayed a draft", /Draft/i.test(p.text("[data-cr-list]")));

  // a long enough body publishes
  p.type(p.qs("[data-cr-body]"), LONG_BODY);
  expect("long body: the gate turns ready", /Ready to publish/i.test(p.text("[data-cr-gate-text]")), p.text("[data-cr-gate-text]"));
  calls.length = 0;
  p.click(p.qs("[data-cr-publish]"));
  await p.wait(260);
  expect("publish: sent as a publish", calls.some((c) => c.includes("member_content_save")));
  expect("publish: the list shows it published", Boolean(p.qs(".cr-chip.is-published")));
  expect("publish: no draft left", p.text('[data-cr-count="draft"]') === "0");
  expect("publish: published counts one", p.text('[data-cr-count="published"]') === "1");
  expect("publish: no errors", p.errors.length === 0, p.errors.join(" | "));

  // a video needs a media link
  p.click(p.qs('[data-cr-kind="video"]'));
  await p.wait(60);
  expect("video: the media field appears", Boolean(p.qs("[data-cr-media]")));
  calls.length = 0;
  p.click(p.qs("[data-cr-publish]"));
  await p.wait(260);
  expect(
    "video: publishing without a link is refused",
    /media link/i.test(p.text("[data-cr-save-text]")),
    p.text("[data-cr-save-text]")
  );

  p.type(p.qs("[data-cr-media]"), "https://example.com/film.mp4");
  calls.length = 0;
  p.click(p.qs("[data-cr-publish]"));
  await p.wait(280);
  expect("video: publishing with a link works", !/could not|needs|Not published/i.test(p.text("[data-cr-save-text]")), p.text("[data-cr-save-text]"));
  expect("video: the kind is on the row", /Video/i.test(p.text("[data-cr-list]")));
  expect("video: no errors", p.errors.length === 0, p.errors.join(" | "));

  // filters
  p.click(p.qs('[data-cr-filter="draft"]'));
  await p.wait(40);
  expect("filter: drafts is empty", /Nothing matches this filter/i.test(p.text("[data-cr-list]")));
  p.click(p.qs('[data-cr-filter="all"]'));
  await p.wait(40);
  expect("filter: all brings it back", p.qsa("[data-cr-select]").length === 1);

  // delete
  calls.length = 0;
  p.click(p.qs("[data-cr-delete]"));
  await p.wait(200);
  expect("delete: the call is made", calls.some((c) => c.includes("member_content_delete")));
  expect("delete: the list empties", /Nothing written yet/i.test(p.text("[data-cr-list]")));
  expect("delete: the editor offers a fresh start", p.qsa("[data-cr-start-kind]").length === 6);
  expect("delete: the numbers reset", p.text('[data-cr-count="all"]') === "0");
  expect("delete: no errors", p.errors.length === 0, p.errors.join(" | "));
  p.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 3 — an account with work, and an inactive membership        */
  /* ---------------------------------------------------------------- */
  scenario = {
    status: "inactive",
    rows: [
      {
        id: "item-a",
        member: MEMBER.id,
        kind: "article",
        title: "The newest piece",
        summary: "kept",
        body: LONG_BODY,
        media_url: "",
        cover_url: "",
        tags: ["marrakesh"],
        language: "en",
        age_rating: "none",
        visibility: "public",
        status: "draft",
        word_count: words(LONG_BODY),
        minutes: 1,
        views: 0,
        likes: 0,
        published_at: null,
        created_at: new Date(NOW - 7200e3).toISOString(),
        updated_at: new Date(NOW - 60e3).toISOString(),
      },
      {
        id: "item-b",
        member: MEMBER.id,
        kind: "podcast",
        title: "An older episode",
        summary: "",
        body: "",
        media_url: "https://example.com/ep.mp3",
        cover_url: "",
        tags: [],
        language: "en",
        age_rating: "none",
        visibility: "public",
        status: "published",
        word_count: 0,
        minutes: 0,
        views: 120,
        likes: 9,
        published_at: new Date(NOW - 864e5).toISOString(),
        created_at: new Date(NOW - 864e5).toISOString(),
        updated_at: new Date(NOW - 864e5).toISOString(),
      },
    ],
  };
  calls.length = 0;
  const q = await boot(3);
  expect("work: the newest item opens", q.qs("[data-cr-title]")?.value === "The newest piece", q.qs("[data-cr-title]")?.value);
  expect("work: its body is loaded", q.qs("[data-cr-body]")?.value === LONG_BODY);
  expect("work: two rows in the list", q.qsa("[data-cr-select]").length === 2);
  expect("work: views come from the server", q.text('[data-cr-count="views"]') === "120", q.text('[data-cr-count="views"]'));
  expect("work: the inactive note is on screen", /not active/i.test(q.text("[data-cr-gate-text]")));
  expect("work: the page is not crashed", q.errors.length === 0, q.errors.join(" | "));

  q.click(q.qsa("[data-cr-select]")[1]);
  await q.wait(200);
  expect("work: the list switches the editor", q.qs("[data-cr-title]")?.value === "An older episode", q.qs("[data-cr-title]")?.value);
  expect("work: a podcast shows the media field", Boolean(q.qs("[data-cr-media]")));
  expect("work: the published row is marked", /Published/i.test(q.text("[data-cr-list]")));

  calls.length = 0;
  q.click(q.qs("[data-cr-publish]"));
  await q.wait(260);
  expect(
    "inactive: publishing is refused",
    /active membership/i.test(q.text("[data-cr-save-text]")),
    q.text("[data-cr-save-text]")
  );
  expect("inactive: it stayed a draft on screen", /Draft/i.test(q.text("[data-cr-list]")));

  q.type(q.qs("[data-cr-search]"), "newest");
  await q.wait(40);
  expect("search: one row survives", q.qsa("[data-cr-select]").length === 1);
  expect("search: it is the right one", /The newest piece/i.test(q.text("[data-cr-list]")));
  q.type(q.qs("[data-cr-search]"), "nothing-like-this");
  await q.wait(40);
  expect("search: an empty result is explained", /Nothing matches this filter/i.test(q.text("[data-cr-list]")));
  expect("search: no errors", q.errors.length === 0, q.errors.join(" | "));
  q.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 4 — deep links                                             */
  /* ---------------------------------------------------------------- */
  scenario = { status: "active", rows: [] };
  const k = await boot(4, { search: "?kind=podcast" });
  expect("deep link: the kind is preselected", /Podcast/i.test(k.text(".cr-kind.is-on")), k.text(".cr-kind.is-on"));
  expect("deep link: a podcast asks for a media link", Boolean(k.qs("[data-cr-media]")));
  expect("deep link: no errors", k.errors.length === 0, k.errors.join(" | "));
  k.window.close();

  scenario = { status: "active", rows: [] };
  const gone = await boot(5, { search: "?id=missing-item" });
  expect("missing id: the member is told", /Not opened/i.test(gone.document.body.textContent));
  expect("missing id: the page still works", Boolean(gone.qs("[data-cr-start-kind]")) || gone.qsa("[data-cr-start-kind]").length === 6);
  expect("missing id: no errors", gone.errors.length === 0, gone.errors.join(" | "));
  gone.window.close();
}

/* ------------------------------------------------------------------ */
/* results                                                             */
/* ------------------------------------------------------------------ */
await main();
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.ok || !c.detail ? "" : ` — ${c.detail}`}`);
});
console.log(`\nchecks: ${checks.length - failed.length}/${checks.length} pass`);
if (failed.length) {
  console.error(`\n${failed.length} failing check(s): ${failed.map((c) => c.name).join(", ")}`);
  process.exit(1);
}
