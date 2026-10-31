/**
 * Verifies that a normal page boot (app.js) writes a visitor row with the
 * visitor's address and country.
 *   node tools/visit-smoke.mjs
 *
 * Three scenarios run in separate processes:
 *   1. rpc       — log_visit answers, payload carries IP + country
 *   2. fallback  — log_visit is down, the client inserts into visitor_visits itself
 *   3. slow      — the geo-IP service answers after the 2.5 s window, annotate_visit fills the row
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODES = ["rpc", "fallback", "slow", "identity"];
const MODE = MODES.includes(process.env.VISIT_MODE) ? process.env.VISIT_MODE : "rpc";

const GEO = { success: true, ip: "41.140.12.34", country: "Morocco", country_code: "MA", city: "Casablanca" };

const html = readFileSync(join(root, "index.html"), "utf8").replace(
  /<script[^>]*src="[^"]*"[^>]*><\/script>/g,
  ""
);
const dom = new JSDOM(html, { url: "http://localhost/index.html", pretendToBeVisual: true });
const { window } = dom;

const errors = [];
window.addEventListener("error", (e) => errors.push(String(e.error || e.message)));

globalThis.window = window;
globalThis.document = window.document;
globalThis.location = window.location;
globalThis.HTMLElement = window.HTMLElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.localStorage = window.localStorage;
globalThis.sessionStorage = window.sessionStorage;
globalThis.getComputedStyle = window.getComputedStyle.bind(window);
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
const mediaStub = (q) => ({
  matches: false,
  media: q,
  addEventListener() {},
  removeEventListener() {},
  addListener() {},
  removeListener() {},
});
window.matchMedia = mediaStub;
globalThis.matchMedia = mediaStub;
Object.defineProperty(globalThis, "navigator", { value: window.navigator, configurable: true });

/* ------------------------------------------------------------------ */
/* identity scenario: the visitor id must never change for a browser  */
/* ------------------------------------------------------------------ */
if (MODE === "identity") {
  const sessionUrl = `file://${join(root, "assets/js/session.js")}`;
  const checks = {};
  const report = {};

  localStorage.clear();
  document.cookie = "1w_vid=; Max-Age=0; Path=/";

  const first = await import(`${sessionUrl}?case=fresh`);
  const id = first.visitorId();
  const idAgain = first.visitorId();
  report.generated = id;
  checks.sixDigits = /^[0-9]{6}$/.test(id) && id !== "000000";
  checks.stableWithinPage = id === idAgain;
  checks.savedToLocalStorage = JSON.parse(localStorage.getItem("1w.visitor") || "null") === id;
  checks.savedToCookie = document.cookie.includes(`1w_vid=${id}`);

  const reloaded = await import(`${sessionUrl}?case=reload`);
  report.afterReload = reloaded.visitorId();
  checks.sameAfterReload = report.afterReload === id;

  localStorage.removeItem("1w.visitor");
  const fromCookie = await import(`${sessionUrl}?case=cookie`);
  report.fromCookieOnly = fromCookie.visitorId();
  checks.survivesClearedStorage = report.fromCookieOnly === id;

  document.cookie = "1w_vid=; Max-Age=0; Path=/";
  localStorage.setItem("1w.visitor", JSON.stringify(id));
  const fromStorage = await import(`${sessionUrl}?case=storage`);
  report.fromStorageOnly = fromStorage.visitorId();
  checks.survivesClearedCookie = report.fromStorageOnly === id;

  // a browser that refuses storage entirely still keeps one id for the page
  const blocked = new Proxy(
    {},
    {
      get: () => () => {
        throw new Error("storage blocked");
      },
    }
  );
  Object.defineProperty(globalThis, "localStorage", { value: blocked, configurable: true });
  document.cookie = "1w_vid=; Max-Age=0; Path=/";
  const privateMode = await import(`${sessionUrl}?case=private`);
  report.privateModeId = privateMode.visitorId();
  checks.oneIdWhenStorageBlocked =
    /^[0-9]{6}$/.test(report.privateModeId) && privateMode.visitorId() === report.privateModeId;

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  console.log(JSON.stringify({ mode: MODE, report, checks }, null, 2));
  console.log("checks:", failed.length ? `FAILED ${failed.join(", ")}` : "all pass");
  process.exit(failed.length ? 1 : 0);
}

const calls = [];
let directInsert = null;
let visitBody = null;
let annotateBody = null;

globalThis.fetch = (url, options = {}) => {
  const target = String(url);
  calls.push(target);

  // ---- geo-IP services -------------------------------------------------
  if (target.includes("ipwho.is")) {
    const payload = JSON.stringify(GEO);
    const answer = { ok: true, status: 200, json: async () => JSON.parse(payload), text: async () => payload };
    return MODE === "slow"
      ? new Promise((resolve) => setTimeout(() => resolve(answer), 3000))
      : Promise.resolve(answer);
  }
  if (target.includes("ipapi.co") || target.includes("ipify")) {
    return Promise.resolve({ ok: false, status: 429, json: async () => ({}), text: async () => "" });
  }

  // ---- visit writes ----------------------------------------------------
  if (target.includes("/rpc/log_visit")) {
    visitBody = options.body ? JSON.parse(options.body) : null;
    if (MODE === "fallback") {
      const body = JSON.stringify({ message: "Could not find the function public.log_visit" });
      return Promise.resolve({ ok: false, status: 404, json: async () => JSON.parse(body), text: async () => body });
    }
    const data = { visit_id: "visit000042", member_visit_id: null, frequency: 3 };
    return Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });
  }

  if (target.includes("/rpc/annotate_visit")) {
    annotateBody = options.body ? JSON.parse(options.body) : null;
    return Promise.resolve({ ok: true, status: 200, json: async () => true, text: async () => "true" });
  }

  if (target.includes("/visitor_visits")) {
    directInsert = { method: options.method, prefer: options.headers?.Prefer, body: options.body };
    return Promise.resolve({ ok: true, status: 201, json: async () => null, text: async () => "" });
  }

  return Promise.resolve({ ok: true, status: 200, json: async () => [], text: async () => "[]" });
};

await import(`file://${join(root, "assets/js/app.js")}`);

// the visit is written after the geo lookup (2.5 s cap at worst)
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
for (let i = 0; i < 12 && !calls.some((c) => c.includes("/rpc/log_visit") || c.includes("/visitor_visits")); i += 1) {
  await wait(300);
}
if (MODE === "slow") {
  for (let i = 0; i < 14 && !annotateBody; i += 1) await wait(300);
}
await wait(200);

const saved = JSON.parse(window.sessionStorage.getItem("1w.visit") || "null");
const report = {
  mode: MODE,
  logVisitCalled: calls.some((c) => c.includes("/rpc/log_visit")),
  visitIdStored: saved?.visitId || null,
  htmlMarker: window.document.documentElement.dataset.visit || null,
  htmlCountry: window.document.documentElement.dataset.country || null,
  payloadAddress: visitBody?.p_address ?? null,
  payloadCountry: visitBody?.p_country ?? null,
  payloadCode: visitBody?.p_code ?? null,
  payloadPage: visitBody?.p_page ?? null,
  geoCache: Boolean(window.sessionStorage.getItem("1w.geo")),
  storedError: JSON.parse(window.localStorage.getItem("1w.visit.error") || "null")?.message || null,
  errors,
};

if (MODE === "fallback") {
  report.directInsertCalled = Boolean(directInsert);
  report.directInsertPrefer = directInsert?.prefer || null;
  report.directInsertRow = directInsert?.body ? JSON.parse(directInsert.body)[0] : null;
}

if (MODE === "slow") {
  report.annotateCalled = Boolean(annotateBody);
  report.annotateAddress = annotateBody?.p_address ?? null;
  report.annotateVisit = annotateBody?.p_visit ?? null;
}

console.log(JSON.stringify(report, null, 2));

const checks = {
  logVisitCalled: report.logVisitCalled,
  visitIdStored: MODE === "rpc" ? report.visitIdStored === "visit000042" : true,
  addressInPayload: MODE === "slow" ? report.payloadAddress === null : report.payloadAddress === GEO.ip,
  countryInPayload: MODE === "slow" ? true : report.payloadCountry === GEO.country,
  codeInPayload: MODE === "slow" ? true : report.payloadCode === GEO.country_code,
  pageSeparateFromCountry: report.payloadPage === "/index.html" || MODE === "fallback",
  geoAnswerCached: MODE === "slow" ? true : report.geoCache,
  fallbackRowHasAddress: MODE === "fallback" ? report.directInsertRow?.visitor_address === GEO.ip : true,
  fallbackRowHasCountry: MODE === "fallback" ? report.directInsertRow?.visitor_location === GEO.country : true,
  fallbackRowHasPage:
    MODE === "fallback" ? report.directInsertRow?.visitor_page === "/index.html" : true,
  slowLookupAnnotatesRow:
    MODE === "slow" ? report.annotateCalled && report.annotateAddress === GEO.ip && report.annotateVisit === "visit000042" : true,
  noErrors: errors.length === 0,
};
const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);

console.log("checks:", failed.length ? `FAILED ${failed.join(", ")}` : "all pass");

if (MODE !== "rpc") {
  console.log("errors:", errors.length ? errors : "none");
  process.exit(failed.length ? 1 : 0);
}

// main process: run the other scenarios in their own module registries
let exitCode = failed.length ? 1 : 0;
for (const mode of ["fallback", "slow", "identity"]) {
  const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], {
    env: { ...process.env, VISIT_MODE: mode },
    encoding: "utf8",
  });
  const line = (child.stdout || "").split("\n").find((l) => l.startsWith("checks:")) || "(no output)";
  console.log(`${mode} scenario:`, child.status === 0 ? "pass" : "FAIL");
  if (child.status !== 0) {
    process.stdout.write(child.stdout || "");
    process.stderr.write(child.stderr || "");
    exitCode = 1;
  } else {
    console.log("  ", line);
  }
}

console.log("errors:", errors.length ? errors : "none");
process.exit(exitCode);
