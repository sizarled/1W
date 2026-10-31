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
  points: 1250,
  membership: "gold",
  status: "active",
  account_status: "active",
  created_at: "2026-10-20T20:00:00Z",
};

const NOW = Date.now();
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
      points_total: 1650,
      watch_minutes: 3820,
      level: 3,
      joined_at: member.created_at,
      last_login_at: null,
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
  if (href.includes("/rpc/member_code_action")) return reply({ ok: true });
  if (href.includes("/rpc/member_device_delete")) return reply({ ok: true });
  if (href.includes("/rpc/member_notify_set")) return reply({ ok: true, source: body.p_source, enabled: body.p_enabled });
  if (href.includes("/rpc/member_notify_read")) return reply({ ok: true });
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
  expect("inactive: no menu", p.qs("[data-side]").hidden === true);
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
  expect("inactive again: still gated", p.qs("[data-side]").hidden === true);
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
  expect("banned: no menu", p.qs("[data-side]").hidden === true);

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
  expect("scheduled: no menu", p.qs("[data-side]").hidden === true);
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
      { id: "n1", source: "movies", title: "New release", subject: "Dune: Part Two is in your list.", read: false, created_at: new Date(NOW - 600e3).toISOString() },
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
  expect("active: menu visible", p.qs("[data-side]").hidden === false);
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

  expect("active: no errors", p.errors.length === 0, p.errors.join(" | "));
  report.pass5 = p.qs("[data-view]")?.dataset.view || "";
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
