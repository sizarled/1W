/**
 * Blog page smoke test — one blog as a reader meets it (blog.html).
 *
 *   node tools/blog-smoke.mjs
 *
 * Pass 1 — the address: no blog named, a name that is not a blog, a closed
 *          blog, the wrong password and the right one.
 * Pass 2 — the blog itself: its cover, its mark, its name, its words, its
 *          sections as chips, and the numbers under it.
 * Pass 3 — the home: most read, one row per section, the sections to walk
 *          into, and the links that carry the section's own filter.
 * Pass 4 — a section opened by the address, its sort, and its More button.
 * Pass 5 — the search: a word, the results, nothing found, and Clear.
 * Pass 6 — the clothes: every class the page and its script wear is defined.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const checks = [];
const expect = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail: String(detail) });
const strip = (file) =>
  readFileSync(join(root, file), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const css =
  readFileSync(join(root, "assets/css/blog.css"), "utf8") +
  readFileSync(join(root, "assets/css/article.css"), "utf8");
const html = readFileSync(join(root, "blog.html"), "utf8");
const js = readFileSync(join(root, "assets/js/blog.js"), "utf8");
const wait = (ms = 60) => new Promise((r) => setTimeout(r, ms));

const reply = (data, ok = true) =>
  Promise.resolve({ ok, status: ok ? 200 : 400, json: async () => data, text: async () => JSON.stringify(data) });

/* ------------------------------------------------------------------ */
/* fixtures                                                           */
/* ------------------------------------------------------------------ */
const HUB = {
  id: "d00fc163-3f29-4d06-adbd-b987b2ec7bda",
  code: "IDBL100003",
  kind: "blog",
  name: "Cine Aura",
  description: "Long pieces about films, the people who make them, and the nights they are watched.",
  logo_url: "https://example.com/logo.png",
  cover_url: "https://example.com/cover.jpg",
  owner: "ID100019",
  owner_username: "@ledsizar7",
  role: "visitor",
  visibility: "public",
};

function card(over = {}) {
  return {
    id: "aaaaaaaa-1111-4111-8111-111111111111",
    code: "PST-001015",
    type: "article",
    title: "The long take is not a flex",
    description: "A four-minute unbroken shot is not automatically four minutes of meaning.",
    thumbnail: "https://example.com/cover.jpg",
    language: "en",
    visibility: "general",
    status: "published",
    published_at: new Date(Date.now() - 7200_000).toISOString(),
    read_minutes: 3,
    word_count: 476,
    author: { name: "El Mehdi", username: "@ledsizar" },
    counters: { impressions: 1240, likes: 12, comments: 4 },
    article: { field: "Cinema", category: "Craft", words: 476, reading: 3, meta: {} },
    ...over,
  };
}

const SECTIONS = [
  { name: "Cinema", by: "field", count: 3 },
  { name: "Series", by: "field", count: 2 },
  { name: "Technology", by: "field", count: 1 },
];

const PAGE = {
  ok: true,
  locked: false,
  hub: HUB,
  sections: SECTIONS,
  stats: { articles: 6, writers: 3, reads: 4200, comments: 18 },
};

const ROWS = [
  card({ code: "PST-001016", title: "A night at the projection booth" }),
  card({ code: "PST-001017", title: "Why the cut is the story", article: { field: "Cinema", category: "Editing", reading: 4 } }),
  card({ code: "PST-001018", title: "Six episodes, one arc", article: { field: "Series", category: "Craft", reading: 5 } }),
];

/* ------------------------------------------------------------------ */
/* the harness                                                        */
/* ------------------------------------------------------------------ */
function boot({ search = "", storage = {}, fetchImpl } = {}) {
  const dom = new JSDOM(strip("blog.html"), { url: `http://localhost/blog.html${search}`, pretendToBeVisual: true });
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
  return { window, document: window.document, calls, errors };
}

const fnName = (href) => String(href).split("/rpc/")[1] || "";
const lastCall = (calls, fn) => [...calls].reverse().find((c) => fnName(c.href) === fn);
let pass = 0;
const importPage = async () => import(`file://${join(root, "assets/js/blog.js")}?p=${++pass}`);

/* ================================================================== */
/* pass 1 — the address                                               */
/* ================================================================== */
{
  const bare = boot({ fetchImpl: () => reply({}) });
  await importPage();
  await wait(60);
  expect("address: no studio says so", /No blog named/.test(bare.document.querySelector("[data-b-state]")?.textContent || ""), bare.document.querySelector("[data-b-state]")?.textContent);
  expect("address: and never calls the server", bare.calls.length === 0, bare.calls.length);
  expect("address: the shell stays shut", bare.document.querySelector("[data-b-shell]")?.hidden === true);

  const other = boot({
    search: "?studio=IDST100001",
    fetchImpl: (href) => (fnName(href) === "blog_page" ? reply({ ok: false, error: "hub_kind", kind: "channel" }) : reply([])),
  });
  await importPage();
  await wait(60);
  expect("address: another kind of hub is named", /That is not a blog/.test(other.document.querySelector("[data-b-state]")?.textContent || ""), other.document.querySelector("[data-b-state]")?.textContent);

  const gone = boot({
    search: "?studio=IDBL999999",
    fetchImpl: (href) => (fnName(href) === "blog_page" ? reply({ ok: false, error: "not_found" }) : reply([])),
  });
  await importPage();
  await wait(60);
  expect("address: an unknown blog says so", /No blog at this address/.test(gone.document.querySelector("[data-b-state]")?.textContent || ""), gone.document.querySelector("[data-b-state]")?.textContent);

  /* the closed door */
  const lockedPage = { ok: true, locked: true, has_password: true, hub: HUB, sections: [], stats: { articles: 0, writers: 0, reads: 0, comments: 0 } };
  const closed = boot({
    search: "?studio=IDBL100003",
    fetchImpl: (href) => (fnName(href) === "blog_page" ? reply(lockedPage) : reply({ ok: true, rows: [], total: 0 })),
  });
  await importPage();
  await wait(60);
  const lockText = closed.document.querySelector("[data-b-state]")?.textContent || "";
  expect("door: a private blog says it is private", /This blog is private/.test(lockText), lockText);
  expect("door: with a password field", Boolean(closed.document.querySelector("[data-b-key]")));
  expect("door: and the shell stays shut", closed.document.querySelector("[data-b-shell]")?.hidden === true);

  /* the wrong password, then the right one */
  let attempt = 0;
  const keyed = boot({
    search: "?studio=IDBL100003",
    fetchImpl: (href) => {
      if (fnName(href) !== "blog_page") return reply({ ok: true, rows: [], total: 0 });
      attempt += 1;
      return reply(attempt === 1 ? lockedPage : PAGE);
    },
  });
  await importPage();
  await wait(60);
  const field = keyed.document.querySelector("[data-b-key]");
  field.value = "open-sesame";
  keyed.document.querySelector("[data-b-key-form]").dispatchEvent(new keyed.window.Event("submit", { bubbles: true, cancelable: true }));
  await wait(140);
  expect("door: the password travels to the server", lastCall(keyed.calls, "blog_page")?.body?.p_password === "open-sesame", JSON.stringify(lastCall(keyed.calls, "blog_page")?.body));
  expect("door: the right one opens the blog", keyed.document.querySelector("[data-b-shell]")?.hidden === false);
  expect("door: and the hero is there", /Cine Aura/.test(keyed.document.querySelector("[data-b-name]")?.textContent || ""), keyed.document.querySelector("[data-b-name]")?.textContent);
  expect("door: the key is kept in the address", /key=open-sesame/.test(String(globalThis.location.search)), String(globalThis.location.search));
}

/* ================================================================== */
/* pass 2 — the blog itself                                           */
/* ================================================================== */
{
  const w = boot({
    search: "?studio=IDBL100003",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "blog_page") return reply(PAGE);
      if (fn === "blog_feed") return reply({ ok: true, rows: ROWS, total: ROWS.length });
      return reply([]);
    },
  });
  const { document, calls, errors } = w;
  await importPage();
  await wait(220);

  expect("blog: the shell is open", document.querySelector("[data-b-shell]")?.hidden === false);
  expect("blog: the cover is the hub's", document.querySelector("[data-b-cover]")?.getAttribute("src") === HUB.cover_url, document.querySelector("[data-b-cover]")?.getAttribute("src"));
  expect("blog: the mark is the hub's logo", Boolean(document.querySelector("[data-b-logo] img")));
  expect("blog: the name is the hub's", document.querySelector("[data-b-name]")?.textContent === "Cine Aura", document.querySelector("[data-b-name]")?.textContent);
  expect("blog: the words are the hub's", (document.querySelector("[data-b-desc]")?.textContent || "").includes("Long pieces"), document.querySelector("[data-b-desc]")?.textContent);
  expect("blog: the kind and the code are named", /Blog · IDBL100003/.test(document.querySelector("[data-b-kind]")?.textContent || ""), document.querySelector("[data-b-kind]")?.textContent);
  expect("blog: the owner is named", /@ledsizar7/.test(document.querySelector("[data-b-owner]")?.textContent || ""), document.querySelector("[data-b-owner]")?.textContent);
  expect("blog: a section is a chip", document.querySelectorAll("[data-b-tag]").length === 3, document.querySelectorAll("[data-b-tag]").length);
  expect(
    "blog: a chip carries its own filter",
    (document.querySelector("[data-b-tag]")?.getAttribute("href") || "").includes("section=Cinema") && (document.querySelector("[data-b-tag]")?.getAttribute("href") || "").includes("by=field"),
    document.querySelector("[data-b-tag]")?.getAttribute("href")
  );
  expect("blog: the numbers are spoken", document.querySelectorAll(".bstat").length === 4, document.querySelectorAll(".bstat").length);
  expect("blog: the articles are counted", /6/.test(document.querySelector("[data-b-stats]")?.textContent || ""), document.querySelector("[data-b-stats]")?.textContent);
  expect("blog: the page is titled after the blog", document.title === "Cine Aura — 1World Web", document.title);
  expect("blog: the studio link points at the hub", document.querySelector("[data-b-studio]")?.getAttribute("href") === "creator.html?studio=IDBL100003", document.querySelector("[data-b-studio]")?.getAttribute("href"));
  expect("blog: the first call names the blog", lastCall(calls, "blog_page")?.body?.p_ref === "IDBL100003");
  expect("blog: nothing threw", errors.length === 0, errors.join(" | "));
}

/* ================================================================== */
/* pass 3 — the home                                                  */
/* ================================================================== */
{
  const w = boot({
    search: "?studio=IDBL100003",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "blog_page") return reply(PAGE);
      if (fn === "blog_feed") return reply({ ok: true, rows: ROWS, total: 12 });
      return reply([]);
    },
  });
  const { document, calls } = w;
  await importPage();
  await wait(260);

  expect("home: most read is shown", document.querySelector("[data-b-popular]")?.hidden === false);
  expect("home: its rail carries cards", document.querySelectorAll("[data-b-popular-rail] .acard").length === 3, document.querySelectorAll("[data-b-popular-rail] .acard").length);
  expect("home: a row per section", document.querySelectorAll("[data-b-row]").length === 3, document.querySelectorAll("[data-b-row]").length);
  expect("home: a row is named after its section", /Cinema/.test(document.querySelector("[data-b-row]")?.textContent || ""), document.querySelector("[data-b-row]")?.textContent);
  expect("home: a row links into its section", (document.querySelector("[data-b-into]")?.getAttribute("href") || "").includes("section=Cinema"), document.querySelector("[data-b-into]")?.getAttribute("href"));
  expect("home: the sections are cards", document.querySelectorAll("[data-b-sec]").length === 3, document.querySelectorAll("[data-b-sec]").length);
  expect("home: a section counts its pieces", /3 pieces/.test(document.querySelector("[data-b-sec]")?.textContent || ""), document.querySelector("[data-b-sec]")?.textContent);
  expect("home: each section asks for its own filter", calls.filter((c) => fnName(c.href) === "blog_feed" && c.body.p_section === "Cinema" && c.body.p_by === "field").length >= 1, JSON.stringify(calls.filter((c) => fnName(c.href) === "blog_feed").map((c) => c.body.p_section)));
  expect("home: the whole blog is asked for most read", calls.filter((c) => fnName(c.href) === "blog_feed" && !c.body.p_section).length === 1, calls.filter((c) => fnName(c.href) === "blog_feed" && !c.body.p_section).length);
  expect("home: a card opens the reader", (document.querySelector("[data-b-popular-rail] .acard")?.getAttribute("href") || "").startsWith("article.html?id="), document.querySelector("[data-b-popular-rail] .acard")?.getAttribute("href"));
  expect("home: a card carries its reading time", /min/.test(document.querySelector("[data-b-popular-rail] .acard")?.textContent || ""));
  expect("home: and its reads", /reads/.test(document.querySelector("[data-b-popular-rail] .acard")?.textContent || ""));
}

/* ================================================================== */
/* pass 4 — a section opened by the address                           */
/* ================================================================== */
{
  const w = boot({
    search: "?studio=IDBL100003&section=Cinema&by=field",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "blog_page") return reply(PAGE);
      if (fn === "blog_feed") return reply({ ok: true, rows: ROWS, total: 24 });
      return reply([]);
    },
  });
  const { document, calls } = w;
  await importPage();
  await wait(220);

  expect("section: the home steps aside", document.querySelector("[data-b-home]")?.hidden === true);
  expect("section: the section is shown", document.querySelector("[data-b-section]")?.hidden === false);
  expect("section: it is named", document.querySelector("[data-b-section-name]")?.textContent === "Cinema", document.querySelector("[data-b-section-name]")?.textContent);
  expect("section: its pieces are counted", /24 pieces/.test(document.querySelector("[data-b-section-count]")?.textContent || ""), document.querySelector("[data-b-section-count]")?.textContent);
  const asked = calls.filter((c) => fnName(c.href) === "blog_feed").pop();
  expect("section: the feed carries the section and its filter", asked?.body.p_section === "Cinema" && asked?.body.p_by === "field", JSON.stringify(asked?.body));
  expect("section: the grid is drawn", document.querySelectorAll("[data-b-grid] .acard").length === 3, document.querySelectorAll("[data-b-grid] .acard").length);
  expect("section: More is offered when there is more", document.querySelector("[data-b-more]")?.hidden === false);

  /* the sort */
  document.querySelector('[data-b-sort] [data-sort="new"]').dispatchEvent(new w.window.MouseEvent("click", { bubbles: true }));
  await wait(160);
  const sorted = calls.filter((c) => fnName(c.href) === "blog_feed").pop();
  expect("section: the sort reaches the server", sorted?.body.p_sort === "new", sorted?.body.p_sort);
  expect("section: the pressed sort is marked", document.querySelector('[data-b-sort] [data-sort="new"]')?.classList.contains("is-active"));

  /* More */
  const before = document.querySelectorAll("[data-b-grid] .acard").length;
  document.querySelector("[data-b-more]").dispatchEvent(new w.window.MouseEvent("click", { bubbles: true }));
  await wait(160);
  const paged = calls.filter((c) => fnName(c.href) === "blog_feed").pop();
  expect("section: More asks for the next page", paged?.body.p_offset === before, paged?.body.p_offset);
  expect("section: and the grid grows", document.querySelectorAll("[data-b-grid] .acard").length > before, document.querySelectorAll("[data-b-grid] .acard").length);

  /* back */
  document.querySelector("[data-b-back]").dispatchEvent(new w.window.MouseEvent("click", { bubbles: true }));
  await wait(200);
  expect("section: Back returns to the home", document.querySelector("[data-b-home]")?.hidden === false && document.querySelector("[data-b-section]")?.hidden === true);
  expect("section: and the address forgets it", !/section=/.test(String(globalThis.location.search)), String(globalThis.location.search));
}

/* ================================================================== */
/* pass 5 — the search                                                */
/* ================================================================== */
{
  let found = [];
  const w = boot({
    search: "?studio=IDBL100003",
    fetchImpl: (href) => {
      const fn = fnName(href);
      if (fn === "blog_page") return reply(PAGE);
      if (fn === "blog_feed") return reply({ ok: true, rows: found, total: found.length });
      return reply([]);
    },
  });
  const { document, calls } = w;
  await importPage();
  await wait(240);

  found = [ROWS[0]];
  const q = document.querySelector("[data-b-q]");
  q.value = "projection";
  q.dispatchEvent(new w.window.Event("input", { bubbles: true }));
  await wait(420);

  expect("search: the word reaches the server", calls.filter((c) => fnName(c.href) === "blog_feed" && c.body.p_search === "projection").length === 1, JSON.stringify(calls.filter((c) => fnName(c.href) === "blog_feed").map((c) => c.body.p_search)));
  expect("search: the results are shown", document.querySelector("[data-b-found]")?.hidden === false);
  expect("search: the home steps aside", document.querySelector("[data-b-home]")?.hidden === true);
  expect("search: the word is spoken back", /projection/.test(document.querySelector("[data-b-found-title]")?.textContent || ""), document.querySelector("[data-b-found-title]")?.textContent);
  expect("search: a result is a card", document.querySelectorAll("[data-b-found-grid] .acard").length === 1, document.querySelectorAll("[data-b-found-grid] .acard").length);
  expect("search: the address carries it", /q=projection/.test(String(globalThis.location.search)), String(globalThis.location.search));
  expect("search: Clear is offered", document.querySelector("[data-b-clear]")?.hidden === false);

  found = [];
  q.value = "nothing at all";
  q.dispatchEvent(new w.window.Event("input", { bubbles: true }));
  await wait(420);
  expect("search: nothing found says so", document.querySelector("[data-b-found-empty]")?.hidden === false);
  expect("search: and the grid is empty", document.querySelectorAll("[data-b-found-grid] .acard").length === 0);

  document.querySelector("[data-b-clear]").dispatchEvent(new w.window.MouseEvent("click", { bubbles: true }));
  await wait(260);
  expect("search: Clear brings the home back", document.querySelector("[data-b-home]")?.hidden === false && document.querySelector("[data-b-found]")?.hidden === true);
  expect("search: and the box is empty", document.querySelector("[data-b-q]")?.value === "");
  expect("search: the address is clean", !/q=/.test(String(globalThis.location.search)), String(globalThis.location.search));
  expect("search: nothing threw", w.errors.length === 0, w.errors.join(" | "));
}

/* ================================================================== */
/* pass 6 — the clothes                                               */
/* ================================================================== */
{
  const shared =
    readFileSync(join(root, "assets/css/base.css"), "utf8") +
    readFileSync(join(root, "assets/css/layout.css"), "utf8") +
    readFileSync(join(root, "assets/css/components.css"), "utf8");
  const defined = new Set([...`${css}${shared}`.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)].map((m) => m[1]));
  const worn = new Set();
  for (const source of [js, html]) {
    for (const match of source.matchAll(/class="([^"$]*)(?:[^"]*)"/g)) {
      match[1]
        .split(/\s+/)
        .filter(Boolean)
        .forEach((cls) => worn.add(cls));
    }
  }
  const missing = [...worn].filter((cls) => !defined.has(cls));
  expect("sheet: every class worn is defined", missing.length === 0, missing.join(" "));

  expect("page: it loads its own script", /assets\/js\/blog\.js\?v=/.test(html));
  expect("page: it wears the site's shell", html.includes("data-site-header") && html.includes("data-site-sidebar"));
  expect("page: it carries the site's cards", html.includes("article.css"));
  expect("script: it asks the blog's own two calls", js.includes('"blog_page"') && js.includes('"blog_feed"'));
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
