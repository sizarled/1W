/**
 * court.html + activated.html smoke test (jsdom, no network).
 *
 *   node tools/court-smoke.mjs
 *
 * activated.html  — guest, the four activation steps (profile, viewing code, ad
 *                   gate, activate), free re-activation, premium points
 *                   re-activation, upgrade, diamond (no upgrade), banned.
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
    const rank = { free: 0, silver: 1, gold: 2, diamond: 3 }[membership];
    const targets =
      status === "banned" || rank === undefined || rank >= 3
        ? []
        : ["silver", "gold", "diamond"].filter((t) => ({ silver: 1, gold: 2, diamond: 3 }[t] > rank));
    return reply({
      ok: true,
      member: { ...MEMBER, status, account_status: status, membership, account_activated_at: activated, points: 5000 },
      status,
      membership,
      membership_expires_at: scenario.expiresAt || null,
      activated_at: activated,
      requested_at: scenario.requestedAt || null,
      pending: Boolean(scenario.pending),
      deadline: new Date(Date.now() + 18 * 864e5).toISOString(),
      first_activation: first,
      can_activate: first,
      can_reactivate: Boolean(activated) && status !== "banned",
      already_active: status === "active",
      can_upgrade: status !== "banned" && targets.length > 0,
      upgrade_targets: targets,
      prices: {
        silver: { 3: 900, 6: 1700, 9: 2400, 12: 3000, 18: 4200, 24: 5200 },
        gold: { 3: 1500, 6: 2800, 9: 3900, 12: 4900, 18: 6900, 24: 8500 },
        diamond: { 3: 2400, 6: 4500, 9: 6300, 12: 7900, 18: 11000, 24: 13500 },
      },
      durations: [3, 6, 9, 12, 18, 24],
      ad_seconds: 30,
      ad_url: "https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a",
      profile: scenario.profile || {
        name: MEMBER.full_name,
        description: null,
        avatar: null,
        cover: null,
        language: "en",
        country: "MA",
        complete: false,
      },
      viewing_codes: scenario.viewingCodes || 0,
      mode: status === "banned" ? "blocked" : first ? "activate" : "choose",
    });
  }
  if (href.includes("/rpc/activation_profile_save")) {
    scenario.profile = {
      name: body.p_name,
      description: body.p_description,
      avatar: body.p_avatar,
      cover: body.p_cover,
      language: body.p_language,
      country: body.p_country,
      complete: true,
    };
    return reply({ ok: true, profile: scenario.profile });
  }
  if (href.includes("/rpc/activation_viewing_code_save")) {
    return reply({
      ok: true,
      code: {
        code: body.p_code,
        months: body.p_months,
        age: body.p_age,
        device: body.p_device,
        device_name: body.p_device_name,
        expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      },
    });
  }
  if (href.includes("/rpc/activation_ad_open")) {
    scenario.adOpened = body.p_type;
    return reply({
      ok: true,
      session: "11111111-2222-3333-4444-555555555555",
      seconds: 30,
      ad_url: "https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a",
    });
  }
  if (href.includes("/rpc/activation_ad_claim")) {
    scenario.claims = (scenario.claims || 0) + 1;
    if (scenario.claims === 1) return reply({ ok: false, error: "too_soon", remaining: 12 });
    return reply({ ok: true, code: "ACT-TEST-1234", type: scenario.adOpened || "initial", reused: false });
  }
  if (href.includes("/rpc/activation_ad_cancel")) return reply({ ok: true });
  if (href.includes("/rpc/activation_pay_points")) {
    scenario.paid = { type: body.p_type, target: body.p_target, duration: body.p_duration };
    return reply({
      ok: true,
      code: "ACT-PAYD-0001",
      points: 2800,
      balance: 2200,
      type: body.p_type,
      target: body.p_target,
      duration: body.p_duration,
    });
  }
  if (href.includes("/rpc/activation_redeem")) {
    scenario.redeemed = { type: body.p_type, target: body.p_target, duration: body.p_duration, code: body.p_code };
    const membership = body.p_type === "upgrade" ? body.p_target : scenario.membership || "free";
    return reply({
      ok: true,
      type: body.p_type,
      status: "active",
      membership,
      duration: body.p_duration,
      expires_at: new Date(Date.now() + 30 * 864e5).toISOString(),
      code: body.p_code,
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
  window.open = () => ({ closed: false, opener: null, focus() {} });
  window.URL.createObjectURL = () => "blob:preview";

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
  expect("activated: guest no wizard", p.qs("[data-wizard]").hidden === true);
  expect("activated: guest no doors", p.qs("[data-act-choice]").hidden === true);
  expect("activated: guest no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — first activation: the four steps --------------------- */
{
  scenario = { status: "inactive", membership: "free", activatedAt: null };
  calls.length = 0;
  const p = await boot(2, { file: "activated.html", search: "?member=ID100042" });
  expect("first: mode activate", p.qs("[data-act]").dataset.mode === "activate");
  expect("first: title", /Activate your account/i.test(p.text("[data-act-title]")));
  expect("first: member id filled", /ID100042/.test(p.text("[data-act-member]")));
  expect("first: never activated", /Never/i.test(p.text("[data-act-activated]")));
  expect("first: four steps", p.qsa("[data-step-dot]").length === 4);
  expect("first: wizard visible", p.qs("[data-wizard]").hidden === false);
  expect("first: doors hidden", p.qs("[data-act-choice]").hidden === true);
  expect("first: starts on step 1", p.qs("[data-step='1']").hidden === false && p.qs("[data-step='2']").hidden === true);
  expect("first: progress 25", /25%/.test(p.qs("[data-progress]").style.width || ""));
  expect("first: device detected", /^[0-9A-F:]{17}$/.test(p.text("[data-device-id]")));

  // step 1 — profile
  p.qs("[data-pf-name]").value = "Youssef A.";
  p.qs("[data-pf-desc]").value = "Sci-fi and documentaries.";
  p.submit(p.qs("[data-step='1']"));
  await p.wait(260);

  expect("step1: profile saved", calls.some((c) => c.includes("activation_profile_save")));
  expect("step1: moved to step 2", p.qs("[data-step='2']").hidden === false && p.qs("[data-step='1']").hidden === true);
  expect("step1: progress 50", /50%/.test(p.qs("[data-progress]").style.width || ""));
  expect("step1: dot 1 done", p.qs("[data-step-dot='1']").dataset.state === "done");

  // step 2 — viewing code
  p.click(p.qs("[data-vc-generate]"));
  expect("step2: generated six digits", /^\d{6}$/.test(p.qs("[data-vc-code]").value));
  p.qs("[data-vc-age]").value = "18";
  p.submit(p.qs("[data-step='2']"));
  await p.wait(260);

  expect("step2: viewing code saved", calls.some((c) => c.includes("activation_viewing_code_save")));
  expect("step2: moved to step 3", p.qs("[data-step='3']").hidden === false);
  expect("step2: free duration is one month", p.qsa("[data-vc-months] option").length === 1);

  // step 3 — the ad gate
  expect("step3: ad modal closed", p.qs("[data-ad]").hidden === true);
  p.click(p.qs("[data-ac-get]"));
  await p.wait(120);
  expect("step3: ad modal open", p.qs("[data-ad]").hidden === false);
  expect("step3: ad link points at the ad", (p.qs("[data-ad-link]")?.getAttribute("href") || "").includes("asiafilm.org"));

  p.click(p.qs("[data-ad-link]"));
  await p.wait(400);
  expect("step3: ad session opened", calls.some((c) => c.includes("activation_ad_open")));
  await p.wait(3400);

  expect("step3: code auto-filled", /ACT-TEST-1234/.test(p.qs("[data-ac-code]").value));
  expect("step3: next enabled", p.qs("[data-ac-next]").disabled === false);
  expect("step3: ad modal closed after", p.qs("[data-ad]").hidden === true);

  p.click(p.qs("[data-ac-next]"));
  await p.wait(120);
  expect("step3: moved to step 4", p.qs("[data-step='4']").hidden === false);
  expect("step4: summary shows the code", /ACT-TEST-1234/.test(p.text("[data-sum-code]")));
  expect("step4: summary shows the viewing code", /\d{6}/.test(p.text("[data-sum-viewing]")));
  expect("step4: progress 100", /100%/.test(p.qs("[data-progress]").style.width || ""));

  // step 4 — activate
  p.click(p.qs("[data-activate]"));
  await p.wait(900);
  expect("step4: redeem called", scenario.redeemed && scenario.redeemed.type === "initial");
  expect("step4: free plan, one month", Boolean(scenario.redeemed) && scenario.redeemed.target === "free" && scenario.redeemed.duration === 1);
  await p.wait(900);
  expect("step4: success title", /Account Activated Successfully/i.test(p.text("[data-done-title]")));
  expect("step4: done visible", p.qs("[data-done]").hidden === false);
  expect("step4: finish links to dashboard", (p.qs("[data-done-finish]")?.getAttribute("href") || "").includes("dashboard.html"));
  expect("step4: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — premium re-activation with points -------------------- */
{
  scenario = {
    status: "expired",
    membership: "gold",
    activatedAt: new Date(Date.now() - 200 * 864e5).toISOString(),
    expiresAt: new Date(Date.now() - 5 * 864e5).toISOString(),
  };
  calls.length = 0;
  const p = await boot(3, { file: "activated.html", search: "?member=ID100042" });
  expect("react: mode choose", p.qs("[data-act]").dataset.mode === "choose");
  expect("react: two doors", p.qsa(".dsh-choice__card").length === 2);
  expect("react: wizard hidden", p.qs("[data-wizard]").hidden === true);
  expect("react: plan gold", /Gold/i.test(p.text("[data-act-membership]")));

  p.click(p.qs("[data-open-react]"));
  await p.wait(120);
  expect("react: panel open", p.qs("[data-react]").hidden === false);
  expect("react: premium durations", p.qsa("[data-react-months] option").length === 6);
  expect("react: pay block visible", p.qs("[data-react-pay]").hidden === false);

  p.qs("[data-react-months]").value = "6";
  p.qs("[data-react-months]").dispatchEvent(new p.window.Event("change", { bubbles: true }));
  expect("react: price for 6 months", /2,800/.test(p.text("[data-react-price]")));

  p.click(p.qs("[data-react-points]"));
  await p.wait(200);
  expect("react: points paid", scenario.paid && scenario.paid.type === "reactivation");
  expect("react: plan kept, duration 6", scenario.paid.target === "gold" && scenario.paid.duration === 6);
  expect("react: code filled", /ACT-PAYD-0001/.test(p.qs("[data-react-code]").value));

  p.click(p.qs("[data-react-get]"));
  await p.wait(120);
  expect("react: premium does not use the ad", p.qs("[data-ad]").hidden === true);

  p.click(p.qs("[data-react-go]"));
  await p.wait(1100);
  expect("react: redeem type reactivation", scenario.redeemed && scenario.redeemed.type === "reactivation");
  expect("react: same plan and duration", scenario.redeemed.target === "gold" && scenario.redeemed.duration === 6);
  expect("react: success title", /Membership Reactivated Successfully/i.test(p.text("[data-done-title]")));
  expect("react: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — free re-activation through the ad -------------------- */
{
  scenario = {
    status: "active",
    membership: "free",
    activatedAt: new Date(Date.now() - 40 * 864e5).toISOString(),
    expiresAt: new Date(Date.now() + 9 * 864e5).toISOString(),
  };
  calls.length = 0;
  const p = await boot(4, { file: "activated.html", search: "?member=ID100042&mode=reactivate" });
  expect("free react: panel opens from the query", p.qs("[data-react]").hidden === false);
  expect("free react: one month only", p.qsa("[data-react-months] option").length === 1);
  expect("free react: no points payment", p.qs("[data-react-pay]").hidden === true);

  p.click(p.qs("[data-react-get]"));
  await p.wait(120);
  expect("free react: ad modal open", p.qs("[data-ad]").hidden === false);
  p.click(p.qs("[data-ad-link]"));
  await p.wait(3400);
  expect("free react: code auto-filled", /ACT-TEST-1234/.test(p.qs("[data-react-code]").value));
  expect("free react: session type", scenario.adOpened === "reactivation");

  p.click(p.qs("[data-react-go]"));
  await p.wait(1100);
  expect("free react: redeem reactivation", scenario.redeemed && scenario.redeemed.type === "reactivation");
  expect("free react: success title", /Free Membership Has Been Reactivated Successfully/i.test(p.text("[data-done-title]")));
  expect("free react: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — upgrade gold → diamond with points ------------------- */
{
  scenario = {
    status: "active",
    membership: "gold",
    activatedAt: new Date(Date.now() - 90 * 864e5).toISOString(),
    expiresAt: new Date(Date.now() + 20 * 864e5).toISOString(),
  };
  calls.length = 0;
  const p = await boot(5, { file: "activated.html", search: "?member=ID100042&mode=upgrade" });
  expect("upgrade: panel opens from the query", p.qs("[data-upgrade]").hidden === false);
  expect("upgrade: only diamond offered", p.qsa("[data-up-tier] option").length === 1 && /diamond/i.test(p.text("[data-up-tier]")));
  expect("upgrade: durations 3…24", p.qsa("[data-up-months] option").length === 6);
  expect("upgrade: price shown", /2,400/.test(p.text("[data-up-price]")));

  p.qs("[data-up-months]").value = "6";
  p.qs("[data-up-months]").dispatchEvent(new p.window.Event("change", { bubbles: true }));
  expect("upgrade: price follows the duration", /4,500/.test(p.text("[data-up-price]")));

  p.click(p.qs("[data-up-points]"));
  await p.wait(200);
  expect("upgrade: points paid for diamond", scenario.paid && scenario.paid.type === "upgrade" && scenario.paid.target === "diamond");
  expect("upgrade: code filled", /ACT-PAYD-0001/.test(p.qs("[data-up-code]").value));

  p.click(p.qs("[data-up-go]"));
  await p.wait(1100);
  expect("upgrade: redeem upgrade", scenario.redeemed && scenario.redeemed.type === "upgrade");
  expect("upgrade: target and duration", scenario.redeemed.target === "diamond" && scenario.redeemed.duration === 6);
  expect("upgrade: success title", /Membership Upgraded Successfully/i.test(p.text("[data-done-title]")));
  expect("upgrade: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — diamond: no upgrade door ----------------------------- */
{
  scenario = {
    status: "active",
    membership: "diamond",
    activatedAt: new Date(Date.now() - 300 * 864e5).toISOString(),
    expiresAt: new Date(Date.now() + 40 * 864e5).toISOString(),
  };
  const p = await boot(6, { file: "activated.html", search: "?member=ID100042" });
  expect("diamond: still offers the doors", p.qs("[data-act-choice]").hidden === false);
  expect("diamond: upgrade disabled", p.qs("[data-open-upgrade]").disabled === true);
  expect("diamond: chip says top tier", /Top tier/i.test(p.text("[data-upgrade-state]")));
  expect("diamond: reactivation available", p.qs("[data-open-react]").disabled === false);
  expect("diamond: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — paid plan, never activated --------------------------- */
{
  scenario = { status: "inactive", membership: "silver", activatedAt: null };
  const p = await boot(7, { file: "activated.html", search: "?member=ID100042" });
  expect("paid: mode choose", p.qs("[data-act]").dataset.mode === "choose");
  expect("paid: no wizard", p.qs("[data-wizard]").hidden === true);
  expect("paid: explains free-only activation", /free-only|free plan/i.test(p.text("[data-paid-note]")));
  expect("paid: upgrade offers gold and diamond", p.qsa("[data-up-tier] option").length === 2);
  expect("paid: no error", p.errors.length === 0, p.errors.join(" | "));
}

/* activated.html — banned: neither door is open ------------------------- */
{
  scenario = { status: "banned", membership: "free", activatedAt: new Date(Date.now() - 30 * 864e5).toISOString() };
  const p = await boot(8, { file: "activated.html", search: "?member=ID100042" });
  expect("banned: mode blocked", p.qs("[data-act]").dataset.mode === "blocked");
  expect("banned: title", /banned/i.test(p.text("[data-act-title]")));
  expect("banned: no wizard", p.qs("[data-wizard]").hidden === true);
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
