/**
 * profile.html smoke test (jsdom, no network).
 *
 *   node tools/profile-smoke.mjs
 *
 * Pass 1 — owner: header fields, member ID, stats, the three tabs, the owner
 *          menu, the connection cylinder, the settings switches (and their
 *          save call), the followers list with a pending request, and the
 *          block panel with its block call.
 * Pass 2 — visitor: no member ID, no Activity tab, hidden connection status,
 *          the Follow button and the pending state after the request.
 * Pass 3 — a blocked profile: the page refuses to draw the profile.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "profile.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
/* the page stylesheet, injected so getComputedStyle() can answer questions
   about [hidden] — jsdom does not fetch external CSS on its own */
const css = readFileSync(join(root, "assets/css/profile.css"), "utf8");

const TOKEN = "c".repeat(64);
const OWNER = {
  id: "6a1c4b0e-3f2d-4a55-9a10-1f0e2d3c4b5a",
  member_id: "ID100003",
  username: "@ledsizar",
  name: "MOUAOUINE EL MEHDI",
  description: "Iam test",
  avatar: null,
  cover: null,
  city: null,
  country: "Morocco",
  language: "en",
  age: null,
  level: 3,
  wealth: 1250,
  membership: "gold",
  online: true,
  created_at: "2026-10-31T23:00:56Z",
};

const OTHER = {
  id: "9b2e5c1d-7a44-4c3b-8f01-2d3e4c5b6a70",
  member_id: null,
  username: "@sara",
  name: "Sara Bennani",
  description: "Writes about cinema.",
  avatar: null,
  cover: null,
  city: "Casablanca",
  country: "Morocco",
  language: "ar",
  age: null,
  level: 2,
  wealth: null,
  membership: "free",
  online: null,
  created_at: "2026-09-12T10:00:00Z",
};

const SETTINGS = {
  show_country: true,
  show_language: true,
  show_age: false,
  show_level: true,
  show_wealth: false,
  show_connection: true,
  auto_accept_follow: false,
  auto_accept_message: false,
  auto_accept_publish: false,
  auto_accept_participate: false,
  allow_keyword_follows: true,
};

const FEED = [
  {
    id: "post-1",
    code: "PST-000101",
    type: "video",
    title: "The monochrome century",
    description: "A short look at black-and-white film.",
    thumbnail: null,
    embed: "https://example.com/watch",
    language: "ar",
    translation_status: "manual",
    visibility: "general",
    status: "published",
    published_at: new Date(Date.now() - 3600000).toISOString(),
    scheduled_at: null,
    read_minutes: 3,
    word_count: 540,
    rank_points: 45,
    reach_points: 12,
    publisher: { id: "9b2e5c1d-7a44-4c3b-8f01-2d3e4c5b6a70", username: "@sara", name: "Sara Bennani", avatar: null, online: true },
    author: { id: "9b2e5c1d-7a44-4c3b-8f01-2d3e4c5b6a70", username: "@sara", name: "Sara Bennani", avatar: null },
    counters: { likes: 30, dislikes: 4, comments: 2, reshares: 7, shares: 1, reports: 0, impressions: 120, clicks: 9, watch_minutes: 44 },
    keywords: [
      { id: "k1", keyword: "Cinema", role: "main", parent_id: null },
      { id: "k2", keyword: "Noir", role: "sub", parent_id: "k1" },
    ],
    related: [{ label: "Source", url: "https://example.com" }],
    translations: [{ language: "en", title: "The monochrome century", status: "ready", kind: "manual", description: null }],
    audience: [],
    mine: { reaction: null, reshared: false, reported: false, can_interact: true, can_manage: false },
  },
];

const calls = [];
let scenario = {};

function reply(data) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
}

function publicPayload() {
  if (scenario.hidden) {
    return {
      ok: true,
      hidden: true,
      reason: "blocked",
      profile: { id: OTHER.id, username: OTHER.username, name: OTHER.name },
    };
  }
  if (scenario.owner) {
    return {
      ok: true,
      hidden: false,
      profile: OWNER,
      stats: { followers: 12, following: 5, posts: 0, reach: 240, rank_avg: 0 },
      settings: SETTINGS,
      relationship: {
        is_owner: true,
        following: "none",
        follows_you: false,
        blocked_by_me: false,
        blocked_me: false,
        can_follow: false,
        can_message: false,
        signed_in: true,
      },
    };
  }
  return {
    ok: true,
    hidden: false,
    profile: OTHER,
    stats: { followers: 3, following: 1, posts: 0, reach: 90, rank_avg: 0 },
    settings: null,
    relationship: {
      is_owner: false,
      following: scenario.following || "none",
      follows_you: false,
      blocked_by_me: false,
      blocked_me: false,
      can_follow: true,
      can_message: true,
      signed_in: true,
    },
  };
}

function stubFetch(url, opts = {}) {
  const href = String(url);
  const body = opts.body ? JSON.parse(opts.body) : {};
  calls.push({ href, body });

  if (href.includes("/rpc/profile_public")) return reply(publicPayload());
  if (href.includes("/rpc/profile_settings_get")) return reply({ ok: true, settings: { ...SETTINGS } });
  if (href.includes("/rpc/profile_settings_save")) {
    Object.assign(SETTINGS, body.p_settings || {});
    return reply({ ok: true, settings: { ...SETTINGS } });
  }
  if (href.includes("/rpc/profile_follow_lists")) {
    return reply({
      ok: true,
      owner: Boolean(scenario.owner),
      followers: [
        { id: "f1", username: "@sara", name: "Sara Bennani", avatar: null, status: "pending", since: "2026-11-01T02:00:00Z", online: true, can_accept: true },
      ],
      following: scenario.owner
        ? [{ id: "f2", username: "@amine", name: "Amine", avatar: null, status: "active", since: "2026-10-30T02:00:00Z", online: false }]
        : [],
      counts: { followers_active: 0, followers_pending: 1, following_active: scenario.owner ? 1 : 0, following_pending: 0 },
    });
  }
  if (href.includes("/rpc/profile_follow_toggle")) {
    scenario.following = "pending";
    return reply({ ok: true, following: true, status: "pending" });
  }
  if (href.includes("/rpc/profile_follow_respond")) return reply({ ok: true, status: "active" });
  if (href.includes("/rpc/profile_blocks_list")) {
    return reply({
      ok: true,
      blocks: scenario.blocks || [],
    });
  }
  if (href.includes("/rpc/profile_block_set")) {
    scenario.blocks = [
      { id: "b1", username: body.p_ref, name: body.p_ref, avatar: null, view_profile: true, view_posts: true, message: true, publish: true, participate: true, react: true, comment: true, reason: null, since: "2026-11-01T03:00:00Z" },
    ];
    return reply({ ok: true, blocked: true, flags: {} });
  }
  if (href.includes("/rpc/profile_block_remove")) return reply({ ok: true, blocked: false });
  if (href.includes("/rpc/profile_links_list")) return reply({ ok: true, owner: true, links: [] });
  if (href.includes("/rpc/profile_links_save")) return reply({ ok: true, platform: body.p_platform });
  if (href.includes("/rpc/profile_feed")) {
    return reply({
      ok: true,
      kind: body.p_kind,
      count: scenario.feed?.length || 0,
      total: scenario.feed?.length || 0,
      posts: scenario.feed || [],
    });
  }
  if (href.includes("/rpc/post_create")) {
    scenario.created = body.p_payload;
    return reply({ ok: true, post: { id: "new-post", code: "PST-000123" }, status: "published", scheduled_at: null });
  }
  if (href.includes("/rpc/post_reactors")) {
    return reply({
      ok: true,
      kind: body.p_kind,
      count: 2,
      members: [
        { id: "f1", username: "@sara", name: "Sara Bennani", avatar: null, online: true, relation: "follow_you" },
        { id: "f2", username: "@amine", name: "Amine", avatar: null, online: false, relation: "others" },
      ],
    });
  }
  if (href.includes("/rpc/post_react")) {
    scenario.reaction = body.p_value;
    return reply({
      ok: true,
      reaction: body.p_value || null,
      likes: body.p_value === 1 ? 31 : 30,
      dislikes: body.p_value === -1 ? 5 : 4,
    });
  }
  if (href.includes("/rpc/post_comments")) {
    return reply({
      ok: true,
      comments: [
        { id: "c1", body: "Great piece", parent_id: null, polarity: 1, likes: 2, dislikes: 0, mine: false, edited: false, created_at: new Date(Date.now() - 60000).toISOString(), author: { id: "f1", username: "@sara", name: "Sara Bennani", avatar: null } },
      ],
    });
  }
  if (href.includes("/rpc/post_comment")) {
    if (!scenario.reaction) return reply({ ok: false, error: "reaction" });
    return reply({ ok: true, comment: { id: "c2" }, comments: 3 });
  }
  if (href.includes("/rpc/post_reshare")) return reply({ ok: true, reshared: true, reshares: 8 });
  if (href.includes("/rpc/post_report")) return reply({ ok: true, reported: true });
  if (href.includes("/rpc/post_delete")) return reply({ ok: true, deleted: true, archived: true });
  if (href.includes("/profiles?")) return reply([]);
  return reply({ ok: true });
}

async function boot(pass, search = "") {
  scenario = { ...scenario, owner: pass === 1 || pass === 4 };
  const dom = new JSDOM(html, { url: `http://localhost/profile.html${search}`, pretendToBeVisual: true });
  const { window } = dom;
  const style = window.document.createElement("style");
  style.textContent = css;
  window.document.head.appendChild(style);
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
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.FormData = window.FormData;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
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
    href: `http://localhost/profile.html${search}`,
    protocol: "http:",
    pathname: "/profile.html",
    replace(target) {
      this.href = String(target);
    },
  };
  globalThis.fetch = stubFetch;
  window.scrollTo = () => {};

  window.localStorage.clear();
  window.localStorage.setItem("1w.session", TOKEN);
  window.localStorage.setItem(
    "1w.member",
    JSON.stringify({ id: OWNER.id, memberId: OWNER.member_id, username: OWNER.username, name: OWNER.name, level: 3, points: 1250 })
  );

  await import(`file://${join(root, "assets/js/profile.js")}?pass=${pass}`);
  await new Promise((r) => setTimeout(r, 200));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const wait = (ms = 140) => new Promise((r) => setTimeout(r, ms));
  return { window, document: window.document, qs, qsa, text, click, wait, errors };
}

const checks = [];
function expect(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

/* ------------------------------------------------------------------ */
/* pass 1 — owner                                                     */
/* ------------------------------------------------------------------ */
{
  scenario = { owner: true, following: "none", blocks: [] };
  calls.length = 0;
  const p = await boot(1, "");

  expect("owner: name rendered", p.text("[data-pf-name]").includes("MOUAOUINE EL MEHDI"), p.text("[data-pf-name]"));
  expect("owner: username rendered", p.text("[data-pf-username]") === "@ledsizar", p.text("[data-pf-username]"));
  expect("owner: member ID in the sidebar", p.text("[data-pf-side-id]").includes("ID100003"), p.text("[data-pf-side-id]"));
  expect("owner: followers stat", p.text("[data-pf-stat-followers]") === "12", p.text("[data-pf-stat-followers]"));
  expect("owner: reach stat", p.text("[data-pf-stat-reach]") === "240", p.text("[data-pf-stat-reach]"));
  expect("owner: level badge", /L3/.test(p.text("[data-pf-flags]")), p.text("[data-pf-flags]"));
  expect("owner: country in the meta", p.text("[data-pf-meta]").includes("Morocco"), p.text("[data-pf-meta]"));
  expect("owner: connection cylinder on", p.qs("[data-pf-conn]")?.classList.contains("is-on") === true);
  expect("owner: three tabs", p.qsa(".pf-tab").length === 3, String(p.qsa(".pf-tab").length));
  expect("owner: activity tab present", p.qsa(".pf-tab").some((tab) => tab.dataset.pfView === "activity"));
  expect("owner: menu rendered", p.qsa("[data-pf-menu] [data-pf-view]").length >= 8, String(p.qsa("[data-pf-menu] [data-pf-view]").length));
  expect("owner: updates tab is first", p.text(".pf-tab.is-active") === "Updates", p.text(".pf-tab.is-active"));
  expect("owner: every icon hydrated to svg", p.qsa("[data-icon]").length === 0, `${p.qsa("[data-icon]").length} left`);
  expect(
    "owner: loading skeleton is gone",
    p.window.getComputedStyle(p.qs("[data-pf-state]")).display === "none",
    p.window.getComputedStyle(p.qs("[data-pf-state]")).display
  );
  expect(
    "owner: profile grid is visible",
    p.window.getComputedStyle(p.qs("[data-pf-root]")).display !== "none",
    p.window.getComputedStyle(p.qs("[data-pf-root]")).display
  );
  expect("owner: svg icons drawn", p.qsa("svg.ico").length >= 20, String(p.qsa("svg.ico").length));
  expect("owner: stats carry icons", p.qsa(".pf-stats dt svg").length === 3, String(p.qsa(".pf-stats dt svg").length));
  expect("owner: tabs carry icons", p.qsa(".pf-tab svg").length === 3, String(p.qsa(".pf-tab svg").length));
  expect("owner: empty feed explains M2", /No posts yet/.test(p.text("[data-pf-panel]")), p.text("[data-pf-panel]").slice(0, 80));

  // settings panel
  p.click(p.qs('[data-pf-view="settings"]'));
  await p.wait(200);
  expect("owner: settings fetched", calls.some((c) => c.href.includes("profile_settings_get")));
  expect("owner: eleven switches", p.qsa(".pf-switch").length === 11, String(p.qsa(".pf-switch").length));
  expect("owner: country switch on", p.qs('[data-pf-toggle="show_country"]')?.getAttribute("aria-checked") === "true");
  expect("owner: links panel rendered", p.qsa("[data-pf-link-url]").length === 9, String(p.qsa("[data-pf-link-url]").length));
  expect("owner: nine brand svgs", p.qsa(".pf-link-row__name svg.brand-svg").length === 9, String(p.qsa(".pf-link-row__name svg.brand-svg").length));
  expect("owner: no icon left after a tab switch", p.qsa("[data-icon]").length === 0, `${p.qsa("[data-icon]").length} left`);
  expect("owner: menu icons survive the switch", p.qsa("[data-pf-menu] svg.ico").length >= 8, String(p.qsa("[data-pf-menu] svg.ico").length));

  p.click(p.qs('[data-pf-toggle="show_country"]'));
  await p.wait(200);
  const saved = calls.find((c) => c.href.includes("profile_settings_save"));
  expect("owner: switch calls save", Boolean(saved));
  expect("owner: save payload", saved?.body?.p_settings?.show_country === false, JSON.stringify(saved?.body));
  expect("owner: switch flipped", p.qs('[data-pf-toggle="show_country"]')?.getAttribute("aria-checked") === "false");

  // followers
  p.click(p.qs('[data-pf-view="followers"]'));
  await p.wait(240);
  expect("owner: followers fetched", calls.some((c) => c.href.includes("profile_follow_lists")));
  const followersText = p.text("[data-pf-panel]");
  expect("owner: pending countered", /0 actual · 1 pending/.test(followersText), followersText.slice(0, 120));
  expect("owner: accept button", Boolean(p.qs('[data-pf-act="accept"]')));

  p.click(p.qs('[data-pf-act="accept"]'));
  await p.wait(240);
  const responded = calls.find((c) => c.href.includes("profile_follow_respond"));
  expect("owner: accept calls respond", Boolean(responded));
  expect("owner: respond payload", responded?.body?.p_accept === true && responded?.body?.p_ref === "@sara", JSON.stringify(responded?.body));

  // blocks
  p.click(p.qs('[data-pf-view="blocks"]'));
  await p.wait(240);
  expect("owner: blocks fetched", calls.some((c) => c.href.includes("profile_blocks_list")));
  expect("owner: block form", Boolean(p.qs("[data-pf-block-input]")));
  p.qs("[data-pf-block-input]").value = "@troll";
  p.click(p.qs('[data-pf-act="block-ref"]'));
  await p.wait(240);
  const blocked = calls.find((c) => c.href.includes("profile_block_set"));
  expect("owner: block calls rpc", Boolean(blocked));
  expect("owner: block payload", blocked?.body?.p_ref === "@troll", JSON.stringify(blocked?.body));

  expect("owner: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* pass 2 — visitor                                                   */
/* ------------------------------------------------------------------ */
{
  scenario = { owner: false, following: "none", blocks: [] };
  calls.length = 0;
  const p = await boot(2, "?u=%40sara");

  expect("visitor: profile resolved from ?u", calls.some((c) => c.href.includes("profile_public") && c.body?.p_ref === "@sara"), JSON.stringify(calls[0]?.body));
  expect("visitor: name rendered", p.text("[data-pf-name]") === "Sara Bennani", p.text("[data-pf-name]"));
  expect("visitor: no member ID", p.qs("[data-pf-side-id]")?.hidden === true);
  expect("visitor: two tabs", p.qsa(".pf-tab").length === 2, String(p.qsa(".pf-tab").length));
  expect("visitor: no activity tab", !p.qsa(".pf-tab").some((tab) => tab.dataset.pfView === "activity"));
  expect("visitor: connection hidden", p.qs("[data-pf-conn]")?.hidden === true);
  expect(
    "visitor: cylinder takes no space",
    p.window.getComputedStyle(p.qs("[data-pf-conn]")).display === "none",
    p.window.getComputedStyle(p.qs("[data-pf-conn]")).display
  );
  expect("visitor: follow button", /Follow/.test(p.text('[data-pf-act="follow"]')), p.text('[data-pf-act="follow"]'));
  expect("visitor: no owner menu", p.qsa("[data-pf-menu] [data-pf-view]").length === 0);
  expect("visitor: icons hydrated", p.qsa("[data-icon]").length === 0, `${p.qsa("[data-icon]").length} left`);
  expect("visitor: svg icons drawn", p.qsa("svg.ico").length >= 10, String(p.qsa("svg.ico").length));

  p.click(p.qs('[data-pf-act="follow"]'));
  await p.wait(260);
  const toggled = calls.find((c) => c.href.includes("profile_follow_toggle"));
  expect("visitor: follow calls rpc", Boolean(toggled));
  expect("visitor: follow payload", toggled?.body?.p_ref === "@sara", JSON.stringify(toggled?.body));
  expect("visitor: requested state", /Requested/.test(p.text('[data-pf-act="follow"]')), p.text('[data-pf-act="follow"]'));
  expect("visitor: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* pass 3 — blocked                                                   */
/* ------------------------------------------------------------------ */
{
  scenario = { owner: false, hidden: true, following: "none", blocks: [] };
  calls.length = 0;
  const p = await boot(3, "?u=%40sara");

  expect("blocked: profile not drawn", p.qs("[data-pf-root]")?.hidden === true);
  expect(
    "blocked: grid takes no space",
    p.window.getComputedStyle(p.qs("[data-pf-root]")).display === "none",
    p.window.getComputedStyle(p.qs("[data-pf-root]")).display
  );
  expect(
    "blocked: state card visible",
    p.window.getComputedStyle(p.qs("[data-pf-state]")).display !== "none",
    p.window.getComputedStyle(p.qs("[data-pf-state]")).display
  );
  expect("blocked: reason shown", /not available/i.test(p.text("[data-pf-state]")), p.text("[data-pf-state]").slice(0, 120));
  expect("blocked: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* pass 4 — posts and the composer                                    */
/* ------------------------------------------------------------------ */
{
  scenario = { owner: true, following: "none", blocks: [], feed: FEED.map((post) => ({ ...post })), reaction: null };
  calls.length = 0;
  const p = await boot(4, "");

  expect("feed: card drawn", p.qsa("[data-post]").length === 1, String(p.qsa("[data-post]").length));
  expect("feed: title rendered", p.text(".pc__title") === "The monochrome century", p.text(".pc__title"));
  expect("feed: publisher rendered", p.text(".pc__name") === "Sara Bennani", p.text(".pc__name"));
  expect("feed: empty state gone", !/No posts yet/.test(p.text("[data-pf-panel]")), p.text("[data-pf-panel]").slice(0, 60));
  expect("feed: embed opens a new window", p.qs(".pc__embed")?.getAttribute("target") === "_blank");
  expect("feed: keywords as chips", p.qsa('[data-pc-pane="content"] .pc__kws .chip').length === 2, String(p.qsa('[data-pc-pane="content"] .pc__kws .chip').length));
  expect("feed: action bar has every action", p.qsa(".pc__act").length === 6, String(p.qsa(".pc__act").length));
  expect("feed: content info pane hidden", p.qs('[data-pc-pane="info"]').hidden === true);

  p.click(p.qs('[data-pc-tab="info"]'));
  await p.wait(60);
  expect("feed: content info pane opens", p.qs('[data-pc-pane="info"]').hidden === false);
  expect("feed: content pane closes", p.qs('[data-pc-pane="content"]').hidden === true);
  expect("feed: info shows the language", /AR/.test(p.text('[data-pc-pane="info"]')), p.text('[data-pc-pane="info"]').slice(0, 60));
  expect("feed: icons hydrated", p.qsa("[data-icon]").length === 0, `${p.qsa("[data-icon]").length} left`);

  // comment is refused until the post is reacted to
  p.click(p.qs('[data-pc-act="comments"]'));
  await p.wait(120);
  expect("comments: pane opens", p.qs("[data-pc-comments]").hidden === false);
  expect("comments: input locked before a reaction", p.qs("[data-pc-input]")?.disabled === true);
  expect("comments: rule explained", /Like or dislike/i.test(p.text("[data-pc-hint]")), p.text("[data-pc-hint]"));
  expect("comments: list loaded", /Great piece/.test(p.text("[data-pc-comment-list]")), p.text("[data-pc-comment-list]").slice(0, 60));

  // like → counters and unlocked comment box
  p.click(p.qs('[data-pc-act="like"]'));
  await p.wait(160);
  expect("like: rpc called with 1", calls.some((c) => c.href.includes("post_react") && c.body.p_value === 1));
  expect("like: counter updated", p.text('[data-pc-count="likes"]') === "31", p.text('[data-pc-count="likes"]'));
  expect("like: button pressed", p.qs('[data-pc-act="like"]')?.classList.contains("is-on") === true);

  p.click(p.qs('[data-pc-act="comments"]'));
  await p.wait(160);
  expect("comments: input unlocked after the like", p.qs("[data-pc-input]")?.disabled === false, String(p.qs("[data-pc-input]")?.disabled));

  const input = p.qs("[data-pc-input]");
  input.value = "Well written";
  p.click(p.qs('[data-pc-act="send-comment"]'));
  await p.wait(200);
  const commentCall = calls.find((c) => c.href.endsWith("/rpc/post_comment"));
  expect("comments: rpc called", Boolean(commentCall));
  expect("comments: body sent", commentCall?.body?.p_body === "Well written", JSON.stringify(commentCall?.body));

  // members behind a counter
  p.click(p.qs('[data-pc-count="likes"]'));
  await p.wait(160);
  expect("members: modal opens", Boolean(p.qs("[data-pf-modal]")));
  expect("members: split in groups", p.qsa(".pf-people__group").length === 2, String(p.qsa(".pf-people__group").length));
  expect("members: names listed", /Sara Bennani/.test(p.text("[data-pf-modal]")), p.text("[data-pf-modal]").slice(0, 80));
  p.click(p.qs("[data-pf-modal] [data-modal-close]"));
  await p.wait(60);
  expect("members: modal closes", !p.qs("[data-pf-modal]"));

  // repost
  p.click(p.qs('[data-pc-act="repost"]'));
  await p.wait(160);
  expect("repost: rpc called", calls.some((c) => c.href.includes("post_reshare")));
  expect("repost: counter updated", p.text('[data-pc-count="reshares"]') === "8", p.text('[data-pc-count="reshares"]'));

  // ---- composer
  calls.length = 0;
  p.click(p.qs('[data-pf-act="publish"]'));
  await p.wait(120);
  expect("composer: modal opens", Boolean(p.qs("[data-pf-modal]")));
  expect("composer: three steps", p.qsa(".pf-step").length === 3, String(p.qsa(".pf-step").length));
  expect("composer: title field", Boolean(p.qs("[data-draft-title]")));
  expect("composer: keyword block", p.qsa("[data-draft-main]").length === 1, String(p.qsa("[data-draft-main]").length));
  expect("composer: upload control", Boolean(p.qs("[data-draft-thumbfile]")));

  // next without a title is refused
  p.click(p.qs("[data-step-next]"));
  await p.wait(80);
  expect("composer: refuses an empty title", Boolean(p.qs("[data-draft-title]")));

  p.qs("[data-draft-title]").value = "A new essay";
  p.qs("[data-draft-body]").value = "word ".repeat(420);
  p.qs("[data-main-keyword]").value = "Cinema";
  p.qs("[data-sub-keyword]").value = "Noir";
  p.click(p.qs("[data-main-add]"));
  await p.wait(60);
  expect("composer: second keyword row", p.qsa("[data-draft-main]").length === 2, String(p.qsa("[data-draft-main]").length));
  p.click(p.qs("[data-main-add]"));
  await p.wait(60);
  p.click(p.qs("[data-main-add]"));
  await p.wait(60);
  expect("composer: three mains at most", p.qsa("[data-draft-main]").length === 3, String(p.qsa("[data-draft-main]").length));

  p.click(p.qs("[data-step-next]"));
  await p.wait(80);
  expect("composer: visibility step", p.qsa("[data-visibility]").length === 7, String(p.qsa("[data-visibility]").length));
  p.click(p.qs('[data-visibility="excluded"]'));
  await p.wait(60);
  expect("composer: exclusion rules appear", Boolean(p.qs("[data-draft-audience]")));
  p.qs("[data-draft-audience]").value = "country:MA";

  p.click(p.qs("[data-step-next]"));
  await p.wait(80);
  expect("composer: schedule step", p.qsa("[data-schedule]").length === 5, String(p.qsa("[data-schedule]").length));
  p.click(p.qs('[data-schedule="1d"]'));
  await p.wait(60);
  p.click(p.qs("[data-publish]"));
  await p.wait(260);

  const createCall = calls.find((c) => c.href.includes("/rpc/post_create"));
  expect("composer: published through post_create", Boolean(createCall));
  const payload = createCall?.body?.p_payload || {};
  expect("composer: payload title", payload.title === "A new essay", JSON.stringify(payload.title));
  expect("composer: payload keywords", payload.keywords?.length === 2 && payload.keywords[1].role === "sub", JSON.stringify(payload.keywords));
  expect("composer: payload visibility", payload.visibility === "excluded", payload.visibility);
  expect("composer: payload audience rule", payload.audience?.[0]?.kind === "country" && payload.audience[0].value === "MA", JSON.stringify(payload.audience));
  expect("composer: payload schedule in the future", Boolean(payload.scheduled_at) && new Date(payload.scheduled_at) > new Date(), payload.scheduled_at);
  expect("composer: modal closed after publishing", !p.qs("[data-pf-modal]"));
  expect("composer: no page errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
console.log(`profile smoke: ${checks.length - failed.length}/${checks.length}`);
failed.forEach((c) => console.log(`  ✗ ${c.name}${c.detail ? ` — ${c.detail}` : ""}`));
if (failed.length) process.exit(1);
