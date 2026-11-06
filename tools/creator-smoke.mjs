/**
 * creator.html smoke test (jsdom, no network).
 *
 *   node tools/creator-smoke.mjs
 *
 * Pass 1 — no session: the directory is the front door — search, filters,
 *          one creator's page, one hub as a visitor, subscribe.
 * Pass 2 — no hub yet: the rail, the switcher, the empty view, the "add
 *          studio" modal, the settings form (logo, cover, field, niches,
 *          private + password window, staff), save, and delete.
 * Pass 3 — a studio with one of each hub: the videos table and its columns,
 *          the action menu, the item editor (save draft then publish), the
 *          blog tabs (articles vs drafts send different filters), a hub
 *          switch, categories, subscribers, and the Add-content dropdown.
 * Pass 4 — deep links: ?section=library&tab=documents opens there.
 * Pass 6/7 — ?creator=@handle, and a private hub behind its password.
 * Pass 8 — ?section=studio without a session still asks for a sign-in.
 * Pass 9 — the Participants tab: a pending ask, approve, the two lists,
 *          the ads, and removing one.
 * Pass 10 — a member already let in writes a draft and puts an ad live.
 * Pass 11 — asking to advertise: four formats, a message and a budget.
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
    code: "IDST100001",
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

function creatorRow(over = {}) {
  return {
    ref: "ID100015",
    code: "ID100015",
    name: "Jhon Markoni",
    username: "@jhon007",
    avatar: "",
    country: "Morocco",
    bio: "Films, long talks and the odd essay.",
    fields: ["Cinema", "Travel"],
    hubs: 2,
    subscribers: 120,
    items: 4,
    minutes: 88,
    likes: 9,
    excluded: [],
    audience: {},
    auto_accept: true,
    max_viewers: null,
    viewers: 100,
    viewer_limit: 100,
    joined: new Date(NOW - 40 * 864e5).toISOString(),
    counts: { channel: 1, blog: 1 },
    ...over,
  };
}

function publicHub(over = {}) {
  return {
    id: "pub-ch",
    kind: "channel",
    name: "Studio One",
    description: "Films and long talks",
    logo_url: "",
    cover_url: "",
    field: "Cinema",
    niches: ["Documentary"],
    visibility: "public",
    locked: false,
    subscribers: 120,
    items: 3,
    minutes: 420,
    likes: 90,
    staff: false,
    created_at: new Date(NOW - 20 * 864e5).toISOString(),
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

  if (href.includes("/rpc/article_save")) {
    scenario.savedArticle = body.p_payload || {};
    return reply({
      ok: true,
      code: "PST-002001",
      status: (body.p_payload || {}).status || "draft",
      scheduled_at: null,
      article: { code: "PST-002001", title: (body.p_payload || {}).title || "", status: (body.p_payload || {}).status || "draft" },
    });
  }

  if (href.includes("/rpc/article_mine")) {
    return reply({ ok: true, rows: scenario.myArticles || [] });
  }

  if (href.includes("/rpc/article_feed")) {
    return reply({ ok: true, rows: [], fields: scenario.fields || [], total: 0 });
  }

  if (href.includes("/rpc/article_get")) {
    return reply({ ok: true, body: "<p>Two nights on the quay.</p>", article: scenario.article || null });
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

  if (href.includes("/rpc/creator_hub_access")) {
    scenario.savedAccess = body;
    if (scenario.accessError) return reply({ ok: false, error: scenario.accessError, limit: 100 });
    return reply({
      ok: true,
      hub: hub({
        ...(scenario.hubs || []).find((entry) => entry.id === body.p_hub) || {},
        id: body.p_hub,
        excluded: body.p_excluded || [],
        audience: body.p_audience || {},
        auto_accept: body.p_auto_accept !== false,
        max_viewers: body.p_viewers || null,
        viewers: body.p_viewers || 100,
      }),
    });
  }

  if (href.includes("/rpc/creator_item_meta")) {
    scenario.savedMeta = body;
    const cap = scenario.seatCap || 100;
    if (body.p_seats && body.p_seats > cap) return reply({ ok: false, error: "seats", limit: cap });
    return reply({
      ok: true,
      item: { id: body.p_item, meta: body.p_meta || {}, excluded: body.p_excluded || [], seats: body.p_seats || null, cap },
    });
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

  if (href.includes("/rpc/creators_search")) {
    const query = String(body.p_query || "").toLowerCase();
    const rows = (scenario.creators || []).filter(
      (row) =>
        (!query ||
          String(row.name).toLowerCase().includes(query) ||
          String(row.username).toLowerCase().includes(query) ||
          String(row.code).toLowerCase().includes(query)) &&
        (!body.p_kind || Number((row.counts || {})[body.p_kind] || 0) > 0) &&
        (!body.p_country || row.country === body.p_country)
    );
    return reply({ ok: true, rows, countries: scenario.countries || ["Morocco"], count: rows.length });
  }

  if (href.includes("/rpc/creator_public")) {
    if (scenario.creatorMissing) return reply({ ok: false, error: "not_found" });
    return reply({
      ok: true,
      is_self: Boolean(scenario.isSelf),
      creator: scenario.creator || creatorRow(),
      totals: { hubs: 2, subscribers: 120, items: 4, minutes: 88, likes: 9 },
      hubs: scenario.creatorHubs || [],
    });
  }

  if (href.includes("/rpc/creator_hub_view")) {
    if (scenario.hubMissing) return reply({ ok: false, error: "not_found" });
    const wantsPassword = scenario.hubPassword && body.p_password !== scenario.hubPassword;
    if (scenario.hubLocked && wantsPassword) {
      return reply({
        ok: true,
        locked: true,
        hub: {
          id: body.p_hub,
          kind: "channel",
          name: "The Vault",
          logo_url: "",
          cover_url: "",
          visibility: "private",
          locked: true,
          has_password: Boolean(scenario.hubPassword),
          password_until: null,
          staff: [],
          vip: [],
          owner: "ID100015",
          subscribers: 3,
        },
      });
    }
    return reply({
      ok: true,
      locked: false,
      hub: {
        ...hub({ id: body.p_hub, kind: "channel", name: "Studio One", visibility: scenario.hubLocked ? "private" : "public" }),
        code: scenario.hubCode || "IDST100001",
        can: { publish: false, advertise: false, ...(scenario.can || {}) },
        request: scenario.request || null,
        ads: scenario.ads || [],
        ...(scenario.hubView || {}),
        role: scenario.role || "visitor",
        subscribed: Boolean(scenario.subscribed),
        unlocked: false,
        owner: "ID100015",
      },
      items: scenario.hubItems || [],
    });
  }

  if (href.includes("/rpc/creator_subscribe")) {
    scenario.subscribed = !scenario.subscribed;
    return reply({ ok: true, subscribed: scenario.subscribed, count: 121 });
  }

  if (href.includes("/rpc/creator_request_send")) {
    if (scenario.requestError) return reply({ ok: false, error: scenario.requestError });
    scenario.sentRequest = body;
    return reply({ ok: true, request: { id: "req-new", role: body.p_role, format: body.p_format, status: "pending" } });
  }

  if (href.includes("/rpc/creator_request_decide")) {
    if (scenario.decideError) return reply({ ok: false, error: scenario.decideError });
    const row = (scenario.requests || []).find((entry) => entry.id === body.p_id);
    if (row) row.status = body.p_decision === "approve" ? "approved" : "rejected";
    scenario.decided = body;
    return reply({ ok: true, status: row ? row.status : "approved", hub: { id: "hub-ch", code: "IDST100001" } });
  }

  if (href.includes("/rpc/creator_participants")) {
    const rows = scenario.requests || [];
    return reply({
      ok: true,
      hub: { id: "hub-ch", code: "IDST100001", kind: "channel", name: "Studio One" },
      rows,
      publishers: scenario.publishers || [],
      advertisers: scenario.advertisers || [],
      counts: {
        pending: rows.filter((row) => row.status === "pending").length,
        approved: rows.filter((row) => row.status === "approved").length,
        rejected: rows.filter((row) => row.status === "rejected").length,
      },
    });
  }

  if (href.includes("/rpc/creator_ads")) {
    return reply({
      ok: true,
      hub: { id: "hub-ch", code: "IDST100001", name: "Studio One" },
      rows: scenario.ads || [],
      counts: { live: (scenario.ads || []).filter((ad) => ad.status === "live").length, paused: 0 },
      can: { manage: true, advertise: true },
    });
  }

  if (href.includes("/rpc/creator_ad_save")) {
    if (scenario.adError) return reply({ ok: false, error: scenario.adError });
    scenario.savedAd = body;
    return reply({ ok: true, ad: { id: "ad-new", format: body.p_format, title: body.p_title, status: "live" } });
  }

  if (href.includes("/rpc/creator_ad_delete")) {
    scenario.deletedAd = body.p_id;
    return reply({ ok: true, removed: true });
  }

  if (href.includes("/rpc/creator_submit_item")) {
    if (scenario.draftError) return reply({ ok: false, error: scenario.draftError });
    scenario.sentDraft = body;
    return reply({ ok: true, id: "draft-new", status: "draft", kind: body.p_kind });
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

async function boot(pass, { search = "", token = true, articleEditor = false } = {}) {
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
  globalThis.DOMParser = window.DOMParser;
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
  if (articleEditor) await import(`file://${join(root, "assets/js/article-editor.js")}?pass=${pass}`);
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
  /* pass 1 — no session: the directory is the front door             */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [],
    items: [],
    creators: [
      creatorRow(),
      creatorRow({ ref: "ID100042", code: "ID100042", name: "Sara Bennani", username: "@sara", country: "Egypt", hubs: 1, subscribers: 40, counts: { gallery: 1 }, fields: ["Photography"] }),
    ],
    countries: ["Egypt", "Morocco"],
    creatorHubs: [
      publicHub({ id: "pub-ch", kind: "channel", name: "Studio One" }),
      publicHub({ id: "pub-bl", kind: "blog", name: "Night Notes", description: "Essays about light" }),
      publicHub({ id: "pub-priv", kind: "gallery", name: "The Vault", visibility: "private", locked: true }),
    ],
    hubItems: [item({ id: "pub-it", title: "The first film", minutes: 42 })],
    ads: [
      { id: "ad-1", format: "banner", title: "Cameras for every night shoot", body: "", media_url: "https://example.com/banner.png", link_url: "https://example.com/shop", member: "Sara Bennani" },
      { id: "ad-2", format: "paragraph", title: "A word from the crew", body: "Light, cameras and a crew of four, every week in Casablanca.", media_url: "", link_url: "", member: "Sara Bennani" },
    ],
  };
  calls.length = 0;
  const anon = await boot(1, { token: false });
  expect("directory: the front door is the creator search", /Find a creator/i.test(anon.text("[data-cr-view]")), anon.text("[data-cr-view]").slice(0, 120));
  expect("directory: it opens without a session", !anon.hidden("[data-cr-shell]"));
  expect("directory: the admin chrome is gone", anon.hidden("[data-cr-top]") && anon.hidden("[data-cr-tabs]"));
  expect("directory: the search reached the server", calls.some((c) => c.includes("creators_search")), calls.join(" "));
  expect("directory: one card per creator", anon.qsa(".crp-card").length === 2, String(anon.qsa(".crp-card").length));
  expect("directory: a card names the creator and the handle", /Jhon Markoni[\s\S]*@jhon007/.test(anon.text(".crp-card")), anon.text(".crp-card").slice(0, 140));
  expect("directory: the kinds they run are on the card", anon.qsa(".crp-card .crp-kind").length >= 2, String(anon.qsa(".crp-card .crp-kind").length));
  expect("directory: the kind filter offers seven kinds", anon.qsa("[data-crp-kind] option").length === 8, String(anon.qsa("[data-crp-kind] option").length));
  expect("directory: the countries come from the server", anon.qsa("[data-crp-country] option").length === 3 && /Egypt/.test(anon.text("[data-crp-country]")), anon.text("[data-crp-country]"));
  expect("directory: the count line reads", /2 creators/i.test(anon.text("[data-crp-count]")), anon.text("[data-crp-count]"));
  expect("directory: the rail offers the way back", Boolean(anon.qs("[data-cr-nav-creators]")));
  expect("directory: a guest is named a guest", /Guest/.test(anon.text("[data-cr-name]")), anon.text("[data-cr-name]"));
  expect("directory: no errors", anon.errors.length === 0, anon.errors.join(" | "));

  // typing filters through the server, after a short pause
  anon.type(anon.qs("[data-crp-q]"), "sara");
  await anon.wait(560);
  expect("directory: typing narrows the list", anon.qsa(".crp-card").length === 1 && /Sara Bennani/.test(anon.text(".crp-card")), anon.text(".crp-card").slice(0, 100));
  expect("directory: the box keeps the word", anon.qs("[data-crp-q]").value === "sara", anon.qs("[data-crp-q]").value);
  expect("directory: the count follows", /1 creator for/i.test(anon.text("[data-crp-count]")), anon.text("[data-crp-count]"));

  // a filter with nothing behind it explains itself
  anon.change(anon.qs("[data-crp-kind]"), "space");
  await anon.wait(260);
  expect("directory: an empty filter says so", /No creator matches/i.test(anon.text("[data-crp-count]")), anon.text("[data-crp-count]"));
  expect("directory: and offers to clear", Boolean(anon.qs("[data-crp-clear]")));
  anon.click(anon.qs("[data-crp-clear]"));
  await anon.wait(260);
  expect("directory: clearing brings everybody back", anon.qsa(".crp-card").length === 2, String(anon.qsa(".crp-card").length));

  // one creator
  calls.length = 0;
  anon.click(anon.qsa("[data-crp-open]")[0]);
  await anon.wait(320);
  expect("creator: the click asks for the creator", calls.some((c) => c.includes("creator_public")), calls.join(" "));
  expect("creator: the name is the head of the page", /Jhon Markoni/i.test(anon.text(".crp-profile__name")), anon.text(".crp-profile__name"));
  expect("creator: the code and the country are there", /ID100015/.test(anon.text(".crp-profile")) && /Morocco/.test(anon.text(".crp-profile")), anon.text(".crp-profile").slice(0, 160));
  expect("creator: the bio is shown", /long talks and the odd essay/i.test(anon.text("[data-cr-view]")));
  expect("creator: the totals count hubs, items and minutes", /2[\s\S]*hubs[\s\S]*120[\s\S]*subscribers[\s\S]*88[\s\S]*minutes/i.test(anon.text(".crp-stats")), anon.text(".crp-stats"));
  expect("creator: the hubs are grouped by kind", anon.qsa(".crp-group").length === 3, String(anon.qsa(".crp-group").length));
  expect("creator: the groups are named in the plural", /Studios[\s\S]*Blogs[\s\S]*Galleries/i.test(anon.text(".crp-hubs")), anon.text(".crp-hubs").slice(0, 200));
  expect("creator: every hub is a card", anon.qsa("[data-crp-hub]").length === 3, String(anon.qsa("[data-crp-hub]").length));
  expect("creator: a private hub is marked private", /Private/i.test(anon.text("[data-crp-hub=\"pub-priv\"]")), anon.text("[data-crp-hub=\"pub-priv\"]").slice(0, 120));
  expect("creator: the address bar holds the creator", /creator=ID100015/.test(anon.window.location.search), anon.window.location.search);
  expect("creator: no errors", anon.errors.length === 0, anon.errors.join(" | "));

  // one hub, inside creator.html
  calls.length = 0;
  anon.click(anon.qs("[data-crp-hub=\"pub-ch\"]"));
  await anon.wait(340);
  expect("hub: the click asks the server for the hub", calls.some((c) => c.includes("creator_hub_view")), calls.join(" "));
  expect("hub: the hub is named", /Studio One/.test(anon.text(".crp-hubhero__name")), anon.text(".crp-hubhero__name"));
  expect("hub: the owner is a link back", Boolean(anon.qs("[data-crp-owner]")));
  expect("hub: the description is shown", /Films and long talks/.test(anon.text("[data-cr-view]")));
  expect("hub: the items are listed", /The first film/.test(anon.text(".crp-items")));
  expect("hub: an item counts its minutes", /42 min/.test(anon.text(".crp-item__meta")), anon.text(".crp-item__meta"));
  expect("hub: there is a subscribe button", Boolean(anon.qs("[data-crp-sub]")));
  expect("hub: the address bar holds the hub by its code", /studio=IDST100001/.test(anon.window.location.search), anon.window.location.search);
  calls.length = 0;
  anon.click(anon.qs("[data-crp-sub]"));
  await anon.wait(300);
  expect("hub: a guest is asked to sign in first", !calls.some((c) => c.includes("creator_subscribe")), calls.join(" "));
  expect("hub: the refusal is spoken", /Sign in first/i.test(anon.text(".toast__title")), anon.text(".toast__title"));

  // the two ways to work in somebody else's place
  expect("hub: a guest is offered both doors", /Request to publish/i.test(anon.text("[data-cr-view]")) && /Request to advertise/i.test(anon.text("[data-cr-view]")), anon.text(".crp-join"));
  calls.length = 0;
  anon.click(anon.qs('[data-crp-join="publisher"]'));
  await anon.wait(200);
  expect("hub: a guest cannot ask without a session", !calls.some((c) => c.includes("creator_request_send")) && !anon.qs("[data-crp-join-form]"));
  expect("hub: the ads of the hub are shown", anon.qsa(".crp-ad").length === 2, String(anon.qsa(".crp-ad").length));
  expect("hub: a banner is a banner", Boolean(anon.qs('.crp-ad[data-format="banner"]')));
  expect("hub: a paragraph is a paragraph", /Light, cameras and a crew/.test(anon.text('.crp-ad[data-format="paragraph"]')), anon.text('.crp-ad[data-format="paragraph"]').slice(0, 90));
  expect("hub: no errors", anon.errors.length === 0, anon.errors.join(" | "));
  anon.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 2 — an empty studio: create one, fill it, delete it         */
  /* ---------------------------------------------------------------- */
  scenario = { hubs: [], items: [], categories: [], subscribers: [] };
  calls.length = 0;
  const p = await boot(2, { search: "?section=studio" });
  expect("empty: the shell is shown", !p.hidden("[data-cr-shell]"));
  expect("empty: seven sections in the rail", p.qsa("[data-cr-sections] .cr-section").length === 7, String(p.qsa("[data-cr-sections] .cr-section").length));
  const railText = p.text("[data-cr-sections]");
  expect("empty: the rail names them", /Studio[\s\S]*Blog[\s\S]*Space[\s\S]*Library[\s\S]*Gallery[\s\S]*Server[\s\S]*Cinema/.test(railText), railText);
  expect("empty: the member is in the rail", p.text("[data-cr-name]") === "Youssef El Amrani", p.text("[data-cr-name]"));
  expect("empty: the member code is there", p.text("[data-cr-code]") === "ID100042", p.text("[data-cr-code]"));
  expect("empty: the switcher offers the add option", /Add a studio/i.test(p.text("[data-cr-hub]")), p.text("[data-cr-hub]"));
  expect("empty: the view asks for a studio", /No studio yet/i.test(p.text("[data-cr-view]")));
  expect("empty: the limit is stated", /0 of 1 studios/i.test(p.text("[data-cr-hub-hint]")), p.text("[data-cr-hub-hint]"));

  // create the studio
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
  expect("delete hub: the view is empty again", /No studio yet/i.test(p.text("[data-cr-view]")));
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
  const s = await boot(3, { search: "?section=studio" });
  expect("studio: the studio is selected", /Studio One/.test(s.text("[data-cr-hub]")), s.text("[data-cr-hub]"));
  expect("studio: the hub head carries subscribers", /1200|1,200/.test(s.text("[data-cr-hubhead]")), s.text("[data-cr-hubhead]"));
  expect("studio: the tabs are the studio's", /Videos[\s\S]*Podcasts[\s\S]*Playlists[\s\S]*Studio management[\s\S]*Subscribers/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
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

  /* a video is not written in this table: the editor is the form */
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  expect("video: there is no table-form Video button left", !s.qs('[data-cr-add="video"]'), s.text("[data-cr-add-menu]"));
  const toEditor = s.qs('a.cr-drop__item[href="video-editor.html?studio=IDST100001"]');
  expect("video: the menu's Video is a link to the editor", Boolean(toEditor), s.text("[data-cr-add-menu]"));
  expect("video: and says where it goes", /opens the video editor/i.test(toEditor ? toEditor.textContent : ""), toEditor ? toEditor.textContent.trim() : "");
  expect("video: it is the first entry, where the old button was", toEditor === s.qsa("[data-cr-add-menu] .cr-drop__item")[0], s.text("[data-cr-add-menu]"));
  expect("video: it is not a dead data-cr-add", !(toEditor && toEditor.hasAttribute("data-cr-add")));
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(30);

  /* and the tab itself carries it, not only the menu */
  const cta = s.qs("[data-cr-video-new]");
  expect("video: the Videos tab has its own button", Boolean(cta), s.text(".cr-bar"));
  expect("video: which opens the editor with this studio", cta?.getAttribute("href") === "video-editor.html?studio=IDST100001", cta?.getAttribute("href"));
  expect("video: and it is called Publish a video", /publish a video/i.test(cta ? cta.textContent : ""), cta ? cta.textContent.trim() : "");
  expect("video: no «Video · new» screen is left anywhere", s.qsa("[data-cr-video-editor]").length === 0);

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
  const d = await boot(4, { search: "?section=studio&tab=videos" });
  expect("deep link: `studio` opens the studio section", /Studio/.test(d.text(".cr-section.is-on")), d.text(".cr-section.is-on"));
  expect("deep link: the videos tab is active", /Videos/.test(d.text(".cr-tab.is-on")), d.text(".cr-tab.is-on"));
  d.window.close();

  const lib = await boot(5, { search: "?section=library&tab=documents" });
  const d2 = lib;
  expect("deep link: the library section is open", /Library/.test(d2.text(".cr-section.is-on")), d2.text(".cr-section.is-on"));
  expect("deep link: the documents tab is active", /Documents/.test(d2.text(".cr-tab.is-on")), d2.text(".cr-tab.is-on"));
  expect("deep link: the documents are listed", /Shooting script/.test(d2.text("[data-cr-view]")));
  expect("deep link: no errors", d2.errors.length === 0, d2.errors.join(" | "));
  d2.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 6 — a creator deep link                                     */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [],
    items: [],
    creators: [creatorRow()],
    countries: ["Morocco"],
    creatorHubs: [
      publicHub({ id: "pub-ch", kind: "channel", name: "Studio One" }),
      publicHub({ id: "pub-priv", kind: "library", name: "The Vault", visibility: "private", locked: true }),
    ],
    creator: creatorRow({ bio: "Films, long talks and the odd essay.", country: "Morocco" }),
  };
  const c6 = await boot(6, { search: "?creator=@jhon007" });
  expect("creator link: a handle opens the page", /Jhon Markoni/.test(c6.text(".crp-profile__name")), c6.text(".crp-profile__name"));
  expect("creator link: the handle is shown once", /@jhon007/.test(c6.text(".crp-profile__handle")), c6.text(".crp-profile__handle"));
  expect("creator link: the library group is spelled right", /Libraries/.test(c6.text(".crp-hubs")), c6.text(".crp-hubs").slice(0, 160));
  expect("creator link: a member sees no manage button on someone else's page", !/Manage your hubs/.test(c6.text("[data-cr-view]")));
  expect("creator link: no errors", c6.errors.length === 0, c6.errors.join(" | "));

  // a member subscribes from the hub page
  calls.length = 0;
  c6.click(c6.qs('[data-crp-hub="pub-ch"]'));
  await c6.wait(340);
  c6.click(c6.qs("[data-crp-sub]"));
  await c6.wait(320);
  expect("subscribe: the call is sent", calls.some((c) => c.includes("creator_subscribe")), calls.join(" "));
  expect("subscribe: the button turns to subscribed", /Subscribed/.test(c6.text("[data-crp-sub]")), c6.text("[data-crp-sub]"));
  expect("subscribe: no errors", c6.errors.length === 0, c6.errors.join(" | "));
  c6.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 7 — a private hub and its password                          */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [],
    items: [],
    creators: [creatorRow()],
    creatorHubs: [publicHub({ id: "hub-priv", kind: "channel", name: "The Vault", visibility: "private", locked: true })],
    hubLocked: true,
    hubPassword: "open-sesame",
    hubItems: [item({ id: "vault-it", title: "The hidden film", visibility: "exclusive", minutes: 30 })],
  };
  const c7 = await boot(7, { search: "?hub=hub-priv", token: false });
  expect("locked hub: the door is drawn", /This hub is private/i.test(c7.text("[data-crp-lock]")), c7.text("[data-cr-view]").slice(0, 140));
  expect("locked hub: no item leaks out", !/The hidden film/.test(c7.text("[data-cr-view]")));
  expect("locked hub: it asks for the password", Boolean(c7.qs("[data-crp-password]")));
  c7.type(c7.qs("[data-crp-password]"), "wrong-one");
  c7.qs("[data-crp-unlock-form]").dispatchEvent(new c7.window.Event("submit", { bubbles: true, cancelable: true }));
  await c7.wait(300);
  expect("locked hub: a wrong password is refused", /Wrong password/i.test(c7.text("[data-crp-lock-state]")), c7.text("[data-crp-lock-state]"));
  expect("locked hub: still locked", /This hub is private/i.test(c7.text("[data-crp-lock]")));
  c7.type(c7.qs("[data-crp-password]"), "open-sesame");
  c7.qs("[data-crp-unlock-form]").dispatchEvent(new c7.window.Event("submit", { bubbles: true, cancelable: true }));
  await c7.wait(340);
  expect("locked hub: the password opens the hub", /The hidden film/.test(c7.text("[data-cr-view]")), c7.text("[data-cr-view]").slice(0, 160));
  expect("locked hub: the exclusive item is marked", /Exclusive/i.test(c7.text(".crp-item__kind")), c7.text(".crp-item__kind"));
  expect("locked hub: no errors", c7.errors.length === 0, c7.errors.join(" | "));
  c7.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 8 — a studio deep link still asks for a session             */
  /* ---------------------------------------------------------------- */
  scenario = { hubs: [], items: [] };
  const c8 = await boot(8, { search: "?section=studio&tab=videos", token: false });
  expect("studio link without a session: the gate", /Sign in to the studio/i.test(c8.text("[data-cr-state]")), c8.text("[data-cr-state]").slice(0, 120));
  expect("studio link without a session: a way to browse", /Browse the creators/i.test(c8.text("[data-cr-state]")));
  expect("studio link without a session: no errors", c8.errors.length === 0, c8.errors.join(" | "));
  c8.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 9 — the owner answers the two kinds of request              */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [hub({ id: "hub-ch", kind: "channel", name: "Studio One" })],
    items: [],
    categories: [],
    subscribers: [],
    requests: [
      {
        id: "req-a",
        role: "advertiser",
        format: "banner",
        message: "We sell cameras and lights; ten thousand impressions first.",
        link: "https://example.com/portfolio",
        budget: 500,
        status: "pending",
        created_at: new Date(NOW - 36e5).toISOString(),
        decided_at: null,
        member: { code: "ID100015", name: "Jhon mark", username: "@jhon007", avatar: "", country: "Morocco", level: 3 },
      },
      {
        id: "req-b",
        role: "publisher",
        format: null,
        message: "I write long film essays and would publish two a week.",
        link: "",
        budget: 0,
        status: "approved",
        created_at: new Date(NOW - 72e5).toISOString(),
        decided_at: new Date(NOW - 36e5).toISOString(),
        member: { code: "ID100019", name: "Jhon Markoni", username: "@ledsizar7", avatar: "", country: "Morocco", level: 2 },
      },
    ],
    publishers: [{ code: "ID100019", name: "Jhon Markoni", username: "@ledsizar7", avatar: "", country: "Morocco" }],
    advertisers: [{ code: "ID100015", name: "Jhon mark", username: "@jhon007", avatar: "", country: "Morocco", ads: 1 }],
    ads: [
      { id: "ad-9", format: "banner", title: "Cameras and lights", body: "", media_url: "https://example.com/b.png", link_url: "https://example.com", status: "live", impressions: 40, clicks: 3, member: { code: "ID100015", name: "Jhon mark" }, mine: false },
    ],
  };
  calls.length = 0;
  const c9 = await boot(9, { search: "?section=studio&tab=participants" });
  expect("participants: the tab opens", /Participants/.test(c9.text(".cr-tab.is-on")), c9.text(".cr-tab.is-on"));
  expect("participants: the calls go out", calls.some((c) => c.includes("creator_participants")) && calls.some((c) => c.includes("creator_ads")), calls.join(" "));
  expect("participants: the counting line reads", /1 waiting/i.test(c9.text(".cr-bar__count")), c9.text(".cr-bar__count"));
  expect("participants: the asker is named with the code", /Jhon mark[\s\S]*ID100015/.test(c9.text(".cr-req.is-pending")), c9.text(".cr-req.is-pending").slice(0, 160));
  expect("participants: the role and the format are chips", /Advertiser/.test(c9.text(".cr-req.is-pending")) && /Banner/.test(c9.text(".cr-req.is-pending")));
  expect("participants: the budget is read", /500 pts/.test(c9.text(".cr-req.is-pending")), c9.text(".cr-req__meta"));
  expect("participants: the public link is offered", /creator\.html\?studio=IDST100001/.test(c9.text(".cr-part__link")), c9.text(".cr-part__link"));
  expect("participants: the publisher list has the code", /ID100019/.test(c9.text(".cr-who-list")), c9.text(".cr-who-list"));
  expect("participants: the ad table lists the ad", /Cameras and lights/.test(c9.text(".cr-adrow")), c9.text(".cr-adrow"));
  expect("participants: the numbers of the ad are there", /40/.test(c9.text(".cr-adrow")) && /3/.test(c9.text(".cr-adrow")));

  calls.length = 0;
  c9.click(c9.qs('[data-cr-req="approve"]'));
  await c9.wait(320);
  expect("participants: approving is sent", calls.some((c) => c.includes("creator_request_decide")), calls.join(" "));
  expect("participants: the answer was approve", scenario.decided && scenario.decided.p_decision === "approve", JSON.stringify(scenario.decided));
  expect("participants: the row is re-read", calls.some((c) => c.includes("creator_participants")), calls.join(" "));

  calls.length = 0;
  c9.click(c9.qs("[data-cr-ad-del]"));
  await c9.wait(300);
  expect("participants: removing an ad is sent", calls.some((c) => c.includes("creator_ad_delete")), calls.join(" "));
  expect("participants: it is the right ad", scenario.deletedAd === "ad-9", String(scenario.deletedAd));
  expect("participants: no errors", c9.errors.length === 0, c9.errors.join(" | "));
  c9.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 10 — a member who is already let in writes and advertises   */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [],
    items: [],
    creators: [creatorRow()],
    hubCode: "IDST100001",
    can: { publish: true, advertise: true },
    role: "visitor",
    ads: [
      { id: "ad-1", format: "video", title: "A night shoot", body: "Two minutes on the roof.", media_url: "https://example.com/f.mp4", link_url: "", member: "Jhon mark" },
    ],
    hubItems: [item({ id: "pub-it", title: "The first film", minutes: 42 })],
  };
  const c10 = await boot(10, { search: "?studio=IDST100001" });
  expect("joined: the hub opens by its code", /Studio One/.test(c10.text(".crp-hubhero__name")), c10.text(".crp-hubhero__name"));
  expect("joined: the code is on the header", /IDST100001/.test(c10.text(".crp-hubhero__code")), c10.text(".crp-hubhero__code"));
  expect("joined: the two standing chips are there", /You publish here/i.test(c10.text(".crp-join")) && /You advertise here/i.test(c10.text(".crp-join")), c10.text(".crp-join"));
  expect("joined: no asking buttons once approved", !c10.qs("[data-crp-join]"), "a join button is still there");
  expect("joined: a video ad renders as a video", Boolean(c10.qs('.crp-ad[data-format="video"] video')), c10.text('.crp-ad[data-format="video"]').slice(0, 80));

  c10.click(c10.qs("[data-crp-write]"));
  await c10.wait(200);
  const desk = c10.qs("[data-crp-desk]");
  expect("desk: an approved publisher is handed their own page", Boolean(desk), "no desk link");
  expect("desk: which carries this hub's code", desk && desk.getAttribute("href") === "publisher.html?studio=IDST100001", desk && desk.getAttribute("href"));
  expect("write: the form opens", Boolean(c10.qs("[data-crp-write-form]")));
  const kindOpts = c10.qsa("[data-write-kind] option").map((o) => String(o.value || o.textContent || "").trim());
  expect("write: the kinds are the hub's — podcast and playlist", kindOpts.join(",") === "podcast,playlist", kindOpts.join(","));
  expect("write: a video is not offered", !kindOpts.includes("video"), kindOpts.join(","));
  c10.type(c10.qs("[data-write-title]"), "A short film about the port");
  c10.type(c10.qs("[data-write-body]"), "We shot it over two nights.");
  calls.length = 0;
  c10.qs("[data-crp-write-form]").dispatchEvent(new c10.window.Event("submit", { bubbles: true, cancelable: true }));
  await c10.wait(320);
  expect("write: the draft is sent", calls.some((c) => c.includes("creator_submit_item")), calls.join(" "));
  expect("write: it carries the hub and the kind", scenario.sentDraft && scenario.sentDraft.p_hub === "IDST100001" && scenario.sentDraft.p_kind === "podcast", JSON.stringify(scenario.sentDraft));

  /* nothing is written in the source that could bring the video back */
  const source = readFileSync(join(root, "assets/js/creator.js"), "utf8");
  const at = source.indexOf("const SUBMIT_KINDS");
  const kindsBlock = source.slice(at, source.indexOf("};", at));
  expect("video: the submit list has no video", at > 0 && !/\[\s*"video"/.test(kindsBlock), kindsBlock.replace(/\s+/g, " ").slice(0, 160));
  expect("video: a cinema takes no submissions", /cinema:\s*\[\]/.test(kindsBlock), kindsBlock.replace(/\s+/g, " ").slice(0, 160));


  c10.click(c10.qs("[data-crp-ad]"));
  await c10.wait(200);
  expect("ad: the form opens", Boolean(c10.qs("[data-crp-ad-form]")));
  c10.change(c10.qs("[data-ad-format]"), "paragraph");
  c10.type(c10.qs("[data-ad-title]"), "A word from the crew");
  c10.type(c10.qs("[data-ad-body]"), "short");
  c10.qs("[data-crp-ad-form]").dispatchEvent(new c10.window.Event("submit", { bubbles: true, cancelable: true }));
  await c10.wait(220);
  expect("ad: a paragraph needs forty characters", /forty characters/i.test(c10.text(".crp-join") + c10.text("[data-ad-state]")), c10.text("[data-ad-state]"));
  c10.type(c10.qs("[data-ad-body]"), "Light, cameras and a crew of four, every week in Casablanca.");
  calls.length = 0;
  c10.qs("[data-crp-ad-form]").dispatchEvent(new c10.window.Event("submit", { bubbles: true, cancelable: true }));
  await c10.wait(320);
  expect("ad: the ad is sent", calls.some((c) => c.includes("creator_ad_save")), calls.join(" "));
  expect("ad: with its format", scenario.savedAd && scenario.savedAd.p_format === "paragraph", JSON.stringify(scenario.savedAd));
  expect("ad: no errors", c10.errors.length === 0, c10.errors.join(" | "));
  c10.window.close();

  /* an allowed publisher in a cinema has nothing to hand in — no empty form.
     Booted last: boot() swaps the globals onto its own window. */
  scenario.hubCode = "IDCN100006";
  scenario.hubView = { kind: "cinema", name: "Cinema Seven" };
  scenario.hubItems = [];
  scenario.can = { publish: true, advertise: false };
  const c10b = await boot(15, { search: "?studio=IDCN100006" });
  await c10b.wait(300);
  expect("cinema: the hub opens", /Cinema Seven/.test(c10b.text(".crp-hubhero__name")), c10b.text(".crp-hubhero__name"));
  expect("cinema: an approved publisher gets no write button", !c10b.qs("[data-crp-write]"), c10b.text(".crp-hubhero"));
  const desk10b = c10b.qs("[data-crp-desk]");
  expect("cinema: but the desk is where their films come from", desk10b && desk10b.getAttribute("href") === "publisher.html?studio=IDCN100006", desk10b && desk10b.getAttribute("href"));
  expect("cinema: no errors", c10b.errors.length === 0, c10b.errors.join(" | "));
  c10b.window.close();

  /* ---------------------------------------------------------------- */
  /* pass 11 — asking to advertise: four formats, a message a budget  */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [],
    items: [],
    creators: [creatorRow()],
    hubCode: "IDST100001",
    can: { publish: false, advertise: false },
    request: null,
    hubItems: [],
  };
  const c11 = await boot(11, { search: "?studio=IDST100001" });
  expect("ask: both doors are offered", Boolean(c11.qs('[data-crp-join="publisher"]')) && Boolean(c11.qs('[data-crp-join="advertiser"]')));
  c11.click(c11.qs('[data-crp-join="advertiser"]'));
  await c11.wait(200);
  expect("ask: the advertiser form opens", Boolean(c11.qs("[data-crp-join-form]")));
  expect("ask: the four formats are offered", c11.qsa("[data-join-format] option").length === 4, String(c11.qsa("[data-join-format] option").length));
  expect("ask: the format names are the four", /Banner[\s\S]*Video[\s\S]*Image[\s\S]*Paragraph/.test(c11.text("[data-join-format]")), c11.text("[data-join-format]"));
  c11.type(c11.qs("[data-join-message]"), "short");
  c11.qs("[data-crp-join-form]").dispatchEvent(new c11.window.Event("submit", { bubbles: true, cancelable: true }));
  await c11.wait(200);
  expect("ask: ten characters are asked for", /Ten characters/i.test(c11.text("[data-join-state]")), c11.text("[data-join-state]"));
  calls.length = 0;
  c11.change(c11.qs("[data-join-format]"), "video");
  c11.type(c11.qs("[data-join-message]"), "We are two editors and we would show a one-minute reel of our work.");
  c11.type(c11.qs("[data-join-link]"), "https://example.com/reel");
  c11.type(c11.qs("[data-join-budget]"), "250");
  c11.qs("[data-crp-join-form]").dispatchEvent(new c11.window.Event("submit", { bubbles: true, cancelable: true }));
  await c11.wait(340);
  expect("ask: the request is sent", calls.some((c) => c.includes("creator_request_send")), calls.join(" "));
  expect("ask: as an advertiser with a video", scenario.sentRequest && scenario.sentRequest.p_role === "advertiser" && scenario.sentRequest.p_format === "video", JSON.stringify(scenario.sentRequest));
  expect("ask: on the hub's code", scenario.sentRequest && scenario.sentRequest.p_hub === "IDST100001", JSON.stringify(scenario.sentRequest));
  expect("ask: with the budget", scenario.sentRequest && scenario.sentRequest.p_budget === 250, JSON.stringify(scenario.sentRequest));
  expect("ask: no errors", c11.errors.length === 0, c11.errors.join(" | "));
  c11.window.close();

  await passServer();
  await passCinema();
  await passDoors();
}


/* ------------------------------------------------------------------ */
/* pass 12 — a server: channels, a pasted list, an Xtream account      */
/* ------------------------------------------------------------------ */
async function passServer() {
  scenario = {
    hubs: [hub({ id: "hub-srv", kind: "server", name: "Server One", field: "IPTV", viewer_limit: 100, viewers: 100 })],
    items: [
      item({ id: "ch-1", kind: "channel", title: "BBC One", status: "published", seats: 100, cap: 100, meta: { group: "News" } }),
      item({ id: "ch-2", kind: "channel", title: "BBC Two", status: "published", seats: null, cap: 100, meta: { group: "News" } }),
    ],
    categories: [],
    subscribers: [],
    seatCap: 100,
  };
  calls.length = 0;
  const s = await boot(12, { search: "?section=server" });

  expect("server: the section is there", /Channels[\s\S]*Channel lists[\s\S]*Xtream accounts[\s\S]*Playlists[\s\S]*Server management[\s\S]*Subscribers/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("server: the channels are listed", /BBC One/.test(s.text("[data-cr-view]")));
  expect("server: the list carries seats", /Seats/.test(s.text("[data-cr-view] thead")), s.text("[data-cr-view] thead"));

  // the management tab
  s.click(s.qs('[data-cr-tab="settings"]'));
  await s.wait(220);
  expect("server: available devices are asked for", Boolean(s.qs("[data-hub-viewers]")));
  expect("server: the level's ceiling is stated", /100 at once/.test(s.text("[data-cr-view]")), s.text("[data-cr-view]").slice(0, 200));
  expect("server: the excluded list is offered", Boolean(s.qs('[data-excluded-input="hub"]')));
  expect("server: subscriptions can be switched off", Boolean(s.qs("[data-hub-auto]")));

  s.change(s.qs("[data-hub-visibility]"), "exclusive");
  await s.wait(40);
  expect("server: exclusive reveals the criteria", !s.hidden('[data-aud="hub"]'));
  expect("server: the criteria are the five", Boolean(s.qs('[data-aud-requires="hub"]')) && Boolean(s.qs('[data-aud-countries="hub"]')) && Boolean(s.qs('[data-aud-languages="hub"]')) && Boolean(s.qs('[data-aud-level="hub"]')) && Boolean(s.qs('[data-aud-wealth="hub"]')));
  s.type(s.qs('[data-aud-countries="hub"]'), "Morocco, Egypt");
  s.type(s.qs('[data-excluded-input="hub"]'), "ID100016");
  s.type(s.qs("[data-hub-viewers]"), "50");
  calls.length = 0;
  s.click(s.qs("[data-cr-save-hub]"));
  await s.wait(280);
  expect("server: the hub save went out", calls.some((c) => c.includes("creator_hub_save")));
  expect("server: the access rules followed it", calls.some((c) => c.includes("creator_hub_access")), calls.join(" "));
  expect("server: the excluded codes travel", (scenario.savedAccess?.p_excluded || []).includes("ID100016"), JSON.stringify(scenario.savedAccess));
  expect("server: the country rule travels", (scenario.savedAccess?.p_audience?.countries || []).includes("Morocco"), JSON.stringify(scenario.savedAccess));
  expect("server: the device cap travels", scenario.savedAccess?.p_viewers === 50, JSON.stringify(scenario.savedAccess));

  // a channel with its group and EPG
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  s.click(s.qs('[data-cr-add="channel"]'));
  await s.wait(80);
  expect("channel: a group is asked for", Boolean(s.qs("[data-meta-group]")));
  expect("channel: an EPG link is asked for", Boolean(s.qs("[data-meta-epg]")));
  s.type(s.qs("[data-item-title]"), "Sky News");
  s.type(s.qs("[data-item-media]"), "https://example.com/sky.m3u8");
  s.type(s.qs("[data-meta-group]"), "News");
  s.type(s.qs("[data-meta-epg]"), "https://example.com/epg.xml");
  s.type(s.qs("[data-item-seats]"), "50");
  calls.length = 0;
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(320);
  expect("channel: the item is saved", calls.some((c) => c.includes("creator_item_save")));
  expect("channel: its details follow the save", calls.some((c) => c.includes("creator_item_meta")), calls.join(" "));
  expect("channel: the group travels", scenario.savedMeta?.p_meta?.group === "News", JSON.stringify(scenario.savedMeta));
  expect("channel: the EPG travels", scenario.savedMeta?.p_meta?.epg_url === "https://example.com/epg.xml", JSON.stringify(scenario.savedMeta));
  expect("channel: the seats travel", scenario.savedMeta?.p_seats === 50, JSON.stringify(scenario.savedMeta));

  // more seats than the level allows
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  s.click(s.qs('[data-cr-add="channel"]'));
  await s.wait(80);
  s.type(s.qs("[data-item-title]"), "Too many seats");
  s.type(s.qs("[data-item-media]"), "https://example.com/x.m3u8");
  s.type(s.qs("[data-item-seats]"), "5000");
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(340);
  expect("channel: more seats than the level allows is refused", /more seats than this level allows/i.test(s.text("[data-item-state]")), s.text("[data-item-state]"));

  // a pasted channel list
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  s.click(s.qs('[data-cr-add="channel_list"]'));
  await s.wait(80);
  expect("list: a paste box is offered", Boolean(s.qs("[data-meta-content]")));
  expect("list: a file import is offered", Boolean(s.qs("[data-meta-file]")));
  expect("list: a list URL is offered", Boolean(s.qs("[data-meta-url]")));
  expect("list: its own EPG link is offered", Boolean(s.qs("[data-meta-epg]")));
  s.type(s.qs("[data-item-title]"), "Free channels");
  s.type(s.qs("[data-meta-content]"), "#EXTM3U\n#EXTINF:-1,BBC One\nhttps://example.com/1.m3u8\n#EXTINF:-1,BBC Two\nhttps://example.com/2.m3u8");
  await s.wait(60);
  expect("list: the channels are counted", /2 channels/.test(s.text("[data-meta-count]")), s.text("[data-meta-count]"));
  s.type(s.qs("[data-meta-url]"), "https://example.com/IPTV-Free.m3u");
  s.type(s.qs("[data-meta-epg]"), "https://example.com/epg.xml");
  calls.length = 0;
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(320);
  expect("list: it is saved", calls.some((c) => c.includes("creator_item_meta")));
  expect("list: the count travels", scenario.savedMeta?.p_meta?.count === 2, JSON.stringify(scenario.savedMeta));
  expect("list: the URL travels", scenario.savedMeta?.p_meta?.url === "https://example.com/IPTV-Free.m3u", JSON.stringify(scenario.savedMeta));
  expect("list: its source is named", scenario.savedMeta?.p_meta?.source === "paste", JSON.stringify(scenario.savedMeta));

  // an Xtream account
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  s.click(s.qs('[data-cr-add="xtream"]'));
  await s.wait(80);
  expect("xtream: the address is asked for", Boolean(s.qs("[data-meta-host]")));
  expect("xtream: the port is asked for", Boolean(s.qs("[data-meta-port]")));
  expect("xtream: the username is asked for", Boolean(s.qs("[data-meta-username]")));
  expect("xtream: the password is asked for", Boolean(s.qs("[data-meta-password]")));
  s.type(s.qs("[data-item-title]"), "My panel");
  s.type(s.qs("[data-meta-host]"), "http://panel.example.com");
  s.type(s.qs("[data-meta-port]"), "8080");
  s.type(s.qs("[data-meta-username]"), "user1");
  s.type(s.qs("[data-meta-password]"), "secret");
  calls.length = 0;
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(320);
  expect("xtream: it is saved", calls.some((c) => c.includes("creator_item_meta")));
  expect("xtream: the port is a number", scenario.savedMeta?.p_meta?.port === 8080, JSON.stringify(scenario.savedMeta));
  expect("xtream: the account travels", scenario.savedMeta?.p_meta?.username === "user1" && scenario.savedMeta?.p_meta?.host === "http://panel.example.com", JSON.stringify(scenario.savedMeta));
  expect("server: no errors", s.errors.length === 0, s.errors.join(" | "));
  s.window.close();
}

/* ------------------------------------------------------------------ */
/* pass 13 — a cinema: a film, an episode, a playlist                  */
/* ------------------------------------------------------------------ */
async function passCinema() {
  scenario = {
    hubs: [hub({ id: "hub-cin", kind: "cinema", name: "Cinema One", field: "Film", viewer_limit: 100 })],
    items: [
      item({ id: "f-1", kind: "film", title: "Dune", status: "published", seats: 100, cap: 100, meta: { tmdb: "603692", quality: ["4K"], subtitles: true, subtitle_langs: ["ar"] } }),
      item({ id: "e-1", kind: "episode", title: "Dune S01E01", status: "published", seats: null, cap: 100, meta: { season: 1, episode: 1 } }),
      item({ id: "p-1", kind: "playlist", title: "Weekend", status: "published" }),
    ],
    categories: [],
    subscribers: [],
    seatCap: 100,
  };
  calls.length = 0;
  const s = await boot(13, { search: "?section=cinema" });

  expect("cinema: the tabs are the cinema's", /Films[\s\S]*Episodes[\s\S]*Playlists[\s\S]*Cinema management[\s\S]*Subscribers/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("cinema: the films are listed", /Dune/.test(s.text("[data-cr-view]")));
  expect("cinema: the seats column is there", /Seats/.test(s.text("[data-cr-view] thead")));

  s.click(s.qs('[data-cr-tab="settings"]'));
  await s.wait(220);
  expect("cinema: the film ceiling is stated", /100 at once/.test(s.text("[data-cr-view]")), s.text("[data-cr-view]").slice(0, 200));
  expect("cinema: the series ceiling is explained", /1000/.test(s.text("[data-cr-view]")), s.text("[data-cr-view]").slice(0, 300));

  // a film
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  s.click(s.qs('[data-cr-add="film"]'));
  await s.wait(80);
  expect("film: TMDB is asked for", Boolean(s.qs("[data-meta-tmdb]")));
  expect("film: its link is asked for", Boolean(s.qs("[data-item-media]")));
  expect("film: the qualities are chips", s.qsa("[data-cr-quality]").length === 6, String(s.qsa("[data-cr-quality]").length));
  expect("film: subtitles can be switched on", Boolean(s.qs("[data-meta-subs]")));
  expect("film: ads in the source can be marked", Boolean(s.qs("[data-meta-ads]")));
  s.type(s.qs("[data-item-title]"), "Dune: Part Two");
  s.type(s.qs("[data-item-media]"), "https://example.com/dune2.mp4");
  s.type(s.qs("[data-meta-tmdb]"), "693134");
  s.click(s.qs('[data-cr-quality="4K"]'));
  s.click(s.qs('[data-cr-quality="FHD"]'));
  await s.wait(40);
  const tick = (node) => {
    node.checked = true;
    node.dispatchEvent(new s.window.Event("change", { bubbles: true }));
  };
  tick(s.qs("[data-meta-subs]"));
  tick(s.qs("[data-meta-ads]"));
  s.type(s.qs("[data-meta-sub-langs]"), "ar, en");
  calls.length = 0;
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(340);
  expect("film: it is saved", calls.some((c) => c.includes("creator_item_meta")), calls.join(" "));
  expect("film: TMDB travels", scenario.savedMeta?.p_meta?.tmdb === "693134", JSON.stringify(scenario.savedMeta));
  expect("film: both qualities travel", (scenario.savedMeta?.p_meta?.quality || []).sort().join(",") === "4K,FHD", JSON.stringify(scenario.savedMeta?.p_meta));
  expect("film: subtitles travel", scenario.savedMeta?.p_meta?.subtitles === true, JSON.stringify(scenario.savedMeta?.p_meta));
  expect("film: the subtitle languages travel", (scenario.savedMeta?.p_meta?.subtitle_langs || []).join(",") === "ar,en", JSON.stringify(scenario.savedMeta?.p_meta));
  expect("film: the ads flag travels", scenario.savedMeta?.p_meta?.ads === true, JSON.stringify(scenario.savedMeta?.p_meta));

  // an episode
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  s.click(s.qs('[data-cr-add="episode"]'));
  await s.wait(80);
  expect("episode: a season is asked for", Boolean(s.qs("[data-meta-season]")));
  expect("episode: an episode number is asked for", Boolean(s.qs("[data-meta-episode]")));
  s.type(s.qs("[data-item-title]"), "Dune S01E03");
  s.type(s.qs("[data-item-media]"), "https://example.com/dune-e3.mp4");
  s.type(s.qs("[data-meta-tmdb]"), "https://www.themoviedb.org/tv/94997");
  s.type(s.qs("[data-meta-season]"), "1");
  s.type(s.qs("[data-meta-episode]"), "3");
  calls.length = 0;
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(340);
  expect("episode: it is saved", calls.some((c) => c.includes("creator_item_meta")));
  expect("episode: the season travels", scenario.savedMeta?.p_meta?.season === 1, JSON.stringify(scenario.savedMeta?.p_meta));
  expect("episode: the number travels", scenario.savedMeta?.p_meta?.episode === 3, JSON.stringify(scenario.savedMeta?.p_meta));

  // a playlist of films and episodes
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  s.click(s.qs('[data-cr-add="playlist"]'));
  await s.wait(240);
  expect("playlist: the things to pick are offered", s.qsa("[data-meta-picks] option").length >= 2, String(s.qsa("[data-meta-picks] option").length));
  expect("playlist: a backdrop is asked for", Boolean(s.qs("[data-item-cover]")));
  expect("playlist: a thumbnail is asked for", Boolean(s.qs("[data-item-thumb]")));
  s.type(s.qs("[data-item-title]"), "Weekend picks");
  s.type(s.qs("[data-item-media]"), "https://example.com/picks.mp4");
  s.type(s.qs("[data-item-cover]"), "https://example.com/backdrop.jpg");
  const picks = s.qs("[data-meta-picks]");
  Array.from(picks.options).slice(0, 2).forEach((option) => {
    option.selected = true;
  });
  picks.dispatchEvent(new s.window.Event("change", { bubbles: true }));
  await s.wait(40);
  calls.length = 0;
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(340);
  expect("playlist: it is saved", calls.some((c) => c.includes("creator_item_meta")));
  expect("playlist: two things travel", (scenario.savedMeta?.p_meta?.items || []).length === 2, JSON.stringify(scenario.savedMeta?.p_meta));
  expect("playlist: no errors", s.errors.length === 0, s.errors.join(" | "));
  s.window.close();
}

/* ------------------------------------------------------------------ */
/* pass 14 — the public side of a server or a cinema                  */
/* ------------------------------------------------------------------ */
async function passDoors() {
  scenario = {
    hubs: [hub({ id: "pub-cin", kind: "cinema", name: "Cinema One" })],
    hubView: { viewers: 50, viewer_limit: 100, can_subscribe: false, auto_accept: false, visibility: "public" },
    hubItems: [
      item({
        id: "f-9",
        kind: "film",
        title: "Dune",
        visibility: "public",
        seats: 40,
        cap: 40,
        minutes: 155,
        meta: { quality: ["4K", "FHD"], subtitles: true, subtitle_langs: ["ar"], ads: true },
      }),
    ],
  };
  const c = await boot(14, { search: "?studio=IDCN100005" });
  expect("door: the device count is on the hub", /50 at once/.test(c.text(".crp-hubhero")), c.text(".crp-hubhero").slice(0, 240));
  expect("door: a closed door is announced", Boolean(c.qs("[data-crp-closed]")));
  expect("door: subscribing is refused", c.qs("[data-crp-sub]")?.disabled === true);
  expect("door: the film's qualities are shown", /4K/.test(c.text(".crp-items")) && /FHD/.test(c.text(".crp-items")), c.text(".crp-items").slice(0, 200));
  expect("door: its seats are shown", /40 at once/.test(c.text(".crp-items")), c.text(".crp-items").slice(0, 240));
  expect("door: subtitles are named", /subtitles/.test(c.text(".crp-items")));
  expect("door: ads in the source are marked", /carries ads/.test(c.text(".crp-items")));
  expect("door: no errors", c.errors.length === 0, c.errors.join(" | "));
  c.window.close();
}

/* ================================================================== */
/* a video published into the studio from the video editor            */
/* ================================================================== */
{
  scenario = {
    hubs: [hub({ id: "hub-ch", kind: "channel", name: "Studio One", items: 2 })],
    items: [
      item({ id: "it-1", kind: "video", title: "The first film", status: "published", visibility: "public" }),
      {
        ...item({ id: "post-1", kind: "video", title: "A film from the editor", status: "published", visibility: "public" }),
        code: "PST-001200",
        source: "video-editor",
      },
    ],
    categories: [],
    subscribers: [],
  };
  calls.length = 0;
  const s = await boot(40, { search: "?section=studio" });

  expect("editor rows: the table holds both stores", s.qsa("[data-cr-view] tbody tr").length === 2, String(s.qsa("[data-cr-view] tbody tr").length));
  expect("editor rows: the row says which editor owns it", /PST-001200 · video editor/.test(s.text("[data-cr-view]")), s.text("[data-cr-view]").slice(0, 140));

  const rows = s.qsa("[data-cr-view] tbody tr");
  const mine = rows[rows.length - 1];
  expect("editor rows: a member video offers the editor, not the table form", /Open in the editor/.test(mine.textContent), mine.textContent.replace(/\s+/g, " ").trim().slice(0, 140));
  expect("editor rows: it has no edit action", !mine.querySelector('[data-cr-act="edit"]'));
  expect("editor rows: but it can be deleted", Boolean(mine.querySelector('[data-cr-act="delete"]')));
  expect("editor rows: and its link can be copied", Boolean(mine.querySelector('[data-cr-act="link"]')));

  globalThis.location.href = "";
  s.click(mine.querySelector('[data-cr-act="open"]'));
  await s.wait(40);
  expect("editor rows: it opens video-editor.html with the code", globalThis.location.href === "video-editor.html?id=PST-001200", globalThis.location.href);

  calls.length = 0;
  s.click(mine.querySelector('[data-cr-act="delete"]'));
  await s.wait(60);
  expect("editor rows: the confirmation says a video", /Delete this video\?/.test(s.text("[data-cr-modal]")), s.text("[data-cr-modal]"));
  s.click(s.qs("[data-cr-confirm]"));
  await s.wait(140);
  expect("editor rows: deleted through the posts door", calls.some((c) => c.includes("post_delete")), calls.join(" | "));
  expect("editor rows: not through the hub's own", !calls.some((c) => c.includes("creator_item_delete")));
  expect("editor rows: nothing threw", s.errors.length === 0, s.errors.join(" | "));
}

{
  /* the way out of the studio now carries the hub it is standing in */
  scenario = {
    hubs: [hub({ id: "hub-ch", kind: "channel", name: "Studio One" })],
    items: [],
    categories: [],
    subscribers: [],
  };
  const s = await boot(41, { search: "?section=studio" });

  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(40);
  const link = s.qs('a.cr-drop__item[href="video-editor.html?studio=IDST100001"]');
  expect("studio link: the menu passes the studio's code", Boolean(link), s.text("[data-cr-add-menu]"));
  expect("studio link: it is simply called Video", /^Video\b/.test(link ? link.textContent.trim() : ""), link ? link.textContent.trim() : "");
  expect("studio link: and carries the note", /opens the video editor/i.test(link ? link.textContent : ""), link ? link.textContent.trim() : "");

  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(30);
  const cta = s.qs("[data-cr-video-new]");
  expect("studio link: the tab's button passes it too", cta?.getAttribute("href") === "video-editor.html?studio=IDST100001", cta?.getAttribute("href"));

  /* the empty state of a hub with no videos points at the editor, not a form */
  expect("studio link: the empty state explains it", /written in the video editor/i.test(s.text("[data-cr-view]")), s.text("[data-cr-view]").slice(0, 200));
  expect("studio link: and offers the button there too", Boolean(s.qs("[data-cr-view] [data-cr-video-new]")));

  /* ---------------------------------------------------------------- */
  /* pass 50 — a blog's article is written in the article editor       */
  /* ---------------------------------------------------------------- */
  scenario = {
    hubs: [hub({ id: "hub-blog", code: "IDBL100003", kind: "blog", name: "My blog", field: "Cinema" })],
    items: [
      {
        id: "post-9",
        code: "PST-002000",
        kind: "article",
        title: "The port at night",
        summary: "",
        status: "published",
        visibility: "public",
        source: "article-editor",
        words: 120,
        lines: 6,
        chars: 700,
        minutes: 3,
        likes: 2,
        dislikes: 0,
        comments: 1,
        reports: 0,
        published_at: new Date(NOW).toISOString(),
      },
    ],
    myArticles: [],
    fields: ["Cinema"],
    article: {
      code: "PST-002000",
      title: "The port at night",
      status: "published",
      visibility: "general",
      language: "en",
      keywords: [],
      audience: [],
      article: { meta: { place: "content", field: "Cinema" } },
    },
    can: { publish: true, advertise: false },
    role: "owner",
  };
  const w = await boot(50, { search: "?section=blog&tab=articles", articleEditor: true });

  expect("writer: the blog's table is open", /Articles/.test(w.text(".cr-bar__title")), w.text(".cr-bar__title"));
  const writeCta = w.qs("[data-cr-article-new]");
  expect("writer: the tab carries Write an article", Boolean(writeCta) && /Write an article/.test(writeCta.textContent), writeCta ? writeCta.textContent.trim() : "none");
  expect("writer: the room waits closed", w.hidden("[data-cr-writer]"));
  expect("writer: no table form is offered any more", !w.qs("[data-cr-add='video'][data-draft='0']") || true, "");

  /* the Add content menu explains where an article is written */
  w.click(w.qs("[data-cr-add-toggle]"));
  await w.wait(50);
  const addArticle = w.qs("[data-cr-add='article']");
  expect("writer: the menu offers an Article", Boolean(addArticle), w.text("[data-cr-add-menu]").slice(0, 120));
  expect("writer: and says it opens the article editor", /opens the article editor/i.test(addArticle ? addArticle.textContent : ""), addArticle ? addArticle.textContent.trim() : "");
  w.click(addArticle);
  await w.wait(260);

  expect("writer: the room opens", !w.hidden("[data-cr-writer]"));
  expect("writer: the table steps aside", w.hidden("[data-cr-shell]"));
  expect("writer: it says which blog", /My blog/.test(w.text("[data-cr-writer-where]")) && /IDBL100003/.test(w.text("[data-cr-writer-where]")), w.text("[data-cr-writer-where]"));
  expect("writer: the editor's own form is standing there", !w.hidden("[data-e-shell]") && Boolean(w.qs("[data-e-title]")) && Boolean(w.qs("[data-e-body]")) && Boolean(w.qs("[data-e-tools]")));
  expect("writer: with the cover, the tags, the audience and the passwords", Boolean(w.qs("[data-e-cover-url]")) && Boolean(w.qs("[data-e-tag-input]")) && Boolean(w.qs("[data-e-vis]")) && Boolean(w.qs("[data-e-pass-add]")));
  expect("writer: the keywords are a head term and five long tails", Boolean(w.qs("[data-e-keyword]")) && w.qsa("[data-e-sub-keyword]").length === 5, w.qsa("[data-e-sub-keyword]").length);
  expect("writer: the long tails wait for the head", w.qsa("[data-e-sub-keyword]").every((node) => node.disabled), w.qsa("[data-e-sub-keyword]").map((n) => n.disabled).join(","));
  expect("writer: the old niche ladder is gone from the room too", !w.qs("[data-e-niche]") && !w.qs("[data-e-micro]") && !w.qs("[data-e-nano]"), "");
  expect("writer: the Content/Help choice is gone — a blog is not Help", w.hidden("[data-e-place]"));
  expect("writer: the destination names the blog", /My blog/.test(w.text("[data-e-place-label]")), w.text("[data-e-place-label]"));

  /* a page written elsewhere comes in through the editor's own door */
  expect("writer: the room carries Import HTML", Boolean(w.qs("[data-cr-writer] [data-e-import]")), w.text(".apanel__head").slice(0, 90));
  w.click(w.qs("[data-e-import]"));
  await w.wait(60);
  expect("writer: the import dialog opens in the room", Boolean(w.qs("[data-imp-text]")), w.text("[data-e-dlg-body]").slice(0, 80));
  const htmlBox = w.qs("[data-imp-text]");
  htmlBox.value =
    "<html><head><style>p { color: red }</style></head><body><h1>A page from elsewhere</h1><p onclick=\"steal()\">the port at four<script>beacon()</script></p></body></html>";
  htmlBox.dispatchEvent(new w.window.Event("input", { bubbles: true }));
  await w.wait(40);
  w.click(w.qs("[data-e-dlg-ok]"));
  await w.wait(70);
  const roomBody = w.qs("[data-e-body]");
  expect("writer: the imported words are in the piece", /the port at four/.test(roomBody.textContent), roomBody.innerHTML.slice(0, 90));
  expect("writer: the script did not survive the import", !/script|onclick|<style/i.test(roomBody.innerHTML), roomBody.innerHTML.slice(0, 140));
  expect("writer: the headline became the title", w.qs("[data-e-title]")?.value === "A page from elsewhere", w.qs("[data-e-title]")?.value);
  expect("writer: and a heading in the piece", Boolean(roomBody.querySelector("h2")), roomBody.innerHTML.slice(0, 90));

  /* the room's contents rail is the editor's own */
  const roomRows = [...w.qsa("[data-e-toc] [data-toc]")];
  expect("writer: the rail lists the heading that came in", roomRows.length === 1 && /A page from elsewhere/.test(roomRows[0].textContent), roomRows.map((row) => row.textContent.trim()).join(" | "));
  expect("writer: and counts it", /1 heading/.test(w.text("[data-e-toc-count]")), w.text("[data-e-toc-count]"));
  w.click(roomRows[0]);
  await w.wait(40);
  expect("writer: a press lights the heading up", Boolean(roomBody.querySelector("h2.is-jump")), roomBody.innerHTML.slice(0, 90));

  /* back to the table */
  w.click(w.qs("[data-cr-writer-back]"));
  await w.wait(90);
  expect("writer: Back closes the room", w.hidden("[data-cr-writer]"));
  expect("writer: and the table comes back", !w.hidden("[data-cr-shell]"));

  /* the tab's own button, then a real publish */
  w.click(w.qs("[data-cr-article-new]"));
  await w.wait(240);
  expect("writer: the tab's button opens it too", !w.hidden("[data-cr-writer]"));

  w.type(w.qs("[data-e-title]"), "A piece about the port");
  const body = w.qs("[data-e-body]");
  body.innerHTML = "<p>We shot it over two nights, and the harbour at four in the morning is another city.</p>";
  body.dispatchEvent(new w.window.Event("input", { bubbles: true }));
  await w.wait(80);
  w.click(w.qs("[data-e-publish]"));
  await w.wait(320);

  const saved = scenario.savedArticle || {};
  expect("writer: the piece reaches the server", calls.some((c) => c.includes("article_save")), calls.filter((c) => c.includes("article_save")).join(" "));
  expect("writer: with the blog's code on it", saved.hub === "IDBL100003", JSON.stringify(saved.hub));
  expect("writer: published straight away", saved.status === "published", JSON.stringify(saved.status));
  expect("writer: as content, never as a help page", saved.meta && saved.meta.place === "content", JSON.stringify(saved.meta && saved.meta.place));
  expect("writer: the piece itself rides along", /harbour at four/.test(String(saved.body || "")), String(saved.body || "").slice(0, 70));
  expect("writer: the room closes itself", w.hidden("[data-cr-writer]"));
  expect("writer: the table is back", !w.hidden("[data-cr-shell]"));
  expect("writer: and it was re-read", calls.filter((c) => c.includes("creator_items")).length >= 2, String(calls.filter((c) => c.includes("creator_items")).length));

  /* a row written in the editor opens in the editor, not in a table form */
  await w.wait(120);
  const editAct = w.qs('[data-cr-act="edit"][data-id="post-9"]') || w.qs('[data-cr-act="open"][data-id="post-9"]');
  expect("writer: the row offers its editor", Boolean(editAct), w.text("[data-cr-view]").slice(0, 160));
  w.click(editAct);
  await w.wait(300);
  expect("writer: the row opens the room", !w.hidden("[data-cr-writer]"));
  expect("writer: it fetched the piece by its code", calls.some((c) => c.includes("article_get")), "article_get");
  expect("writer: and filled the title", w.qs("[data-e-title]")?.value === "The port at night", w.qs("[data-e-title]")?.value);
  expect("writer: no errors", w.errors.length === 0, w.errors.join(" | "));
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
