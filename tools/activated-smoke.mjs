/**
 * activated.html smoke test (jsdom, no network).
 *
 *   node tools/activated-smoke.mjs
 *
 * Three complaints from the brief, one check each:
 *   • the first visit shows the wizard only — no «Re-activate», no «Upgrade»,
 *     no success card (the page root is `.dsh-page`, so `[hidden]` has to win
 *     from base.css and not from a `.dsh` scope)
 *   • the success card appears only after the last step, never at boot
 *   • the ad countdown stops when the page is hidden or the ad tab is closed,
 *     and an ad page that the browser blocks says so instead of hanging
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "activated.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const baseCss = readFileSync(join(root, "assets/css/base.css"), "utf8");

const TOKEN = "c".repeat(64);
const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  email: "youssef@example.com",
  membership: "free",
  status: "inactive",
  avatar_url: "",
};

const calls = [];
const errors = [];
let scenario = {};

function reply(data) {
  return Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
}

function stubFetch(url, options = {}) {
  const href = String(url);
  calls.push({ href, body: options.body ? String(options.body).slice(0, 200) : "" });
  if (href.includes("/rpc/member_activation_state")) {
    return reply({
      ok: true,
      mode: scenario.mode || "activate",
      status: "inactive",
      member: MEMBER,
      membership: "free",
      activated_at: scenario.activatedAt || null,
      deadline: new Date(Date.now() + 30 * 864e5).toISOString(),
      profile: scenario.profile || { name: "", description: "", country: "", language: "en" },
      can_reactivate: true,
      can_upgrade: true,
      ad_url: "https://asiafilm.org/4/e476b83b0c777b7828ac79fef485bd1a",
      plans: [],
    });
  }
  if (href.includes("/rpc/activation_profile_save")) return reply({ ok: true, profile: { name: "Youssef" } });
  if (href.includes("/rpc/activation_ad_open")) return reply({ ok: true, session: "s-1", seconds: 30 });
  if (href.includes("/rpc/activation_ad_claim")) {
    if (scenario.claimCode) return reply({ ok: true, code: scenario.claimCode });
    return reply({ ok: false, error: "too_soon", remaining: 29 });
  }
  if (href.includes("/rpc/activation_ad_cancel")) return reply({ ok: true });
  return reply([]);
}

async function boot(pass, { openAllowed = true } = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/activated.html", pretendToBeVisual: true });
  const { window } = dom;
  window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));
  window.addEventListener("unhandledrejection", (e) => errors.push(String(e.reason)));

  globalThis.window = window;
  globalThis.document = window.document;
  globalThis.HTMLElement = window.HTMLElement;
  globalThis.Element = window.Element;
  globalThis.Node = window.Node;
  globalThis.CustomEvent = window.CustomEvent;
  globalThis.Event = window.Event;
  globalThis.File = window.File;
  globalThis.Blob = window.Blob;
  globalThis.FormData = window.FormData;
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  globalThis.getComputedStyle = window.getComputedStyle.bind(window);
  globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
  globalThis.matchMedia = (q) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  globalThis.location = {
    search: "",
    hash: "",
    href: "http://localhost/activated.html",
    protocol: "http:",
    pathname: "/activated.html",
  };
  globalThis.fetch = stubFetch;
  window.scrollTo = () => {};
  window.focus = () => {};

  /* the pop-up: `null` means the browser — or an ad blocker — refused it */
  const popups = [];
  const tabs = [];
  window.open = (href) => {
    popups.push(href);
    if (!openAllowed) return null;
    const tab = { href, closed: false, close() { this.closed = true; } };
    tabs.push(tab);
    return tab;
  };

  /* a visibility the test can flip */
  let visibility = "visible";
  Object.defineProperty(window.document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
  const setVisibility = (value) => {
    visibility = value;
    window.document.dispatchEvent(new window.Event("visibilitychange"));
  };

  window.localStorage.clear();
  window.localStorage.setItem("1w.session", TOKEN);

  await import(`file://${join(root, "assets/js/activated.js")}?pass=${pass}`);
  await new Promise((r) => setTimeout(r, 260));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => [...window.document.querySelectorAll(sel)];
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (el) => el && el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  return { window, document: window.document, qs, qsa, text, click, wait, popups, tabs, setVisibility };
}

const checks = [];
function expect(name, condition, detail = "") {
  checks.push({ name, ok: Boolean(condition), detail });
}

/* the CSS rule that makes `hidden` work outside a `.dsh` scope */
expect(
  "base.css: [hidden] is global",
  /\[hidden\]\s*\{\s*display:\s*none\s*!important;?\s*\}/.test(baseCss),
  baseCss.split("\n").find((line) => line.includes("[hidden]"))
);

/* ------------------------------------------------------------------ */
/* pass 1 — first visit, nothing activated yet                        */
/* ------------------------------------------------------------------ */
{
  scenario = { mode: "activate", profile: {} };
  calls.length = 0;
  const p = await boot(1);

  expect("first visit: wizard shown", p.qs("[data-wizard]")?.hidden === false);
  expect("first visit: re-activate hidden", p.qs("[data-react]") ? p.qs("[data-react]").hidden === true : true);
  expect("first visit: upgrade hidden", p.qs("[data-upgrade]") ? p.qs("[data-upgrade]").hidden === true : true);
  expect("first visit: choice panel hidden", p.qs("[data-act-choice]")?.hidden === true);
  expect("first visit: success card hidden", p.qs("[data-done]")?.hidden === true);
  expect("first visit: step 1 only", p.qsa("[data-step]").filter((el) => !el.hidden).length === 1);
  expect("first visit: member id painted", p.text("[data-act-member]") === "ID100042");

  /* the image link: no upload, the link is kept as it is */
  const urlInput = p.qs('[data-url-input="avatar"]');
  urlInput.value = "https://images.example/me.png";
  p.click(p.qs('[data-url-apply="avatar"]'));
  await p.wait(60);
  expect("link: preview shown", p.qs('[data-preview-box="avatar"]')?.hidden === false);
  expect("link: preview src", (p.qs('[data-preview="avatar"]')?.getAttribute("src") || "").includes("images.example/me.png"));
  expect("link: remove button shown", p.qs('[data-clear="avatar"]')?.hidden === false);
  expect("link: crop button offered", p.qs('[data-crop="avatar"]')?.hidden === false);

  /* a bad link is refused */
  urlInput.value = "not a link";
  p.click(p.qs('[data-url-apply="avatar"]'));
  await p.wait(40);
  expect("link: bad value refused", (p.qs('[data-preview="avatar"]')?.getAttribute("src") || "").includes("images.example/me.png"));

  /* the ad: the browser refuses the pop-up */
  const blocked = await boot(2, { openAllowed: false });
  blocked.click(blocked.qs("[data-ac-get]"));
  await blocked.wait(80);
  expect("blocked ad: the ad panel opens", blocked.qs("[data-ad]")?.hidden === false);
  blocked.click(blocked.qs("[data-ad-link]"));
  await blocked.wait(220);
  const opens = calls.filter((call) => call.href.includes("activation_ad_open")).length;
  expect("blocked ad: nothing starts on the server", opens === 0, `${opens}`);
  expect("blocked ad: says it plainly", /blocked/i.test(blocked.text("[data-ad-status]")), blocked.text("[data-ad-status]"));

  /* the ad: allowed, then the member hides the page */
  calls.length = 0;
  const ad = await boot(3, { openAllowed: true });
  ad.click(ad.qs("[data-ac-get]"));
  await ad.wait(80);
  ad.click(ad.qs("[data-ad-link]"));
  await ad.wait(260);
  expect("ad: opens a tab", ad.popups.length === 1, ad.popups.join(" | "));
  expect("ad: server clock started", calls.some((call) => call.href.includes("activation_ad_open")));
  expect("ad: counting down", ad.text("[data-ad-status]").toLowerCase().includes("countdown"), ad.text("[data-ad-status]"));

  const before = Number(ad.text("[data-ad-time]"));
  ad.setVisibility("hidden");
  await ad.wait(60);
  expect("ad: hidden page pauses", /paused/i.test(ad.text("[data-ad-status]")) && /left the activation page/i.test(ad.text("[data-ad-status]")), ad.text("[data-ad-status]"));
  await ad.wait(1200);
  expect("ad: the clock stops while hidden", Number(ad.text("[data-ad-time]")) === before, `${before} → ${ad.text("[data-ad-time]")}`);

  /* the ad tab closed by the member — the clock stops again */
  ad.setVisibility("visible");
  ad.click(ad.qs("[data-ad-link]"));
  await ad.wait(200);
  expect("ad: resumed after coming back", /countdown running/i.test(ad.text("[data-ad-status]")) || /resumed/i.test(ad.text("[data-ad-status]")), ad.text("[data-ad-status]"));
  const frozen = Number(ad.text("[data-ad-time]"));
  ad.tabs.at(-1).closed = true;
  await ad.wait(1300);
  expect("ad: a closed ad tab pauses", /closed/i.test(ad.text("[data-ad-status]")), ad.text("[data-ad-status]"));
  expect("ad: clock frozen after the tab closed", Number(ad.text("[data-ad-time]")) === frozen, `${frozen} → ${ad.text("[data-ad-time]")}`);
}

/* ------------------------------------------------------------------ */
/* pass 1d — the countdown finishes: back on the activation page       */
/* ------------------------------------------------------------------ */
{
  scenario = { mode: "activate", claimCode: "ACT-9K2M-4Q7Z" };
  const p = await boot(5, { openAllowed: true });
  p.click(p.qs("[data-ac-get]"));
  await p.wait(80);
  p.click(p.qs("[data-ad-link]"));
  await p.wait(3200);
  expect("finish: the code lands in the field", (p.qs("[data-ac-code]")?.value || "") === "ACT-9K2M-4Q7Z", p.qs("[data-ac-code]")?.value);
  expect("finish: the next button is enabled", p.qs("[data-ac-next]")?.disabled === false);
  expect("finish: the ad tab is closed", p.tabs.at(-1)?.closed === true);
  expect("finish: the ad panel is gone", p.qs("[data-ad]")?.hidden === true);
}

/* ------------------------------------------------------------------ */
/* pass 2 — the account was activated before (second visit)           */
/* ------------------------------------------------------------------ */
{
  scenario = { mode: "choose", activatedAt: new Date(Date.now() - 40 * 864e5).toISOString() };
  const p = await boot(4);
  expect("second visit: choice panel shown", p.qs("[data-act-choice]")?.hidden === false);
  expect("second visit: wizard hidden", p.qs("[data-wizard]")?.hidden === true);
  expect("second visit: success card still hidden", p.qs("[data-done]")?.hidden === true);
  const doors = p.qsa("[data-act-choice] [data-choice]");
  expect("second visit: the two doors exist", doors.length === 2, `${doors.length}`);
  expect(
    "second visit: door names",
    /re-activate/i.test(p.text('[data-choice="reactivate"]')) && /upgrade/i.test(p.text('[data-choice="upgrade"]'))
  );
  expect("second visit: no runtime errors", errors.length === 0, errors.join(" | "));
}

/* ------------------------------------------------------------------ */
expect("no runtime errors at all", errors.length === 0, errors.join(" | "));

const failed = checks.filter((check) => !check.ok);
for (const check of checks) {
  console.log(`${check.ok ? "ok  " : "FAIL"}  ${check.name}${check.ok || !check.detail ? "" : `  → ${check.detail}`}`);
}
console.log(`\nchecks: ${checks.length - failed.length}/${checks.length} pass`);
process.exit(failed.length ? 1 : 0);
