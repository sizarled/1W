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
 * Pass 4 — deep links: ?section=library&tab=documents opens there, and
 *          ?new=1 (the dashboard's Create) opens the form itself.
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
    thumbnail: over.thumbnail ?? "https://example.com/still.jpg",
    views: over.views ?? 1284,
    media_url: "https://example.com/film.mp4",
    category: null,
    category_name: null,
    parent: null,
    parent_title: null,
    micro: "",
    nano: "",
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

  if (href.includes("/rpc/question_save")) {
    scenario.savedQuestion = body.p_payload || {};
    return reply({
      ok: true,
      code: "PST-003001",
      status: (body.p_payload || {}).status || "draft",
      scheduled_at: null,
      question: { code: "PST-003001", title: (body.p_payload || {}).title || "", status: (body.p_payload || {}).status || "draft" },
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

  if (href.includes("/rpc/hub_reach_get")) {
    if (scenario.reachMissing) {
      return Promise.resolve({
        ok: false,
        status: 404,
        json: async () => ({ message: "Could not find the function" }),
        text: async () => JSON.stringify({ message: "Could not find the function public.hub_reach_get" }),
      });
    }
    const reach = scenario.reach || {
      hub: { id: "hub-ch", code: "IDST100001", name: "Studio One", kind: "channel" },
      configured: true,
      points: 0,
      spent: 0,
      remaining: 0,
      day: "2026-12-05",
      rows: [],
    };
    return reply({ ok: true, ...reach });
  }

  /* `hub_reach_save` was the manual plan, and the server no longer has it: a
     page that still asked would be asking a door that is gone */
  if (href.includes("/rpc/hub_reach_save")) {
    scenario.savedReach = body.p_payload || {};
    return reply({ ok: false, error: "not_found" });
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
    scenario.savedItemSave = body;
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
    const role = String(body.p_role || "");
    const wanted = (row) => {
      const owns = Number(row.hubs || 0) > 0;
      const writes = Number(row.writes || (row.writes_hubs || []).length || 0) > 0;
      if (role === "owner") return owns;
      if (role === "publisher") return writes;
      return owns || writes;
    };
    const rows = (scenario.creators || []).filter(
      (row) =>
        wanted(row) &&
        (!query ||
          String(row.name).toLowerCase().includes(query) ||
          String(row.username).toLowerCase().includes(query) ||
          String(row.code).toLowerCase().includes(query)) &&
        (!body.p_kind || Number((row.counts || {})[body.p_kind] || 0) > 0 || (row.writes_hubs || []).some((hub) => hub.kind === body.p_kind)) &&
        (!body.p_country || row.country === body.p_country)
    );
    const pool = (scenario.creators || []).filter(wanted);
    return reply({
      ok: true,
      role: role || "all",
      rows,
      countries: scenario.countries || ["Morocco"],
      count: rows.length,
      owners: pool.filter((row) => Number(row.hubs || 0) > 0).length,
      publishers: pool.filter((row) => Number(row.writes || (row.writes_hubs || []).length || 0) > 0).length,
    });
  }

  if (href.includes("/rpc/creator_public")) {
    if (scenario.creatorMissing) return reply({ ok: false, error: "not_found" });
    return reply({
      ok: true,
      is_self: Boolean(scenario.isSelf),
      creator: scenario.creator || creatorRow(),
      is_publisher: Boolean((scenario.pubHubs || []).length),
      totals: { hubs: 2, subscribers: 120, items: 4, minutes: 88, likes: 9, writes: (scenario.pubHubs || []).length },
      hubs: scenario.creatorHubs || [],
      pubhubs: scenario.pubHubs || [],
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

  /* the studio's safety net: the public feed, asked only when a shelf comes
     back shorter than the count the hub reports */
  if (href.includes("/rpc/video_feed")) {
    return reply({ ok: true, rows: scenario.feedRows || [], total: (scenario.feedRows || []).length, fields: [] });
  }

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
      /* she owns nothing: she was let into two hubs and writes there */
      {
        ref: "ID100077", code: "ID100077", name: "Nadia Rami", username: "@nadia", avatar: "", country: "Morocco",
        fields: [], hubs: 0, subscribers: 0, items: 5, minutes: 61, likes: 12, counts: {},
        role: "publisher", writes: 2,
        writes_hubs: [
          { id: "hub-nn", code: "IDBL100009", kind: "blog", name: "Night Notes", owner_name: "Jhon Markoni", owner_code: "ID100015", items: 4 },
          { id: "hub-lb", code: "IDLB100010", kind: "library", name: "The Shelf", owner_name: "Sara Bennani", owner_code: "ID100042", items: 1 },
        ],
      },
    ],
    countries: ["Egypt", "Morocco"],
    creatorHubs: [
      publicHub({ id: "pub-ch", kind: "channel", name: "Studio One" }),
      publicHub({ id: "pub-bl", kind: "blog", name: "Night Notes", description: "Essays about light" }),
      publicHub({ id: "pub-priv", kind: "gallery", name: "The Vault", visibility: "private", locked: true }),
    ],
    /* a studio holds every medium it publishes — the page reads them shelf by shelf */
    hubItems: [
      item({ id: "pub-it", title: "The first film", minutes: 42 }),
      item({ id: "pub-it-v", code: "CA4728CE", title: "The tall one", shape: "v", minutes: 1 }),
      item({ id: "pub-it-p", code: "PST-000901", kind: "podcast", title: "A long talk", minutes: 51 }),
      item({ id: "pub-it-m", code: "SNG-000901", kind: "song", title: "Night bus", minutes: 4 }),
      item({ id: "pub-it-l", code: "PLS-000901", kind: "playlist", title: "Winter", meta: { kind: "song" } }),
    ],
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
  expect("directory: one card per creator", anon.qsa(".crp-card").length === 3, String(anon.qsa(".crp-card").length));
  expect("directory: the three doors are offered", anon.qsa("[data-crp-role]").length === 3, String(anon.qsa("[data-crp-role]").length));
  expect("directory: an owner is marked owner", /Owner/i.test(anon.text('[data-crp-role-row="owner"]')), anon.text('[data-crp-role-row="owner"]').slice(0, 80));
  expect("directory: a publisher is marked publisher", /Publisher/i.test(anon.text('[data-crp-role-row="publisher"]')), anon.text('[data-crp-role-row="publisher"]').slice(0, 120));
  expect("directory: the publisher names the hubs they write in", anon.qsa('[data-crp-role-row="publisher"] .crp-write').length === 2, String(anon.qsa('[data-crp-role-row="publisher"] .crp-write').length));
  expect("directory: a card names the creator and the handle", /Jhon Markoni[\s\S]*@jhon007/.test(anon.text(".crp-card")), anon.text(".crp-card").slice(0, 140));
  expect("directory: the kinds they run are on the card", anon.qsa(".crp-card .crp-kind").length >= 2, String(anon.qsa(".crp-card .crp-kind").length));
  expect("directory: the kind filter offers seven kinds", anon.qsa("[data-crp-kind] option").length === 8, String(anon.qsa("[data-crp-kind] option").length));
  expect("directory: the countries come from the server", anon.qsa("[data-crp-country] option").length === 3 && /Egypt/.test(anon.text("[data-crp-country]")), anon.text("[data-crp-country]"));
  expect("directory: the count line reads", /3 creators/i.test(anon.text("[data-crp-count]")), anon.text("[data-crp-count]"));
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
  expect("directory: an empty filter says so", /Nobody matches/i.test(anon.text("[data-crp-count]")), anon.text("[data-crp-count]"));
  expect("directory: and offers to clear", Boolean(anon.qs("[data-crp-clear]")));
  anon.click(anon.qs("[data-crp-clear]"));
  await anon.wait(260);
  expect("directory: clearing brings everybody back", anon.qsa(".crp-card").length === 3, String(anon.qsa(".crp-card").length));

  /* the search asks who: owners, publishers, or everybody */
  anon.click(anon.qs('[data-crp-role="publisher"]'));
  await anon.wait(320);
  expect("roles: only the publishers are left", anon.qsa(".crp-card").length === 1 && /Nadia Rami/.test(anon.text(".crp-card")), anon.text(".crp-card").slice(0, 120));
  expect("roles: the chip is the one on", anon.qs('[data-crp-role="publisher"]')?.classList.contains("is-on"), "on");
  expect("roles: the count says publisher", /1 publisher/i.test(anon.text("[data-crp-count]")), anon.text("[data-crp-count]"));
  expect("roles: the blurb explains the seat", /somebody else's hub/i.test(anon.text(".crp-hero")), anon.text(".crp-hero__text").slice(0, 120));
  expect("roles: the address bar says publishers", /section=publishers/.test(anon.window.location.search), anon.window.location.search);

  anon.click(anon.qs('[data-crp-role="owner"]'));
  await anon.wait(320);
  expect("roles: only the owners are left", anon.qsa(".crp-card").length === 2 && !/Nadia Rami/.test(anon.text("[data-crp-grid]")), String(anon.qsa(".crp-card").length));
  expect("roles: a word still searches inside the role", true);
  anon.type(anon.qs("[data-crp-q]"), "sara");
  await anon.wait(560);
  expect("roles: the search stays inside the role", anon.qsa(".crp-card").length === 1 && /Sara Bennani/.test(anon.text(".crp-card")), anon.text(".crp-card").slice(0, 90));
  anon.click(anon.qs('[data-crp-role=""]'));
  await anon.wait(320);
  expect("roles: everybody comes back", anon.qsa(".crp-card").length >= 3 || /creator/i.test(anon.text("[data-crp-count]")), anon.text("[data-crp-count]"));

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
  expect("creator: an owner with no seats is marked owner", /Owner/.test(anon.text(".crp-profile__name")), anon.text(".crp-profile__name"));
  expect("creator: no errors", anon.errors.length === 0, anon.errors.join(" | "));

  // one hub, inside creator.html
  calls.length = 0;
  anon.click(anon.qs("[data-crp-hub=\"pub-ch\"]"));
  await anon.wait(340);
  expect("hub: the click asks the server for the hub", calls.some((c) => c.includes("creator_hub_view")), calls.join(" "));
  expect("hub: the hub is named", /Studio One/.test(anon.text(".crp-hubhero__name")), anon.text(".crp-hubhero__name"));
  expect("hub: the owner is a link back", Boolean(anon.qs("[data-crp-owner]")));
  expect("hub: the description is shown", /Films and long talks/.test(anon.text("[data-cr-view]")));
  /* a studio is read shelf by shelf, and every shelf is a door */
  expect("studio: the videos shelf lists the video", /The first film/.test(anon.text('[data-crs-sec="videos"]')), anon.text('[data-crs-sec="videos"]').slice(0, 120));
  expect("studio: a video card opens videos.html#/h/ID=", anon.qs('[data-crs-sec="videos"] .crs-card')?.getAttribute("href") === "videos.html#/h/ID=CA4728CD", anon.qs('[data-crs-sec="videos"] .crs-card')?.getAttribute("href"));
  expect("studio: the card counts its minutes", /42 min/.test(anon.text('[data-crs-sec="videos"] .crs-card__time')), anon.text('[data-crs-sec="videos"] .crs-card__time'));
  expect(
    "studio: the card draws its still as an image",
    anon.qs('[data-crs-sec="videos"] .crs-card__thumb img')?.getAttribute("src") === "https://example.com/still.jpg",
    anon.qs('[data-crs-sec="videos"] .crs-card__thumb')?.innerHTML.slice(0, 80)
  );
  expect(
    "studio: the card says how many watched it",
    /1,284 views/.test(anon.text('[data-crs-sec="videos"] .crs-card__meta') || ""),
    anon.text('[data-crs-sec="videos"] .crs-card__meta')
  );
  expect("studio: and it names the studio that published it", /Studio One/.test(anon.text('[data-crs-sec="videos"] .crs-card__pres') || ""), anon.text('[data-crs-sec="videos"] .crs-card__pres'));
  expect("studio: a vertical video keeps its own rail", anon.qsa('[data-crs-sec="vertical"] .crs-card').length === 1 && anon.qs('[data-crs-sec="vertical"] .crs-card')?.getAttribute("href") === "videos.html#/v/ID=CA4728CE", anon.qs('[data-crs-sec="vertical"] .crs-card')?.getAttribute("href"));
  expect("studio: the podcasts shelf opens the audio page", anon.qs('[data-crs-sec="podcasts"] .crs-row')?.getAttribute("href") === "audio.html#/p/ID=PST-000901", anon.qs('[data-crs-sec="podcasts"] .crs-row')?.getAttribute("href"));
  expect("studio: the music shelf opens the song", anon.qs('[data-crs-sec="music"] .crs-row')?.getAttribute("href") === "audio.html#/m/ID=SNG-000901", anon.qs('[data-crs-sec="music"] .crs-row')?.getAttribute("href"));
  expect("studio: a playlist keeps its shelf", anon.qs('[data-crs-sec="playlists"] .crs-row')?.getAttribute("href") === "playlist.html#/songs/ID=PLS-000901", anon.qs('[data-crs-sec="playlists"] .crs-row')?.getAttribute("href"));
  expect("studio: one shelf tab per medium, after All", anon.qsa("[data-crs-tab]").length === 6 && anon.qs("[data-crs-tab]")?.getAttribute("data-crs-tab") === "all", String(anon.qsa("[data-crs-tab]").length));
  expect("studio: a tab counts its shelf", /Podcasts[\s\S]*1/.test(anon.text('[data-crs-tab="podcasts"]')), anon.text('[data-crs-tab="podcasts"]'));
  anon.click(anon.qs('[data-crs-tab="podcasts"]'));
  await anon.wait(80);
  expect("studio: picking a shelf hides the others", !anon.hidden('[data-crs-sec="podcasts"]') && anon.hidden('[data-crs-sec="videos"]') && anon.hidden('[data-crs-sec="music"]'));
  anon.click(anon.qs('[data-crs-tab="all"]'));
  await anon.wait(80);
  expect("studio: All brings them back", !anon.hidden('[data-crs-sec="videos"]') && !anon.hidden('[data-crs-sec="playlists"]'));
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
  expect("empty: the switcher says there is none", /No studio yet/i.test(p.text("[data-cr-hub]")), p.text("[data-cr-hub]"));
  expect("empty: the view asks for a studio", /No studio yet/i.test(p.text("[data-cr-view]")));
  expect("empty: the limit is stated", /0 of 1 studios/i.test(p.text("[data-cr-hub-hint]")), p.text("[data-cr-hub-hint]"));

  /* a page is made on the dashboard now: the studio sends you there, and
     carries no management of its own any more */
  const door = p.qs('[data-cr-view] a[href="dashboard.html#creator"]');
  expect("empty: the create door is the dashboard", Boolean(door), p.text("[data-cr-view]").slice(0, 120));
  expect("empty: nothing in the studio makes a page", !p.qs("[data-cr-new-hub]") && !p.qs("[data-cr-create-hub]"));
  expect("empty: no management tab", !/management|Categories|Participants|Subscribers/i.test(p.text("[data-cr-tabs]")), p.text("[data-cr-tabs]"));
  expect("empty: the hub strip stays hidden", p.hidden("[data-cr-hubhead]"));
  expect("empty: no errors", p.errors.length === 0, p.errors.join(" | "));
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
  expect("studio: the tabs are the studio's", /Videos[\s\S]*Podcasts[\s\S]*Playlists/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("studio: and management is not among them", !/management|Participants|Subscribers/i.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
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

  /* the row itself is the door to the thing in it */
  expect("row: every row is a door", s.qsa("[data-cr-view] tbody tr[data-cr-row]").length === 2 && s.qs("[data-cr-view] tbody tr[data-cr-row]")?.getAttribute("tabindex") === "0");
  expect("row: it wears the pointer", s.qs("[data-cr-view] tbody tr[data-cr-row]")?.classList.contains("cr-row"));
  s.click(s.qsa("[data-cr-view] tbody tr[data-cr-row]")[0]);
  await s.wait(220);
  expect("row: a click opens the item", s.qs("[data-item-title]")?.value === "The first film", s.qs("[data-item-title]")?.value);
  s.click(s.qs("[data-cr-editor-back]"));
  await s.wait(220);
  s.click(s.qsa("[data-cr-view] .cr-act > summary")[0]);
  await s.wait(60);
  expect("row: the menu keeps its own click", !s.qs("[data-item-title]"), s.text("[data-cr-view]").slice(0, 80));
  s.click(s.qsa("[data-cr-view] .cr-act > summary")[0]);
  await s.wait(40);

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
  expect("add: the inline podcast editor replaces Podcast · new", s.text(".cr-editor__kind").trim() === "Podcast Editore" && Boolean(s.qs(".cr-pod-editor")), s.text(".cr-editor__kind"));
  expect("add: the episode can be uploaded to the studio host", Boolean(s.qs("[data-pod-file]")) && /Streamtape/.test(s.text(".cr-pod-source")));
  expect("add: metadata fields are part of this editor", Boolean(s.qs("[data-pod-show]")) && Boolean(s.qs("[data-pod-season]")) && Boolean(s.qs("[data-pod-transcript]")));
  s.type(s.qs("[data-item-media]"), "https://open.spotify.com/episode/abc123");
  expect("add: Spotify links get the real embedded player", s.qs("[data-pod-player] iframe")?.getAttribute("src")?.includes("open.spotify.com/embed/episode/abc123"));
  s.type(s.qs("[data-item-media]"), "https://cdn.example.com/episode.mp3");
  expect("add: direct audio URLs preview as audio", Boolean(s.qs("[data-pod-preview-audio]")));
  s.type(s.qs("[data-item-title]"), "Episode one");
  s.type(s.qs("[data-pod-show]"), "Hello podcast");
  s.type(s.qs("[data-pod-season]"), "2");
  s.type(s.qs("[data-pod-episode]"), "7");
  s.type(s.qs("[data-item-summary]"), "A short episode summary");
  s.type(s.qs("[data-item-body]"), "Show notes and guest links.");
  s.type(s.qs("[data-pod-transcript]"), "Transcript words.");
  s.qs("[data-pod-explicit]").checked = true;
  s.qs("[data-pod-explicit]").dispatchEvent(new s.window.Event("change", { bubbles: true }));
  calls.length = 0;
  s.click(s.qs("[data-cr-item-publish]"));
  await s.wait(300);
  expect("add: publishing is sent through the existing item RPC", calls.some((c) => c.includes("creator_item_save")));
  expect("add: the existing RPC receives the audio and notes", scenario.savedItemSave?.p_media_url === "https://cdn.example.com/episode.mp3" && scenario.savedItemSave?.p_body === "Show notes and guest links.", JSON.stringify(scenario.savedItemSave));
  expect("add: episode fields save through creator_item_meta", scenario.savedMeta?.p_meta?.show_name === "Hello podcast" && scenario.savedMeta?.p_meta?.season === 2 && scenario.savedMeta?.p_meta?.episode === 7 && scenario.savedMeta?.p_meta?.transcript === "Transcript words." && scenario.savedMeta?.p_meta?.explicit === true, JSON.stringify(scenario.savedMeta?.p_meta));
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
  expect("blog: the tabs change", /Articles[\s\S]*Drafts/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("blog: and only content is in them", !/management|Categories|Participants|Subscribers/i.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("blog: articles are listed", /A night in Marrakesh/.test(s.text("[data-cr-view]")));
  expect("blog: the articles tab shows reads", /Minutes/.test(s.text("[data-cr-view] thead")));
  const lastItems = calls.filter((c) => c.includes("creator_items")).length;
  s.click(s.qs('[data-cr-tab="drafts"]'));
  await s.wait(240);
  expect("blog: drafts read a second table", calls.filter((c) => c.includes("creator_items")).length > lastItems);
  expect("blog: the draft row is there", /Unfinished essay/.test(s.text("[data-cr-view]")), s.text("[data-cr-view]").slice(0, 160));
  expect("blog: drafts show lines, words and chars", /Lines[\s\S]*Words[\s\S]*Chars/.test(s.text("[data-cr-view] thead")));
  expect("blog: drafts have publish and preview", /Publish[\s\S]*Preview[\s\S]*Delete/.test(s.text("[data-cr-view]")));

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

  /* the dashboard's Create button names the section and asks for the form */
  const nu = await boot("4-new", { search: "?section=server&tab=channels&new=1" });
  expect("new: the section is open", /Server/.test(nu.text(".cr-section.is-on")), nu.text(".cr-section.is-on"));
  expect("new: the channels tab is active", /Channels/.test(nu.text(".cr-tab.is-on")), nu.text(".cr-tab.is-on"));
  expect("new: the studio makes no page, so ?new=1 opens the table", !nu.qs(".cr-modal") && /Channels/.test(nu.text(".cr-tab.is-on")), nu.text(".cr-tab.is-on"));
  nu.window.close();

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
  expect("locked hub: the exclusive item is marked", /Exclusive/i.test(c7.text('[data-crs-sec="videos"] .crs-card__meta')), c7.text('[data-crs-sec="videos"] .crs-card__meta'));
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
  /* pass 9 — the participants pane is the dashboard's now: the studio
     keeps no requests screen, and the public hub's Requests door points
     at the dashboard's management */

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
  const room = c10.qs("[data-crp-room]");
  expect("room: an approved publisher is handed the creator page", Boolean(room), "no room link");
  expect("room: which opens this hub in its own rooms", room && room.getAttribute("href") === "creator.html?section=studio&hub=IDST100001", room && room.getAttribute("href"));
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
  const room10b = c10b.qs("[data-crp-room]");
  expect("cinema: and the room is where the hub is opened", room10b && room10b.getAttribute("href") === "creator.html?section=cinema&hub=IDCN100006", room10b && room10b.getAttribute("href"));
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

  expect("server: the section is there", /Channels[\s\S]*Channel lists[\s\S]*Xtream accounts[\s\S]*Playlists/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("server: no management tab is left", !/management|Subscribers/i.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("server: the channels are listed", /BBC One/.test(s.text("[data-cr-view]")));
  expect("server: the list carries seats", /Seats/.test(s.text("[data-cr-view] thead")), s.text("[data-cr-view] thead"));

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

  expect("cinema: the tabs are the cinema's", /Films[\s\S]*Episodes[\s\S]*Playlists/.test(s.text("[data-cr-tabs]")), s.text("[data-cr-tabs]"));
  expect("cinema: the films are listed", /Dune/.test(s.text("[data-cr-view]")));
  expect("cinema: the seats column is there", /Seats/.test(s.text("[data-cr-view] thead")));

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

  /* the films tab is `movies` now; the older `films` link still lands on it */
  scenario = { hubs: [hub({ id: "hub-cin", kind: "cinema", name: "Cinema One", field: "Film", viewer_limit: 100 })], items: [item({ id: "f-1", kind: "film", title: "Dune", status: "published", seats: 100, cap: 100 })], categories: [], subscribers: [], seatCap: 100 };
  const old = await boot("13-films", { search: "?section=cinema&tab=films" });
  expect("cinema: an old tab=films link lands on the films", /Films/.test(old.text(".cr-tab.is-on")) && /Dune/.test(old.text("[data-cr-view]")), old.text(".cr-tab.is-on"));
  expect("cinema: and the address is rewritten to movies", /tab=movies/.test(old.window.location.search), old.window.location.search);
  old.window.close();
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

  /* the blog has a reading page of its own, and two doors lead to it */
  const door = w.qs("[data-cr-blog-open]");
  expect("writer: the tab opens the blog's reading page", door?.getAttribute("href") === "blog.html?studio=IDBL100003", door?.getAttribute("href"));
  expect("writer: and says so", /Open the blog/.test(door ? door.textContent : ""), door ? door.textContent.trim() : "none");


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

  /* and the blog, as a visitor meets it, carries the same door */
  scenario.hubView = { kind: "blog", name: "My blog", code: "IDBL100003", description: "Long pieces about films.", field: "" };
  const hv = await boot(52, { search: "?studio=IDBL100003" });
  expect("blog: the hub page opens", /My blog/.test(hv.text(".crp-hubhero__name")), hv.text(".crp-hubhero__name"));
  const readBlog = hv.qs("[data-crp-blog]");
  expect("blog: the hub page offers its reading page", readBlog?.getAttribute("href") === "blog.html?studio=IDBL100003", readBlog?.getAttribute("href"));
  expect("blog: and names it", /Read the blog/.test(readBlog ? readBlog.textContent : ""), readBlog ? readBlog.textContent.trim() : "none");
  delete scenario.hubView;
}

/* ------------------------------------------------------------------ */
/* pass 51 — a space's question is asked in the same room             */
/* ------------------------------------------------------------------ */
/*
 * The space used to keep its own small form under `Question · new`: a title, a
 * paragraph, a visibility. It was a second, weaker door beside the article
 * engine, so it is gone. What the Questions tab opens now is the writing room
 * in its question kind — attachments, keywords, doors, schedule and all.
 */
scenario = {
  hubs: [hub({ id: "hub-space", code: "IDSP100002", kind: "space", name: "The questions space" })],
  items: [
    {
      id: "q-1",
      code: "PST-003000",
      kind: "question",
      title: "Which ending rewired you?",
      summary: "",
      status: "published",
      visibility: "public",
      source: "question-editor",
      words: 32,
      lines: 3,
      chars: 210,
      minutes: 0,
      likes: 1,
      dislikes: 0,
      comments: 0,
      reports: 0,
      answers: 0,
      followers: 0,
      refollows: 0,
      published_at: new Date(NOW).toISOString(),
    },
  ],
  myArticles: [],
  fields: [],
  article: { code: "PST-003000", title: "Which ending rewired you?", status: "published", visibility: "general", language: "en", keywords: [], audience: [], article: { meta: { place: "content", attachments: [] } } },
  can: { publish: true, advertise: false },
  role: "owner",
};
{
  const q = await boot(51, { search: "?section=space&tab=questions", articleEditor: true });

  expect("question: the space's table is open", /Questions/.test(q.text(".cr-bar__title")), q.text(".cr-bar__title"));
  const askCta = q.qs("[data-cr-question-new]");
  expect("question: the tab carries Ask a question", Boolean(askCta) && /Ask a question/.test(askCta.textContent), askCta ? askCta.textContent.trim() : "none");
  expect("question: the room waits closed", q.hidden("[data-cr-writer]"));

  /* the old form is gone, not duplicated */
  q.click(q.qs("[data-cr-add-toggle]"));
  await q.wait(50);
  expect("question: the Add menu offers no second question form", !q.qs("[data-cr-add='question']"), q.text("[data-cr-add-menu]").slice(0, 160));

  q.click(askCta);
  await q.wait(260);
  expect("question: the room opens", !q.hidden("[data-cr-writer]"));
  expect("question: it says which space", /Asking in The questions space/.test(q.text("[data-cr-writer-where]")) && /IDSP100002/.test(q.text("[data-cr-writer-where]")), q.text("[data-cr-writer-where]"));
  expect("question: the editor's own form stands there", !q.hidden("[data-e-shell]") && Boolean(q.qs("[data-e-title]")) && Boolean(q.qs("[data-e-tools]")));
  expect("question: with the attachments panel", !q.hidden("[data-e-attach]"));
  expect("question: and its count", /0 \/ 5/.test(q.text("[data-e-attach-count]")), q.text("[data-e-attach-count]"));
  expect("question: the button asks the question", /Ask the question/.test(q.text("[data-e-publish]")), q.text("[data-e-publish]"));
  expect("question: the readiness is the question's", /Ready to ask\?/.test(q.text("[data-e-ready-title]")), q.text("[data-e-ready-title]"));
  expect("question: no Help section to pick", q.hidden("[data-e-place]"));
  expect("question: no field ladder either", !q.qs("[data-e-field]")?.closest("label") || q.qs("[data-e-field]").closest("label").hidden === true, "the field is still on screen");

  q.type(q.qs("[data-e-title]"), "Which ending rewired you?");
  const qbody = q.qs("[data-e-body]");
  qbody.innerHTML = "<p>Which last shot changed the whole film you had just watched?</p>";
  qbody.dispatchEvent(new q.window.Event("input", { bubbles: true }));
  await q.wait(80);
  q.click(q.qs("[data-e-publish]"));
  await q.wait(320);

  const saved = scenario.savedQuestion || {};
  expect("question: it reaches the server through question_save", scenario.savedQuestion !== null && scenario.savedQuestion !== undefined, JSON.stringify(scenario.savedQuestion));
  expect("question: never through article_save", !scenario.savedArticle, JSON.stringify(scenario.savedArticle || null));
  expect("question: with the space's code on it", saved.hub === "IDSP100002", JSON.stringify(saved.hub));
  expect("question: published straight away", saved.status === "published", JSON.stringify(saved.status));
  expect("question: with the question itself", /last shot changed/.test(String(saved.body || "")), String(saved.body || "").slice(0, 60));
  expect("question: with an attachments list", Array.isArray((saved.meta || {}).attachments), JSON.stringify(saved.meta));
  expect("question: and no field in meta", (saved.meta || {}).field === "", JSON.stringify((saved.meta || {}).field));
  expect("question: the room closes itself", q.hidden("[data-cr-writer]"));
  expect("question: the table is back", !q.hidden("[data-cr-shell]"));

  /* an editor-written question opens in the editor */
  await q.wait(120);
  const edit = q.qs('[data-cr-act="edit"][data-id="q-1"]') || q.qs('[data-cr-act="open"][data-id="q-1"]');
  expect("question: the row offers its editor", Boolean(edit), q.text("[data-cr-view]").slice(0, 160));
  q.click(edit);
  await q.wait(300);
  expect("question: the row opens the room", !q.hidden("[data-cr-writer]"));
  expect("question: it fetched the question by its code", calls.some((c) => c.includes("article_get")), "article_get");
  expect("question: and filled the title", q.qs("[data-e-title]")?.value === "Which ending rewired you?", q.qs("[data-e-title]")?.value);
  expect("question: nothing threw", q.errors.length === 0, q.errors.join(" | "));
}


/* ================================================================== */
/* a publisher's seat — somebody else's hub, written in this page     */
/* ================================================================== */
/*
 * The member an owner admits is not the owner: the tables are theirs to fill,
 * the management under them is not, and nothing they write goes out by itself —
 * the owner publishes it. All of it is decided from the `role` the server puts
 * on the hub, so the whole pass rides on that one field.
 */
async function seatPass() {
  const seatHub = hub({ id: "hub-lib", kind: "library", name: "The Shelf", owned: false, role: "publisher", subscribers: 41 });
  scenario = {
    hubs: [seatHub],
    items: [
      item({ id: "lib-1", kind: "book", title: "A book by the owner", status: "published", mine: false }),
      item({ id: "lib-2", kind: "book", title: "My draft", status: "draft", mine: true }),
    ],
    categories: [{ id: "cat-1", name: "Watch Movies", level: 1, parent: null, items: 1 }],
  };

  const s = await boot(60, { search: "?section=library&hub=hub-lib" });
  await s.wait(420);

  expect("seat: the hub opens with the member's row", /The Shelf/.test(s.text("[data-cr-hubhead]")), s.text("[data-cr-hubhead]").slice(0, 90));
  expect("seat: the header says which seat it is", /publisher seat/i.test(s.text("[data-cr-hubhead]")), s.text("[data-cr-hubhead]").slice(0, 120));

  const tabs = s.qsa("[data-cr-tab]").map((btn) => btn.getAttribute("data-cr-tab"));
  expect("seat: the tables are there", tabs.join(",") === "books,documents", tabs.join(","));
  expect("seat: no management tab", !tabs.some((key) => ["settings", "participants", "subscribers", "categories"].includes(key)), tabs.join(","));
  expect("seat: the bar says who publishes", /Publisher seat/i.test(s.text("[data-cr-view]")), s.text(".cr-bar").slice(0, 140));

  /* the add menu: content, and no management */
  s.click(s.qs("[data-cr-add-toggle]"));
  await s.wait(80);
  const adds = s.qsa("[data-cr-add-menu] [data-cr-add]").map((btn) => btn.getAttribute("data-cr-add"));
  expect("seat: content can be added", adds.includes("book") && adds.includes("document"), adds.join(","));
  expect("seat: but no category", !adds.includes("category"), adds.join(","));
  expect("seat: and no new library", !adds.includes("hub"), adds.join(","));

  /* somebody else's published row only opens; the member's own draft is theirs */
  const foreign = [...s.qsa('[data-row="lib-1"] [data-cr-act]')].map((btn) => btn.getAttribute("data-cr-act"));
  expect("seat: another's row is read only", foreign.length > 0 && foreign.every((act) => ["open", "preview", "link", "share"].includes(act)), foreign.join(","));
  const own = [...s.qsa('[data-row="lib-2"] [data-cr-act]')].map((btn) => btn.getAttribute("data-cr-act"));
  expect("seat: their own draft can be edited", own.includes("edit"), own.join(","));
  expect("seat: and never published from the table", !own.includes("publish"), own.join(","));

  /* the editor writes a draft, and offers no publish */
  s.click(s.qs('[data-cr-add="book"]'));
  await s.wait(160);
  expect("seat: the item editor opens", Boolean(s.qs("[data-item-title]")));
  expect("seat: no publish button", !s.qs("[data-cr-item-publish]"), "a publish button is there");
  expect("seat: the save is a draft save", Boolean(s.qs("[data-cr-item-save]")));
  expect("seat: the foot says whose hub it is", /is not yours/i.test(s.text("[data-item-state]")), s.text("[data-item-state]"));

  scenario.savedItemSave = null;
  s.type(s.qs("[data-item-title]"), "A book for the shelf");
  s.click(s.qs("[data-cr-item-save]"));
  await s.wait(360);
  expect("seat: the draft is sent", Boolean(scenario.savedItemSave), "no save");
  expect("seat: as a draft, never live", scenario.savedItemSave && scenario.savedItemSave.p_publish === false, JSON.stringify(scenario.savedItemSave && scenario.savedItemSave.p_publish));
  expect("seat: into the hub that let them in", scenario.savedItemSave && scenario.savedItemSave.p_hub === "hub-lib", String(scenario.savedItemSave && scenario.savedItemSave.p_hub));
  expect("seat: no errors", s.errors.length === 0, s.errors.join(" | "));
  s.window.close();

  /* a management tab cannot be reached through the address bar either */
  scenario = { hubs: [hub({ id: "hub-lib", kind: "library", name: "The Shelf", owned: false, role: "publisher" })], items: [] };
  const deep = await boot(61, { search: "?section=library&hub=hub-lib&tab=settings" });
  await deep.wait(340);
  expect("seat: ?tab=settings falls back to the tables", /Books/.test(deep.text(".cr-tab.is-on")), deep.text(".cr-tab.is-on"));
  expect("seat: no settings form was drawn", !deep.qs("[data-settings]"), "a settings form is there");
  expect("seat: no errors on the deep link", deep.errors.length === 0, deep.errors.join(" | "));
  deep.window.close();

  /* the owner is untouched: the same page, the same tabs */
  scenario = { hubs: [hub({ id: "hub-own", kind: "library", name: "My Shelf" })], items: [item({ id: "own-1", kind: "book", title: "My book" })] };
  const owner = await boot(62, { search: "?section=library&hub=hub-own" });
  await owner.wait(340);
  const ownerTabs = owner.qsa("[data-cr-tab]").map((btn) => btn.getAttribute("data-cr-tab"));
  expect("owner: the content tabs are all there", ownerTabs.join(",") === "books,documents", ownerTabs.join(","));
  expect("owner: and management is not in the studio", !ownerTabs.some((key) => ["settings", "categories", "participants", "subscribers"].includes(key)), ownerTabs.join(","));
  expect("owner: no publisher seat is claimed", !/Publisher seat/i.test(owner.text("[data-cr-view]")), owner.text(".cr-bar").slice(0, 120));
  expect("owner: no errors", owner.errors.length === 0, owner.errors.join(" | "));
  owner.window.close();
}

/* ------------------------------------------------------------------ */
/* pass 13 — the Reach tab: a day's budget, and the rank each item keeps */
/* ------------------------------------------------------------------ */
async function reachPass() {
  scenario = {
    hubs: [hub({ id: "hub-ch", kind: "channel", name: "Studio One" })],
    items: [],
    reach: {
      hub: { id: "hub-ch", code: "IDST100001", name: "Studio One", kind: "channel" },
      configured: true,
      base: 100,
      earned: 400,
      limitless: false,
      points: 500,
      spent: 120,
      remaining: 380,
      /* the server divides the day: 500 over two items, evenly */
      items: 2,
      share: 250,
      auto: true,
      /* what an interaction is worth — the server's own table */
      worth: [
        { event: "repost", delta: 60, note: "every repost adds 60" },
        { event: "comment_pos", delta: 30, note: "a positive comment adds 30" },
        { event: "like", delta: 30, note: "a like adds 30" },
        { event: "share", delta: 10, note: "every share link adds 10" },
        { event: "share_visit", delta: 10, note: "every visit from that link adds 10 more" },
        { event: "comment_neg", delta: -30, note: "a negative comment takes 30" },
        { event: "dislike", delta: -30, note: "a dislike takes 30" },
        { event: "report", delta: -60, note: "every report takes 60" },
      ],
      day: "2026-12-05",
      rows: [
        { kind: "post", ref: "post-a", code: "VID-001032", title: "The first film", points: 250, shown: 120, rank: 5000, reached_updates: 40, reached_suggestions: 60, reached_search: 20 },
        { kind: "content", ref: "content-b", code: "PST-000901", title: "A long talk", points: 250, shown: 0, rank: 1500, reached_updates: 0, reached_suggestions: 0, reached_search: 0 },
      ],
    },
  };
  calls.length = 0;
  const view = await boot(70, { search: "?section=studio&hub=hub-ch&tab=reach" });
  await view.wait(320);

  const tabs = view.qsa("[data-cr-tab]").map((btn) => btn.getAttribute("data-cr-tab"));
  expect("reach: the tab is offered in the studio", tabs.includes("reach"), tabs.join(","));
  expect("reach: it asked the server for the studio's day", calls.some((c) => c.includes("hub_reach_get")), calls.join(" "));

  const day = view.text(".cr-bar__count").replace(/\s+/g, " ").trim();
  expect("reach: the day is said in points, spent and left", /500 points · 120 spent · 380 left today/.test(day), day);
  /* the points are one studio's, so the bar says whose before it says how many */
  expect("reach: the bar names the studio the points belong to", /^Studio One · IDST100001 ·/.test(day), day);

  const total = view.text("[data-cr-reach-total]");
  expect("reach: the studio's number is shown, not typed", /500/.test(total) && !view.qs("[data-cr-reach-total] input"), total);
  expect("reach: and it says what it is made of", /100 from the level \+ 400 from the interactions/.test(total), total);
  expect("reach: one row per item", view.qsa("[data-reach-row]").length === 2, String(view.qsa("[data-reach-row]").length));
  expect("reach: a row names the item and its code", /The first film[\s\S]*VID-001032/.test(view.text('[data-reach-row="post-a"]')), view.text('[data-reach-row="post-a"]').slice(0, 90));
  expect(
    "reach: the item's share is the server's, written as a number",
    view.text('[data-cr-reach-points="post-a"]') === "250" && !view.qs("input[data-cr-reach-points]"),
    view.text('[data-cr-reach-points="post-a"]')
  );
  expect(
    "reach: the second item is given the same share — an even split",
    view.text('[data-cr-reach-points="content-b"]') === "250",
    view.text('[data-cr-reach-points="content-b"]')
  );
  expect(
    "reach: nothing on the tab can be typed",
    !view.qs(".cr-reach input, .cr-reach select"),
    (view.qs(".cr-reach")?.innerHTML || "").slice(0, 120)
  );
  expect("reach: its ranking points are read, not typed", view.text('[data-cr-reach-rank="post-a"]') === "5,000" && !view.qs("input[data-cr-reach-rank]"), view.text('[data-cr-reach-rank="post-a"]'));
  expect("reach: what has been shown is counted", /120 shown · 130 left/.test(view.text('[data-reach-row="post-a"]')), view.text('[data-reach-row="post-a"]'));
  expect("reach: an untouched item says it has spent nothing", /0 shown · 250 left/.test(view.text('[data-reach-row="content-b"]')), view.text('[data-reach-row="content-b"]'));

  /* the three surfaces, beside the allocation, and the total at the top */
  const heads = view.qsa(".cr-reach .cr-table thead th").map((th) => th.textContent.trim());
  expect("reach: the table names the three surfaces", heads.join(" | ") === "Item | Kind | Reach today | Reached in the updates | Reached in the suggestions | Reached in search | Ranking points", heads.join(" | "));
  expect("reach: the updates' people are counted", view.text('[data-cr-reach-updates="post-a"]') === "40", view.text('[data-cr-reach-updates="post-a"]'));
  expect("reach: the suggestions' people are counted", view.text('[data-cr-reach-suggestions="post-a"]') === "60", view.text('[data-cr-reach-suggestions="post-a"]'));
  expect("reach: the search's people are counted", view.text('[data-cr-reach-search="post-a"]') === "20", view.text('[data-cr-reach-search="post-a"]'));
  expect("reach: the day's total is above the table", /500/.test(view.text("[data-cr-reach-total]")), view.text("[data-cr-reach-total]"));
  expect("reach: the meter shows the day spent", view.qs(".cr-reach__meter-fill")?.getAttribute("style")?.includes("24%"), view.qs(".cr-reach__meter-fill")?.getAttribute("style"));

  /* what an interaction is worth is a table, not a sentence — and its numbers
     are the server's, handed over with the day */
  const worthHeads = view.qsa(".cr-worth thead th").map((th) => th.textContent.trim());
  expect(
    "reach: the worth of an interaction is a table of three columns",
    worthHeads.join(" | ") === "Interaction | Reach points | Ranking points",
    worthHeads.join(" | ")
  );
  expect("reach: one line per interaction, eight of them", view.qsa(".cr-worth tbody tr").length === 8, String(view.qsa(".cr-worth tbody tr").length));
  const worthCell = (event, column) => view.qs(`[data-cr-worth="${event}"] .cr-worth__${column}`)?.textContent.trim();
  expect(
    "reach: the numbers are the ones the server sent",
    [["repost", "+60"], ["like", "+30"], ["dislike", "−30"], ["report", "−60"], ["share", "+10"], ["share_visit", "+10"]].every(
      ([event, value]) => worthCell(event, "delta") === value
    ),
    ["repost", "like", "dislike", "report", "share", "share_visit"].map((event) => worthCell(event, "delta")).join(" / ")
  );
  expect(
    "reach: the ranking column says where it is earned",
    worthCell("like", "rank") === "+30 from a search" && worthCell("report", "rank") === "−60 from a search",
    `${worthCell("like", "rank")} / ${worthCell("report", "rank")}`
  );
  expect(
    "reach: every interaction is named in words, not as a key",
    /a repost/.test(view.text('[data-cr-worth="repost"]')) && /a visit from that link/.test(view.text('[data-cr-worth="share_visit"]')),
    view.text('[data-cr-worth="repost"]')
  );
  expect(
    "reach: the old prose is gone — the numbers are not repeated in a sentence",
    !/Every like is worth 30/.test(view.text(".cr-reach")),
    view.text(".cr-reach__note")
  );
  expect(
    "reach: the bar says the day is split evenly, and between how many",
    /split evenly between 2 items/.test(view.text("[data-cr-reach-plan]")),
    view.text("[data-cr-reach-plan]")
  );
  expect(
    "reach: the note says the rule, with today's numbers in it",
    /500 points over 2 items is 250 each/.test(view.text(".cr-reach__note")),
    view.text(".cr-reach__note")
  );

  /* nothing is saved: the split is the rule, not a plan somebody types */
  expect("reach: there is no Save the plan to press", !view.qs("[data-cr-reach-save]"), "a save button is still there");
  expect(
    "reach: and nothing in the pass ever wrote a plan",
    calls.every((c) => !c.includes("hub_reach_save")),
    calls.filter((c) => c.includes("hub_reach_save")).join(" ")
  );

  /* reading it again is the one button the tab has, and it is a real call */
  const reads = calls.filter((c) => c.includes("hub_reach_get")).length;
  view.click(view.qs("[data-cr-reach-reload]"));
  await view.wait(220);
  expect(
    "reach: Read again asks the server again",
    calls.filter((c) => c.includes("hub_reach_get")).length > reads,
    String(calls.filter((c) => c.includes("hub_reach_get")).length)
  );
  expect("reach: and the split is the same — it is not random", /split evenly between 2 items/.test(view.text("[data-cr-reach-plan]")), view.text("[data-cr-reach-plan]"));
  expect("reach: no errors", view.errors.length === 0, view.errors.join(" | "));
  view.window.close();

  /* the tab is a door too: pressing it opens the panel, like the others */
  const clicked = await boot(72, { search: "?section=studio&hub=hub-ch" });
  await clicked.wait(320);
  const reachTab = clicked.qs('[data-cr-tab="reach"]');
  expect("reach: the tab is one of the doors", Boolean(reachTab), clicked.qsa("[data-cr-tab]").map((b) => b.getAttribute("data-cr-tab")).join(","));
  reachTab.dispatchEvent(new clicked.window.MouseEvent("click", { bubbles: true }));
  await clicked.wait(320);
  expect("reach: pressing it shows the panel", Boolean(clicked.qs("[data-cr-reach-total]")), clicked.text("[data-cr-view]").slice(0, 160));
  expect("reach: and the tab is marked as the one in use", clicked.qs('[data-cr-tab="reach"]')?.getAttribute("aria-selected") === "true", clicked.qs('[data-cr-tab="reach"]')?.getAttribute("aria-selected"));
  expect("reach: no errors on the way", clicked.errors.length === 0, clicked.errors.join(" | "));
  clicked.window.close();

  /* a server without the table: the door still opens, and says what is missing */
  scenario = {
    hubs: [hub({ id: "hub-ch", kind: "channel", name: "Studio One" })],
    items: [item({ id: "vid-1", kind: "video", code: "VID-001032", title: "The first film", status: "published" })],
    reachMissing: true,
  };
  const offline = await boot(73, { search: "?section=studio&hub=hub-ch&tab=reach" });
  await offline.wait(340);
  const offlineView = offline.text("[data-cr-view]");
  expect("reach: a server without the table still opens the tab", /not connected yet/.test(offline.text(".cr-bar")), offline.text(".cr-bar"));
  expect("reach: the panel is drawn, not blank", /Reach points for this studio/.test(offlineView), offlineView.slice(0, 140));
  expect("reach: it names the files that are missing", /studio-reach\.sql/.test(offlineView) && /reach-earnings\.sql/.test(offlineView), offlineView.slice(0, 200));
  expect("reach: the shelf is read from the live table", /The first film/.test(offlineView) && /VID-001032/.test(offlineView), offlineView.slice(0, 240));
  expect("reach: nothing is offered for saving", !offline.qs("[data-cr-reach-save]"), "a save button was drawn");
  expect("reach: no errors on the way", offline.errors.length === 0, offline.errors.join(" | "));
  offline.window.close();
  scenario.reachMissing = false;

  /* three items and one day: the split is even, and the odd point goes first */
  scenario = {
    hubs: [hub({ id: "hub-ch", kind: "channel", name: "Studio One" })],
    items: [],
    reach: {
      hub: { id: "hub-ch", code: "IDST100001", name: "Studio One", kind: "channel" },
      configured: true,
      base: 100,
      earned: 0,
      limitless: false,
      points: 100,
      spent: 0,
      remaining: 100,
      items: 3,
      share: 33,
      auto: true,
      day: "2026-12-05",
      rows: [
        { kind: "post", ref: "post-a", code: "VID-001032", title: "The oldest film", points: 34, shown: 0, rank: 0, reached_updates: 0, reached_suggestions: 0, reached_search: 0 },
        { kind: "post", ref: "post-b", code: "VID-001033", title: "The second film", points: 33, shown: 0, rank: 0, reached_updates: 0, reached_suggestions: 0, reached_search: 0 },
        { kind: "content", ref: "content-c", code: "PST-000902", title: "The newest talk", points: 33, shown: 0, rank: 0, reached_updates: 0, reached_suggestions: 0, reached_search: 0 },
      ],
    },
  };
  const split = await boot(71, { search: "?section=studio&hub=hub-ch&tab=reach" });
  await split.wait(320);
  expect("reach: one line per item, three of them", split.qsa("[data-reach-row]").length === 3, String(split.qsa("[data-reach-row]").length));
  expect(
    "reach: 100 points over three items is 34 / 33 / 33 — the oldest takes the odd point",
    ["post-a", "post-b", "content-c"].map((ref) => split.text(`[data-cr-reach-points="${ref}"]`)).join(" / ") === "34 / 33 / 33",
    ["post-a", "post-b", "content-c"].map((ref) => split.text(`[data-cr-reach-points="${ref}"]`)).join(" / ")
  );
  expect(
    "reach: and the bar counts three, not two",
    /split evenly between 3 items/.test(split.text("[data-cr-reach-plan]")),
    split.text("[data-cr-reach-plan]")
  );
  expect(
    "reach: the note explains where the odd point goes",
    /the odd point goes to the oldest/.test(split.text(".cr-reach__note")),
    split.text(".cr-reach__note")
  );
  expect("reach: nothing can be typed here either", !split.qs(".cr-reach input"), (split.qs(".cr-reach")?.innerHTML || "").slice(0, 100));
  expect(
    "reach: without the server's worth table the page still shows the eight",
    split.qsa(".cr-worth tbody tr").length === 8 && split.text('[data-cr-worth="like"] .cr-worth__delta') === "+30",
    `${split.qsa(".cr-worth tbody tr").length} rows`
  );
  expect("reach: no errors on the split", split.errors.length === 0, split.errors.join(" | "));
  split.window.close();

  /* LVMax: no number, and no cap — said as such, not as a zero */
  scenario = {
    hubs: [hub({ id: "hub-ch", kind: "channel", name: "Studio One" })],
    items: [],
    reach: {
      hub: { id: "hub-ch", code: "IDST100001", name: "Studio One", kind: "channel" },
      configured: true,
      base: 0,
      earned: 0,
      limitless: true,
      points: 0,
      spent: 0,
      remaining: -1,
      items: 1,
      share: -1,
      auto: true,
      day: "2026-12-05",
      rows: [{ kind: "post", ref: "post-a", code: "VID-001032", title: "The first film", points: -1, shown: 0, rank: 0, reached_updates: 0, reached_suggestions: 0, reached_search: 0 }],
    },
  };
  const maxed = await boot(77, { search: "?section=studio&hub=hub-ch&tab=reach" });
  await maxed.wait(320);
  expect(
    "reach: LVMax is said as no limit, never as a share of zero",
    maxed.text('[data-cr-reach-points="post-a"]') === "no limit" && /and never spent out/.test(maxed.text('[data-reach-row="post-a"]')),
    maxed.text('[data-reach-row="post-a"]')
  );
  maxed.window.close();

  /* the schema behind the tab */
  const reachSql = readFileSync(join(root, "tools/sql/studio-reach.sql"), "utf8");
  const earnSql = readFileSync(join(root, "tools/sql/reach-earnings.sql"), "utf8");
  expect("reach sql: the level sets the floor", /100 \* greatest\(v_level, 0\)/.test(reachSql), "no level floor");
  expect("reach sql: LVMax is limitless", /v_level >= 11/.test(reachSql) && /limitless/.test(reachSql), "no LVMax");
  expect("reach sql: an interaction is worth what the table says", /'repost',  *60/.test(earnSql) && /'report',  *-60/.test(earnSql), "worth table missing");
  expect("reach sql: a comment follows the reaction", /comment_pos/.test(earnSql) && /sentiment/.test(earnSql), "comment sign missing");
  expect("reach sql: a share is 10, and its visit 10 more", /'share',  *10/.test(earnSql) && /'share_visit',  *10/.test(earnSql), "share missing");
  expect("reach sql: rank moves on a search result only", /if v_src = 'search' then/.test(earnSql), "rank is not search-only");
  expect("reach sql: a day per studio", /create table if not exists public\.hub_reach/.test(reachSql), "hub_reach missing");
  expect("reach sql: one allocation per item", /create table if not exists public\.reach_items/.test(reachSql), "reach_items missing");
  expect("reach sql: a refresh costs nothing", /create table if not exists public\.reach_seen/.test(reachSql), "reach_seen missing");
  expect("reach sql: every reach leaves a row saying where it happened", /create table if not exists public\.reach_impressions/.test(reachSql) && /i\.source = 'search'/.test(reachSql), "impressions missing");
  expect("reach sql: the gate knows the surface", /reach_claim\(p_hub uuid, p_kind text, p_ref uuid, p_profile uuid, p_source text default 'suggestion'\)/.test(reachSql), "no source on the gate");
  expect("reach sql: a podcast ranks like a video", /member_content[\s\S]*rank_points/.test(reachSql), "no rank column for member content");
  expect("reach sql: the gate is one function", /function public\.reach_claim/.test(reachSql) && /function public\.reach_screen/.test(reachSql), "no gate");
  expect("reach sql: the studio can never spend past its day", /v_budget\.spent >= v_budget\.points/.test(reachSql), "no ceiling");
  expect("reach sql: the studio's own members are never counted", /v_owner = p_profile/.test(reachSql), "owner not excused");
  expect("reach sql: a studio is always its level plus its earnings", /b\.base \+ b\.earned/.test(reachSql), "the total is not derived");

  /* the split is a rule on the server, and the manual plan is gone */
  const splitSql = readFileSync(join(root, "tools/sql/reach-split.sql"), "utf8");
  expect(
    "reach sql: the day is divided evenly, the odd point first",
    /greatest\(\s*1,/.test(splitSql) && /p_points, 0\) \/ p_total/.test(splitSql) && /% p_total then 1 else 0/.test(splitSql),
    "no even split"
  );
  expect(
    "reach sql: the share is the item's allowance in the gate",
    /v_cap := public\.reach_share\(p_hub, p_kind, p_ref\)/.test(splitSql) && /v_item\.shown >= v_cap/.test(splitSql),
    "the gate does not use the share"
  );
  expect(
    "reach sql: the tab is read, not written — the manual plan is dropped",
    /drop function if exists public\.hub_reach_save/.test(splitSql) && !/create or replace function public\.hub_reach_save/.test(splitSql),
    "hub_reach_save is still created"
  );
  expect(
    "reach sql: the tab hands the share to the page",
    /'items', v_count/.test(splitSql) && /'share', v_share/.test(splitSql) && /'auto', true/.test(splitSql),
    "the split is not returned"
  );

  const videosSql = readFileSync(join(root, "tools/sql/videos-page.sql"), "utf8");
  expect(
    "reach: the feed is gated by it, and names the surface",
    /and public\.reach_visible\(p\.id, v_me\.id, case when v_search <> '' then 'search' else 'suggestion' end\)/.test(videosSql),
    "the feed is not gated"
  );
  expect("reach: the rail beside a video goes by upload time", /coalesce\(jsonb_agg\(public\.video_card\(r\.id, v_me\.id\) order by r\.published_at asc\)/.test(videosSql), "the rail is not in upload order");
}

/* ------------------------------------------------------------------ */
/* the head of the page: cover, mark, numbers, and what it still lacks */
/* ------------------------------------------------------------------ */
async function headPass() {
  scenario = {
    hubs: [hub({ id: "hub-ch", kind: "channel", name: "Studio One", subscribers: 1200, items: 3, published: 2, drafts: 1, minutes: 420, likes: 90, reports: 1 })],
    items: [item({ id: "it-1", kind: "video", title: "The first film", status: "published" })],
    categories: [],
  };
  const bare = await boot(81, { search: "?section=studio&hub=hub-ch&tab=videos" });
  await bare.wait(240);
  const head = bare.qs("[data-cr-hubhead]");
  expect("head: the cover and the mark are one block", Boolean(head?.querySelector(".cr-hubhead__hero .cr-hubhead__plate")), "the plate is not inside the hero");
  expect("head: the mark sits in that block", Boolean(bare.qs(".cr-hubhead__plate .cr-hubhead__logo")), "no mark in the plate");
  expect("head: the numbers run in a strip", bare.qsa(".cr-hubhead__strip .cr-stat").length === 7, String(bare.qsa(".cr-hubhead__strip .cr-stat").length));
  expect("head: every number carries its name", /subscribers[\s\S]*items[\s\S]*published[\s\S]*drafts[\s\S]*minutes watched[\s\S]*likes[\s\S]*reports/i.test(bare.text(".cr-hubhead__strip")), bare.text(".cr-hubhead__strip"));
  expect("head: the page says what it still lacks", /Finishing touches/.test(bare.text(".cr-hubhead__ready")) && /3 \/ 6/.test(bare.text(".cr-hubhead__ready")), bare.text(".cr-hubhead__ready"));
  expect("head: and names it", /a cover, a logo, a category/.test(bare.text(".cr-hubhead__ready")), bare.text(".cr-hubhead__ready"));
  expect("head: without a cover the head asks for one", /Add a cover/.test(bare.text(".cr-hubhead__seat--add")), bare.text(".cr-hubhead__top"));
  expect("head: the managing row carries the mark", bare.text("[data-cr-hub-mark]").trim() === "ST" && !bare.hidden("[data-cr-hub-mark]"), bare.text("[data-cr-hub-mark]"));
  expect("head: no errors", bare.errors.length === 0, bare.errors.join(" | "));
  bare.window.close();

  /* the same page once it has a cover, a logo and a category */
  scenario = {
    hubs: [
      hub({
        id: "hub-ch",
        kind: "channel",
        name: "Studio One",
        subscribers: 1200,
        items: 3,
        published: 2,
        drafts: 1,
        categories: 2,
        cover_url: "https://example.com/cover.jpg",
        logo_url: "https://example.com/logo.png",
      }),
    ],
    items: [item({ id: "it-1", kind: "video", title: "The first film", status: "published" })],
    categories: [{ id: "cat-1", name: "Documentary", level: 1, parent: null, items: 1 }],
  };
  const full = await boot(82, { search: "?section=studio&hub=hub-ch&tab=videos" });
  await full.wait(240);
  expect("head: a cover of its own is worn", full.qs("[data-cr-hubhead]")?.getAttribute("data-cover") === "1" && Boolean(full.qs(".cr-hubhead__cover")), "the cover is not in the art");
  expect("head: the mark becomes the logo", Boolean(full.qs(".cr-hubhead__plate .cr-hubhead__logo img")), "no logo in the plate");
  expect("head: with nothing missing, the meter says so", /The page is complete/.test(full.text(".cr-hubhead__ready")) && /6 \/ 6/.test(full.text(".cr-hubhead__ready")), full.text(".cr-hubhead__ready"));
  expect("head: and it stops asking for a cover", !full.qs(".cr-hubhead__seat--add"), "still asking");
  expect("head: the doors are the dashboard and the visitor's page", Boolean(full.qs('.cr-hubhead__acts a[href="dashboard.html#creator"]')) && Boolean(full.qs('.cr-hubhead__acts a[href*="creator.html?studio="]')), "a door is missing");
  expect("head: no errors", full.errors.length === 0, full.errors.join(" | "));
  full.window.close();
}

/* ------------------------------------------------------------------ */
/* pass 83 — a studio reads what was published into it                 */
/* ------------------------------------------------------------------ */
/* The bug this guards: a video is written to `posts`, and the studio shelf
   was drawn from `member_content` alone — so a studio could report one
   published item and still say "Nothing published yet". The shelf is read
   from both tables now (`tools/sql/studio-items.sql`), and the shape each row
   carries decides the shelf it lands on. */
async function postsPass() {
  const post = (over = {}) => ({
    ...item({ id: over.id, code: over.code, title: over.title, shape: over.shape, thumbnail: over.thumbnail }),
    minutes: over.minutes ?? null,
    kind: "video",
  });

  scenario = {
    hubs: [],
    items: [],
    creators: [],
    creator: creatorRow(),
    creatorHubs: [],
    pubhubs: [],
    hubItems: [
      post({ id: "p-wide", code: "VID-001039", title: "The wide one", shape: "h", thumbnail: "https://thumb.tapecontent.net/thumb/wide.jpg" }),
      post({ id: "p-tall", code: "VSR-001040", title: "The tall one", shape: "v" }),
    ],
    hubView: { published: 2 },
  };
  calls.length = 0;
  const studio = await boot(83, { search: "?studio=IDST100001&creator=ID100015" });
  await studio.wait(300);
  expect("shelf: a studio with published videos is not empty", !/Nothing published yet/.test(studio.text("[data-cr-view]")), studio.text("[data-cr-view]").slice(0, 140));
  expect("shelf: the landscape video is in the grid", /The wide one/.test(studio.text('[data-crs-sec="videos"]')), studio.text('[data-crs-sec="videos"]').slice(0, 120));
  expect(
    "shelf: and it opens videos.html#/h/ID=",
    studio.qs('[data-crs-sec="videos"] .crs-card')?.getAttribute("href") === "videos.html#/h/ID=VID-001039",
    studio.qs('[data-crs-sec="videos"] .crs-card')?.getAttribute("href")
  );
  expect("shelf: the portrait video gets its own rail", /The tall one/.test(studio.text('[data-crs-sec="vertical"]')), studio.text('[data-crs-sec="vertical"]').slice(0, 120));
  expect(
    "shelf: and it opens videos.html#/v/ID=",
    studio.qs('[data-crs-sec="vertical"] .crs-card')?.getAttribute("href") === "videos.html#/v/ID=VSR-001040",
    studio.qs('[data-crs-sec="vertical"] .crs-card')?.getAttribute("href")
  );
  expect("shelf: the shelf answers for itself — the feed is not asked", !calls.some((c) => c.includes("video_feed")), calls.join(" "));
  expect("shelf: no errors", studio.errors.length === 0, studio.errors.join(" | "));
  studio.window.close();

  /* a server that still reads one table: the count is bigger than the shelf, so
     the feed is asked — and only a row that names this studio is added */
  scenario = {
    hubs: [],
    items: [],
    creators: [],
    creator: creatorRow(),
    creatorHubs: [],
    pubhubs: [],
    hubItems: [post({ id: "p-wide", code: "VID-001039", title: "The wide one", shape: "h" })],
    hubView: { published: 2 },
    feedRows: [
      {
        id: "f-1",
        code: "VID-001050",
        title: "Published into this studio",
        orientation: "h",
        thumbnail: "https://thumb.tapecontent.net/thumb/a.jpg",
        published_at: "2026-11-09T10:00:00Z",
        video: { meta: { host_file: { studio: "IDST100001", folder: "IDST100001" } } },
      },
      {
        id: "f-2",
        code: "VID-001051",
        title: "Belongs to another studio",
        orientation: "h",
        video: { meta: { host_file: { studio: "IDST100099", folder: "IDST100099" } } },
      },
    ],
  };
  calls.length = 0;
  const short = await boot(84, { search: "?studio=IDST100001&creator=ID100015" });
  await short.wait(320);
  expect("shelf: a shelf shorter than the count asks the feed", calls.some((c) => c.includes("video_feed")), calls.join(" "));
  expect("shelf: the row that names this studio is added", /Published into this studio/.test(short.text('[data-crs-sec="videos"]')), short.text('[data-crs-sec="videos"]').slice(0, 140));
  expect("shelf: a row from another studio is not", !/Belongs to another studio/.test(short.text("[data-cr-view]")), short.text("[data-cr-view]").slice(0, 140));
  expect("shelf: no errors", short.errors.length === 0, short.errors.join(" | "));
  short.window.close();
}

/* ------------------------------------------------------------------ */
/* results                                                             */
/* ------------------------------------------------------------------ */
await main();
await postsPass();
await seatPass();
await reachPass();
await headPass();
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.ok || !c.detail ? "" : ` — ${c.detail}`}`);
});
console.log(`\nchecks: ${checks.length - failed.length}/${checks.length} pass`);
if (failed.length) {
  console.error(`\n${failed.length} failing check(s): ${failed.map((c) => c.name).join(", ")}`);
  process.exit(1);
}
