/**
 * rest.html smoke test (jsdom, no network).
 *
 *   node tools/rest-smoke.mjs
 *
 * Pass 1 — step 1: the email and the phone are validated here, and the server's
 *          `not_found` / `phone` answers land on the right field. A good pair
 *          issues the code, shows which channels carried it and moves to step 2.
 * Pass 2 — step 2: a malformed code never reaches the server, a wrong code keeps
 *          the attempt count, the right one opens step 3 with the account rows.
 * Pass 3 — step 3: short password, mismatched pair, then the change: the done
 *          panel carries the **new** code, the recovery link, the .txt body and
 *          the three closed step dots.
 * Pass 4 — the recovery link: `?recovry=` goes straight to the password step,
 *          and a spent link falls back to step 1 with an explanation.
 * Pass 5 — the device path: refuses without a device id, sends `p_device`, tells
 *          "another device's code" from "this browser is not the device", answers
 *          "check this device" with a verdict, and finishes.
 * Pass 6 — the resend cooldown after step 1.
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "rest.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");

const MEMBER = {
  id: "5d9e05a4-be29-4832-9a8c-03d595f4f50b",
  member_id: "ID100042",
  member_code: "000042",
  username: "@youssef.amrani",
  full_name: "Youssef El Amrani",
  email: "youssef@example.com",
  phone_number: "+212 6 12 34 56 78",
  country: "Morocco",
  status: "active",
  created_at: "2026-10-31T20:00:00Z",
};

const NEW_CODE = "OW-7K9P-4X2M-8Q6R";
const TICKET = "f".repeat(48);

/** what the fake server answers; the test switches it before each call */
const server = {
  start: "ok", // ok | not_found | phone | wait | locked
  code: "ok", // ok | wrong | expired
  reset: "ok", // ok | password
  link: "ok", // ok | bad
  device: "ok", // ok | other_device | unknown_device
  check: "bound", // bound | unbound | no_identity
  attemptsLeft: 4,
};

const calls = [];
const bodies = [];
let blobText = "";

function reply(data) {
  return Promise.resolve({
    ok: true,
    status: 200,
    json: async () => data,
    text: async () => JSON.stringify(data),
  });
}

function stubFetch(url, opts = {}) {
  const href = String(url);
  calls.push(href);
  const body = opts.body ? JSON.parse(opts.body) : {};
  bodies.push({ href, body });

  if (href.includes("/rpc/recovery_start")) {
    if (server.start === "not_found") return reply({ ok: false, error: "not_found" });
    if (server.start === "phone") return reply({ ok: false, error: "phone" });
    if (server.start === "wait") return reply({ ok: false, error: "wait", retry_after: 42 });
    if (server.start === "locked") return reply({ ok: false, error: "locked", until: "2026-11-01T23:30:00Z" });
    return reply({
      ok: true,
      member_id: MEMBER.member_id,
      username: MEMBER.username,
      full_name: MEMBER.full_name,
      masked_email: "y*********@example.com",
      masked_phone: "+212 6 1***678",
      channels: { email: true, telegram: true },
      expires_at: "2026-11-01T23:10:00Z",
      restricted: false,
    });
  }

  if (href.includes("/rpc/recovery_verify")) {
    if (server.code === "wrong") return reply({ ok: false, error: "code", attempts_left: server.attemptsLeft });
    if (server.code === "expired") return reply({ ok: false, error: "expired" });
    return reply({ ok: true, ticket: TICKET, expires_at: "2026-11-01T23:20:00Z", member: MEMBER });
  }

  if (href.includes("/rpc/recovery_link")) {
    if (server.link === "bad") return reply({ ok: false, error: "code" });
    return reply({ ok: true, ticket: TICKET, expires_at: "2026-11-01T23:20:00Z", member: MEMBER });
  }

  if (href.includes("/rpc/recovery_reset")) {
    if (server.reset === "password") return reply({ ok: false, error: "password" });
    return reply({
      ok: true,
      via: "code",
      recovery_code: NEW_CODE,
      recovery_link: `rest.html?recovry=${NEW_CODE}`,
      member: MEMBER,
    });
  }

  if (href.includes("/rpc/recovery_device_status")) {
    if (server.check === "unbound") return reply({ ok: true, device: true, identity: true, bound: false, codes: 1 });
    if (server.check === "no_identity") return reply({ ok: true, device: true, identity: false, bound: false, codes: 0 });
    return reply({ ok: true, device: true, identity: true, bound: true, codes: 1 });
  }

  if (href.includes("/rpc/recovery_device")) {
    if (server.device === "other_device") return reply({ ok: false, error: "device_not_bound", reason: "other_device" });
    if (server.device === "unknown_device") return reply({ ok: false, error: "device_not_bound", reason: "unknown_device" });
    return reply({
      ok: true,
      via: "device",
      recovery_code: NEW_CODE,
      recovery_link: `rest.html?recovry=${NEW_CODE}`,
      member: MEMBER,
    });
  }

  return reply([]);
}

/* ------------------------------------------------------------------ */
/* one page instance                                                  */
/* ------------------------------------------------------------------ */
async function boot(pass, { search = "", device = "" } = {}) {
  const dom = new JSDOM(html, { url: `http://localhost/rest.html${search}`, pretendToBeVisual: true });
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
  globalThis.FormData = window.FormData;
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

  // the download is captured instead of written to disk
  blobText = "";
  const grab = (blob) => {
    Promise.resolve(blob.text ? blob.text() : "").then((text) => {
      blobText = text;
    });
    return "blob:rest-test";
  };
  window.URL.createObjectURL = grab;
  window.URL.revokeObjectURL = () => {};
  globalThis.URL.createObjectURL = grab;
  globalThis.URL.revokeObjectURL = () => {};
  window.HTMLAnchorElement.prototype.click = function noop() {};

  globalThis.fetch = stubFetch;

  window.localStorage.clear();
  window.sessionStorage.clear();
  if (device) window.localStorage.setItem("1w.device", device);

  const mod = await import(`file://${join(root, "assets/js/rest.js")}?pass=${pass}`);
  await mod.initRest();
  await new Promise((r) => setTimeout(r, 160));

  const qs = (sel) => window.document.querySelector(sel);
  const qsa = (sel) => Array.from(window.document.querySelectorAll(sel));
  const text = (sel) => qs(sel)?.textContent.replace(/\s+/g, " ").trim() || "";
  const click = (el) => el?.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
  const wait = (ms = 120) => new Promise((r) => setTimeout(r, ms));
  const setInput = (sel, value) => {
    const input = qs(sel);
    input.value = value;
    input.dispatchEvent(new window.Event("input", { bubbles: true }));
    return input;
  };
  const submit = (step) => qs(`[data-rc-form="${step}"]`).dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  const errorFor = (name) => {
    const node = qs(`[data-err="${name}"]`);
    return node && !node.hidden ? node.textContent.trim() : "";
  };
  const shownPanel = () => qsa("[data-rc-panel]").find((panel) => !panel.hidden)?.dataset.rcPanel || "";
  const alertFor = (step) => {
    const box = qs(`[data-rc-alert="${step}"]`);
    return box && !box.hidden ? text(`[data-rc-alert="${step}"] [data-rc-alert-text]`) : "";
  };
  const dots = () => qsa("[data-rc-stepdot]").map((dot) => ({ step: dot.dataset.rcStepdot, current: dot.getAttribute("aria-current") === "step", done: dot.dataset.done === "true" }));

  return { window, document: window.document, qs, qsa, text, click, wait, setInput, submit, errorFor, shownPanel, alertFor, dots, errors, mod };
}

const report = {};
const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), detail });
  if (!ok) report.failures = [...(report.failures || []), `${name}${detail ? ` — ${detail}` : ""}`];
}

/* ------------------------------------------------------------------ */
/* pass 1 — email + phone                                             */
/* ------------------------------------------------------------------ */
{
  Object.assign(server, { start: "ok", code: "ok", reset: "ok", link: "ok", device: "ok" });
  calls.length = 0;
  const p = await boot(1);

  report.openedAt = p.shownPanel();
  report.stepOneCurrent = p.dots()[0].current;
  report.stepThreeHidden = p.qs('[data-rc-panel="password"]').hidden;

  // empty form
  p.submit("identity");
  await p.wait(60);
  report.emptyEmailError = p.errorFor("email");

  // bad email
  p.setInput("#rc-email", "not-an-email");
  p.setInput("#rc-phone", "+212612345678");
  p.submit("identity");
  await p.wait(60);
  report.badEmailError = p.errorFor("email");
  report.noCallOnBadEmail = !calls.some((c) => c.includes("recovery_start"));

  // short phone
  p.setInput("#rc-email", "youssef@example.com");
  p.setInput("#rc-phone", "12");
  p.submit("identity");
  await p.wait(60);
  report.badPhoneError = p.errorFor("phone");

  // unknown account
  server.start = "not_found";
  p.setInput("#rc-phone", "+212 6 12 34 56 78");
  p.submit("identity");
  await p.wait(140);
  report.notFoundField = p.errorFor("email");
  report.notFoundStays = p.shownPanel();

  // wrong phone
  server.start = "phone";
  p.submit("identity");
  await p.wait(140);
  report.wrongPhoneField = p.errorFor("phone");

  // the pair matches — the code is issued
  server.start = "ok";
  calls.length = 0;
  p.submit("identity");
  await p.wait(160);
  report.sentTo = p.shownPanel();
  report.sentTitle = p.text("[data-rc-sent-title]");
  report.sentText = p.text("[data-rc-sent-text]");
  report.sentChecksChannels = /email/i.test(report.sentText) && /telegram/i.test(report.sentText);
  report.stepTwoCurrent = p.dots()[1].current;
  report.stepOneDone = p.dots()[0].done;
  report.startPayload = bodies.find((c) => c.href.includes("recovery_start"))?.body || {};
  check("the code step is reached", report.sentTo === "code", report.sentTo);
  check("the code step is marked", report.stepTwoCurrent);
}

/* ------------------------------------------------------------------ */
/* pass 6 — the cooldown (kept on pass 1's page)                      */
/* ------------------------------------------------------------------ */
{
  const p = await boot(6);
  p.setInput("#rc-email", "youssef@example.com");
  p.setInput("#rc-phone", "+212612345678");
  server.start = "ok";
  p.submit("identity");
  await p.wait(160);
  report.resendDisabled = p.qs("[data-rc-resend]").disabled;
  report.countdownShown = !p.qs("[data-rc-countdown]").hidden;
  report.countdownText = p.text("[data-rc-countdown]");
  check("resend waits after a send", report.resendDisabled && report.countdownShown);
}

/* ------------------------------------------------------------------ */
/* pass 2 — the code                                                  */
/* ------------------------------------------------------------------ */
{
  Object.assign(server, { start: "ok", code: "ok", reset: "ok" });
  calls.length = 0;
  const p = await boot(2);

  p.setInput("#rc-email", "youssef@example.com");
  p.setInput("#rc-phone", "+212 6 12 34 56 78");
  p.submit("identity");
  await p.wait(160);

  // a code that is too short never reaches the server
  calls.length = 0;
  p.setInput("#rc-code", "OW-12");
  p.submit("code");
  await p.wait(60);
  report.shortCodeError = p.errorFor("code");
  report.noVerifyCall = !calls.some((c) => c.includes("recovery_verify"));

  // the field formats itself
  p.setInput("#rc-code", "ow7k9p4x2m8q6r");
  report.codeFormatted = p.qs("#rc-code").value;

  // wrong code → attempts left, still on step 2
  server.code = "wrong";
  server.attemptsLeft = 4;
  p.setInput("#rc-code", "OW-AAAA-BBBB-CCCC");
  p.submit("code");
  await p.wait(140);
  report.wrongCodeMessage = p.errorFor("code");
  report.wrongCodeStays = p.shownPanel();

  // expired
  server.code = "expired";
  p.submit("code");
  await p.wait(140);
  report.expiredMessage = p.errorFor("code") || p.alertFor("code");

  // the right code
  server.code = "ok";
  calls.length = 0;
  p.setInput("#rc-code", "OW-7K9P-4X2M-8Q6R");
  p.submit("code");
  await p.wait(160);
  report.afterCode = p.shownPanel();
  report.whoTitle = p.text("[data-rc-who-title]");
  report.accountRows = p.qsa("[data-rc-account] > div").length;
  report.accountFirstRow = p.text("[data-rc-account] > div:first-child dd");
  report.stepThreeCurrent = p.dots()[2].current;
  report.verifyPayload = bodies.find((c) => c.href.includes("recovery_verify"))?.body || {};
  check("the code opens step 3", report.afterCode === "password", report.afterCode);
  check("the account is on screen", report.accountRows >= 4 && report.accountFirstRow === MEMBER.member_id, `${report.accountRows}/${report.accountFirstRow}`);

  /* ---------------------------------------------------------------- */
  /* pass 3 — the new password                                       */
  /* ---------------------------------------------------------------- */
  p.setInput("#rc-password", "short");
  p.setInput("#rc-password2", "short");
  p.submit("password");
  await p.wait(60);
  report.shortPasswordError = p.errorFor("password");

  p.setInput("#rc-password", "Str0ngPass!23");
  p.setInput("#rc-password2", "Str0ngPass!24");
  p.submit("password");
  await p.wait(60);
  report.mismatchError = p.errorFor("password2");
  report.noResetYet = !calls.some((c) => c.includes("recovery_reset"));

  // a weak-but-valid password shows the strength hint
  p.setInput("#rc-password", "abcdefgh");
  report.strengthShown = !p.qs("[data-rc-strength]").hidden;
  report.strengthLabel = p.text("[data-rc-strength-label]");

  calls.length = 0;
  p.setInput("#rc-password", "Str0ngPass!23");
  p.setInput("#rc-password2", "Str0ngPass!23");
  p.submit("password");
  await p.wait(180);
  report.afterReset = p.shownPanel();
  report.resetPayload = bodies.find((c) => c.href.includes("recovery_reset"))?.body || {};
  report.newCode = p.text("[data-rc-code]");
  report.newLink = p.text("[data-rc-link]");
  report.doneRows = p.qsa("[data-rc-details] > div").length;
  report.allDotsDone = p.dots().every((d) => d.done && !d.current);
  report.passwordCleared = p.qs("#rc-password").value;
  report.revealRestored = p.qs("#rc-password").getAttribute("type");

  // the .txt
  p.click(p.qs("[data-rc-download]"));
  await p.wait(120);
  report.txtHasCode = blobText.includes(`Recovery Code: ${NEW_CODE}`);
  report.txtHasLink = blobText.includes(`Recovery Link: rest.html?recovry=${NEW_CODE}`);
  report.txtHasId = blobText.includes(`Member ID: ${MEMBER.member_id}`);
  report.txtVia = /Recovered through: recovery code/.test(blobText);
  check("the done panel appears", report.afterReset === "done", report.afterReset);
  check("a new code is handed out", report.newCode === NEW_CODE, report.newCode);
  check("the recovery link is handed out", report.newLink === `rest.html?recovry=${NEW_CODE}`, report.newLink);
  check("the .txt carries code, link and member id", report.txtHasCode && report.txtHasLink && report.txtHasId);
  check("the ticket is the only thing sent to the reset", report.resetPayload.p_ticket === TICKET && report.resetPayload.p_password === "Str0ngPass!23", JSON.stringify(report.resetPayload));
}

/* ------------------------------------------------------------------ */
/* pass 4 — the recovery link                                         */
/* ------------------------------------------------------------------ */
{
  Object.assign(server, { link: "ok", reset: "ok" });
  calls.length = 0;
  const p = await boot(4, { search: `?recovry=${NEW_CODE}` });
  report.linkOpensAt = p.shownPanel();
  report.linkWho = p.text("[data-rc-who-title]");
  report.linkPrefilled = p.qs("#rc-email").value;
  report.linkPayload = bodies.find((c) => c.href.includes("recovery_link"))?.body || {};
  report.linkStepSkipped = p.dots()[1].current === false && p.dots()[2].current === true;
  check("the link opens the password step", report.linkOpensAt === "password", report.linkOpensAt);
  check("the link pre-fills the account", report.linkPrefilled === MEMBER.email, report.linkPrefilled);

  // a spent link falls back to step 1 with an explanation
  server.link = "bad";
  const dead = await boot("4b", { search: `?recovry=${NEW_CODE}` });
  report.deadLinkStep = dead.shownPanel();
  report.deadLinkAlert = dead.alertFor("identity");
  check("a spent link returns to step 1", report.deadLinkStep === "identity", report.deadLinkStep);
  check("a spent link explains itself", /no longer valid/i.test(report.deadLinkAlert), report.deadLinkAlert);
}

/* ------------------------------------------------------------------ */
/* pass 5 — the device path                                           */
/* ------------------------------------------------------------------ */
{
  Object.assign(server, { device: "ok" });
  const bare = await boot(5, {});
  bare.click(bare.qs('[data-rc-go="device"]'));
  await bare.wait(60);
  report.devicePanel = bare.shownPanel();
  report.deviceStateNoId = bare.text("[data-rc-device-state]");
  check("the device panel opens without an id", /no device id/i.test(report.deviceStateNoId), report.deviceStateNoId);

  server.device = "other_device";
  calls.length = 0;
  const p = await boot("5b", { device: "9E:3D:EB:E8:B8:50" });
  p.click(p.qs('[data-rc-go="device"]'));
  await p.wait(60);
  report.deviceStateWithId = p.text("[data-rc-device-state]");
  report.devicePrefillEmpty = p.qs("#rc-device-email").value;

  p.setInput("#rc-name", "Youssef El Amrani");
  p.setInput("#rc-device-phone", "+212 6 12 34 56 78");
  p.setInput("#rc-device-email", "youssef@example.com");
  p.setInput("#rc-view-code", "424242");
  p.setInput("#rc-device-password", "Str0ngPass!23");
  p.submit("device");
  await p.wait(160);
  report.deviceRefusedField = p.errorFor("view_code");
  report.devicePayload = bodies.find((c) => c.href.includes("recovery_device"))?.body || {};
  report.deviceSendsId = report.devicePayload.p_device === "9E:3D:EB:E8:B8:50";

  // the other refusal: this browser holds none of the account's original codes
  server.device = "unknown_device";
  p.submit("device");
  await p.wait(160);
  report.deviceUnknownField = p.errorFor("view_code");

  // "check this device" — a verdict before the code is typed
  server.check = "bound";
  calls.length = 0;
  p.click(p.qs("[data-rc-device-check]"));
  await p.wait(140);
  report.checkBoundText = p.text("[data-rc-device-state]");
  report.checkBoundFlag = p.qs("[data-rc-device-state]").dataset.bound;
  report.checkPayload = bodies.find((c) => c.href.includes("recovery_device_status"))?.body || {};

  server.check = "unbound";
  p.click(p.qs("[data-rc-device-check]"));
  await p.wait(140);
  report.checkUnboundText = p.text("[data-rc-device-state]");
  report.checkUnboundFlag = p.qs("[data-rc-device-state]").dataset.bound;


  server.device = "ok";
  calls.length = 0;
  p.submit("device");
  await p.wait(180);
  report.deviceDone = p.shownPanel();
  report.deviceNewCode = p.text("[data-rc-code]");
  report.deviceVia = bodies.filter((c) => c.href.includes("recovery_device")).pop()?.body.p_view_code === "424242";
  check("a code of another device is refused", /belongs to another device/i.test(report.deviceRefusedField), report.deviceRefusedField);
  check("an unbound browser is refused with its own words", /was created on this browser|not the linked device/i.test(report.deviceUnknownField), report.deviceUnknownField);
  check("the check reports a bound device", report.checkBoundFlag === "true", report.checkBoundText);
  check("the check reports an unbound device", report.checkUnboundFlag === "false", report.checkUnboundText);
  check("the device path finishes", report.deviceDone === "done", report.deviceDone);
  check("the device id travels with the request", report.deviceSendsId, JSON.stringify(report.devicePayload));
  check("the viewing code travels with the request", report.deviceVia);
}

/* ------------------------------------------------------------------ */
/* markup + wiring                                                    */
/* ------------------------------------------------------------------ */
{
  calls.length = 0;
  const p = await boot("markup");
  report.panels = p.qsa("[data-rc-panel]").map((panel) => panel.dataset.rcPanel);
  report.forms = p.qsa("[data-rc-form]").map((form) => form.dataset.rcForm);
  report.stepDots = p.qsa("[data-rc-stepdot]").length;
  report.cssLinks = Array.from(p.document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.getAttribute("href"));
  report.hasRestCss = report.cssLinks.some((href) => href.startsWith("assets/css/rest.css"));
  report.noEmoji = !/[\u{1F300}-\u{1FAFF}]/u.test(p.document.body.innerHTML);
  report.iconsHydrated = p.qsa("svg.ico").length;
  report.fetchesOnBoot = calls.length;
  check("five panels, four forms", report.panels.length === 5 && report.forms.length === 4, `${report.panels.length}/${report.forms.length}`);
  check("rest.css is loaded", report.hasRestCss);
  check("the icons are inline svg", report.iconsHydrated > 10, String(report.iconsHydrated));
  check("no console errors", p.errors.length === 0, p.errors.join(" | "));
}

report.checks = checks.length;
report.passed = checks.filter((c) => c.ok).length;
report.failed = checks.filter((c) => !c.ok).length;
console.log(JSON.stringify(report, null, 2));
console.log(`checks: ${report.passed}/${report.checks} pass`);
process.exit(report.failed ? 1 : 0);
