/**
 * creator.html smoke test (jsdom, no network).
 *
 *   node tools/creator-smoke.mjs
 *
 * Pass 1 — no session: the studio asks for a sign-in and calls nothing.
 * Pass 2 — no hub yet: the rail, the switcher, the empty view, the "add
 *          channel" modal, the settings form (logo, cover, field, niches,
 *          private + password window, staff), save, and delete.
 * Pass 3 — a studio with one of each hub: the videos table and its columns,
 *          the action menu, the item editor (save draft then publish), the
 *          blog tabs (articles vs drafts send different filters), a hub
 *          switch, categories, subscribers, and the Add-content dropdown.
 * Pass 4 — deep links: ?section=library&tab=documents opens there.
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

const TOKEN = "d".repeat(64);
const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  avatar_url: "",
  level: 1,
  status: "active",
};

const NOW = Date.now();

const calls = [];
let scenario = {};

function reply(data) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
}

function hub(over = {}) {
  return {
    id: over.id || `hub-${over.kind || "channel"}`,
    kind: "channel",
    name: "Studio One",
    description: "Films and long talks",
    logo_url: "",
    cover_url: "",
    links: [],
    field: "Cinema",
    niches: ["Documentary"],
    visibility: "public",
    password_until: null,
    locked: false,
    staff: [],
    vip: [],
    status: "active",
    subscribers: 0,
    items: 0,
    published: 0,
    drafts: 0,
    minutes: 0,
    likes: 0,
    dislikes: 0,
    comments: 0,
    shares: 0,
    reports: 0,
    categories: 0,
    created_at: new Date(NOW - 864e5).toISOString(),
    updated_at: new Date(NOW - 36e5).toISOString(),
    owned: true,
    ...over,
  };
}

function item(over = {}) {
  return {
    id: over.id || "item-1",
    code: "CA4728CD",
    kind: "video",
    title: "The first film",
    summary: "a short film",
    status: "published",
    visibility: "public",
    thumbnail: "",
    media_url: "https://example.com/film.mp4",
    category: null,
    category_name: null,
    parent: null,
    parent_title: null,
    micro: "",
    nano: "",
    views: 0,
    minutes: 42,
    likes: 12,
    dislikes: 3,
    comments: 5,
    shares: 1,
    reports: 0,
    downloads: 0,
    answers: 0,
    followers: 0,
    refollows: 0,
    words: 0,
    lines: 0,
    chars: 0,
    published_at: new Date(NOW - 864e5).toISOString(),
    created_at: new Date(NOW - 864e5).toISOString(),
    updated_at: new Date(NOW - 36e5).toISOString(),
    ...over,
  };
}

function stubFetch(url, opts = {}) {
  const href = String(url);
  calls.push(href);
  const body = opts.body ? JSON.parse(opts.body) : {};

  if (href.includes("/rpc/creator_hubs_list")) {
    return reply({
      ok: true,
      level: 1,
      hubs: scenario.hubs || [],
      limits: scenario.limits || {
        channel: { used: 0, limit: 1 },
        blog: { used: 0, limit: 3 },
        space: { used: 0, limit: 2 },
        library: { used: 0, limit: 2 },
        gallery: { used: 0, limit: 2 },
      },
    });
  }

  if (href.includes("/rpc/creator_hub_save")) {
    if (scenario.hubSaveError) return reply({ ok: false, error: scenario.hubSaveError });
    const existing = (scenario.hubs || []).find((entry) => entry.id === body.p_id);
    const saved = hub({
      ...(existing || {}),
      id: body.p_id || `hub-new-${(scenario.hubs || []).length + 1}`,
      kind: body.p_kind,
      name: body.p_name,
      description: body.p_description,
      logo_url: body.p_logo_url,
      cover_url: body.p_cover_url,
      links: body.p_links || [],
      field: body.p_field,
      niches: body.p_niches || [],
      visibility: body.p_visibility,
      staff: body.p_staff || [],
      vip: body.p_vip || [],
      locked: body.p_visibility === "private" && Boolean(body.p_password),
      password_until: body.p_visibility === "private" && body.p_password ? new Date(NOW + 8 * 36e5).toISOString() : null,
      updated_at: new Date(NOW).toISOString(),
    });
    scenario.hubs = existing
      ? (scenario.hubs || []).map((entry) => (entry.id === saved.id ? saved : entry))
      : [...(scenario.hubs || []), saved];
    return reply({ ok: true, hub: saved });
  }

  if (href.includes("/rpc/creator_hub_delete")) {
    scenario.hubs = (scenario.hubs || []).filter((entry) => entry.id !== body.p_id);
    return reply({ ok: true, removed: true });
  }

  if (href.includes("/rpc/creator_items")) {
    const rows = (scenario.items || []).filter(
      (row) =>
        (!body.p_kind || row.kind === body.p_kind) &&
        (!body.p_status || row.status === body.p_status) &&
        (!body.p_search || String(row.title).toLowerCase().includes(String(body.p_search).toLowerCase()))
    );
    return reply({
      ok: true,
      rows,
      counts: { all: rows.length, published: rows.filter((r) => r.status === "published").length, draft: rows.filter((r) => r.status === "draft").length },
    });
  }

  if (href.includes("/rpc/creator_item_get")) {
    const row = (scenario.items || []).find((entry) => entry.id === body.p_id);
    if (!row) return reply({ ok: false, error: "not_found" });
    return reply({ ok: true, row: { ...row, body: "The body of the item.", tags: ["cinema"], language: "en", age_rating: "none" } });
  }

  if (href.includes("/rpc/creator_item_save")) {
    if (scenario.itemSaveError) return reply({ ok: false, error: scenario.itemSaveError });
    const id = body.p_id || `item-new-${(scenario.items || []).length + 1}`;
    const row = item({
      id,
      kind: body.p_kind,
      title: body.p_title,
      summary: body.p_summary,
      status: body.p_publish ? "published" : "draft",
      visibility: body.p_visibility,
    });
    scenario.items = (scenario.items || []).some((entry) => entry.id === id)
      ? scenario.items.map((entry) => (entry.id === id ? { ...entry, ...row } : entry))
      : [row, ...(scenario.items || [])];
    return reply({ ok: true, row: { id, code: row.code, kind: row.kind, title: row.title, status: row.status, visibility: row.visibility } });
  }

  if (href.includes("/rpc/creator_item_status")) {
    scenario.items = (scenario.items || []).map((row) => (row.id === body.p_id ? { ...row, status: body.p_status } : row));
    return reply({ ok: true, id: body.p_id, status: body.p_status });
  }

  if (href.includes("/rpc/creator_item_delete")) {
    scenario.items = (scenario.items || []).filter((row) => row.id !== body.p_id);
    return reply({ ok: true, removed: true });
  }

  if (href.includes("/rpc/creator_categories")) {
    return reply({ ok: true, rows: scenario.categories || [] });
  }

  if (href.includes("/rpc/creator_category_save")) {
    if (scenario.categoryError) return reply({ ok: false, error: scenario.categoryError });
    const row = { id: `cat-${(scenario.categories || []).length + 1}`, name: body.p_name, level: 1, parent: body.p_parent, items: 0 };
    scenario.categories = [...(scenario.categories || []), row];
    return reply({ ok: true, row });
  }

  if (href.includes("/rpc/creator_category_delete")) {
    scenario.categories = (scenario.categories || []).filter((row) => row.id !== body.p_id);
    return reply({ ok: true, removed: true });
  }

  if (href.includes("/rpc/creator_subscribers")) {
    return reply({
      ok: true,
      rows: scenario.subscribers || [],
      counts: { subscribers: (scenario.subscribers || []).length, vip: 0, staff: 0 },
    });
  }

  if (href.includes("/rpc/member_logout")) return reply({ ok: true });
  return reply([]);
}

/* timers of a closed page keep writing into the next document */
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
    origin: "http://localhost",
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
  window.localStorage.setItem("1w.member", JSON.stringify({ ...MEMBER, status: scenario.status || "active" }));

  await import(`file://${join(root, "assets/js/creator.js")}?pass=${pass}`);
  await wait(240);

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
/* checks                                                             */
/* ------------------------------------------------------------------ */
const checks = [];
function expect(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail });
}

async function main() {
  /* ---------------------------------------------------------------- */
  /* pass 1 — no session                                              */
  /* ---------------------------------------------------------------- */
  scenario = { hubs: [], items: [] };
  calls.length = 0;
  const anon = await boot(1, { token: false });
  expect("no session: the studio asks for a sign-in", /Sign in to the studio/i.test(anon.text("[data-cr-state]")));
  expect("no session: the shell stays hidden", anon.hidden("[data-cr-shell]"));
  expect("no session: no rpc at all", !calls.some((c) => c.includes("/rpc/creator")), calls.join(" "));
  expect("no session: no errors", anon.errors.length === 0, anon.errors.join(" | "));
  anon.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 2 — an empty studio: create a channel, fill it, delete it    */
  /* ---------------------------------------------------------------- */
  scenario = { hubs: [], items: [], categories: [], subscribers: [] };
  calls.length = 0;
  const p = await boot(2);
  expect("empty: the shell is shown", !p.hidden("[data-cr-shell]"));
  expect("empty: five sections in the rail", p.qsa("[data-cr-sections] .cr-section").length === 5, String(p.qsa("[data-cr-sections] .cr-section").length));
  const railText = p.text("[data-cr-sections]");
  expect("empty: the rail names them", /Channel[\s\S]*Blog[\s\S]*Space[\s\S]*Library[\s\S]*Gallery/.test(railText), railText);
  expect("empty: the member is in the rail", p.text("[data-cr-name]") === "Youssef El Amrani", p.text("[data-cr-name]"));
  expect("empty: the member code is there", p.text("[data-cr-code]") === "ID100042", p.text("[data-cr-code]"));
  expect("empty: the switcher offers the add option", /Add a channel/i.test(p.text("[data-cr-hub]")), p.text("[data-cr-hub]"));
  expect("empty: the view asks for a channel", /No channel yet/i.test(p.text("[data-cr-view]")));
  expect("empty: the limit is stated", /0 of 1 channels/i.test(p.text("[data-cr-hub-hint]")), p.text("[data-cr-hub-hint]"));

  // create the channel
  p.click(p.qs("[data-cr-new-hub]"));
  await p.wait(60);
  expect("create: the modal opens", Boolean(p.qs("[data-new-hub-name]")));
  p.type(p.qs("[data-new-hub-name]"), "Studio One");
  calls.length = 0;
  p.click(p.qs("[data-cr-create-hub]"));
  await p.wait(240);
  expect("create: the call went out", calls.some((c) => c.includes("creator_hub_save")));
  expect("create: the hub is in the switcher", /Studio One/.test(p.text("[data-cr-hub]")), p.text("[data-cr-hub]"));
  expect("create: the settings tab opens", Boolean(p.qs("[data-hub-name]")));
  expect("create: no errors", p.errors.length === 0, p.errors.join(" | "));

  // settings: identity, private access, staff
  p.type(p.qs("[data-hub-name]"), "Studio One");
  p.type(p.qs("[data-hub-description]"), "Films and long talks");
  p.type(p.qs("[data-hub-field]"), "Cinema");
  p.type(p.qs("[data-hub-niches]"), "Documentary, Essay");
  p.type(p.qs("[data-hub-logo]"), "https://example.com/logo.png");
  expect("settings: the password field is hidden while public", p.hidden("[data-hub-pass-wrap]"));
  p.change(p.qs("[data-hub-visibility]"), "private");
  await p.wait(40);
  expect("settings: private reveals the password", !p.hidden("[data-hub-pass-wrap]"));
  expect("settings: and the window select", Boolean(p.qs("[data-hub-hours]")));
  p.type(p.qs("[data-hub-password]"), "open-sesame");
  p.change(p.qs("[data-hub-hours]"), "168");
  p.type(p.qs("[data-hub-staff]"), "ID100015");
  calls.length = 0;
  p.click(p.qs("[data-cr-save-hub]"));
  await p.wait(260);
  const hubCall = calls.find((c) => c.includes("creator_hub_save"));
  expect("settings: the save is sent", Boolean(hubCall));
  expect("settings: it says saved", /Saved/i.test(p.text("[data-hub-state]")), p.text("[data-hub-state]"));
  expect("settings: the hub head shows private", /Private/i.test(p.text("[data-cr-hubhead]")), p.text("[data-cr-hubhead]"));
  expect("settings: no errors", p.errors.length === 0, p.errors.join(" | "));

  // a refused save is explained
  scenario.hubSaveError = "staff";
  p.click(p.qs("[data-cr-save-hub]"));
  await p.wait(220);
  expect("settings: a refusal is explained", /not a member/i.test(p.text("[data-hub-state]")), p.text("[data-hub-state]"));
  scenario.hubSaveError = null;

  // delete the hub
  p.click(p.qs("[data-cr-delete-hub]"));
  await p.wait(60);
  expect("delete hub: it confirms first", Boolean(p.qs("[data-cr-confirm]")));
  calls.length = 0;
  p.click(p.qs("[data-cr-confirm]"));
  await p.wait(240);
  expect("delete hub: the call is sent", calls.some((c) => c.includes("creator_hub_delete")));
  expect("delete hub: the view is empty again", /No channel yet/i.test(p.text("[data-cr-view]")));
  expect("delete hub: no errors", p.errors.length === 0, p.errors.join(" | "));
  p.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 3 — one of each hub, real tables and the editor              */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [
      hub({ id: "hub-ch", kind: "channel", name: "Studio One", subscribers: 1200, items: 3, minutes: 420, likes: 90, dislikes: 4, comments: 22, reports: 1 }),
      hub({ id: "hub-bl", kind: "blog", name: "Night Notes", subscribers: 340, items: 2 }),
      hub({ id: "hub-sp", kind: "space", name: "Open Court", subscribers: 88 }),
      hub({ id: "hub-lb", kind: "library", name: "The Shelf", subscribers: 41 }),
      hub({ id: "hub-gl", kind: "gallery", name: "Contact Sheet", subscribers: 12 }),
    ],
    items: [
      item({ id: "it-1", kind: "video", title: "The first film", status: "published", visibility: "exclusive", minutes: 42, likes: 12, dislikes: 3, comments: 5, shares: 1 }),
      item({ id: "it-2", kind: "video", title: "Second cut", status: "draft", visibility: "public", minutes: 0, likes: 0 }),
      item({ id: "it-3", kind: "article", title: "A night in Marrakesh", status: "published", visibility: "public", minutes: 7, likes: 4 }),
      item({ id: "it-4", kind: "article", title: "Unfinished essay", status: "draft", visibility: "private", category_name: "Essay", lines: 12, words: 340, chars: 1800 }),
      item({ id: "it-5", kind: "question", title: "Where does the light go?", status: "published", visibility: "public", answers: 3, followers: 9, refollows: 2 }),
      item({ id: "it-6", kind: "answer", title: "It leaves through the wall", status: "published", parent_title: "Where does the light go?", likes: 5, dislikes: 1 }),
      item({ id: "it-7", kind: "book", title: "The long shelf", status: "published", downloads: 44, minutes: 90 }),
      item({ id: "it-8", kind: "document", title: "Shooting script", status: "published", downloads: 7 }),
      item({ id: "it-9", kind: "image", title: "Ochre wall", status: "published", likes: 3 }),
    ],
    categories: [{ id: "cat-1", name: "Essay", level: 1, parent: null, items: 2 }],
    subscribers: [
      { code: "ID100015", name: "Jhon mark", username: "@jhon007", country: "Andorra", since: new Date(NOW - 864e5).toISOString() },
    ],
  };
  calls.length = 0;
  const s = await boot(3);
  expect("studio: the channel is selected", /Studio One/.test(s.text("[data-cr-hub]")), s.text("[data-cr-hub]"));
  expect("studio: the hub head carries subscribers", /1200|1,200/.test(s.text("[data-cr-hubhead]")), s.text("[data-cr-hubhead]"));
  expect("studio: the tabs are the channel's", /Videos[\s\S]*Podcasts[\s\S]*Playlists[\s\S]*Channel management[\s\S]*Subscribers/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("studio: the videos table has its two rows", s.qsa("[data-cr-view] tbody tr").length === 2, String(s.qsa("[data-cr-view] tbody tr").length));
  const head = s.text("[data-cr-view] thead");
  expect("studio: the columns are the spec's", /Visibility[\s\S]*Minutes[\s\S]*Likes[\s\S]*Dislikes[\s\S]*Comments[\s\S]*Shares[\s\S]*Reports/.test(head), head);
  expect("studio: the code sits under the title", /CA4728CD/.test(s.text("[data-cr-view]")));
  expect("studio: exclusive is marked", Boolean(s.qs('[data-vis="exclusive"]')));
  expect("studio: the numbers are numbers", /12/.test(s.text("[data-cr-view]")));
  expect("studio: every row has an action menu", s.qsa("[data-cr-view] .cr-act").length === 2);
  expect("studio: the action menu has edit, link and delete", (() => {
    const first = s.qsa("[data-cr-view] .cr-act__menu")[0];
    return /Edit[\s\S]*Copy link[\s\S]*Delete/.test(first?.textContent || "");
  })());

  // search narrows it
  s.type(s.qs("[data-cr-search]"), "second");
  await s.wait(60);
  expect("search: one row survives", s.qsa("[data-cr-view] tbody tr").length === 1, String(s.qsa("[data-cr-view] tbody tr").length));
  expect("search: it is the right one", /Second cut/.test(s.text("[data-cr-view]")));
  s.type(s.qs("[data-cr-search]"), "");
  await s.wait(60);

  // open the item editor
  s.click(s.qsa('[data-cr-act="edit"]')[0]);
  await s.wait(220);
  expect("editor: it opens with the item", s.qs("[data-item-title]")?.value === "The first film", s.qs("[data-item-title]")?.value);
  expect("editor: the body is loaded", s.qs("[data-item-body]")?.value === "The body of the item.");
  expect("editor: a video asks for its media link", Boolean(s.qs("[data-item-media]")));
  expect("editor: the kind is named", /Video/i.test(s.text(".cr-editor__kind")), s.text(".cr-editor__kind"));

  s.type(s.qs("[data-item-title]"), "The first film (final cut)");
  calls.length = 0;
  s.click(s.qs("[data-cr-item-save]"));
  await s.wait(240);
  expect("editor: the draft save is sent", calls.some((c) => c.includes("creator_item_save")));
  expect("editor: it returns to the table", Boolean(s.qs("[data-cr-view] tbody tr")));

  // a new item through the Add-content menu
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  expect("add: the menu opens", !s.hidden("[data-cr-add-menu]"));
  s.click(s.qs('[data-cr-add="podcast"]'));
  await s.wait(60);
  expect("add: a new podcast editor opens", /Podcast/i.test(s.text(".cr-editor__kind")), s.text(".cr-editor__kind"));
  s.type(s.qs("[data-item-title]"), "Episode one");
  s.type(s.qs("[data-item-media]"), "https://example.com/ep.mp3");
  calls.length = 0;
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(260);
  expect("add: publishing is sent", calls.some((c) => c.includes("creator_item_save")));
  expect("add: no errors", s.errors.length === 0, s.errors.join(" | "));

  // the blog section
  calls.length = 0;
  s.click(s.qs('[data-cr-section="blog"]'));
  await s.wait(260);
  expect("blog: the tabs change", /Articles[\s\S]*Drafts[\s\S]*Categories[\s\S]*Blog management[\s\S]*Subscribers/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("blog: articles are listed", /A night in Marrakesh/.test(s.text("[data-cr-view]")));
  expect("blog: the articles tab shows reads", /Minutes/.test(s.text("[data-cr-view] thead")));
  const lastItems = calls.filter((c) => c.includes("creator_items")).length;
  s.click(s.qs('[data-cr-tab="drafts"]'));
  await s.wait(240);
  expect("blog: drafts read a second table", calls.filter((c) => c.includes("creator_items")).length > lastItems);
  expect("blog: the draft row is there", /Unfinished essay/.test(s.text("[data-cr-view]")), s.text("[data-cr-view]").slice(0, 160));
  expect("blog: drafts show lines, words and chars", /Lines[\s\S]*Words[\s\S]*Chars/.test(s.text("[data-cr-view] thead")));
  expect("blog: drafts have publish and preview", /Publish[\s\S]*Preview[\s\S]*Delete/.test(s.text("[data-cr-view]")));

  // categories
  s.click(s.qs('[data-cr-tab="categories"]'));
  await s.wait(220);
  expect("categories: the tree is drawn", /Essay/.test(s.text("[data-cr-view]")));
  s.type(s.qs("[data-cat-name]"), "Travel");
  calls.length = 0;
  s.click(s.qs("[data-cr-cat-add]"));
  await s.wait(220);
  expect("categories: the add is sent", calls.some((c) => c.includes("creator_category_save")));
  expect("categories: it lands in the table", /Travel/.test(s.text("[data-cr-view]")));

  // subscribers
  s.click(s.qs('[data-cr-tab="subscribers"]'));
  await s.wait(220);
  expect("subscribers: the member is listed", /Jhon mark/.test(s.text("[data-cr-view]")));
  expect("subscribers: with their code", /ID100015/.test(s.text("[data-cr-view]")));

  // switching hub inside a section
  s.click(s.qs('[data-cr-section="library"]'));
  await s.wait(260);
  expect("library: books are listed", /The long shelf/.test(s.text("[data-cr-view]")));
  expect("library: downloads are a column", /Downloads/.test(s.text("[data-cr-view] thead")));
  expect("library: no errors", s.errors.length === 0, s.errors.join(" | "));

  // a refused delete is explained
  scenario.itemSaveError = "media";
  s.click(s.qs('[data-cr-tab="documents"]'));
  await s.wait(220);
  s.click(s.qsa('[data-cr-act="edit"]')[0]);
  await s.wait(220);
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(240);
  expect("save: a refusal is explained", /needs its link/i.test(s.text("[data-item-state]")), s.text("[data-item-state]"));
  scenario.itemSaveError = null;
  expect("save: no errors", s.errors.length === 0, s.errors.join(" | "));
  s.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 4 — deep links                                              */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [
      hub({ id: "hub-lb", kind: "library", name: "The Shelf" }),
      hub({ id: "hub-sp", kind: "space", name: "Open Court" }),
    ],
    items: [item({ id: "it-doc", kind: "document", title: "Shooting script" })],
    categories: [],
    subscribers: [],
  };
  const d = await boot(4, { search: "?section=library&tab=documents" });
  expect("deep link: the library section is open", /Library/.test(d.text(".cr-section.is-on")), d.text(".cr-section.is-on"));
  expect("deep link: the documents tab is active", /Documents/.test(d.text(".cr-tab.is-on")), d.text(".cr-tab.is-on"));
  expect("deep link: the documents are listed", /Shooting script/.test(d.text("[data-cr-view]")));
  expect("deep link: no errors", d.errors.length === 0, d.errors.join(" | "));
  d.window.close();
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
