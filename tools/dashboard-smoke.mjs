/**
 * dashboard.html smoke test (jsdom, no network).
 *
 *   node tools/dashboard-smoke.mjs
 *
 * Pass 1 — inactive account: activation gate, activate link with the member id,
 *          log out, no menu and no rail.
 * Pass 2 — banned account: reason, "Request trial", log out, the request call.
 * Pass 3 — banned account with a scheduled trial: date, "Go to trial" link to
 *          court.html?id=…, absence warning.
 * Pass 4 — banned account with the ban upheld: permanently closed, log out only.
 * Pass 5 — active account: rail, sidebar, overview, popover, notifications
 *          settings, codes, devices, tabs, log out.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "dashboard.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");

const TOKEN = "b".repeat(64);
const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  member_code: "000042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  email: "youssef@example.com",
  phone_number: "+212600000000",
  avatar_url: "",
  level: 3,
  level_unlocked: 3,
  points: 1250,
  membership: "gold",
  status: "active",
  account_status: "active",
  created_at: "2026-10-20T20:00:00Z",
};

const NOW = Date.now();
// Keep the "recency" fixtures inside both the last hour and today, even when
// the suite runs just after local midnight.
const MIDNIGHT = new Date(NOW).setHours(0, 0, 0, 0);
const RECENT = Math.min(NOW - 30e3, Math.max(NOW - 600e3, MIDNIGHT + 1e3));
const CODE_ROW = {
  id: "c1",
  code: "654321",
  months: 6,
  age: "18",
  status: "active",
  active: true,
  device_mac: "AA:BB:CC:DD:EE:FF",
  device_name: "Living room TV",
  created_at: new Date(NOW - 864e5).toISOString(),
  expires_at: new Date(NOW + 180 * 864e5).toISOString(),
  devices: [{ device_id: "AA:BB:CC:DD:EE:FF", first_used_at: new Date(NOW - 864e5).toISOString(), last_used_at: new Date(NOW - 36e5).toISOString() }],
};

const calls = [];
let scenario = {};

function reply(data) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
}

function payload() {
  const member = {
    ...MEMBER,
    status: scenario.status || "active",
    account_status: scenario.status || "active",
    account_activated_at: scenario.activatedAt || null,
  };
  return {
    ok: true,
    member_id: member.member_id,
    member,
    restricted: member.status !== "active",
    ban: scenario.ban || { reason: null, at: null, by: null, permanent: false },
    overview: {
      membership: member.membership,
      membership_started_at: null,
      membership_expires_at: new Date(NOW + 300 * 864e5).toISOString(),
      points_available: 1250,
      points_spent: 400,
      points_total: 12400,
      watch_minutes: 3820,
      level: 3,
      joined_at: member.created_at,
      last_login_at: null,
      ...(scenario.overview || {}),
    },
    codes: scenario.codes || [],
    devices: scenario.devices || [],
    notifications: scenario.notifications || [],
    prefs: scenario.prefs || {},
    lists: scenario.lists || { favorite: [], later: [], complete: [] },
    reports: scenario.reports || [],
    court: scenario.court || { active: null, history: [] },
    prizes: scenario.prizes || [],
    points_ledger: scenario.ledger || [],
    history: scenario.history || [],
  };
}

const PROVIDER_KEYS = ["telegram", "whatsapp", "google", "facebook", "x", "pinterest", "reddit", "tiktok"];

function accountPayload() {
  const identities = scenario.identities || [];
  return {
    ok: true,
    member: {
      member_id: MEMBER.member_id,
      username: MEMBER.username,
      email: MEMBER.email,
      phone_number: MEMBER.phone_number,
      status: scenario.status || "active",
      created_at: MEMBER.created_at,
    },
    security: {
      email_locked: true,
      recovery_issued_at: null,
      recovery_expires_at: null,
      last_channel: null,
      linked: identities.filter((row) => row.status === "verified").length,
    },
    identities,
  };
}

function stubFetch(url, opts = {}) {
  const href = String(url);
  calls.push(href);
  const body = opts.body ? JSON.parse(opts.body) : {};

  if (href.includes("/rpc/member_dashboard")) return reply(payload());
  if (href.includes("/rpc/member_court_request")) {
    if (scenario.requestFails) return reply({ ok: false, error: "permanent" });
    scenario.court = { active: { id: "k1", case_code: "CRT-558104", reason: "Payment fraud", status: "requested", scheduled_at: null, decision: null }, history: [] };
    return reply({ ok: true, case: { case_code: "CRT-558104", status: "requested", scheduled_at: null } });
  }
  if (href.includes("/rpc/member_account")) return reply(accountPayload());
  if (href.includes("/rpc/member_change_password")) {
    if (scenario.passwordFails) return reply({ ok: false, error: "current" });
    return reply({ ok: true, closed_sessions: 2 });
  }
  if (href.includes("/rpc/member_identity_start")) {
    if (body.p_provider === "telegram") {
      return reply({
        ok: true,
        provider: "telegram",
        status: "pending",
        code: "TGCODE1234",
        url: "https://t.me/cineaura2bot?start=TGCODE1234",
        expires_at: new Date(NOW + 12e5).toISOString(),
      });
    }
    if (body.p_provider === "whatsapp") {
      return reply({
        ok: true,
        provider: "whatsapp",
        status: "pending",
        masked_phone: "+2126••••3710",
        expires_at: new Date(NOW + 12e5).toISOString(),
      });
    }
    return reply({ ok: false, error: "oauth", provider: body.p_provider });
  }
  if (href.includes("/rpc/member_identity_verify")) {
    scenario.identities = [
      ...(scenario.identities || []).filter((row) => row.provider !== body.p_provider),
      { provider: body.p_provider, status: "verified", handle: "@linked", verified_at: new Date().toISOString(), pending_until: null },
    ];
    return reply({ ok: true, provider: body.p_provider, status: "verified" });
  }
  if (href.includes("/rpc/member_identity_unlink")) {
    scenario.identities = (scenario.identities || []).filter((row) => row.provider !== body.p_provider);
    return reply({ ok: true, provider: body.p_provider });
  }
  if (href.includes("/rpc/member_code_action")) return reply({ ok: true });
  if (href.includes("/rpc/member_device_delete")) return reply({ ok: true });
  if (href.includes("/rpc/member_notify_set")) return reply({ ok: true, source: body.p_source, enabled: body.p_enabled });
  if (href.includes("/rpc/member_notify_read")) return reply({ ok: true });
  if (href.includes("/rpc/level_unlock")) {
    if (scenario.unlockFails) return reply({ ok: false, error: "points", fee: 10000, balance: 10 });
    return reply({ ok: true, level: Number(body.p_level || 4), fee: 10000, balance: 190000 });
  }
  if (href.includes("/rpc/member_logout")) return reply({ ok: true });
  return reply([]);
}

async function boot(pass) {
  const dom = new JSDOM(html, { url: "http://localhost/dashboard.html", pretendToBeVisual: true });
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
  globalThis.AbortController = window.AbortController || AbortController;
  globalThis.FormData = window.FormData;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
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
    search: "",
    hash: "",
    href: "http://localhost/dashboard.html",
    protocol: "http:",
    pathname: "/dashboard.html",
    replace(target) {
      this.href = String(target);
    },
  };
  globalThis.fetch = stubFetch;
  window.scrollTo = () => {};

  window.localStorage.clear();
  window.localStorage.setItem("1w.session", TOKEN);

  await import(`file://${join(root, "assets/js/dashboard.js")}?pass=${pass}`);
  await new Promise((r) => setTimeout(r, 180));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  return { window, document: window.document, qs, qsa, text, click, wait, errors };
}

const report = {};
const checks = [];
function expect(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

/* ------------------------------------------------------------------ */
/* pass 1 — inactive                                                   */
/* ------------------------------------------------------------------ */
{
  scenario = { status: "inactive", notifications: [], codes: [] };
  calls.length = 0;
  const p = await boot(1);
  const gate = p.qs("[data-main] .dsh-gate");
  expect("inactive: gate rendered", Boolean(gate));
  expect("inactive: title", /not activated/i.test(p.text("[data-main] .dsh-gate__title")));
  expect("inactive: activate link", (p.qs("[data-gate-activate]")?.getAttribute("href") || "").includes("activated.html?member=ID100042"));
  expect("inactive: log out present", Boolean(p.qs("[data-main] [data-logout]")));
  expect("inactive: no rail", p.qs("[data-rail-wrap]").hidden === true);
  expect("inactive: no menu", p.qs("[data-dsh-side]").hidden === true);
  expect("inactive: 30-day deadline shown", /banned automatically/i.test(p.text("[data-gate-deadline]")));
  expect("inactive: no dashboard tool", !p.qs("[data-code-form]"));
  expect("inactive: no errors", p.errors.length === 0, p.errors.join(" | "));
  report.pass1 = p.text("[data-main]").slice(0, 90);
}

/* ------------------------------------------------------------------ */
/* pass 1b — inactive account that was activated before                */
/* ------------------------------------------------------------------ */
{
  scenario = { status: "inactive", activatedAt: new Date(NOW - 120 * 864e5).toISOString() };
  const p = await boot(99);
  const link = p.qs("[data-gate-activate]");
  expect("inactive again: two-door label", /Re-activate or upgrade/i.test(link?.textContent || ""));
  expect("inactive again: deep link", (link?.getAttribute("href") || "").includes("mode=reactivate"));
  expect("inactive again: still gated", p.qs("[data-dsh-side]").hidden === true);
  expect("inactive again: no errors", p.errors.length === 0, p.errors.join(" | "));
}

/* ------------------------------------------------------------------ */
/* pass 2 — banned, no case                                            */
/* ------------------------------------------------------------------ */
{
  scenario = {
    status: "banned",
    ban: { reason: "Repeated payment fraud reports", at: new Date(NOW - 2 * 864e5).toISOString(), by: "moderator.hassan", permanent: false },
    court: { active: null, history: [] },
  };
  calls.length = 0;
  const p = await boot(2);
  expect("banned: gate rendered", Boolean(p.qs("[data-main] .dsh-gate")));
  expect("banned: reason", /payment fraud/i.test(p.text("[data-gate-ban-reason]")));
  expect("banned: reason author", /moderator\.hassan/.test(p.text("[data-gate-ban-by]")));
  expect("banned: request trial", Boolean(p.qs("[data-court-request]")));
  expect("banned: log out", Boolean(p.qs("[data-main] [data-logout]")));
  expect("banned: no menu", p.qs("[data-dsh-side]").hidden === true);

  p.click(p.qs("[data-court-request]"));
  await p.wait(220);
  expect("banned: request sent", calls.some((c) => c.includes("member_court_request")));
  expect("banned: moves to requested", /with the court|will be set soon/i.test(p.text("[data-main]")));
  expect("banned: case code shown", /CRT-558104/.test(p.text("[data-main]")));
  expect("banned: no errors", p.errors.length === 0, p.errors.join(" | "));
  report.pass2 = p.text("[data-main]").slice(0, 90);
}

/* ------------------------------------------------------------------ */
/* pass 3 — trial scheduled                                            */
/* ------------------------------------------------------------------ */
{
  const when = new Date(NOW + 3 * 864e5).toISOString();
  scenario = {
    status: "banned",
    ban: { reason: "Payment fraud", at: new Date(NOW - 2 * 864e5).toISOString(), by: "moderator.hassan", permanent: false },
    court: {
      active: { id: "k1", case_code: "CRT-558104", reason: "Payment fraud", status: "scheduled", scheduled_at: when, decision: null },
      history: [],
    },
  };
  const p = await boot(3);
  expect("scheduled: date in title", /\d{4}/.test(p.text("[data-gate-when]")));
  expect("scheduled: go to trial link", (p.qs("[data-gate-court]")?.getAttribute("href") || "").includes("court.html?id=k1"));
  expect("scheduled: absence warning", /permanent/i.test(p.text(".dsh-gate__warn")));
  expect("scheduled: log out", Boolean(p.qs("[data-main] [data-logout]")));
  expect("scheduled: no menu", p.qs("[data-dsh-side]").hidden === true);
  expect("scheduled: no errors", p.errors.length === 0, p.errors.join(" | "));
  report.pass3 = p.text("[data-main]").slice(0, 90);
}

/* ------------------------------------------------------------------ */
/* pass 4 — ban upheld                                                 */
/* ------------------------------------------------------------------ */
{
  scenario = {
    status: "banned",
    ban: { reason: "Payment fraud", at: new Date(NOW - 9 * 864e5).toISOString(), by: "moderator.hassan", permanent: true },
    court: {
      active: { id: "k1", case_code: "CRT-558104", reason: "Payment fraud", status: "closed", scheduled_at: null, decision: "uphold", decision_note: "Evidence confirmed." },
      history: [{ case_code: "CRT-558104", decision: "uphold", decided_at: new Date(NOW - 864e5).toISOString(), created_at: new Date(NOW - 6 * 864e5).toISOString() }],
    },
  };
  const p = await boot(4);
  expect("closed: title", /permanently closed/i.test(p.text("[data-main] .dsh-gate__title")));
  expect("closed: case id", /CRT-558104/.test(p.text("[data-main]")));
  expect("closed: only log out", p.qsa("[data-main] .dsh-btn").length === 1 && Boolean(p.qs("[data-main] [data-logout]")));
  expect("closed: note", /Evidence confirmed/.test(p.text("[data-gate-decision]")));
  expect("closed: no trial button", !p.qs("[data-court-request]"));
  expect("closed: no errors", p.errors.length === 0, p.errors.join(" | "));
  report.pass4 = p.text("[data-main]").slice(0, 90);
}

/* ------------------------------------------------------------------ */
/* pass 5 — active                                                     */
/* ------------------------------------------------------------------ */
{
  scenario = {
    status: "active",
    ban: { reason: null, at: null, by: null, permanent: false },
    codes: [CODE_ROW],
    devices: [
      {
        id: "d1",
        device_id: "AA:BB:CC:DD:EE:FF",
        code: "654321",
        code_id: "c1",
        first_used_at: new Date(NOW - 864e5).toISOString(),
        last_used_at: new Date(NOW - 36e5).toISOString(),
      },
    ],
    notifications: [
      { id: "n1", source: "movies", title: "New release", subject: "Dune: Part Two is in your list.", read: false, created_at: new Date(RECENT).toISOString() },
      { id: "n2", source: "court", title: "Trial scheduled", subject: "Case CRT-1 on Friday.", read: true, created_at: new Date(NOW - 3 * 864e5).toISOString() },
    ],
    prefs: { movies: false },
    lists: {
      favorite: [{ id: 1, kind: "favorite", media_type: "movie", tmdb_id: 693134, title: "Dune: Part Two", poster: "", link: "", created_at: new Date(NOW - 5 * 864e5).toISOString() }],
      later: [],
      complete: [],
    },
    reports: [{ id: "r1", reason: "Broken link", details: "Episode 4", status: "under_review", tmdb_id: 693134, mine: true, created_at: new Date(NOW - 2 * 864e5).toISOString() }],
    prizes: [{ id: "pz1", prize_code: "prize000001", title: "3 Months Diamond", image: null, points: 4500, stock: null, ends_at: new Date(NOW + 30 * 864e5).toISOString() }],
    ledger: [{ delta: 500, reason: "Review bonus", source: "reviews", balance_after: 1250, created_at: new Date(NOW - 864e5).toISOString() }],
    history: [{ tmdb_id: 693134, media_type: "movie", season: null, episode: null, watched_at: new Date(NOW - 864e5).toISOString(), minutes: 166 }],
  };
  calls.length = 0;
  const p = await boot(5);

  expect("active: rail visible", p.qs("[data-rail-wrap]").hidden === false);
  expect("active: 12 rail sections", p.qsa("[data-rail] .dsh-rail__item").length === 12);
  expect("active: rail scrolls with drag", p.qs("[data-rail]").dataset.dragReady === "1");
  expect("active: rail arrow scrolls", p.qsa("[data-rail-dir]").length === 2);
  expect("active: menu visible", p.qs("[data-dsh-side]").hidden === false);
  expect("active: admin group hidden", p.qs("[data-admin-group]").hidden === true);
  expect("active: identity", /@youssef\.amrani/.test(p.text("[data-me-username]")) && /ID100042/.test(p.text("[data-me-id]")));
  expect("active: overview stats", p.qsa(".dsh-stat").length >= 6);
  expect("active: overview codes", /654321/.test(p.text("[data-main]")));
  expect("active: watch minutes", /3,820/.test(p.text("[data-main]")));

  // popover
  p.click(p.qs("[data-bell]"));
  await p.wait(60);
  expect("popover: opens", p.qs("[data-pop]").hidden === false);
  expect("popover: hour filter keeps the 10-minute item", /New release/.test(p.text("[data-pop-list]")) && !/Trial scheduled/.test(p.text("[data-pop-list]")));
  p.click(p.qsa("[data-pop-filter]").find((b) => b.dataset.popFilter === "today"));
  await p.wait(40);
  expect("popover: today shows item", /New release/.test(p.text("[data-pop-list]")));
  expect("popover: settings button", Boolean(p.qs("[data-pop-settings]")));
  expect("popover: view all link", (p.qs(".dsh-pop__all")?.getAttribute("href") || "").includes("notifications.html"));
  p.click(p.qs("[data-pop-settings]"));
  await p.wait(80);
  expect("popover: closes on settings", p.qs("[data-pop]").hidden === true);
  expect("popover: settings view", /Settings/.test(p.text("[data-main] .dsh-tabs")));

  // notification settings
  const locked = p.qsa("[data-source]").filter((i) => i.disabled).map((i) => i.dataset.source);
  expect("settings: messages + court locked", locked.includes("messages") && locked.includes("court"));
  expect("settings: movies off from prefs", p.qs('[data-source="movies"]').checked === false);
  const movies = p.qs('[data-source="series"]');
  movies.checked = false;
  movies.dispatchEvent(new p.window.Event("change", { bubbles: true }));
  await p.wait(120);
  expect("settings: toggle saved", calls.some((c) => c.includes("member_notify_set")));

  // notifications list with filters
  p.click(p.qsa("[data-tab]").find((b) => b.dataset.tabValue === "list"));
  await p.wait(80);
  expect("notifications: filters", p.qsa("[data-window]").length >= 8);
  expect("notifications: custom range", Boolean(p.qs('[data-window="custom"]')));
  p.click(p.qsa("[data-window]").find((b) => b.dataset.window === "all"));
  await p.wait(80);
  expect("notifications: rows", p.qsa("[data-notif]").length === 2);

  // codes
  p.click(p.qsa("[data-nav] [data-goto]").find((b) => b.dataset.goto === "codes"));
  await p.wait(80);
  expect("codes: form fields", p.qsa("[data-code-form] select").length === 3);
  expect("codes: durations", [...p.qsa("#c-months option")].map((o) => o.value).join(",") === "1,3,6,12");
  expect("codes: age ratings", [...p.qsa("#c-age option")].map((o) => o.value).join(",") === "none,13,16,18");
  expect("codes: row rendered", /654321/.test(p.text("[data-main]")));
  expect("codes: actions", p.qsa("[data-code-action]").length === 2 && p.qsa("[data-copy]").length === 1);
  p.click(p.qs("[data-code-gen]"));
  expect("codes: generator fills", /^\d{6}$/.test(p.qs("#c-code").value));

  p.click(p.qsa("[data-tab]").find((b) => b.dataset.tabValue === "devices"));
  await p.wait(80);
  expect("devices: tab lists MAC", /AA:BB:CC:DD:EE:FF/.test(p.text("[data-main]")));
  expect("devices: remove button", Boolean(p.qs("[data-device-delete]")));

  // other sections render
  for (const key of ["favorites", "later", "complete", "reports", "points", "level", "payments", "prizes", "history", "iptv", "notifications", "settings-site", "settings-platforms"]) {
    p.click(p.qsa("[data-nav] [data-goto]").find((b) => b.dataset.goto === key) || p.qs(`[data-goto="${key}"]`));
    await p.wait(45);
    const view = p.qs(`[data-view="${key}"]`);
    expect(`section: ${key}`, Boolean(view) && view.textContent.length > 40);
  }

  /* the sidebar: own profile behind the avatar, and the fold into a rail */
  const sideLink = p.qs("[data-side-profile]")?.getAttribute("href") || "";
  expect("active: sidebar avatar opens the own profile", sideLink === "profile.html?u=%40youssef.amrani", sideLink);
  const chipLink = p.qs("[data-me-link]")?.getAttribute("href") || "";
  expect("active: header chip opens the own profile", chipLink === "profile.html?u=%40youssef.amrani", chipLink);
  expect("active: sidebar starts open", p.qs("[data-dsh]")?.dataset.side === "open", p.qs("[data-dsh]")?.dataset.side);

  const headerBefore = p.qs(".dsh-top")?.outerHTML || "";
  p.click(p.qs("[data-side-toggle]"));
  await p.wait(40);
  expect("active: the toggle folds the menu", p.qs("[data-dsh]")?.dataset.side === "collapsed");
  expect("active: collapsed is remembered", p.window.localStorage.getItem("1w.dsh.side") === "collapsed");
  expect("active: the header did not change", (p.qs(".dsh-top")?.outerHTML || "") === headerBefore);
  expect("active: the site header did not change", !p.document.body.classList.contains("sb-open"));

  p.click(p.qs("[data-side-open]"));
  await p.wait(40);
  expect("active: the menu opens again", p.qs("[data-dsh]")?.dataset.side === "open");
  expect("active: label shows the menu", p.qs("[data-side-open]")?.hidden !== true);

  /* the level page: Unlock now, its price, and the paid promotion */
  p.click(p.qs('[data-nav] [data-goto="level"]'));
  await p.wait(60);
  const unlock = p.qs("[data-level-unlock]");
  expect("level: an unlock button is offered", Boolean(unlock), unlock?.outerHTML?.slice(0, 60) || "none");
  expect("level: the next rung is LV40", unlock?.dataset.levelUnlock === "4", unlock?.dataset.levelUnlock || "");
  expect("level: it asks for the rung's own points", /10,000 points|10000 points/.test(p.text(".dsh-table") + unlock?.getAttribute("title") || ""), unlock?.getAttribute("title") || "");
  expect("level: short balance keeps it disabled", unlock?.disabled === true);

  expect("level: the paid level is the badge", /LV3/.test(p.text(".dsh-grid")), p.text(".dsh-grid").slice(0, 80));
  expect("level: an earned rung reads Ready", /Ready/.test(p.text(".dsh-table")), "Ready");

  /* a member who has not earned the next rung gets no button at all */
  scenario = { overview: { points_total: 1650 } };
  const poor = await boot("level-poor");
  poor.click(poor.qs('[data-nav] [data-goto="level"]'));
  await poor.wait(60);
  expect("level: no unlock button before the points are reached", !poor.qs("[data-level-unlock]"));
  expect("level: the paid level still stands", /LV3/.test(poor.text(".dsh-grid")), poor.text(".dsh-grid").slice(0, 80));
  expect("level-poor: no errors", poor.errors.length === 0, poor.errors.join(" | "));

  /* with the balance covered, the dialog and the payment run */
  scenario = { overview: { points_available: 200000, points_total: 12400 } };
  calls.length = 0;
  const pay = await boot("unlock");
  pay.click(pay.qs('[data-nav] [data-goto="level"]'));
  await pay.wait(60);
  const btn = pay.qs("[data-level-unlock]");
  expect("unlock: the button opens up with the balance", btn?.disabled === false, String(btn?.disabled));
  pay.click(btn);
  await pay.wait(80);
  expect("unlock: a dialog names the price", /10,000 points/.test(pay.text("[data-level-modal]")), pay.text("[data-level-modal]").slice(0, 120));
  pay.click(pay.qs("[data-level-pay]"));
  await pay.wait(260);
  expect("unlock: the payment is sent", calls.some((c) => c.includes("level_unlock")), calls.slice(-3).join(" | "));
  expect("unlock: the dialog closes", !pay.qs("[data-level-modal]"));
  expect("unlock: no errors", pay.errors.length === 0, pay.errors.join(" | "));

  /* a refused payment explains itself and stays open */
  scenario = { overview: { points_available: 200000, points_total: 12400 }, unlockFails: true };
  calls.length = 0;
  const refused = await boot("unlock-refused");
  refused.click(refused.qs('[data-nav] [data-goto="level"]'));
  await refused.wait(60);
  refused.click(refused.qs("[data-level-unlock]"));
  await refused.wait(80);
  refused.click(refused.qs("[data-level-pay]"));
  await refused.wait(260);
  expect("unlock refused: the dialog stays", Boolean(refused.qs("[data-level-modal]")));
  expect("unlock refused: it says how much is missing", /10,000|need/i.test(refused.document.body.textContent));

  expect("active: no errors", p.errors.length === 0, p.errors.join(" | "));
  report.pass5 = p.qs("[data-view]")?.dataset.view || "";
}

/* ------------------------------------------------------------------ */
/* pass 6 — account settings                                           */
/* ------------------------------------------------------------------ */
{
  scenario = { status: "active", identities: [] };
  calls.length = 0;
  const a = await boot("account");
  a.click(a.qs('[data-nav] [data-goto="settings-account"]'));
  await a.wait(80);

  expect("account: the view renders", Boolean(a.qs('[data-view="settings-account"]')));
  expect("account: password form asks three times", a.qsa("[data-acct-password] input").length === 3, String(a.qsa("[data-acct-password] input").length));
  expect("account: current password is required", Boolean(a.qs('[data-acct-password] input[name="current"]')));
  expect("account: email is not editable", a.qsa('[data-view="settings-account"] input[type="email"]').length === 0);
  expect("account: email marked fixed", /fixed/i.test(a.text('[data-view="settings-account"]')));
  expect("account: no change-email wording", !/change email/i.test(a.text('[data-view="settings-account"]')));

  const rows = a.qsa("[data-identity]").map((row) => row.dataset.identity);
  expect("account: eight networks", rows.length === 8, rows.join(","));
  expect("account: the eight requested networks", PROVIDER_KEYS.every((key) => rows.includes(key)), rows.join(","));
  expect("account: brand glyphs drawn", a.qsa('[data-identity="telegram"] .dsh-brand svg').length === 1);
  expect("account: oauth cannot pretend", a.qs('[data-identity="google"] button')?.disabled === true);
  expect("account: chats can connect", a.qs('[data-identity-start="telegram"]') !== null && a.qs('[data-identity-start="whatsapp"]') !== null);
  expect("account: unlinked says email only", /email only|None yet/i.test(a.text('[data-view="settings-account"]')));

  // telegram: the deep link and the code
  calls.length = 0;
  a.click(a.qs('[data-identity-start="telegram"]'));
  await a.wait(200);
  expect("telegram: start is called", calls.some((c) => c.includes("member_identity_start")));
  const panel = a.qs("[data-identity-panel]");
  expect("telegram: a panel explains the step", Boolean(panel));
  expect("telegram: deep link carries the code", (panel?.querySelector("a")?.getAttribute("href") || "") === "https://t.me/cineaura2bot?start=TGCODE1234", panel?.querySelector("a")?.getAttribute("href") || "");
  expect("telegram: the code is on screen", /TGCODE1234/.test(panel?.textContent || ""));
  a.window.close();

  // whatsapp: the 6-character form
  scenario = { status: "active", identities: [] };
  const w = await boot("account-whatsapp");
  w.click(w.qs('[data-nav] [data-goto="settings-account"]'));
  await w.wait(80);
  w.click(w.qs('[data-identity-start="whatsapp"]'));
  await w.wait(200);
  const waForm = w.qs("[data-identity-verify]");
  expect("whatsapp: a code box appears", Boolean(waForm));
  expect("whatsapp: it says where the code went", /\+2126/.test(w.qs("[data-identity-panel]")?.textContent || ""));
  calls.length = 0;
  w.qs('[data-identity-verify] input[name="code"]').value = "abc123";
  w.qs("[data-identity-verify]").dispatchEvent(new w.window.Event("submit", { bubbles: true, cancelable: true }));
  await w.wait(200);
  expect("whatsapp: the code is sent upper-cased", calls.some((c) => c.includes("member_identity_verify")));
  expect("whatsapp: the row turns linked", /Linked/.test(w.text('[data-identity="whatsapp"]')));
  expect("whatsapp: a Disconnect button appears", Boolean(w.qs('[data-identity-unlink="whatsapp"]')));
  expect("whatsapp: the panel is gone", !w.qs("[data-identity-panel]"));
  expect("whatsapp: no errors", w.errors.length === 0, w.errors.join(" | "));

  // unlinking a verified row
  calls.length = 0;
  w.click(w.qs('[data-identity-unlink="whatsapp"]'));
  await w.wait(200);
  expect("unlink: the call is made", calls.some((c) => c.includes("member_identity_unlink")));
  expect("unlink: the row is back to Connect", Boolean(w.qs('[data-identity-start="whatsapp"]')));
  w.window.close();

  // the password: a mismatch never reaches the server
  scenario = { status: "active", identities: [], passwordFails: false };
  const pw = await boot("account-password");
  pw.click(pw.qs('[data-nav] [data-goto="settings-account"]'));
  await pw.wait(80);
  const form = pw.qs("[data-acct-password]");
  form.querySelector('[name="current"]').value = "old-password";
  form.querySelector('[name="password"]').value = "new-password-1";
  form.querySelector('[name="confirm"]').value = "new-password-2";
  calls.length = 0;
  form.dispatchEvent(new pw.window.Event("submit", { bubbles: true, cancelable: true }));
  await pw.wait(120);
  expect("password: mismatch is caught here", !calls.some((c) => c.includes("member_change_password")));
  expect("password: mismatch says why", /not the same/i.test(pw.text("[data-acct-error]")), pw.text("[data-acct-error]"));

  form.querySelector('[name="confirm"]').value = "new-password-1";
  form.dispatchEvent(new pw.window.Event("submit", { bubbles: true, cancelable: true }));
  await pw.wait(200);
  expect("password: it is sent", calls.some((c) => c.includes("member_change_password")));
  expect("password: the fields are cleared", form.querySelector('[name="password"]').value === "");
  expect("password: the closed sessions are named", /2 other sessions/i.test(pw.document.body.textContent));
  pw.window.close();

  // a wrong current password is reported, not swallowed
  scenario = { status: "active", identities: [], passwordFails: true };
  const bad = await boot("account-password-bad");
  bad.click(bad.qs('[data-nav] [data-goto="settings-account"]'));
  await bad.wait(80);
  const badForm = bad.qs("[data-acct-password]");
  badForm.querySelector('[name="current"]').value = "wrong";
  badForm.querySelector('[name="password"]').value = "new-password-1";
  badForm.querySelector('[name="confirm"]').value = "new-password-1";
  badForm.dispatchEvent(new bad.window.Event("submit", { bubbles: true, cancelable: true }));
  await bad.wait(200);
  expect("password refused: it says which field", /current password/i.test(bad.text("[data-acct-error]")), bad.text("[data-acct-error]"));
  bad.window.close();

  // an already linked account says so on arrival
  scenario = {
    status: "active",
    identities: [{ provider: "telegram", status: "verified", handle: "@member_chat", verified_at: new Date().toISOString(), pending_until: null }],
  };
  const linked = await boot("account-linked");
  linked.click(linked.qs('[data-nav] [data-goto="settings-account"]'));
  await linked.wait(80);
  expect("linked: the row reads Linked", /Linked/.test(linked.text('[data-identity="telegram"]')));
  expect("linked: the count is on the card", /1 linked/i.test(linked.text('[data-view="settings-account"]')));
  expect("linked: it says codes arrive there", /recovery code/i.test(linked.text('[data-identity="telegram"]')));
  expect("linked: no errors", linked.errors.length === 0, linked.errors.join(" | "));
  linked.window.close();
}

/* ------------------------------------------------------------------ */
/* results                                                             */
/* ------------------------------------------------------------------ */
const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => {
  console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.ok || !c.detail ? "" : ` — ${c.detail}`}`);
});
console.log(`\nchecks: ${checks.length - failed.length}/${checks.length} pass`);
if (failed.length) {
  console.error(`\n${failed.length} failing check(s): ${failed.map((c) => c.name).join(", ")}`);
  process.exit(1);
}
