/**
 * court.html + activated.html smoke test (jsdom, no network).
 *
 *   node tools/court-smoke.mjs
 *
 * activated.html  — guest, inactive member (request sent), already-active member.
 * court.html      — guest, the member's own case, and a case id that is not theirs.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => readFileSync(join(root, file), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");

const TOKEN = "c".repeat(64);
const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  email: "youssef@example.com",
  avatar_url: "",
  level: 3,
  points: 1250,
  membership: "gold",
  status: "inactive",
  account_status: "inactive",
  created_at: new Date(Date.now() - 12 * 864e5).toISOString(),
};

const calls = [];
let scenario = {};

function reply(data) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
}

function stubFetch(url, opts = {}) {
  const href = String(url);
  calls.push(href);
  const body = opts.body ? JSON.parse(opts.body) : {};

  if (href.includes("/rpc/member_activation_state")) {
    const status = scenario.status || "inactive";
    const activated = scenario.activatedAt === undefined ? null : scenario.activatedAt;
    const membership = scenario.membership || "free";
    const first = !activated && status === "inactive" && membership === "free";
    return reply({
      ok: true,
      member: { ...MEMBER, status, account_status: status, membership, account_activated_at: activated, points: 1250 },
      status,
      membership,
      activated_at: activated,
      requested_at: scenario.requestedAt || null,
      pending: Boolean(scenario.pending),
      deadline: status === "inactive" ? new Date(Date.now() + 18 * 864e5).toISOString() : null,
      first_activation: first,
      can_activate: first,
      can_reactivate: Boolean(activated) && ["inactive", "expired"].includes(status),
      already_active: status === "active",
      can_upgrade: status !== "banned",
      mode: status === "banned" ? "blocked" : first ? "activate" : "choose",
    });
  }
  if (href.includes("/rpc/member_activation_request")) {
    scenario.pending = true;
    scenario.requestedAt = new Date().toISOString();
    if (scenario.already) return reply({ ok: true, already: true });
    return reply({ ok: true, already: false });
  }
  if (href.includes("/rpc/member_reactivate_request")) {
    scenario.pending = true;
    scenario.requestedAt = new Date().toISOString();
    return reply({ ok: true, already: false });
  }
  if (href.includes("/rpc/member_court_history")) {
    return reply({
      ok: true,
      member_status: "banned",
      ban: { reason: "Payment fraud", at: new Date().toISOString(), by: "moderator.hassan", permanent: false },
      cases: scenario.cases || [],
    });
  }
  if (href.includes("/rpc/member_logout")) return reply({ ok: true });
  return reply([]);
}

async function boot(pass, { file, search = "", hash = "", token = TOKEN }) {
  const dom = new JSDOM(read(file), { url: `http://localhost/${file}${search}`, pretendToBeVisual: true });
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
    search,
    hash,
    href: `http://localhost/${file}${search}`,
    protocol: "http:",
    pathname: `/${file}`,
    replace(target) {
      this.href = String(target);
    },
  };
  globalThis.fetch = stubFetch;

  window.localStorage.clear();
  if (token) window.localStorage.setItem("1w.session", token);

  const script = file === "activated.html" ? "activated.js" : "court.js";
  await import(`file://${join(root, "assets/js", script)}?pass=${pass}`);
  await new Promise((r) => setTimeout(r, 180));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const submit = (form) => form && form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  return { window, document: window.document, qs, qsa, text, click, submit, wait, errors };
}

const checks = [];
const expect = (name, condition, detail = "") => checks.push({ name, ok: Boolean(condition), detail });

/* activated.html — guest ------------------------------------------------ */
{
  scenario = { status: "inactive" };
  calls.length = 0;
  const p = await boot(1, { file: "activated.html", token: "" });
  expect("activated: guest asks to sign in", /Sign in to activate/i.test(p.text(".dsh-gate__title")));
  expect("activated: guest link", (p.qs("[data-act] a[href*=\"login.html\"]")?.getAttribute("href") || "").includes("login.html"));
  expect("activated: guest no forms", p.qs("[data-act-form]") === null && p.qs("[data-act-choice]").hidden === true);
  expect("activated: guest no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — first activation (free plan, never activated) -------- */
{
  scenario = { status: "inactive", membership: "free", activatedAt: null };
  calls.length = 0;
  const p = await boot(2, { file: "activated.html", search: "?member=ID100042" });
  expect("first: mode activate", p.qs("[data-act]").dataset.mode === "activate");
  expect("first: title", /Activate your account/i.test(p.text("[data-act-title]")));
  expect("first: member id filled", /ID100042/.test(p.text("[data-act-member]")));
  expect("first: membership filled", /Free/i.test(p.text("[data-act-membership]")));
  expect("first: never activated", /Never/i.test(p.text("[data-act-activated]")));
  expect("first: status filled", /Inactive/i.test(p.text("[data-act-status]")));
  expect("first: 30-day note", /banned automatically/i.test(p.text("[data-act-deadline]")));
  expect("first: activation form visible", p.qs("[data-act-form]").hidden === false);
  expect("first: no options yet", p.qs("[data-act-choice]").hidden === true);
  p.submit(p.qs("[data-act-form]"));
  await p.wait(200);
  expect("first: request posted", calls.some((c) => c.includes("member_activation_request")));
  expect("first: confirmation", /moderator|received/i.test(p.text("[data-act-notice]")));
  expect("first: form closed after request", p.qs("[data-act-form]").hidden === true);
  expect("first: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — paid plan, never activated: activation is included -- */
{
  scenario = { status: "inactive", membership: "gold", activatedAt: null };
  calls.length = 0;
  const p = await boot(98, { file: "activated.html", search: "?member=ID100042" });
  expect("paid: mode choose", p.qs("[data-act]").dataset.mode === "choose");
  expect("paid: no activation form", p.qs("[data-act-form]").hidden === true);
  expect("paid: included in plan chip", /Included in plan/i.test(p.text("[data-react-state]")));
  expect("paid: reactivation form hidden", p.qs("[data-react-form]").hidden === true);
  expect("paid: plan shown", /Gold/i.test(p.text("[data-act-membership]")));
  expect("paid: upgrade link", (p.qs("[data-upgrade]")?.getAttribute("href") || "").includes("actevite.html"));
  expect("paid: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — after activation, account active: two options -------- */
{
  scenario = { status: "active", membership: "free", activatedAt: new Date(Date.now() - 40 * 864e5).toISOString() };
  const p = await boot(3, { file: "activated.html", search: "?member=ID100042" });
  expect("choose: mode choose", p.qs("[data-act]").dataset.mode === "choose");
  expect("choose: title", /Manage your activation/i.test(p.text("[data-act-title]")));
  expect("choose: activation form hidden", p.qs("[data-act-form]").hidden === true);
  expect("choose: two cards", p.qsa(".dsh-choice__card").length === 2);
  expect("choose: reactivate card", Boolean(p.qs("[data-choice='reactivate']")));
  expect("choose: upgrade card", Boolean(p.qs("[data-choice='upgrade']")));
  expect("choose: active chip", /Active now/i.test(p.text("[data-react-state]")));
  expect("choose: reactivation form hidden", p.qs("[data-react-form]").hidden === true);
  expect("choose: upgrade link", (p.qs("[data-upgrade]")?.getAttribute("href") || "").includes("actevite.html?member=ID100042"));
  expect("choose: plan shown", /Free/i.test(p.text("[data-upgrade-current]")));
  expect("choose: first activated date", /\d{4}/.test(p.text("[data-act-activated]")));
  expect("choose: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — after activation, account closed: request it again --- */
{
  scenario = { status: "expired", membership: "gold", activatedAt: new Date(Date.now() - 200 * 864e5).toISOString() };
  calls.length = 0;
  const p = await boot(4, { file: "activated.html", search: "?member=ID100042" });
  expect("reactivate: mode choose", p.qs("[data-act]").dataset.mode === "choose");
  expect("reactivate: plan shown", /Gold/i.test(p.text("[data-act-membership]")));
  expect("reactivate: form visible", p.qs("[data-react-form]").hidden === false);
  expect("reactivate: status chip", /Expired/i.test(p.text("[data-react-state]")));
  p.submit(p.qs("[data-react-form]"));
  await p.wait(220);
  expect("reactivate: request posted", calls.some((c) => c.includes("member_reactivate_request")));
  expect("reactivate: chip says sent", /Request sent/i.test(p.text("[data-react-state]")));
  expect("reactivate: form closed after", p.qs("[data-react-form]").hidden === true);
  expect("reactivate: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — banned: neither door is open ------------------------- */
{
  scenario = { status: "banned", membership: "free", activatedAt: new Date(Date.now() - 30 * 864e5).toISOString() };
  const p = await boot(5, { file: "activated.html", search: "?member=ID100042" });
  expect("banned: mode blocked", p.qs("[data-act]").dataset.mode === "blocked");
  expect("banned: title", /banned/i.test(p.text("[data-act-title]")));
  expect("banned: no activation form", p.qs("[data-act-form]").hidden === true);
  expect("banned: no options", p.qs("[data-act-choice]").hidden === true);
  expect("banned: trial path", /trial/i.test(p.text("[data-act-notice]")));
  expect("banned: dashboard link", p.qsa(".dsh-gate__actions--banned a").some((a) => (a.getAttribute("href") || "").startsWith("dashboard.html")));
  expect("banned: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* court.html — guest ---------------------------------------------------- */
{
  scenario = { cases: [] };
  const p = await boot(4, { file: "court.html", token: "" });
  expect("court: guest gate", /Sign in to open the court room/i.test(p.text(".dsh-gate__title")));
  expect("court: guest link", (p.qs(".dsh-gate__actions a")?.getAttribute("href") || "").includes("login.html"));
}

/* court.html — own case ------------------------------------------------- */
{
  const when = new Date(Date.now() + 3 * 864e5).toISOString();
  scenario = {
    cases: [
      { id: "k1", case_code: "CRT-558104", reason: "Payment fraud", status: "scheduled", scheduled_at: when, decision: null, decision_note: null, created_at: new Date().toISOString(), decided_at: null },
    ],
  };
  calls.length = 0;
  const p = await boot(5, { file: "court.html", search: "?id=k1" });
  expect("court: crumbs case code", /CRT-558104/.test(p.text("[data-court-code]")));
  expect("court: hearing date", /\d{4}/.test(p.text(".dsh-court__clock")));
  expect("court: parties", /Judge/.test(p.text(".dsh-court__stage")) && /Defendant/.test(p.text(".dsh-court__stage")));
  expect("court: absence warning", /permanent/i.test(p.text(".dsh-gate__warn")));
  expect("court: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* court.html — somebody else's case ------------------------------------- */
{
  scenario = { cases: [{ id: "k1", case_code: "CRT-1", reason: "x", status: "requested", created_at: new Date().toISOString() }] };
  const p = await boot(6, { file: "court.html", search: "?id=other" });
  expect("court: foreign id refused", /Case not found/i.test(p.text(".dsh-gate__title")));
  expect("court: no error", p.errors.length === 0, p.errors.join(" | "));
}

const failed = checks.filter((c) => !c.ok);
checks.forEach((c) => console.log(`${c.ok ? "ok  " : "FAIL"}  ${c.name}${c.ok || !c.detail ? "" : ` — ${c.detail}`}`));
console.log(`\nchecks: ${checks.length - failed.length}/${checks.length} pass`);
if (failed.length) {
  console.error(`\n${failed.length} failing check(s): ${failed.map((c) => c.name).join(", ")}`);
  process.exit(1);
}
