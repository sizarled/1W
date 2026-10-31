/**
 * login.html smoke test (jsdom, no network).
 *
 *   node tools/login-smoke.mjs
 *
 * Pass 1 — fresh visitor: prefill, empty submit, wrong password, unknown
 *          account, then sign-in for an inactive account, a banned account and
 *          an active one (all three reach the signed-in card), plus log out.
 * Pass 2 — returning visitor: a stored token is restored through
 *          `member_session()`.
 * Pass 3 — a stored token the server no longer accepts.
 * Pass 4 — a restored session for an account that is not active.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "login.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");

const CODE_TOKEN = "a".repeat(64);
const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  member_code: "000042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  email: "youssef@example.com",
  avatar_url: "",
  level: 3,
  points: 420,
  membership: "gold",
  status: "active",
  account_status: "active",
  created_at: "2026-10-31T20:00:00Z",
};
const EXPIRES = new Date(Date.now() + 30 * 864e5).toISOString();

let mode = "active"; // active | inactive | banned | password | not_found | restore-dead | restore-restricted
const calls = [];

function reply(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

function sessionPayload(status, remember) {
  return {
    id: "s1",
    token: CODE_TOKEN,
    expires_at: EXPIRES,
    remember_me: Boolean(remember),
  };
}

function stubFetch(url, opts = {}) {
  const href = String(url);
  calls.push(href);
  const body = opts.body ? JSON.parse(opts.body) : {};

  if (href.includes("/rpc/member_login")) {
    if (mode === "password" || mode === "not_found") return reply({ ok: false, error: mode });
    const status = mode === "inactive" || mode === "banned" ? mode : "active";
    return reply({
      ok: true,
      restricted: status !== "active",
      status,
      login_method: "member_id",
      session: sessionPayload(status, body.p_remember),
      member: { ...MEMBER, status, account_status: status },
    });
  }

  if (href.includes("/rpc/member_session")) {
    if (mode === "restore-dead") return reply({ ok: false, error: "expired" });
    const status = mode === "restore-restricted" ? "inactive" : "active";
    return reply({
      ok: true,
      restricted: status !== "active",
      status,
      member: { ...MEMBER, status, account_status: status },
      session: { ...sessionPayload(status, true), created_at: "2026-10-31T20:00:00Z", last_activity_at: new Date().toISOString() },
    });
  }

  if (href.includes("/rpc/member_logout")) return reply({ ok: true, ended_at: new Date().toISOString() });
  if (href.includes("/rpc/member_log")) return reply({ ok: true });
  return reply([]);
}

/* ------------------------------------------------------------------ */
/* one page instance                                                  */
/* ------------------------------------------------------------------ */
async function boot(pass, { token } = {}) {
  const dom = new JSDOM(html, { url: "http://localhost/login.html?username=@youssef.amrani&next=dashboard.html", pretendToBeVisual: true });
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
  globalThis.localStorage = window.localStorage;
  globalThis.sessionStorage = window.sessionStorage;
  if (typeof globalThis.crypto?.randomUUID !== "function") {
    Object.defineProperty(globalThis, "crypto", { value: window.crypto, configurable: true });
  }
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
  globalThis.location = { search: "?username=@youssef.amrani&next=dashboard.html", href: "http://localhost/login.html", protocol: "http:", pathname: "/login.html" };
  globalThis.fetch = stubFetch;

  // the geo lookup is warm, so no provider call is made
  window.sessionStorage.setItem("1w.geo", JSON.stringify({ ip: "41.140.12.7", country: "Morocco", at: Date.now() }));
  window.localStorage.clear();
  window.sessionStorage.removeItem("1w.session");
  if (token) window.localStorage.setItem("1w.session", token);

  const mod = await import(`file://${join(root, "assets/js/login.js")}?pass=${pass}`);
  await mod.initLogin();
  await new Promise((r) => setTimeout(r, 140));

  const qs = (sel) => window.document.querySelector(sel);
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const wait = (ms = 100) => new Promise((r) => setTimeout(r, ms));
  const setInput = (name, value) => {
    const input = qs(`[name="${name}"]`);
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    return input;
  };
  const submit = () => qs("[data-lgform]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  const errorFor = (name) => {
    const node = qs(`[data-err="${name}"]`);
    return node && !node.hidden ? node.textContent.trim() : "";
  };

  return { window, document: window.document, qs, text, click, wait, setInput, submit, errorFor, errors, mod };
}

/* ------------------------------------------------------------------ */
/* pass 1 — fresh visitor                                             */
/* ------------------------------------------------------------------ */
const report = {};
{
  mode = "active";
  calls.length = 0;
  const p = await boot(1);

  report.formVisible = p.qs("[data-lg-form]").hidden === false;
  report.successHidden = p.qs("[data-lg-success]").hidden === true;
  report.prefill = p.qs('[name="login"]').value;
  report.fields = p.document.querySelectorAll(".lg-form .lg-field").length;
  report.rememberDefault = p.qs("[data-remember]").checked;
  report.forgotHref = p.qs(".lg-links a")?.getAttribute("href") || "";
  report.signupHref = [...p.document.querySelectorAll(".lg-links a")].map((a) => a.getAttribute("href"));

  // 1. empty submit
  p.setInput("login", "");
  p.submit();
  await p.wait(60);
  report.emptyError = p.errorFor("login");
  report.emptyNoCall = !calls.some((c) => c.includes("member_login"));

  // 2. empty password
  p.setInput("login", "ID100042");
  p.setInput("password", "");
  p.submit();
  await p.wait(60);
  report.emptyPasswordError = p.errorFor("password");

  // 3. wrong password
  mode = "password";
  p.setInput("password", "nope-nope");
  p.submit();
  await p.wait(140);
  report.wrongPasswordAlert = p.text("[data-lg-error-text]");
  report.wrongPasswordField = p.errorFor("password");
  report.wrongStillOnForm = p.qs("[data-lg-form]").hidden === false;

  // 4. unknown account
  mode = "not_found";
  p.setInput("login", "ID999999");
  p.submit();
  await p.wait(140);
  report.notFoundAlert = p.text("[data-lg-error-text]");
  report.notFoundField = p.errorFor("login");

  // 5. inactive account — allowed in, flagged
  mode = "inactive";
  p.setInput("login", "@youssef.amrani");
  p.setInput("password", "Str0ngPass!23");
  p.submit();
  await p.wait(200);
  report.inactiveSuccess = p.qs("[data-lg-success]").hidden === false;
  report.inactiveFormHidden = p.qs("[data-lg-form]").hidden === true;
  report.inactiveStatusChip = p.text("[data-lg-status]");
  report.inactiveChipState = p.qs("[data-lg-status]")?.dataset.state;
  report.inactiveNoticeShown = p.qs("[data-lg-notice]").hidden === false;
  report.inactiveNoticeTitle = p.text("[data-lg-notice-title]");
  report.inactiveNoticeText = p.text("[data-lg-notice-text]");
  report.inactiveHasActions =
    p.qs("[data-lg-profile]").getAttribute("href") === "profile.html" &&
    p.qs("[data-lg-dashboard]").getAttribute("href") === "dashboard.html" &&
    Boolean(p.qs("[data-lg-logout]"));

  // back to the form
  p.click(p.qs("[data-lg-logout]"));
  await p.wait(160);
  report.afterInactiveLogout = p.qs("[data-lg-form]").hidden === false;

  // 6. banned account — also allowed in
  mode = "banned";
  p.setInput("login", "ID100042");
  p.setInput("password", "Str0ngPass!23");
  p.submit();
  await p.wait(200);
  report.bannedSuccess = p.qs("[data-lg-success]").hidden === false;
  report.bannedStatusChip = p.text("[data-lg-status]");
  report.bannedNoticeTitle = p.text("[data-lg-notice-title]");
  report.bannedNoticeText = p.text("[data-lg-notice-text]");

  p.click(p.qs("[data-lg-logout]"));
  await p.wait(160);

  // 7. active account with "stay signed in"
  mode = "active";
  p.qs("[data-remember]").checked = true;
  p.setInput("login", "ID100042");
  p.setInput("password", "Str0ngPass!23");
  p.submit();
  await p.wait(220);

  report.successVisible = p.qs("[data-lg-success]").hidden === false;
  report.formHidden = p.qs("[data-lg-form]").hidden === true;
  report.name = p.text("[data-lg-name]");
  report.memberId = p.text("[data-lg-member-id]");
  report.status = p.text("[data-lg-status]");
  report.avatarSrc = (p.qs("[data-lg-avatar]")?.getAttribute("src") || "").slice(0, 30);
  report.detailRows = [...p.document.querySelectorAll("[data-lg-details] div")].map((row) => row.textContent.replace(/\s+/g, " ").trim());
  report.message = p.text("[data-lg-message]");
  report.noticeHidden = p.qs("[data-lg-notice]").hidden === true;
  report.profileHref = p.qs("[data-lg-profile]").getAttribute("href");
  report.dashboardHref = p.qs("[data-lg-dashboard]").getAttribute("href");
  report.nextHref = p.qs("[data-lg-next]").getAttribute("href");
  report.nextVisible = p.qs("[data-lg-next]").hidden === false;
  report.tokenStored = p.window.localStorage.getItem("1w.session");
  report.tokenNotInSessionStore = p.window.sessionStorage.getItem("1w.session");
  report.memberStored = JSON.parse(p.window.localStorage.getItem("1w.member") || "null");

  // 8. log out
  p.click(p.qs("[data-lg-logout]"));
  await p.wait(200);
  report.logoutCalled = calls.some((c) => c.includes("member_logout"));
  report.afterLogoutForm = p.qs("[data-lg-form]").hidden === false;
  report.afterLogoutToken = p.window.localStorage.getItem("1w.session");
  report.afterLogoutMember = p.window.localStorage.getItem("1w.member");
  report.passwordCleared = p.qs('[name="password"]').value === "";
  report.errors1 = p.errors;
}

/* ------------------------------------------------------------------ */
/* pass 2 — returning visitor with a live token                       */
/* ------------------------------------------------------------------ */
{
  mode = "active";
  calls.length = 0;
  const p = await boot(2, { token: CODE_TOKEN });

  report.restoredVisible = p.qs("[data-lg-success]").hidden === false;
  report.restoredFormHidden = p.qs("[data-lg-form]").hidden === true;
  report.restoredName = p.text("[data-lg-name]");
  report.restoredMessage = p.text("[data-lg-message]");
  report.restoredNotice = p.qs("[data-lg-notice]").hidden === true;
  report.restoredSessionCall = calls.some((c) => c.includes("member_session"));
  report.restoredErrors = p.errors;
}

/* ------------------------------------------------------------------ */
/* pass 3 — stored token that the server no longer accepts            */
/* ------------------------------------------------------------------ */
{
  mode = "restore-dead";
  calls.length = 0;
  const p = await boot(3, { token: CODE_TOKEN });

  report.deadTokenStaysOnForm = p.qs("[data-lg-form]").hidden === false;
  report.deadTokenCleared = p.window.localStorage.getItem("1w.session");
  report.deadTokenErrors = p.errors;
}

/* ------------------------------------------------------------------ */
/* pass 4 — restored session for an inactive account                  */
/* ------------------------------------------------------------------ */
{
  mode = "restore-restricted";
  calls.length = 0;
  const p = await boot(4, { token: CODE_TOKEN });

  report.restoredRestrictedVisible = p.qs("[data-lg-success]").hidden === false;
  report.restoredRestrictedNotice = p.qs("[data-lg-notice]").hidden === false;
  report.restoredRestrictedTitle = p.text("[data-lg-notice-title]");
  report.restoredRestrictedErrors = p.errors;
}

/* ------------------------------------------------------------------ */
/* checks                                                             */
/* ------------------------------------------------------------------ */
const details = report.detailRows || [];
const checks = {
  form: report.formVisible && report.successHidden && report.fields === 2 && report.prefill === "@youssef.amrani",
  rememberDefault: report.rememberDefault === false,
  links: report.forgotHref === "help.html" && report.signupHref.includes("register.html"),
  emptySubmit: report.emptyError.length > 0 && report.emptyNoCall,
  emptyPassword: report.emptyPasswordError.length > 0,
  wrongPassword:
    report.wrongPasswordAlert.includes("not correct") &&
    report.wrongPasswordField.includes("not correct") &&
    report.wrongStillOnForm,
  notFound: report.notFoundAlert.includes("No account matches") && report.notFoundField.includes("No account matches"),
  inactiveAllowed:
    report.inactiveSuccess && report.inactiveFormHidden &&
    report.inactiveStatusChip === "Inactive" && report.inactiveChipState === "restricted" &&
    report.inactiveNoticeShown && report.inactiveNoticeTitle.includes("not activated") &&
    report.inactiveNoticeText.includes("banned automatically") &&
    report.inactiveHasActions && report.afterInactiveLogout,
  bannedAllowed:
    report.bannedSuccess && report.bannedStatusChip === "Banned" &&
    report.bannedNoticeTitle.includes("banned") && report.bannedNoticeText.includes("appeal"),
  signedIn:
    report.successVisible && report.formHidden && report.name === "@youssef.amrani" &&
    report.memberId === "ID100042" && report.status === "Active" && report.noticeHidden,
  avatar: report.avatarSrc.startsWith("data:image/svg+xml"),
  details:
    details.length === 8 &&
    details.some((r) => r.includes("Member ID")) && details.some((r) => r.includes("ID100042")) &&
    details.some((r) => r.includes("LV 3")) && details.some((r) => r.includes("Gold")) &&
    details.some((r) => r.includes("Stay signed in")),
  actions:
    report.profileHref === "profile.html" && report.dashboardHref === "dashboard.html" &&
    report.nextHref === "dashboard.html" && report.nextVisible,
  storage:
    report.tokenStored === CODE_TOKEN && report.tokenNotInSessionStore === null &&
    report.memberStored?.username === "@youssef.amrani" && report.memberStored?.memberId === "ID100042",
  logout:
    report.logoutCalled && report.afterLogoutForm && report.afterLogoutToken === null &&
    report.afterLogoutMember === null && report.passwordCleared,
  restore:
    report.restoredVisible && report.restoredFormHidden && report.restoredName === "@youssef.amrani" &&
    report.restoredSessionCall && report.restoredMessage.includes("still active") && report.restoredNotice,
  deadToken: report.deadTokenStaysOnForm && report.deadTokenCleared === null,
  restoredRestricted:
    report.restoredRestrictedVisible && report.restoredRestrictedNotice &&
    report.restoredRestrictedTitle.includes("not activated"),
  noErrors:
    [report.errors1, report.restoredErrors, report.deadTokenErrors, report.restoredRestrictedErrors].every((list) => list.length === 0),
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);

console.log(report);
console.log("checks:", failed.length ? `FAILED ${failed.join(", ")}` : "all pass");
process.exit(failed.length ? 1 : 0);
