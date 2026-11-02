/**
 * Visit tracking smoke test.
 *   node tools/visit-smoke.mjs
 *
 * Five scenarios, each in its own process:
 *   1. rpc       — log_visit answers; the payload carries page, IP, country, session id
 *   2. fallback  — log_visit is down; the client inserts the row itself
 *   3. slow      — the geo-IP service answers after the 2.5 s window; annotate_visit fills the row
 *   4. identity  — visitor_id is one stable 6-digit number per browser
 *   5. session   — visit_id lives as long as the browser stays open, one row per page,
 *                  and a reload adds nothing
 */
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const MODES = ["rpc", "fallback", "slow", "identity", "session"];
const MODE = MODES.includes(process.env.VISIT_MODE) ? process.env.VISIT_MODE : "rpc";

const GEO = { success: true, ip: "41.140.12.34", country: "Morocco", country_code: "MA", city: "Casablanca" };
const reply = (data) =>
  Promise.resolve({ ok: true, status: 200, json: async () => data, text: async () => JSON.stringify(data) });

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

/* ================================================================== */
/* 4 · identity: visitor_id is one stable number per browser          */
/* ================================================================== */
if (MODE === "identity") {
  const sessionUrl = `file://${join(root, "assets/js/session.js")}`;
  const checks = {};
  const report = {};

  localStorage.clear();
  document.cookie = "1w_vid=; Max-Age=0; Path=/";

  const first = await import(`${sessionUrl}?case=fresh`);
  const id = first.visitorId();
  report.generated = id;
  checks.sixDigits = /^[0-9]{6}$/.test(id) && id !== "000000";
  checks.stableWithinPage = id === first.visitorId();
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

/* ================================================================== */
/* 5 · session: one visit_id per browser session, one row per page    */
/* ================================================================== */
if (MODE === "session") {
  const visitsUrl = `file://${join(root, "assets/js/visits.js")}`;
  let created = 0;
  let sessionSeq = 0;
  const logBodies = [];

  globalThis.fetch = (url, options = {}) => {
    const href = String(url);
    if (href.includes("/rpc/log_visit")) {
      created += 1;
      const body = options.body ? JSON.parse(options.body) : {};
      logBodies.push(body);
      // mimic the server: reuse the session id when the browser sends one
      const sessionId = body.p_visit || `visit${String((sessionSeq += 1)).padStart(6, "0")}`;
      return reply({
        visit_id: sessionId,
        row_id: 100 + created,
        member_visit_id: null,
        member_row_id: null,
        frequency: created,
      });
    }
    if (href.includes("/rpc/finish_visit") || href.includes("/rpc/annotate_visit")) return reply(true);
    if (href.includes("ipwho.is")) return reply(GEO);
    return reply([]);
  };

  localStorage.clear();
  sessionStorage.clear();

  const readSession = () => JSON.parse(localStorage.getItem("1w.visit.session") || "null");
  const boot = async (tag) => {
    const mod = await import(`${visitsUrl}?${tag}`);
    await mod.startVisitTracking();
    await new Promise((r) => setTimeout(r, 60));
    return mod;
  };
  const state = () => {
    const session = readSession();
    return { id: session?.id || null, rowId: session?.rowId ?? null, path: session?.path || null, raw: session };
  };

  const report = {};
  const checks = {};

  // 1 · first page opens the browser session
  await boot("p1");
  const first = state();
  report.firstVisitId = first.id;
  report.firstRowId = first.rowId;
  checks.firstPageOpensSession = created === 1 && first.id === "visit000001" && first.rowId === 101;
  checks.sessionHasOneTab = Object.keys(first.raw?.tabs || {}).length === 1;

  // 2 · reloading the same page adds nothing: same session, same row
  window.dispatchEvent(new window.Event("pagehide"));
  await boot("p2");
  const reload = state();
  report.afterReload = { id: reload.id, rowId: reload.rowId };
  checks.reloadAddsNoRow = created === 1 && reload.id === first.id && reload.rowId === first.rowId;

  // 3 · another page: new row, but the SAME visit id
  window.history.pushState({}, "", "/watch.html?tv=1399");
  window.dispatchEvent(new window.Event("pagehide"));
  await boot("p3");
  const moved = state();
  report.afterPageChange = { id: moved.id, rowId: moved.rowId };
  checks.pageChangeAddsRow = created === 2 && moved.rowId === 102;
  checks.pageChangeKeepsVisitId = moved.id === first.id;
  checks.sessionFollowsPage = moved.path === "/watch.html?tv=1399";

  // 4 · reloading that page keeps its row
  window.dispatchEvent(new window.Event("pagehide"));
  await boot("p4");
  const reload2 = state();
  report.afterReloadWatch = { id: reload2.id, rowId: reload2.rowId };
  checks.reloadOfSecondPageKeepsRow = created === 2 && reload2.rowId === moved.rowId && reload2.id === moved.id;

  // 5 · a second tab on another page: another row, same session
  window.history.pushState({}, "", "/index.html");
  sessionStorage.setItem("1w.visit.tab", "tab-two");
  await boot("p5");
  const otherTab = state();
  report.afterSecondTab = { id: otherTab.id, rowId: otherTab.rowId };
  checks.secondTabAddsRow = created === 3 && otherTab.rowId === 103 && otherTab.id === first.id;

  // 6 · the element after "?" is part of the page identity
  window.history.pushState({}, "", "/watch.html?movie=1765072");
  window.dispatchEvent(new window.Event("pagehide"));
  sessionStorage.setItem("1w.visit.tab", "tab-three");
  await boot("p6");
  const movieA = state();
  report.moviePage = { id: movieA.id, rowId: movieA.rowId };
  checks.contentIdAddsRow = created === 4 && movieA.rowId === 104 && movieA.id === first.id;

  window.dispatchEvent(new window.Event("pagehide"));
  await boot("p7");
  const movieAReload = state();
  report.moviePageReload = { id: movieAReload.id, rowId: movieAReload.rowId };
  checks.reloadOfTitleKeepsRow = created === 4 && movieAReload.rowId === movieA.rowId;

  window.history.pushState({}, "", "/watch.html?movie=550");
  window.dispatchEvent(new window.Event("pagehide"));
  await boot("p8");
  const movieB = state();
  report.otherMoviePage = { id: movieB.id, rowId: movieB.rowId };
  checks.otherContentIdAddsRow = created === 5 && movieB.rowId === 105 && movieB.id === first.id;

  // 7 · every page closed (browser closed) → the next page opens a NEW visit id
  window.dispatchEvent(new window.Event("pagehide"));
  const closed = readSession();
  closed.tabs = {};
  closed.closedAt = Date.now() - 60000;
  closed.lastSeen = closed.closedAt;
  localStorage.setItem("1w.visit.session", JSON.stringify(closed));
  sessionStorage.setItem("1w.visit.tab", "tab-four");
  window.history.pushState({}, "", "/watch.html?movie=1765072");
  await boot("p9");
  const afterBrowserClose = state();
  report.afterBrowserClose = { id: afterBrowserClose.id, rowId: afterBrowserClose.rowId };
  checks.browserCloseOpensNewVisit =
    created === 6 && afterBrowserClose.id === "visit000002" && afterBrowserClose.rowId === 106;
  checks.sessionIdSentToServer =
    logBodies[1]?.p_visit === "visit000001" && logBodies[5]?.p_visit === null;

  const failed = Object.entries(checks).filter(([, ok]) => !ok).map(([name]) => name);
  console.log(JSON.stringify({ mode: MODE, report, checks }, null, 2));
  console.log("checks:", failed.length ? `FAILED ${failed.join(", ")}` : "all pass");
  process.exit(failed.length ? 1 : 0);
}

/* ================================================================== */
/* 1-3 · the page boot itself                                         */
/* ================================================================== */
const calls = [];
let directInsert = null;
let visitBody = null;
let annotateBody = null;

globalThis.fetch = (url, options = {}) => {
  const target = String(url);
  calls.push(target);

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

  if (target.includes("/rpc/log_visit")) {
    visitBody = options.body ? JSON.parse(options.body) : null;
    if (MODE === "fallback") {
      const body = JSON.stringify({ message: "Could not find the function public.log_visit" });
      return Promise.resolve({ ok: false, status: 404, json: async () => JSON.parse(body), text: async () => body });
    }
    const data = {
      visit_id: "visit000042",
      row_id: 4242,
      member_visit_id: null,
      member_row_id: null,
      frequency: 3,
    };
    return reply(data);
  }

  if (target.includes("/rpc/annotate_visit")) {
    annotateBody = options.body ? JSON.parse(options.body) : null;
    return reply(true);
  }

  if (target.includes("/rpc/finish_visit")) return reply(true);

  if (target.includes("/visitor_visits")) {
    directInsert = { method: options.method, prefer: options.headers?.Prefer, body: options.body };
    return Promise.resolve({ ok: true, status: 201, json: async () => null, text: async () => "" });
  }

  return reply([]);
};

await import(`file://${join(root, "assets/js/app.js")}`);

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
  firstLoadHasNoSession: visitBody ? visitBody.p_visit === null : null,
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
  firstLoadAsksForNewSession: MODE === "fallback" ? true : report.firstLoadHasNoSession === true,
  geoAnswerCached: MODE === "slow" ? true : report.geoCache,
  fallbackRowHasAddress: MODE === "fallback" ? report.directInsertRow?.visitor_address === GEO.ip : true,
  fallbackRowHasCountry: MODE === "fallback" ? report.directInsertRow?.visitor_location === GEO.country : true,
  fallbackRowHasPage: MODE === "fallback" ? report.directInsertRow?.visitor_page === "/index.html" : true,
  fallbackRowHasSessionId: MODE === "fallback" ? /^visit[0-9]{6,}$/.test(report.directInsertRow?.visit_id || "") : true,
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

let exitCode = failed.length ? 1 : 0;
for (const mode of ["fallback", "slow", "identity", "session"]) {
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
