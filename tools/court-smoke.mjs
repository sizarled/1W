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

  if (href.includes("/rpc/member_dashboard")) {
    return reply({
      ok: true,
      member: { ...MEMBER, status: scenario.status || "inactive", account_status: scenario.status || "inactive" },
      restricted: true,
      ban: { reason: null, at: null, by: null, permanent: false },
      overview: {},
      codes: [],
      devices: [],
      notifications: [],
      prefs: {},
      lists: { favorite: [], later: [], complete: [] },
      reports: [],
      court: { active: null, history: [] },
      prizes: [],
      points_ledger: [],
      history: [],
    });
  }
  if (href.includes("/rpc/member_activation_request")) {
    if (scenario.already) return reply({ ok: true, already: true });
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
  expect("activated: guest asks to sign in", /Sign in first/i.test(p.text(".dsh-gate__text")));
  expect("activated: guest link", (p.qs(".dsh-gate__text a, [data-act-form] a")?.getAttribute("href") || "").includes("login.html"));
  expect("activated: guest no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — inactive member asks --------------------------------- */
{
  scenario = { status: "inactive" };
  calls.length = 0;
  const p = await boot(2, { file: "activated.html", search: "?member=ID100042" });
  expect("activated: member id filled", /ID100042/.test(p.text("[data-act-member]")));
  expect("activated: status filled", /INACTIVE/i.test(p.text("[data-act-status]")));
  expect("activated: 30-day note", /banned automatically/i.test(p.text("[data-act-deadline]")));
  expect("activated: form present", Boolean(p.qs("[data-act-form]")));
  p.submit(p.qs("[data-act-form]"));
  await p.wait(160);
  expect("activated: request posted", calls.some((c) => c.includes("member_activation_request")));
  expect("activated: confirmation", /moderator|received/i.test(p.text("[data-act-notice]")));
  expect("activated: form hidden after", p.qs("[data-act-form]").hidden === true);
  expect("activated: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — already active --------------------------------------- */
{
  scenario = { status: "active" };
  const p = await boot(3, { file: "activated.html", search: "?member=ID100042" });
  expect("activated: active shows notice", /already active/i.test(p.text("[data-act-notice]")));
  expect("activated: active hides form", p.qs("[data-act-form]").hidden === true);
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
