/**
 * register.html smoke test (jsdom, no network).
 *
 *   node tools/register-smoke.mjs
 *
 * Exercises the whole flow against a stubbed Supabase: empty submit, password
 * mismatch, terms, live availability, a rejected duplicate, a successful
 * registration, the success card, the .txt export and the login button
 * (inactive → notice, active → login.html).
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const html = readFileSync(join(root, "register.html"), "utf8").replace(/<script[^>]*src="[^"]*"[^>]*><\/script>/g, "");
const dom = new JSDOM(html, { url: "http://localhost/register.html?plan=gold&duration=3", pretendToBeVisual: true });
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
// a writable stand-in for location: jsdom refuses real navigation
globalThis.location = { search: "?plan=gold&duration=3", href: "http://localhost/register.html?plan=gold&duration=3", protocol: "http:", pathname: "/register.html" };

/* ------------------------------------------------------------------ */
/* stub                                                               */
/* ------------------------------------------------------------------ */
const reply = (data) =>
  Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

const TAKEN_USER = "cineaura";
const TAKEN_EMAIL = "taken@example.com";
const CODE = "OW-7K9P-4X2M-8Q6R";

let mode = "ok"; // "ok" | "duplicate"
const calls = [];
let registerBody = null;

const MEMBER = {
  id: "3f0c2f5e-8a41-4d1c-9b0e-88a1f2c4d5e6",
  member_id: "ID100042",
  member_code: "000031",
  full_name: "Youssef El Amrani",
  username: "@youssef.amrani",
  email: "youssef@example.com",
  phone_number: "+212 612 345 678",
  birth_date: "1996-04-12",
  country: "Morocco",
  status: "inactive",
  terms_accepted: true,
  terms_accepted_at: "2026-10-31T20:00:00Z",
  created_at: "2026-10-31T20:00:00Z",
};

let accountStatus = "inactive";

globalThis.fetch = (url, opts = {}) => {
  const href = String(url);
  calls.push(href);
  const body = opts.body ? JSON.parse(opts.body) : {};

  if (href.includes("/rpc/member_check")) {
    const handle = String(body.p_username || "").replace(/^@+/, "").toLowerCase();
    const email = String(body.p_email || "").toLowerCase();
    return reply({
      username_taken: handle === TAKEN_USER,
      email_taken: email === TAKEN_EMAIL,
    });
  }
  if (href.includes("/rpc/member_register")) {
    registerBody = body;
    if (mode === "duplicate") return reply({ ok: false, error: "username_taken" });
    return reply({ ok: true, recovery_code: CODE, member: MEMBER });
  }
  if (href.includes("/rpc/member_status")) {
    return reply({ found: true, username: MEMBER.username, status: accountStatus, account_status: accountStatus });
  }
  return reply([]);
};

/* capture the download anchor instead of navigating */
const downloads = [];
window.HTMLAnchorElement.prototype.click = function click() {
  downloads.push({ download: this.getAttribute("download"), href: this.href });
};
let lastBlob = null;
globalThis.URL.createObjectURL = (blob) => {
  lastBlob = blob;
  return "blob:mock";
};
globalThis.URL.revokeObjectURL = () => {};

/* ------------------------------------------------------------------ */
/* helpers                                                            */
/* ------------------------------------------------------------------ */
const qs = (sel) => document.querySelector(sel);
const text = (sel) => qs(sel)?.textContent.trim() || "";
const wait = (ms = 80) => new Promise((r) => setTimeout(r, ms));
const setInput = (name, value) => {
  const input = qs(`[name="${name}"]`);
  input.value = value;
  input.dispatchEvent(new window.Event("input", { bubbles: true }));
  return input;
};
const blur = (name) => qs(`[name="${name}"]`).dispatchEvent(new window.Event("blur", { bubbles: true }));
const submit = () => qs("[data-regform]").dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
const errorFor = (name) => {
  const node = qs(`[data-err="${name}"]`);
  return node && !node.hidden ? node.textContent.trim() : "";
};
const click = (el) => el.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));

/* ------------------------------------------------------------------ */
/* run                                                                */
/* ------------------------------------------------------------------ */
const { initRegister, __debug } = await import(`file://${join(root, "assets/js/register.js")}`);
await initRegister();
await wait(60);

const report = { calls: [] };
report.fields = document.querySelectorAll(".reg-form .reg-field").length;
report.countries = document.querySelectorAll("#reg-countries option").length;
report.prefixInDom = document.querySelectorAll(".reg-input__prefix, .reg-input__state").length;
report.handleIdle = text("[data-handle-preview]");
report.maxBirth = qs("#reg-birth")?.max || "";
report.planChip = text("[data-reg-plan-name]");
report.planMeta = text("[data-reg-plan-meta]");

/* 1. empty submit ------------------------------------------------ */
submit();
await wait(60);
report.emptyFullNameError = errorFor("full_name");
report.emptyTermsError = errorFor("terms");
report.emptySubmitNoCall = !calls.some((c) => c.includes("/rpc/member_register"));

/* 2. availability ------------------------------------------------ */
setInput("username", TAKEN_USER);
blur("username");
await wait(160);
report.takenChip = text("[data-username-state]");
report.takenError = errorFor("username");

setInput("username", "Youssef.Amrani");
blur("username");
await wait(160);
report.availableChip = text("[data-username-state]");
report.availableState = qs("[data-username-state]")?.dataset.state;
report.handlePreview = text("[data-handle-preview]");
report.usernameValue = qs('[name="username"]').value;

/* 3. password mismatch ------------------------------------------- */
setInput("full_name", "Youssef El Amrani");
setInput("email", "youssef@example.com");
setInput("phone", "+212 612 345 678");
setInput("password", "Str0ngPass!23");
setInput("password_confirm", "Str0ngPass!24");
setInput("birth_date", "1996-04-12");
setInput("country", "Morocco");
qs("[data-terms]").checked = true;
qs("[data-terms]").dispatchEvent(new window.Event("change", { bubbles: true }));
submit();
await wait(60);
report.mismatchError = errorFor("password_confirm");
report.mismatchNoCall = !calls.some((c) => c.includes("/rpc/member_register"));

/* 4. server rejects a duplicate ---------------------------------- */
mode = "duplicate";
setInput("password_confirm", "Str0ngPass!23");
submit();
await wait(180);
report.rejectedAlert = text("[data-reg-error-text]");
report.rejectedError = errorFor("username");
report.rejectedStillOnForm = qs("[data-reg-form]").hidden === false;
report.rejectedNoSuccess = qs("[data-reg-success]").hidden === true;
report.registerPayload = registerBody;
report.passwordSent = registerBody?.p_password;

/* 5. success ----------------------------------------------------- */
mode = "ok";
// the user edits the username the server rejected → the stale answer is dropped
setInput("username", "youssef.amrani");
setInput("email", "youssef@example.com");
submit();
await wait(220);
report.successVisible = qs("[data-reg-success]").hidden === false;
report.formHidden = qs("[data-reg-form]").hidden === true;
report.successTitle = text(".reg-success__title");
report.code = text("[data-reg-code]");
report.memberId = text("[data-reg-member-id]");
report.detailPairs = [...document.querySelectorAll("[data-reg-details] div")].map((row) => row.textContent.trim());
report.passwordInputsEmpty = [...document.querySelectorAll('[name="password"], [name="password_confirm"]')].every((i) => i.value === "");
report.passwordNotOnPage = !document.body.textContent.includes("Str0ngPass!23");
report.codeNotStored = !Object.keys(window.localStorage).some((key) => String(window.localStorage.getItem(key)).includes(CODE)) &&
  !window.localStorage.getItem("1w.register");

/* 6. txt download ------------------------------------------------ */
const txt = __debug.buildTxt();
report.txtHasName = txt.includes("Full Name: Youssef El Amrani");
report.txtHasUser = txt.includes("Username: @youssef.amrani");
report.txtHasCode = txt.includes(`Recovery Code: ${CODE}`);
report.txtInactive = txt.includes("Account Status: Inactive");
report.txtNoPassword = !txt.includes("Str0ngPass!23");
click(qs("[data-reg-download]"));
await wait(60);
report.download = downloads.at(-1) || null;
report.downloadText = lastBlob ? await lastBlob.text() : "";
report.downloadType = lastBlob ? lastBlob.type : "";
report.txtHasId = txt.includes("Member ID: ID100042");

/* 6b. copy the member ID ----------------------------------------- */
click(qs("[data-reg-copy-id]"));
await wait(80);
report.idCopyLabel = qs("[data-reg-copy-id] span").textContent;

/* 7. login button ------------------------------------------------ */
click(qs("[data-reg-login]"));
await wait(160);
report.inactiveNoteShown = qs("[data-reg-login-note]").hidden === false;
report.inactiveNote = text("[data-reg-login-note]");
report.noNavigationYet = location.href.includes("register.html");

accountStatus = "active";
click(qs("[data-reg-login]"));
await wait(160);
report.activeLoginHref = location.href;

/* ------------------------------------------------------------------ */
/* checks                                                             */
/* ------------------------------------------------------------------ */
const checks = {
  fields: report.fields === 9,
  noOverlayOnInputs: report.prefixInDom === 0 && report.handleIdle === "@yourname",
  countries: report.countries > 90,
  birthLimit: report.maxBirth.length === 10,
  planFromUrl: report.planChip.includes("Gold") && report.planMeta.includes("3 months"),
  emptyValidation: report.emptyFullNameError.length > 0 && report.emptyTermsError.length > 0 && report.emptySubmitNoCall,
  takenHiddenWhileTyping: report.takenChip === "Taken" && report.takenError.includes("already taken"),
  available: report.availableChip === "Available" && report.availableState === "ok",
  handle: report.handlePreview === "@youssef.amrani" && report.usernameValue === "Youssef.Amrani",
  passwordMismatch: report.mismatchError.includes("do not match") && report.mismatchNoCall,
  duplicateRejected: report.rejectedAlert.includes("already taken") && report.rejectedError.includes("already taken") &&
    report.rejectedStillOnForm && report.rejectedNoSuccess,
  payloadComplete:
    report.registerPayload?.p_username === "youssef.amrani" &&
    report.registerPayload?.p_email === "youssef@example.com" &&
    report.registerPayload?.p_full_name === "Youssef El Amrani" &&
    report.registerPayload?.p_phone === "+212 612 345 678" &&
    report.registerPayload?.p_birth_date === "1996-04-12" &&
    report.registerPayload?.p_country === "Morocco" &&
    report.registerPayload?.p_terms === true &&
    report.passwordSent === "Str0ngPass!23",
  successCard: report.successVisible && report.formHidden && report.successTitle === "Registration complete" && report.code === CODE,
  memberId: report.memberId === "ID100042" && report.idCopyLabel === "Select and copy",
  details: report.detailPairs.length === 9 &&
    report.detailPairs[0].includes("Member ID") && report.detailPairs[0].includes("ID100042") &&
    report.detailPairs.some((row) => row.includes("Youssef El Amrani")) &&
    report.detailPairs.some((row) => row.includes("@youssef.amrani")) &&
    report.detailPairs.some((row) => row.includes("Inactive")),
  passwordWiped: report.passwordInputsEmpty && report.passwordNotOnPage,
  codeNotPersisted: report.codeNotStored,
  txt:
    report.txtHasName && report.txtHasUser && report.txtHasCode && report.txtHasId &&
    report.txtInactive && report.txtNoPassword,
  download:
    report.download?.download === "ONEWORLD-youssef.amrani.txt" &&
    report.download?.href === "blob:mock" &&
    report.downloadText.includes("ONEWORLD") &&
    report.downloadText.includes("Recovery Code: OW-7K9P-4X2M-8Q6R") &&
    report.downloadType.includes("text/plain"),
  inactiveLogin: report.inactiveNoteShown && report.inactiveNote.toLowerCase().includes("inactive") && report.noNavigationYet,
  activeLogin: report.activeLoginHref.startsWith("login.html?") && report.activeLoginHref.includes("youssef.amrani"),
  noErrors: errors.length === 0,
};

const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);

console.log(report);
console.log("checks:", failed.length ? `FAILED ${failed.join(", ")}` : "all pass");
console.log("errors:", errors.length ? errors : "none");
process.exit(failed.length ? 1 : 0);
